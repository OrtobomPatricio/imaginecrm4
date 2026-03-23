/**
 * WhatsApp Embedded Signup — Meta Business Integration
 *
 * Flow:
 *   1. Frontend loads Meta JS SDK, calls FB.login() with the config_id
 *   2. User completes WhatsApp Embedded Signup in Meta's popup
 *   3. Frontend captures { code, waba_id, phone_number_id } via window.addEventListener('message')
 *   4. Frontend POSTs to /api/whatsapp/embedded-signup/complete
 *   5. Backend exchanges code → short-lived → long-lived user token
 *   6. Backend subscribes WABA to webhooks (/{waba_id}/subscribed_apps)
 *   7. Backend fetches phone number display info
 *   8. Backend upserts whatsapp_numbers + whatsapp_connections (encrypted token)
 *   9. Returns success → frontend shows "connected"
 *
 * Coexistence Mode:
 *   Enabled via `solution_type=COEXISTENCE` in the Embedded Signup config.
 *   When a user has the WA Business App installed:
 *   - Existing chats stay on the phone app.
 *   - New API-initiated conversations go through Cloud API.
 *   - Inbound messages replicate to both phone app AND webhook.
 *   - Contact list and labels do NOT sync to the API.
 *
 * References:
 *   - https://developers.facebook.com/docs/whatsapp/embedded-signup
 *   - https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
 *   - Graph API version: v21.0 (current recommended for WA ES)
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import * as db from "../db";
import { whatsappNumbers, whatsappConnections } from "../../drizzle/schema";
import { encryptSecret, decryptSecret } from "../_core/crypto";
import { logger, safeError } from "../_core/logger";
import { getOrCreateAppSettings, getPlatformMetaConfig } from "../services/app-settings";
import { sdk } from "../_core/sdk";
import { logAccess, getClientIp } from "../services/security";
import { isMaintenanceActive } from "../_core/middleware/maintenance";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

// ── Auth middleware (same pattern as meta-routes) ──

async function requireAdminAuth(req: Request, res: Response): Promise<{ userId: number; tenantId: number; role: string } | null> {
  const isDev = process.env.NODE_ENV !== "production";
  const devBypassUser = (req as any).devBypassUser;

  let user: any = null;

  if (isDev && devBypassUser) {
    user = devBypassUser;
  } else {
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Autenticación requerida" });
      return null;
    }
  }

  if (!user) {
    res.status(401).json({ error: "Autenticación requerida" });
    return null;
  }

  const role = user.role || "viewer";
  if (!["owner", "admin"].includes(role)) {
    res.status(403).json({ error: "Se requiere rol de Admin o Propietario" });
    return null;
  }

  return { userId: user.id, tenantId: user.tenantId, role };
}

// ── Input validation ──

/** Only digits allowed — prevents SSRF / path traversal via Graph API URLs */
const GRAPH_ID_RE = /^\d{1,30}$/;

const completeSignupSchema = z.object({
  // Accept either access_token (token flow) or code (code flow, legacy)
  access_token: z.string().min(1).max(1024).optional(),
  code: z.string().min(1).max(512).optional(),
  waba_id: z.string().max(30).optional().default(""),
  phone_number_id: z.string().max(30).optional().default(""),
}).refine((data) => data.access_token || data.code, {
  message: "Se requiere access_token o code",
});

const disconnectSchema = z.object({
  connectionId: z.number({ error: "Se requiere connectionId (número entero)" }).int().positive(),
});

// ── Helper: Graph API fetch ──

async function graphGet<T = any>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`);
  // Pass params as query strings (needed for oauth endpoints)
  // but NEVER pass access_token as a query param — use Authorization header.
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url.toString(), { headers });
  const data = await res.json() as any;
  if (!res.ok) {
    const msg = data?.error?.message || `Graph API error ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

