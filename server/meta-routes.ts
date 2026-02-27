import type { Express, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import * as db from "./db";
import { eq, and } from "drizzle-orm";
import { whatsappNumbers, whatsappConnections } from "../drizzle/schema";
import { encryptSecret, decryptSecret } from "./_core/crypto";
import axios from "axios";
import { logger, safeError } from "./_core/logger";
import { getOrCreateAppSettings } from "./services/app-settings";
import { sdk } from "./_core/sdk";
import { logAccess, getClientIp } from "./services/security";

const META_API_VERSION = "v19.0";

// ── Server-side OAuth state store ──
// Short-lived: 10-minute TTL. Validated on callback, deleted after use.
interface OAuthState {
    userId: number;
    tenantId: number;
    createdAt: number;
}
const oauthStateStore = new Map<string, OAuthState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanExpiredStates() {
    const now = Date.now();
    for (const [key, val] of oauthStateStore.entries()) {
        if (now - val.createdAt > STATE_TTL_MS) {
            oauthStateStore.delete(key);
        }
    }
}

/**
 * Express middleware: Extract authenticated user from request.
 * Supports both dev bypass and production JWT/session auth.
 * Returns 401 if not authenticated, 403 if not admin/owner.
 */
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
            res.status(401).json({ error: "Authentication required" });
            return null;
        }
    }

    if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return null;
    }

    const role = user.role || "viewer";
    if (!["owner", "admin"].includes(role)) {
        res.status(403).json({ error: "Admin or Owner role required" });
        return null;
    }

    return { userId: user.id, tenantId: user.tenantId, role };
}

