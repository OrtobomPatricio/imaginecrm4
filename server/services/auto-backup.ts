import cron from "node-cron";
import { createBackup, encryptBackup } from "./backup";
import fs from "fs";
import path from "path";
import { getDb } from "../db";
import { tenants } from "../../drizzle/schema";

import { logger } from "../_core/logger";

/**
 * Auto-backup with security controls:
 * - BACKUPS_ENABLED env flag (default: OFF)
 * - BACKUP_ENCRYPTION_KEY env for AES-256-GCM encryption
 * - Per-tenant backups (iterates all active tenants)
 * - Never writes plaintext JSON to disk
 */
export function startAutoBackup() {
    const enabled = process.env.BACKUPS_ENABLED === "1" || process.env.BACKUPS_ENABLED === "true";
    if (!enabled) {
        logger.info("[AutoBackup] Disabled (set BACKUPS_ENABLED=1 to activate)");
        return;
    }

    const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
    if (!encryptionKey || encryptionKey.length < 16) {
        logger.error("[AutoBackup] REJECTED: BACKUP_ENCRYPTION_KEY is required and must be ≥16 chars. Backups will NOT run.");
        return;
    }

    logger.info("[AutoBackup] Starting daily encrypted backup scheduler...");

    // Run every day at 2 AM
    cron.schedule("0 2 * * *", async () => {
        try {
            const db = await getDb();
            if (!db) {
                logger.error("[AutoBackup] Database not available, skipping.");
                return;
            }

            // Get all active tenant IDs
            const allTenants = await db.select({ id: tenants.id }).from(tenants);
            const tenantIds = Array.isArray(allTenants) ? allTenants.map(t => t.id) : [1];

            const backupDir = path.join(process.cwd(), "backups");
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            for (const tenantId of tenantIds) {
                try {
                    const backupData = await createBackup(tenantId);

                    // Encrypt before writing — NEVER write plaintext
                    const encrypted = encryptBackup(backupData, encryptionKey);

                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const filename = `backup-t${tenantId}-${timestamp}.enc`;
                    const backupPath = path.join(backupDir, filename);

                    fs.writeFileSync(backupPath, encrypted);
                    logger.info(`[AutoBackup] Created encrypted backup: ${backupPath} (tenant ${tenantId})`);
                } catch (tenantErr) {
                    logger.error(`[AutoBackup] Error backing up tenant ${tenantId}:`, tenantErr);
                }
            }

            // Keep only last 7 backups per tenant
            const files = fs.readdirSync(backupDir)
                .filter(f => f.startsWith('backup-') && f.endsWith('.enc'))
                .sort()
                .reverse();

            if (files.length > 7 * tenantIds.length) {
                files.slice(7 * tenantIds.length).forEach(f => {
                    try {
                        fs.unlinkSync(path.join(backupDir, f));
                        logger.info(`[AutoBackup] Deleted old backup: ${f}`);
                    } catch (e) {
                        logger.error(`[AutoBackup] Error deleting old backup ${f}:`, e);
                    }
                });
            }
        } catch (err) {
            logger.error("[AutoBackup] Error:", err);
        }
    });
}