async function graphPost<T = any>(path: string, token: string, body?: Record<string, any>): Promise<T> {
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as any;
  if (!res.ok) {
    const msg = data?.error?.message || `Graph API error ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/**
 * POST to OAuth endpoints. Uses query-string params (NOT JSON body, NO Auth header).
 * Meta’s /oauth/access_token for code exchange requires this format.
 */
async function oauthPost<T = any>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { method: "POST" });
  const data = await res.json() as any;
  if (!res.ok) {
    const msg = data?.error?.message || `Graph API error ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ── Routes ──

export function registerEmbeddedSignupRoutes(app: Express) {

  /**
   * GET /api/whatsapp/embedded-signup/config
   * Returns the public configuration needed for the frontend JS SDK.
   * Does NOT leak appSecret or tokens.
   */
  app.get("/api/whatsapp/embedded-signup/config", async (req: Request, res: Response) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth) return;

      const maint = await isMaintenanceActive(auth.tenantId);
      if (maint) return res.status(503).json({ error: "Maintenance", message: maint.message || "Sistema en mantenimiento." });

      const database = await db.getDb();
      const settings = await getOrCreateAppSettings(database, auth.tenantId);
      // Fallback chain: tenant config → platform config (tenant 1) → env vars
      const platformMeta = await getPlatformMetaConfig(database);
      const appId = settings.metaConfig?.appId || platformMeta.appId;
      const configId = settings.metaConfig?.embeddedSignupConfigId || platformMeta.configId;

      if (!appId) {
        return res.status(400).json({
          error: "La plataforma aún no tiene configurada la integración con Meta. Contacta al administrador de la plataforma.",
          code: "PLATFORM_META_NOT_CONFIGURED",
        });
      }

      return res.json({
        appId,
        configId, // may be empty if not yet created in Meta dashboard
        graphVersion: GRAPH_VERSION,
      });
    } catch (err) {
      logger.error({ err: safeError(err) }, "embedded-signup config failed");
      return res.status(500).json({ error: "Error interno" });
    }
  });

  /**
   * POST /api/whatsapp/embedded-signup/complete
   * Called by frontend after Embedded Signup popup completes.
   *
   * Body: { code, waba_id, phone_number_id }
   *
   * Steps:
   *   1. Exchange code → short-lived token
   *   2. Exchange short → long-lived token (60 day, auto-refreshable)
   *   3. Subscribe WABA to webhooks
   *   4. Fetch phone number details
   *   5. Register phone number (if needed)
   *   6. Upsert whatsapp_numbers + whatsapp_connections
   */
  app.post("/api/whatsapp/embedded-signup/complete", async (req: Request, res: Response) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth) return;

      const maint = await isMaintenanceActive(auth.tenantId);
      if (maint) return res.status(503).json({ error: "Maintenance", message: maint.message || "Sistema en mantenimiento." });

      // Validate input
      const parseResult = completeSignupSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Datos incompletos",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      let { access_token: directToken, code, waba_id, phone_number_id } = parseResult.data;
      const tenantId = auth.tenantId;
      const userId = auth.userId;

      const database = await db.getDb();
      if (!database) {
        return res.status(500).json({ error: "Base de datos no disponible" });
      }

      const settings = await getOrCreateAppSettings(database, tenantId);
      // Fallback chain: tenant config → platform config (tenant 1) → env vars
      const platformMeta = await getPlatformMetaConfig(database);
      const appId = settings.metaConfig?.appId || platformMeta.appId;
      const appSecretStored = settings.metaConfig?.appSecret || platformMeta.appSecret;
      const appSecret = decryptSecret(appSecretStored);
      if (!appSecret && appSecretStored) {
        logger.error({ tenantId }, "[EmbeddedSignup] Failed to decrypt appSecret — check DATA_ENCRYPTION_KEY");
      }

      if (!appId || !appSecret) {
        return res.status(400).json({
          error: "La plataforma aún no tiene configuradas las credenciales de Meta. Contacta al administrador.",
          code: "PLATFORM_META_NOT_CONFIGURED",
        });
      }

      // ── Step 1: Get short-lived user token ──
      let shortToken: string;

      if (directToken) {
        // Token flow: frontend already has the access token from FB.login()
        logger.info({ tenantId, wabaId: waba_id }, "[EmbeddedSignup] Using direct token from JS SDK");
        shortToken = directToken;
      } else if (code) {
        // Code flow: exchange code → token via POST (Meta Embedded Signup docs require POST)
        // redirect_uri must match what the JS SDK used implicitly: login_success.html
        logger.info({ tenantId, wabaId: waba_id }, "[EmbeddedSignup] Exchanging code for token via POST");
        try {
          const tokenRes = await oauthPost<{ access_token: string }>("oauth/access_token", {
            client_id: appId,
            client_secret: appSecret,
            redirect_uri: "https://www.facebook.com/connect/login_success.html",
            code,
          });
          shortToken = tokenRes.access_token;
        } catch (codeErr: any) {
          const errMsg = codeErr?.message || "";
          if (errMsg.toLowerCase().includes("client secret") || errMsg.toLowerCase().includes("client_secret")) {
            logger.error({ tenantId, appId, secretLen: appSecret.length }, "[EmbeddedSignup] Code exchange failed — App Secret mismatch. Go to Super Admin and update Meta App Secret.");
            return res.status(400).json({
              error: "Error validating client secret. El App Secret de Meta guardado en el CRM no coincide con el de tu app. Ve a Super Admin y actualiza el Meta App Secret.",
              detail: errMsg,
              code: "META_SECRET_MISMATCH",
            });
          }
          throw codeErr;
        }
      } else {
        return res.status(400).json({ error: "Se requiere access_token o code." });
      }

      if (!shortToken) {
        return res.status(400).json({ error: "No se pudo obtener el token de Meta. Reintenta el flujo." });
      }

      // ── Step 2: Exchange → long-lived token (60 days) ──
      let longToken: string;
      let tokenExpiresAt: Date | null = null;
      try {
        const longRes = await oauthPost<{ access_token: string; expires_in?: number }>("oauth/access_token", {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        });
        longToken = longRes.access_token;
        // Meta returns expires_in in seconds (~60 days). Store expiry for auto-renewal.
        if (longRes.expires_in) {
          tokenExpiresAt = new Date(Date.now() + longRes.expires_in * 1000);
        } else {
          // Default: assume 60 days if not provided
          tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        }
      } catch (err) {
        logger.warn({ err: safeError(err) }, "[EmbeddedSignup] Long-lived token exchange failed, using short token");
        longToken = shortToken;
      }

      // ── Step 2.5: Auto-discover WABA and phone number if not provided ──
      if (!waba_id || !GRAPH_ID_RE.test(waba_id) || !phone_number_id || !GRAPH_ID_RE.test(phone_number_id)) {
        logger.info({ tenantId, waba_id, phone_number_id }, "[EmbeddedSignup] WABA/phone not in response, auto-discovering via Graph API");
        try {
          let discoveredWabaId = "";
          let discoveredPhoneId = "";

          // Primary: use debug_token to find WABA IDs from the granted scopes
          // Meta Embedded Signup tokens include granular_scopes with the target WABA IDs
          try {
            const debugRes = await graphGet<{
              data: {
                granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
                scopes?: string[];
                app_id?: string;
                type?: string;
                is_valid?: boolean;
              };
            }>("debug_token", "", {
              input_token: longToken,
              access_token: `${appId}|${appSecret}`,
            });

            logger.info({
              isValid: debugRes.data?.is_valid,
              type: debugRes.data?.type,
              tokenAppId: debugRes.data?.app_id,
              scopes: debugRes.data?.scopes,
              granularScopes: debugRes.data?.granular_scopes,
            }, "[EmbeddedSignup] debug_token response");

            const scopes = debugRes.data?.granular_scopes || [];
            for (const scope of scopes) {
              if (
                (scope.scope === "whatsapp_business_management" || scope.scope === "whatsapp_business_messaging") &&
                scope.target_ids?.length
              ) {
                discoveredWabaId = scope.target_ids[0];
                break;
              }
            }
            if (discoveredWabaId) {
              logger.info({ discoveredWabaId }, "[EmbeddedSignup] Found WABA via debug_token granular_scopes");
            } else {
              logger.warn({ scopeCount: scopes.length, scopeNames: scopes.map(s => s.scope) }, "[EmbeddedSignup] debug_token has no WA scopes with target_ids");

              // If the token only has public_profile and no WA scopes at all, the Embedded Signup
              // flow didn't complete — Meta fell back to basic Facebook Login.
              const tokenScopes = debugRes.data?.scopes || [];
              const hasWaScope = tokenScopes.some((s: string) =>
                s.includes("whatsapp") || s === "business_management"
              );
              if (!hasWaScope && tokenScopes.length <= 1) {
                logger.error({
                  tenantId,
                  tokenScopes,
                  tokenType: debugRes.data?.type,
                }, "[EmbeddedSignup] Token has NO WhatsApp scopes — Embedded Signup did not run");
                return res.status(400).json({
                  error: "El flujo de Embedded Signup no se completó. El token de Meta solo tiene permiso 'public_profile' sin acceso a WhatsApp.",
                  detail: "Causas posibles: (1) El config_id de Embedded Signup no es válido o no coincide con la app. (2) La app de Meta está en modo Development y el usuario no es tester/admin de la app. (3) Los permisos de WhatsApp no están aprobados en App Review. Verifica en Meta Dashboard > App Review > Permissions que whatsapp_business_management y whatsapp_business_messaging están aprobados o que la app está en modo Live.",
                  code: "NO_WA_SCOPES",
                  tokenScopes,
                });
              }
            }
          } catch (err) {
            logger.warn({ err: safeError(err) }, "[EmbeddedSignup] debug_token lookup failed");
          }

          // Fallback: iterate businesses → owned_whatsapp_business_accounts
          if (!discoveredWabaId) {
            try {
              const sharedWabas = await graphGet<{ data: Array<{ id: string; name?: string }> }>(
                "me/businesses", longToken, { fields: "id,name" }
              );
              logger.info({ businesses: sharedWabas.data?.map((b: any) => ({ id: b.id, name: b.name })) }, "[EmbeddedSignup] me/businesses response");
              if (sharedWabas.data?.length) {
                for (const biz of sharedWabas.data) {
                  try {
                    const ownedWabas = await graphGet<{ data: Array<{ id: string }> }>(
                      `${biz.id}/owned_whatsapp_business_accounts`, longToken
                    );
                    logger.info({ bizId: biz.id, wabas: ownedWabas.data }, "[EmbeddedSignup] owned_whatsapp_business_accounts");
                    if (ownedWabas.data?.[0]?.id) {
                      discoveredWabaId = ownedWabas.data[0].id;
                      break;
                    }
                  } catch (bizErr) {
                    logger.warn({ bizId: biz.id, err: safeError(bizErr) }, "[EmbeddedSignup] Failed to get WABAs for business");
                  }
                }
              }
            } catch (err) {
              logger.warn({ err: safeError(err) }, "[EmbeddedSignup] me/businesses lookup failed");
            }
          }

          // Fallback: direct WABA listing
          if (!discoveredWabaId) {
            try {
              const directWabas = await graphGet<{ data: Array<{ id: string }> }>(
                "me/whatsapp_business_accounts", longToken
              );
              logger.info({ wabas: directWabas.data }, "[EmbeddedSignup] me/whatsapp_business_accounts response");
              if (directWabas.data?.[0]?.id) {
                discoveredWabaId = directWabas.data[0].id;
              }
            } catch (err) {
              logger.warn({ err: safeError(err) }, "[EmbeddedSignup] me/whatsapp_business_accounts lookup failed");
            }
          }

          if (!discoveredWabaId) {
            logger.error({ tenantId }, "[EmbeddedSignup] All WABA discovery methods failed — returning 400");
            return res.status(400).json({
              error: "No se encontró ninguna cuenta de WhatsApp Business asociada. Asegúrate de haber dado permisos en el flujo de Meta.",
              code: "WABA_NOT_FOUND",
            });
          }

          // Get phone numbers from the WABA
          if (!discoveredPhoneId) {
            try {
              const phones = await graphGet<{ data: Array<{ id: string; display_phone_number?: string; verified_name?: string }> }>(
                `${discoveredWabaId}/phone_numbers`, longToken, { fields: "id,display_phone_number,verified_name" }
              );
              logger.info({ wabaId: discoveredWabaId, phones: phones.data }, "[EmbeddedSignup] phone_numbers response");
              if (phones.data?.[0]?.id) {
                discoveredPhoneId = phones.data[0].id;
              }
            } catch (err) {
              logger.warn({ err: safeError(err), wabaId: discoveredWabaId }, "[EmbeddedSignup] Failed to list phone numbers from WABA");
            }
          }

          if (!discoveredPhoneId) {
            logger.error({ tenantId, discoveredWabaId }, "[EmbeddedSignup] Found WABA but no phone numbers — returning 400");
            return res.status(400).json({
              error: "Se encontró la WABA pero no tiene números de teléfono registrados. Completa el registro del número en el flujo de Meta.",
              code: "PHONE_NOT_FOUND",
            });
          }

          waba_id = discoveredWabaId;
          phone_number_id = discoveredPhoneId;
          logger.info({ tenantId, wabaId: waba_id, phoneNumberId: phone_number_id }, "[EmbeddedSignup] Auto-discovered WABA and phone");
        } catch (err) {
          logger.error({ err: safeError(err) }, "[EmbeddedSignup] Auto-discovery failed");
          return res.status(400).json({
            error: "No se pudieron descubrir los datos de WhatsApp Business automáticamente. Intenta de nuevo.",
          });
        }
      }

      // ── Step 3: Subscribe WABA to webhooks ──
      try {
        await graphPost(`${waba_id}/subscribed_apps`, longToken, {
          subscribed_fields: ["messages", "message_template_status_update"].join(","),
        });
        logger.info({ tenantId, wabaId: waba_id }, "[EmbeddedSignup] Subscribed WABA to webhooks");
      } catch (err) {
        logger.warn({ err: safeError(err), wabaId: waba_id }, "[EmbeddedSignup] Webhook subscription failed (non-fatal)");
        // Non-fatal: the WABA may already be subscribed, or we can retry later
      }

      // ── Step 4: Fetch phone number details ──
      let displayPhone = phone_number_id;
      let phoneVerifiedName = "";
      try {
        const phoneInfo = await graphGet<{
          display_phone_number?: string;
          verified_name?: string;
          quality_rating?: string;
        }>(phone_number_id, longToken, { fields: "display_phone_number,verified_name,quality_rating" });

        displayPhone = phoneInfo.display_phone_number || phone_number_id;
        phoneVerifiedName = phoneInfo.verified_name || "";
        logger.info({ displayPhone, phoneVerifiedName }, "[EmbeddedSignup] Phone info fetched");
      } catch (err) {
        logger.warn({ err: safeError(err) }, "[EmbeddedSignup] Phone info fetch failed (non-fatal)");
      }

      // ── Step 5: Register phone number (enable messaging) ──
      try {
        // Generate a random 6-digit PIN (required by Graph API)
        const pin = String(Math.floor(100000 + Math.random() * 900000));
        await graphPost(`${phone_number_id}/register`, longToken, {
          messaging_product: "whatsapp",
          pin,
        });
        logger.info({ phoneNumberId: phone_number_id }, "[EmbeddedSignup] Phone number registered for messaging");
      } catch (err: any) {
        // Error 100 = already registered → harmless
        const isAlreadyRegistered = err?.message?.includes("already registered") || err?.message?.includes("100");
        if (!isAlreadyRegistered) {
          logger.warn({ err: safeError(err) }, "[EmbeddedSignup] Phone register failed (may already be registered)");
        }
      }

      // ── Step 6: Upsert whatsapp_numbers + whatsapp_connections ──
      const rawPhone = displayPhone.replace(/\D/g, "") || phone_number_id;
      const encryptedToken = encryptSecret(longToken);

      // Check if connection already exists for this tenant + phoneNumberId
      const existingConn = await database.select().from(whatsappConnections)
        .where(and(
          eq(whatsappConnections.tenantId, tenantId),
          eq(whatsappConnections.phoneNumberId, phone_number_id),
        ))
        .limit(1);

      let connectionId: number;

      if (existingConn.length > 0) {
        // Update existing connection
        await database.update(whatsappConnections).set({
          accessToken: encryptedToken,
          businessAccountId: waba_id,
          wabaId: waba_id,
          isConnected: true,
          setupSource: "embedded_signup",
          tokenExpiresAt,
          lastPingAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(whatsappConnections.tenantId, tenantId),
          eq(whatsappConnections.id, existingConn[0].id),
        ));

        // Update associated number
        if (existingConn[0].whatsappNumberId) {
          await database.update(whatsappNumbers).set({
            displayName: phoneVerifiedName || displayPhone,
            phoneNumber: rawPhone,
            isConnected: true,
            lastConnected: new Date(),
            status: "active",
            updatedAt: new Date(),
          }).where(and(
            eq(whatsappNumbers.tenantId, tenantId),
            eq(whatsappNumbers.id, existingConn[0].whatsappNumberId),
          ));
        }

        connectionId = existingConn[0].id;
        logger.info({ connectionId, tenantId }, "[EmbeddedSignup] Updated existing connection");
      } else {
        // Create new number + connection inside a transaction to avoid orphan rows
        const result = await database.transaction(async (tx) => {
          const [newNumber] = await tx.insert(whatsappNumbers).values({
            tenantId,
            phoneNumber: rawPhone,
            displayName: phoneVerifiedName || displayPhone,
            country: "Unknown",
            countryCode: "+",
            status: "active",
            isConnected: true,
            lastConnected: new Date(),
            dailyMessageLimit: 1000,
            messagesSentToday: 0,
            totalMessagesSent: 0,
          }).$returningId();

          const [newConn] = await tx.insert(whatsappConnections).values({
            tenantId,
            whatsappNumberId: newNumber.id,
            connectionType: "api",
            phoneNumberId: phone_number_id,
            businessAccountId: waba_id,
            wabaId: waba_id,
            accessToken: encryptedToken,
            isConnected: true,
            setupSource: "embedded_signup",
            tokenExpiresAt,
            lastPingAt: new Date(),
          }).$returningId();

          return { connectionId: newConn.id, numberId: newNumber.id };
        });

        connectionId = result.connectionId;
        logger.info({ connectionId, numberId: result.numberId, tenantId }, "[EmbeddedSignup] Created new connection");
      }

      // ── Audit log ──
      await logAccess({
        tenantId,
        userId,
        action: "whatsapp_embedded_signup_complete",
        metadata: { tenantId, wabaId: waba_id, phoneNumberId: phone_number_id, connectionId },
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      }).catch(() => {});

      return res.json({
        success: true,
        connectionId,
        phone: displayPhone,
        verifiedName: phoneVerifiedName,
        wabaId: waba_id,
      });

    } catch (err: any) {
      logger.error({ err: safeError(err) }, "[EmbeddedSignup] Complete failed");

      // Provide user-readable error — always include detail for debugging
      const metaMsg = err?.message || "Error desconocido";
      return res.status(500).json({
        error: "Error al completar la conexión de WhatsApp",
        detail: metaMsg,
      });
    }
  });

  /**
   * POST /api/whatsapp/embedded-signup/disconnect
   * Disconnects a connection set up via Embedded Signup.
   * Optionally deregisters the phone number from Cloud API.
   */
  app.post("/api/whatsapp/embedded-signup/disconnect", async (req: Request, res: Response) => {
    try {
      const auth = await requireAdminAuth(req, res);
      if (!auth) return;

      const maint = await isMaintenanceActive(auth.tenantId);
      if (maint) return res.status(503).json({ error: "Maintenance", message: maint.message || "Sistema en mantenimiento." });

      const parseResult = disconnectSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Se requiere connectionId (número entero positivo)", details: parseResult.error.flatten().fieldErrors });
      }
      const { connectionId } = parseResult.data;

      const database = await db.getDb();
      if (!database) return res.status(500).json({ error: "Base de datos no disponible" });

      const [conn] = await database.select().from(whatsappConnections)
        .where(and(
          eq(whatsappConnections.tenantId, auth.tenantId),
          eq(whatsappConnections.id, connectionId),
        ))
        .limit(1);

      if (!conn) {
        return res.status(404).json({ error: "Conexión no encontrada" });
      }

      // Try to deregister phone from Cloud API (best-effort)
      if (conn.accessToken && conn.phoneNumberId && GRAPH_ID_RE.test(conn.phoneNumberId)) {
        try {
          const token = decryptSecret(conn.accessToken);
          if (token) {
            await graphPost(`${conn.phoneNumberId}/deregister`, token, {
              messaging_product: "whatsapp",
            });
          }
        } catch {
          // Deregister may fail if token expired or phone was already deregistered
        }
      }

      // Mark as disconnected (don't delete — preserve history)
      await database.update(whatsappConnections).set({
        isConnected: false,
        accessToken: null,
        updatedAt: new Date(),
      }).where(and(
        eq(whatsappConnections.tenantId, auth.tenantId),
        eq(whatsappConnections.id, connectionId),
      ));

      if (conn.whatsappNumberId) {
        await database.update(whatsappNumbers).set({
          isConnected: false,
          status: "disconnected",
          updatedAt: new Date(),
        }).where(and(
          eq(whatsappNumbers.tenantId, auth.tenantId),
          eq(whatsappNumbers.id, conn.whatsappNumberId),
        ));
      }

      await logAccess({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "whatsapp_embedded_signup_disconnect",
        metadata: { tenantId: auth.tenantId, connectionId },
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      }).catch(() => {});

      return res.json({ success: true });
    } catch (err) {
      logger.error({ err: safeError(err) }, "[EmbeddedSignup] Disconnect failed");
      return res.status(500).json({ error: "Error al desconectar" });
    }
  });

  logger.info("[EmbeddedSignup] Routes registered: /api/whatsapp/embedded-signup/*");
}
