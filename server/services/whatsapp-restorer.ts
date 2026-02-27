
import { getDb } from "../db";
import { whatsappConnections, whatsappNumbers } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { BaileysService } from "./baileys";

import { logger } from "../_core/logger";

export async function startWhatsAppSessions() {
    logger.info("[WhatsAppSession] Checking for active sessions to restore...");
    const db = await getDb();
    if (!db) {
        logger.error("[WhatsAppSession] DB not available");
        return;
    }

    try {
        // Find all connections that are supposed to be connected via QR
        const activeConnections = await db.select()
            .from(whatsappConnections)
            .where(
                and(
                    eq(whatsappConnections.connectionType, 'qr'),
                    eq(whatsappConnections.isConnected, true)
                )
            );

        logger.info(`[WhatsAppSession] Found ${activeConnections.length} sessions to restore.`);

        for (const conn of activeConnections) {
            if (!conn.whatsappNumberId) continue;

            logger.info(`[WhatsAppSession] Restoring session for Number ID: ${conn.whatsappNumberId}`);
            try {
                // Initialize session
                await BaileysService.initializeSession(
                    conn.whatsappNumberId,
                    async (qr) => {
                        logger.info(`[WhatsAppSession] QR Update for ${conn.whatsappNumberId} (Session Invalid)`);
                        // Session is invalid (needs QR), mark as disconnected in DB
                        const db = await getDb();
                        if (db) {
                            await db.update(whatsappConnections)
                                .set({ isConnected: false, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60000) })
                                .where(eq(whatsappConnections.id, conn.id));

                            await db.update(whatsappNumbers)
                                .set({ isConnected: false, status: 'disconnected' })
                                .where(eq(whatsappNumbers.id, conn.whatsappNumberId!));
                        }
                    },
                    async (status) => {  // ✅ Ahora es async y actualiza DB
                        logger.info(`[WhatsAppSession] Status Update for ${conn.whatsappNumberId}: ${status}`);
                        const db = await getDb();
                        if (db) {
                            const isConnected = status === 'connected';
                            await db.update(whatsappConnections)
                                .set({
                                    isConnected,
                                    lastPingAt: new Date(),
                                    ...(isConnected ? { qrCode: null as any, qrExpiresAt: null as any } : {})
                                })
                                .where(eq(whatsappConnections.id, conn.id));

                            if (isConnected) {
                                await db.update(whatsappNumbers)
                                    .set({ isConnected: true, status: 'active' })
                                    .where(eq(whatsappNumbers.id, conn.whatsappNumberId!));
                            }
                        }
                    }
                );
            } catch (err) {
                logger.error(`[WhatsAppSession] Failed to restore session ${conn.whatsappNumberId}:`, err);
                const db = await getDb();
                if (db) {
                    await db.update(whatsappConnections).set({ isConnected: false }).where(eq(whatsappConnections.id, conn.id));
                }
            }
        }
    } catch (error) {
        logger.error("[WhatsAppSession] Error finding sessions:", error);
    }
}
