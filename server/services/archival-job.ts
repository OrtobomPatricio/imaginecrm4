import cron from "node-cron";
import { sql, and, lt, eq } from "drizzle-orm";
import { getDb } from "../db";
import { chatMessages } from "../../drizzle/schema";
import { logger, safeError } from "../_core/logger";

const ARCHIVE_DAYS = Number(process.env.ARCHIVE_AFTER_DAYS ?? "180"); // 6 months default
const BATCH_SIZE = 1000;
let chatMessageTimeColumn: "createdAt" | "timestamp" | null = null;

async function resolveChatMessageTimeColumn(db: any): Promise<"createdAt" | "timestamp" | null> {
    if (chatMessageTimeColumn) return chatMessageTimeColumn;

    const [rows] = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'chat_messages'
          AND column_name IN ('createdAt', 'timestamp')
    `) as any;

    const cols = Array.isArray(rows) ? rows.map((r: any) => String(r.column_name)) : [];

    if (cols.includes("createdAt")) {
        chatMessageTimeColumn = "createdAt";
    } else if (cols.includes("timestamp")) {
        chatMessageTimeColumn = "timestamp";
    } else {
        chatMessageTimeColumn = null;
    }

    return chatMessageTimeColumn;
}

/**
 * Archives (soft-deletes or removes) old chat messages and access logs
 * to keep the database performant. Runs daily at 3:00 AM.
 *
 * Strategy:
 * - Messages older than ARCHIVE_AFTER_DAYS are deleted in batches
 * - Access logs older than 90 days are pruned
 * - Runs in small batches to avoid locking the DB
 */
export function startArchivalJob(): void {
    // Run daily at 3:00 AM
    cron.schedule("0 3 * * *", async () => {
        logger.info("[Archival] Starting data archival job");

        try {
            const db = await getDb();
            if (!db) return;

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_DAYS);

            const timeColumn = await resolveChatMessageTimeColumn(db);
            if (!timeColumn) {
                logger.warn("[Archival] Skipped chat_messages archival: neither createdAt nor timestamp column exists");
            }

            // Archive old chat messages in batches
            let totalArchived = 0;
            let batchCount = 0;

            while (timeColumn && batchCount < 50) { // Safety: max 50 batches = 50k rows
                const deleteSql = timeColumn === "createdAt"
                    ? sql`DELETE FROM chat_messages WHERE createdAt < ${cutoffDate} LIMIT ${BATCH_SIZE}`
                    : sql`DELETE FROM chat_messages WHERE timestamp < ${cutoffDate} LIMIT ${BATCH_SIZE}`;

                const result = await db.execute(deleteSql);

                const affected = (result as any)?.[0]?.affectedRows ?? 0;
                totalArchived += affected;
                batchCount++;

                if (affected < BATCH_SIZE) break; // No more rows to delete
            }

            if (totalArchived > 0) {
                logger.info({ totalArchived, batches: batchCount }, "[Archival] Old messages archived");
            }

            // Prune old access logs (90 days)
            const logCutoff = new Date();
            logCutoff.setDate(logCutoff.getDate() - 90);

            const logResult = await db.execute(sql`
                DELETE FROM access_logs
                WHERE createdAt < ${logCutoff}
                LIMIT 5000
            `);

            const logsDeleted = (logResult as any)?.[0]?.affectedRows ?? 0;
            if (logsDeleted > 0) {
                logger.info({ logsDeleted }, "[Archival] Old access logs pruned");
            }

            logger.info("[Archival] Job completed successfully");
        } catch (error) {
            logger.error({ err: safeError(error) }, "[Archival] Job failed");
        }
    });

    logger.info({ archiveDays: ARCHIVE_DAYS }, "[Archival] Scheduled daily at 03:00 AM");
}
