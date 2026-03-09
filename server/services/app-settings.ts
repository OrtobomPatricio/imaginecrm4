import { getDb } from "../db";
import { appSettings } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { logger, safeError } from "../_core/logger";

const APP_SETTINGS_DEFAULTS = {
    id: 0,
    singleton: 1,
    companyName: "Imagine CRM",
    logoUrl: null,
    timezone: "America/Asuncion",
    language: "es",
    currency: "PYG",
    scheduling: { slotMinutes: 15, maxPerSlot: 6, allowCustomTime: true },
    permissionsMatrix: { owner: ["*"], admin: ["settings.*"], supervisor: ["dashboard.view"], agent: ["dashboard.view"], viewer: ["dashboard.view"] },
    slaConfig: null,
    chatDistributionConfig: null,
    salesConfig: null,
    metaConfig: null,
    smtpConfig: null,
    storageConfig: null,
    aiConfig: null,
    mapsConfig: null,
    dashboardConfig: null,
    securityConfig: null,
    billingConfig: null,
    completedAt: null,
} as any;

// Allow passing db instance to use within transactions
export async function getOrCreateAppSettings(dbOrNull: MySql2Database<any> | null | undefined, tenantId: number) {
    try {
        const db = dbOrNull || await getDb();
        if (!db) {
            logger.warn({ tenantId }, "[AppSettings] DB not available — returning defaults");
            return { ...APP_SETTINGS_DEFAULTS, tenantId };
        }

        const rows = await db.select().from(appSettings).where(and(eq(appSettings.tenantId, tenantId), eq(appSettings.singleton, 1))).limit(1);
        if (rows[0]) return rows[0];

        try {
            await db.insert(appSettings).values({ tenantId, singleton: 1 });
        } catch (e) {
            // MockDB or duplicate — fall through to re-select or default
        }
        const again = await db.select().from(appSettings).where(and(eq(appSettings.tenantId, tenantId), eq(appSettings.singleton, 1))).limit(1);
        if (again[0]) return again[0];

        return { ...APP_SETTINGS_DEFAULTS, tenantId };
    } catch (err) {
        logger.error({ err: safeError(err), tenantId }, "[AppSettings] getOrCreateAppSettings failed — returning defaults");
        return { ...APP_SETTINGS_DEFAULTS, tenantId };
    }
}

export async function updateAppSettings(db: MySql2Database<any>, tenantId: number, values: Partial<typeof appSettings.$inferInsert>) {
    const row = await getOrCreateAppSettings(db, tenantId);
    // Ensure we don't accidentally create a new row or update others (though singleton prevents it)
    await db.update(appSettings)
        .set(values)
        .where(and(eq(appSettings.tenantId, tenantId), eq(appSettings.id, row.id)));
}

/**
 * Get the platform-level Meta config (from tenant 1).
 * This is the "shared" Meta App that all tenants inherit automatically.
 * Returns { appId, appSecret, configId } or nulls if not configured.
 */
export async function getPlatformMetaConfig(dbOrNull?: MySql2Database<any> | null) {
    try {
        const platformSettings = await getOrCreateAppSettings(dbOrNull ?? null, 1);
        const meta = platformSettings.metaConfig as Record<string, any> | null;
        return {
            appId: meta?.appId || process.env.META_APP_ID || "",
            appSecret: meta?.appSecret || process.env.META_APP_SECRET || "",
            configId: meta?.embeddedSignupConfigId || process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "",
        };
    } catch {
        return {
            appId: process.env.META_APP_ID || "",
            appSecret: process.env.META_APP_SECRET || "",
            configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "",
        };
    }
}
