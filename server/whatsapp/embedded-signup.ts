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
import { getOrCreateAppSettings } from "../services/app-settings";
import { sdk } from "../_core/sdk";
import { logAccess, getClientIp } from "../services/security";

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

const completeSignupSchema = z.object({
  code: z.string().min(1, "Se requiere el código de autorización"),
  waba_id: z.string().min(1, "Se requiere el WABA ID"),
  phone_number_id: z.string().min(1, "Se requiere el Phone Number ID"),
});

// ── Helper: Graph API fetch ──

async function graphGet<T = any>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/${path}`);
  url.searchParams.set("access_token", token);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
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

      const database = await db.getDb();
      const settings = await getOrCreateAppSettings(database, auth.tenantId);
      const appId = settings.metaConfig?.appId || process.env.META_APP_ID || "";
      const configId = settings.metaConfig?.embeddedSignupConfigId || process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "";

      if (!appId) {
        return res.status(400).json({ error: "META_APP_ID no está configurado. Ve a Configuración → Meta para añadirlo." });
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

      // Validate input
      const parseResult = completeSignupSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Datos incompletos",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const { code, waba_id, phone_number_id } = parseResult.data;
      const tenantId = auth.tenantId;
      const userId = auth.userId;

      const database = await db.getDb();
      if (!database) {
        return res.status(500).json({ error: "Base de datos no disponible" });
      }

      const settings = await getOrCreateAppSettings(database, tenantId);
      const appId = settings.metaConfig?.appId || process.env.META_APP_ID || "";
      const appSecretStored = settings.metaConfig?.appSecret || process.env.META_APP_SECRET || "";
      const appSecret = decryptSecret(appSecretStored) || appSecretStored;

      if (!appId || !appSecret) {
        return res.status(400).json({
          error: "Faltan credenciales de Meta (APP_ID + APP_SECRET). Configúralas en Configuración → Meta.",
        });
      }

      // ── Step 1: Exchange code → short-lived user token ──
      logger.info({ tenantId, wabaId: waba_id }, "[EmbeddedSignup] Exchanging code for token");

      const tokenRes = await graphGet<{ access_token: string }>("oauth/access_token", "", {
        client_id: appId,
        client_secret: appSecret,
        code,
      });

      const shortToken = tokenRes.access_token;
      if (!shortToken) {
        return res.status(400).json({ error: "No se pudo obtener el token de Meta. Reintenta el flujo." });
      }

      // ── Step 2: Exchange → long-lived token (60 days) ──
      let longToken: string;
      try {
        const longRes = await graphGet<{ access_token: string; expires_in?: number }>("oauth/access_token", "", {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        });
        longToken = longRes.access_token;
      } catch (err) {
        logger.warn({ err: safeError(err) }, "[EmbeddedSignup] Long-lived token exchange failed, using short token");
        longToken = shortToken;
      }

      // ── Step 3: Subscribe WABA to webhooks ──
      try {
        await graphPost(`${waba_id}/subscribed_apps`, longToken);
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
        await graphPost(`${phone_number_id}/register`, longToken, {
          messaging_product: "whatsapp",
          pin: "000000", // 6-digit PIN required by Graph API, can be any value
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
        // Create new number + connection
        const [newNumber] = await database.insert(whatsappNumbers).values({
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

        const [newConn] = await database.insert(whatsappConnections).values({
          tenantId,
          whatsappNumberId: newNumber.id,
          connectionType: "api",
          phoneNumberId: phone_number_id,
          businessAccountId: waba_id,
          wabaId: waba_id,
          accessToken: encryptedToken,
          isConnected: true,
          setupSource: "embedded_signup",
          lastPingAt: new Date(),
        }).$returningId();

        connectionId = newConn.id;
        logger.info({ connectionId, numberId: newNumber.id, tenantId }, "[EmbeddedSignup] Created new connection");
      }

      // ── Audit log ──
      await logAccess({
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

      // Provide user-readable error
      const metaMsg = err?.message || "";
      return res.status(500).json({
        error: "Error al completar la conexión de WhatsApp",
        detail: metaMsg.includes("Graph API") ? metaMsg : undefined,
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

      const { connectionId } = req.body as { connectionId?: number };
      if (!connectionId) {
        return res.status(400).json({ error: "Se requiere connectionId" });
      }

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
      if (conn.accessToken && conn.phoneNumberId) {
        try {
          const token = decryptSecret(conn.accessToken) || conn.accessToken;
          await graphPost(`${conn.phoneNumberId}/deregister`, token, {
            messaging_product: "whatsapp",
          });
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