export function registerMetaRoutes(app: Express) {

    // 1. Redirect to Facebook Login — REQUIRES AUTH + ADMIN/OWNER
    app.get("/api/meta/connect", async (req: Request, res: Response) => {
        try {
            const auth = await requireAdminAuth(req, res);
            if (!auth) return; // Response already sent

            const database = await db.getDb();
            const tenantId = auth.tenantId;

            const settings = await getOrCreateAppSettings(database, tenantId);
            const appId = settings.metaConfig?.appId || process.env.META_APP_ID;

            const redirectUri = `${process.env.VITE_API_URL || "http://localhost:3000"}/api/meta/callback`;
            const scope = "business_management,whatsapp_business_management,whatsapp_business_messaging";

            // Generate cryptographically secure state token
            const stateToken = crypto.randomBytes(32).toString("hex");

            // Store state server-side with user+tenant binding
            cleanExpiredStates();
            oauthStateStore.set(stateToken, {
                userId: auth.userId,
                tenantId: auth.tenantId,
                createdAt: Date.now(),
            });

            if (!appId) return res.status(500).send("META_APP_ID is not configured in Settings");

            const url = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${stateToken}&response_type=code`;

            // Audit log
            await logAccess({
                userId: auth.userId,
                action: "meta_oauth_connect",
                metadata: { tenantId },
                ipAddress: getClientIp(req),
                userAgent: req.headers['user-agent'],
            }).catch(() => { });

            res.redirect(url);
        } catch (error) {
            logger.error({ err: safeError(error) }, "meta connect failed");
            res.status(500).send("Internal Server Error");
        }
    });

    // 2. Handle Callback — VALIDATES STATE SERVER-SIDE
    app.get("/api/meta/callback", async (req: Request, res: Response) => {
        const { code, state, error } = req.query;

        if (error) {
            logger.warn({ error: String(error) }, "meta oauth error");
            return res.redirect("/settings?tab=distribution&error=meta_auth_failed");
        }

        if (!code) {
            return res.redirect("/settings?tab=distribution&error=no_code");
        }

        try {
            // Validate state against server-side store (NOT from URL query params)
            const stateStr = (state as string) || "";
            const storedState = oauthStateStore.get(stateStr);

            if (!storedState) {
                logger.warn({ state: stateStr.substring(0, 8) + "..." }, "meta oauth: invalid or expired state");
                return res.redirect("/settings?tab=distribution&error=invalid_state");
            }

            // Check TTL
            if (Date.now() - storedState.createdAt > STATE_TTL_MS) {
                oauthStateStore.delete(stateStr);
                return res.redirect("/settings?tab=distribution&error=state_expired");
            }

            // Delete state immediately (single use)
            oauthStateStore.delete(stateStr);

            // TenantId comes from server-side store, NOT from the URL
            const tenantId = storedState.tenantId;
            const userId = storedState.userId;

            const database = await db.getDb();
            const settings = await getOrCreateAppSettings(database, tenantId);
            const appId = settings.metaConfig?.appId || process.env.META_APP_ID;
            const appSecretStored = settings.metaConfig?.appSecret || process.env.META_APP_SECRET;
            const appSecret = decryptSecret(appSecretStored) || "";

            if (!appId || !appSecret) {
                return res.redirect("/settings?tab=distribution&error=missing_credentials");
            }

            const redirectUri = `${process.env.VITE_API_URL || "http://localhost:3000"}/api/meta/callback`;

            // A. Exchange code for short-lived token
            const tokenRes = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`, {
                params: {
                    client_id: appId,
                    client_secret: appSecret,
                    redirect_uri: redirectUri,
                    code: code.toString()
                }
            });

            const shortToken = tokenRes.data.access_token;

            // B. Exchange for Long-Lived Token
            const longTokenRes = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: appId,
                    client_secret: appSecret,
                    fb_exchange_token: shortToken
                }
            });

            const accessToken = longTokenRes.data.access_token;

            // C. Fetch WABA and Phone Numbers
            const details = await axios.get(`https://graph.facebook.com/${META_API_VERSION}/me`, {
                params: {
                    access_token: accessToken,
                    fields: "id,name,businesses{id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,name_status}}}"
                }
            });

            const business = details.data.businesses?.data?.[0];
            const waba = business?.owned_whatsapp_business_accounts?.data?.[0];
            const phone = waba?.phone_numbers?.data?.[0];

            if (waba && phone) {
                if (!database) {
                    logger.error("meta oauth: db not available");
                    return res.redirect("/settings?tab=distribution&error=db_error");
                }

                // TENANT-SCOPED upsert: check by phoneNumberId AND tenantId
                const existing = await database.select().from(whatsappConnections)
                    .where(and(
                        eq(whatsappConnections.phoneNumberId, phone.id),
                        eq(whatsappConnections.tenantId, tenantId)
                    ))
                    .limit(1);

                if (existing.length > 0) {
                    await database.update(whatsappConnections).set({
                        accessToken: encryptSecret(accessToken),
                        businessAccountId: waba.id,
                        isConnected: true,
                        updatedAt: new Date()
                    }).where(and(eq(whatsappConnections.id, existing[0].id), eq(whatsappConnections.tenantId, tenantId)));
                } else {
                    const rawPhone = phone.display_phone_number.replace(/\D/g, "");

                    const numRes = await database.insert(whatsappNumbers).values({
                        tenantId,
                        phoneNumber: rawPhone,
                        displayName: phone.display_phone_number,
                        country: "Unknown",
                        countryCode: "00",
                        status: "active",
                        isConnected: true
                    });

                    const numId = numRes[0].insertId;

                    await database.insert(whatsappConnections).values({
                        tenantId,
                        whatsappNumberId: numId,
                        connectionType: "api",
                        phoneNumberId: phone.id,
                        businessAccountId: waba.id,
                        accessToken: encryptSecret(accessToken),
                        isConnected: true
                    });
                }

                // Audit log
                await logAccess({
                    userId,
                    action: "meta_oauth_callback_success",
                    metadata: { tenantId, wabaId: waba.id, phoneId: phone.id },
                    ipAddress: getClientIp(req),
                    userAgent: req.headers['user-agent'],
                }).catch(() => { });

                return res.redirect("/settings?tab=distribution&success=meta_connected");
            } else {
                logger.warn({ hasWaba: Boolean(details?.data?.waba), hasPhones: Array.isArray(details?.data?.phones) }, "meta oauth: no waba/phone found");
                return res.redirect("/settings?tab=distribution&error=no_waba_found");
            }

        } catch (err: any) {
            logger.error({ err: safeError(err), meta: err?.response?.data ? "response_data" : undefined }, "meta oauth callback error");
            return res.redirect("/settings?tab=distribution&error=exchange_failed");
        }
    });

    // 3. Webhook Handling (unchanged — this is Meta sending webhooks to us)
    app.get("/api/meta/webhook", async (req: Request, res: Response) => {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        try {
            const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || "imagine_crm_verify";

            if (mode === "subscribe" && token === verifyToken) {
                res.status(200).send(challenge);
            } else {
                res.sendStatus(403);
            }
        } catch (e) {
            logger.error({ err: safeError(e) }, "meta webhook verification error");
            res.sendStatus(500);
        }
    });

    app.post("/api/meta/webhook", async (req: Request, res: Response) => {
        res.sendStatus(200);
    });
}