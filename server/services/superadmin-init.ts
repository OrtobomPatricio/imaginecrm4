/**
 * SuperAdmin startup initialization — ensures all required tables/columns exist.
 * Called once at server startup to avoid DDL in runtime request handlers.
 */
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger } from "../_core/logger";

/**
 * Ensure the `internalNotes` column exists on the tenants table
 * and the `platform_announcements` table exists.
 */
export async function ensureSuperadminTables(): Promise<void> {
    const db = await getDb();
    if (!db) {
        logger.warn("[SuperadminInit] No DB connection — skipping table init");
        return;
    }

    // 1. Ensure tenants.internalNotes column
    try {
        await db.execute(sql.raw(
            `ALTER TABLE tenants ADD COLUMN internalNotes TEXT NULL`
        ));
        logger.info("[SuperadminInit] Added internalNotes column to tenants");
    } catch {
        // Column already exists — safe to ignore
    }

    // 2. Ensure platform_announcements table
    try {
        await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS platform_announcements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type ENUM('info','warning','critical','maintenance') DEFAULT 'info' NOT NULL,
                active BOOLEAN DEFAULT TRUE NOT NULL,
                createdBy INT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
            )
        `));
        logger.info("[SuperadminInit] platform_announcements table ensured");
    } catch (e) {
        logger.error({ err: (e as any)?.message }, "[SuperadminInit] Failed to create platform_announcements table");
    }

    // 3. Ensure feature_flags table
    try {
        await db.execute(sql.raw(`
            CREATE TABLE IF NOT EXISTS feature_flags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenantId INT NOT NULL,
                flag VARCHAR(100) NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
                UNIQUE INDEX idx_ff_tenant_flag (tenantId, flag)
            )
        `));
        logger.info("[SuperadminInit] feature_flags table ensured");
    } catch (e) {
        logger.error({ err: (e as any)?.message }, "[SuperadminInit] Failed to create feature_flags table");
    }
}
