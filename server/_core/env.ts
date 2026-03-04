export const ENV = {
  appId: process.env.VITE_APP_ID ?? "imagine-crm",
  cookieSecret: process.env.COOKIE_SECRET ?? process.env.JWT_SECRET ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  whatsappGraphVersion: process.env.WHATSAPP_GRAPH_VERSION ?? "v19.0",
  whatsappGraphBaseUrl: process.env.WHATSAPP_GRAPH_BASE_URL ?? "https://graph.facebook.com",
  whatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "",
  whatsappAppSecret: process.env.WHATSAPP_APP_SECRET ?? "",
  forgeApiUrl: process.env.FORGE_API_URL ?? "",
  forgeApiKey: process.env.FORGE_API_KEY ?? "",
};

/**
 * Validate that critical environment variables are set in production.
 * Called at server startup — refuses to start if secrets are missing.
 */
export function validateCriticalEnv(): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;

  const missing: string[] = [];
  if (!ENV.cookieSecret) missing.push("COOKIE_SECRET (or JWT_SECRET)");
  if (!ENV.dataEncryptionKey) missing.push("DATA_ENCRYPTION_KEY");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");

  if (missing.length > 0) {
    const msg = `[FATAL] Missing required env vars in production: ${missing.join(", ")}`;
    console.error(msg);
    process.exit(1);
  }
}
