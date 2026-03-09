/**
 * WhatsApp Token Renewal Service
 *
 * Meta long-lived tokens expire after ~60 days.
 * This scheduler checks daily and auto-renews tokens that expire within 7 days.
 * If renewal fails, it logs a warning so admins can re-authenticate.
 */

import { eq, and, lt, isNotNull } from "drizzle-orm";
import { whatsappConnections } from "../../drizzle/schema";
import { getDb } from "../db";
import { encryptSecret, decryptSecret } from "../_core/crypto";
import { logger, safeError } from "../_core/logger";
import { getPlatformMetaConfig } from "../services/app-settings";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

/** Renew tokens expiring within this window */
const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Check interval */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function refreshMetaToken(currentToken: string, appId: string, appSecret: string): Promise<{ access_token: string; expires_in?: number } | null> {
  const url = new URL(`${GRAPH_BASE}/${GRAPH_VERSION}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", currentToken);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meta token refresh failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function renewExpiringTokens() {
  const db = await getDb();
  if (!db) return;

  const threshold = new Date(Date.now() + RENEWAL_WINDOW_MS);

  // Find API connections with tokens expiring soon
  const expiring = await db.select()
    .from(whatsappConnections)
    .where(and(
      eq(whatsappConnections.connectionType, "api"),
      eq(whatsappConnections.isConnected, true),
      isNotNull(whatsappConnections.tokenExpiresAt),
      lt(whatsappConnections.tokenExpiresAt, threshold),
      isNotNull(whatsappConnections.accessToken),
    ))
    .limit(100);

  if (expiring.length === 0) return;

  logger.info({ count: expiring.length }, "[TokenRenewal] Found connections with expiring tokens");

  // Get Meta app credentials
  const metaConfig = await getPlatformMetaConfig();
  if (!metaConfig?.appId || !metaConfig?.appSecret) {
    logger.warn("[TokenRenewal] Meta app credentials not configured, cannot renew tokens");
    return;
  }

  for (const conn of expiring) {
    try {
      const currentToken = decryptSecret(conn.accessToken || "");
      if (!currentToken) {
        logger.warn({ connectionId: conn.id }, "[TokenRenewal] Could not decrypt token, skipping");
        continue;
      }

      const result = await refreshMetaToken(currentToken, metaConfig.appId, metaConfig.appSecret);
      if (!result?.access_token) {
        logger.warn({ connectionId: conn.id }, "[TokenRenewal] No token returned from Meta");
        continue;
      }

      const encryptedToken = encryptSecret(result.access_token);
      const newExpiry = result.expires_in
        ? new Date(Date.now() + result.expires_in * 1000)
        : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

      await db.update(whatsappConnections).set({
        accessToken: encryptedToken,
        tokenExpiresAt: newExpiry,
        updatedAt: new Date(),
      }).where(eq(whatsappConnections.id, conn.id));

      logger.info({ connectionId: conn.id, tenantId: conn.tenantId, newExpiry: newExpiry.toISOString() },
        "[TokenRenewal] Token renewed successfully");
    } catch (err) {
      logger.error({ err: safeError(err), connectionId: conn.id, tenantId: conn.tenantId },
        "[TokenRenewal] Failed to renew token — admin must re-authenticate via Embedded Signup");
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startTokenRenewalScheduler() {
  // Run first check after 60 seconds (let the app fully start)
  setTimeout(() => {
    renewExpiringTokens().catch(err =>
      logger.error({ err: safeError(err) }, "[TokenRenewal] Initial check failed")
    );
  }, 60_000);

  // Then check every 24 hours
  intervalHandle = setInterval(() => {
    renewExpiringTokens().catch(err =>
      logger.error({ err: safeError(err) }, "[TokenRenewal] Scheduled check failed")
    );
  }, CHECK_INTERVAL_MS);

  logger.info("[TokenRenewal] Scheduler started (checks every 24h, renews tokens expiring within 7 days)");
}

export function stopTokenRenewalScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
