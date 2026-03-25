import cron from "node-cron";
import { logger } from "../_core/logger";
import { BaileysService } from "./baileys";
import { getDb } from "../db";
import { whatsappNumbers, whatsappConnections } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

/**
 * WhatsApp Connection Health Check Service
 * Periodically pings all active Baileys (QR) connections and marks
 * stale/disconnected sessions for reconnection.
 *
 * NOTE: Cloud API ("api") connections do NOT use Baileys sockets — they are
 * always "disconnected" in Baileys, so they must be excluded from this check
 * to avoid incorrectly marking them as disconnected every 5 minutes.
 *
 * Runs every 5 minutes.
 */
export function startWAHealthCheck(): void {
    cron.schedule("*/5 * * * *", async () => {
        try {
            const db = await getDb();
            if (!db) return;

            // Only check Baileys (QR) connections — Cloud API connections don't use sockets
            // connectionType lives in whatsappConnections, not whatsappNumbers
            const activeNumbers = await db
                .select({ id: whatsappNumbers.id })
                .from(whatsappNumbers)
                .innerJoin(
                    whatsappConnections,
                    and(
                        eq(whatsappConnections.whatsappNumberId, whatsappNumbers.id),
                        eq(whatsappConnections.connectionType, "qr")
                    )
                )
                .where(eq(whatsappNumbers.status, "active"));

            let healthy = 0;
            let stale = 0;

            for (const num of activeNumbers) {
                const status = BaileysService.getStatus(num.id);

                if (status === "connected") {
                    healthy++;
                    // Try to get the socket and verify it's truly alive
                    const socket = BaileysService.getSocket(num.id);
                    if (!socket) {
                        stale++;
                        healthy--;
                        logger.warn({ numberId: num.id }, "[WAHealthCheck] Socket missing for connected number, marking stale");
                        await db.update(whatsappNumbers)
                            .set({ status: "disconnected", isConnected: false })
                            .where(eq(whatsappNumbers.id, num.id));
                        await db.update(whatsappConnections)
                            .set({ isConnected: false })
                            .where(eq(whatsappConnections.whatsappNumberId, num.id));
                    }
                } else {
                    stale++;
                    logger.warn({ numberId: num.id, status }, "[WAHealthCheck] Stale connection detected");
                    // Update DB status to reflect reality
                    await db.update(whatsappNumbers)
                        .set({ status: "disconnected", isConnected: false })
                        .where(eq(whatsappNumbers.id, num.id));
                    await db.update(whatsappConnections)
                        .set({ isConnected: false })
                        .where(eq(whatsappConnections.whatsappNumberId, num.id));
                }
            }

            if (activeNumbers.length > 0) {
                logger.info({ healthy, stale, total: activeNumbers.length }, "[WAHealthCheck] Health check completed");
            }
        } catch (error) {
            logger.error({ err: error }, "[WAHealthCheck] Health check failed");
        }
    });

    logger.info("[WAHealthCheck] Scheduled every 5 minutes");
}
