import { logger } from "../_core/logger";
import { cacheGet, cacheSet, cacheInvalidate } from "./app-cache";
import { getDb } from "../db";
import { featureFlags } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Feature Flags Service
 *
 * Tenant-level feature toggles that control which features are available.
 * Flags are persisted in the `feature_flags` DB table.
 * Falls back to GLOBAL_DEFAULTS for any flag not explicitly set.
 *
 * Usage:
 * ```ts
 * if (await isFeatureEnabled("advanced_reports", tenantId)) { ... }
 * ```
 */

// Default feature flags (all tenants get these unless overridden in DB)
const GLOBAL_DEFAULTS: Record<string, boolean> = {
    "whatsapp_cloud_api": true,
    "facebook_messenger": true,
    "helpdesk": true,
    "campaigns": true,
    "automations": true,
    "gamification": false,
    "advanced_reports": false,
    "ai_suggestions": false,
    "custom_fields": true,
    "csv_import": true,
    "api_access": false,
    "sla_management": false,
    "audit_logs": true,
    "2fa_required": false,
    "data_export": true,
    "onboarding_completed": false,
};

/**
 * Ensure the feature_flags table exists (called once at startup).
 */
export async function ensureFeatureFlagsTable(): Promise<void> {
    try {
        const db = await getDb();
        if (!db) return;
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS feature_flags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenantId INT NOT NULL,
                flag VARCHAR(100) NOT NULL,
                enabled BOOLEAN DEFAULT FALSE NOT NULL,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
                UNIQUE INDEX idx_ff_tenant_flag (tenantId, flag),
                FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE CASCADE
            )
        `);
        logger.info("[FeatureFlags] Table ensured");
    } catch (e) {
        logger.warn({ err: (e as any)?.message }, "[FeatureFlags] ensureTable failed (may already exist)");
    }
}

/**
 * Load overrides from DB for a tenant (with Redis cache).
 */
async function loadTenantOverrides(tenantId: number): Promise<Record<string, boolean>> {
    const cacheKey = `flags:${tenantId}`;
    const cached = await cacheGet<Record<string, boolean>>(cacheKey);
    if (cached) return cached;

    try {
        const db = await getDb();
        if (!db) return {};

        const rows = await db.select({
            flag: featureFlags.flag,
            enabled: featureFlags.enabled,
        }).from(featureFlags).where(eq(featureFlags.tenantId, tenantId));

        const overrides: Record<string, boolean> = {};
        for (const row of rows) {
            overrides[row.flag] = row.enabled;
        }

        // Cache for 5 min
        await cacheSet(cacheKey, overrides, "settings");
        return overrides;
    } catch (e) {
        logger.warn({ tenantId, err: (e as any)?.message }, "[FeatureFlags] loadOverrides failed");
        return {};
    }
}

/**
 * Check if a feature is enabled for a specific tenant.
 */
export async function isFeatureEnabled(flag: string, tenantId: number): Promise<boolean> {
    const overrides = await loadTenantOverrides(tenantId);
    if (flag in overrides) return overrides[flag];
    return GLOBAL_DEFAULTS[flag] ?? false;
}

/**
 * Get all feature flags for a tenant (merged: defaults + DB overrides).
 */
export async function getAllFlags(tenantId: number): Promise<Record<string, boolean>> {
    const overrides = await loadTenantOverrides(tenantId);
    return { ...GLOBAL_DEFAULTS, ...overrides };
}

/**
 * Set a feature flag override for a specific tenant (persisted to DB).
 */
export async function setFeatureFlag(
    tenantId: number,
    flag: string,
    enabled: boolean
): Promise<void> {
    try {
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        // Upsert: INSERT ... ON DUPLICATE KEY UPDATE
        await db.execute(sql`
            INSERT INTO feature_flags (tenantId, flag, enabled)
            VALUES (${tenantId}, ${flag}, ${enabled})
            ON DUPLICATE KEY UPDATE enabled = ${enabled}
        `);

        // Invalidate cache
        await cacheInvalidate(`flags:${tenantId}`);

        logger.info({ tenantId, flag, enabled }, "[FeatureFlags] Flag updated (persisted to DB)");
    } catch (e) {
        logger.error({ tenantId, flag, enabled, err: (e as any)?.message }, "[FeatureFlags] setFlag failed");
        throw e;
    }
}

/**
 * Get available flag definitions with descriptions.
 */
export function getFlagDefinitions(): Array<{ key: string; label: string; category: string }> {
    return [
        { key: "whatsapp_cloud_api", label: "WhatsApp Cloud API", category: "Channels" },
        { key: "facebook_messenger", label: "Facebook Messenger", category: "Channels" },
        { key: "helpdesk", label: "Mesa de Ayuda", category: "Modules" },
        { key: "campaigns", label: "Campañas Marketing", category: "Modules" },
        { key: "automations", label: "Automatizaciones", category: "Modules" },
        { key: "gamification", label: "Gamificación", category: "Modules" },
        { key: "advanced_reports", label: "Reportes Avanzados", category: "Analytics" },
        { key: "ai_suggestions", label: "Sugerencias IA", category: "AI" },
        { key: "custom_fields", label: "Campos Personalizados", category: "Data" },
        { key: "csv_import", label: "Importación CSV", category: "Data" },
        { key: "api_access", label: "Acceso API", category: "Developer" },
        { key: "sla_management", label: "Gestión SLA", category: "Enterprise" },
        { key: "audit_logs", label: "Logs de Auditoría", category: "Security" },
        { key: "2fa_required", label: "2FA Obligatorio", category: "Security" },
        { key: "data_export", label: "Exportación de Datos", category: "GDPR" },
    ];
}
