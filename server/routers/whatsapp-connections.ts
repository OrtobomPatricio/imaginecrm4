import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { whatsappConnections, whatsappNumbers } from "../../drizzle/schema";
import { getDb } from "../db";
import { permissionProcedure, router } from "../_core/trpc";
import { maskSecret, encryptSecret } from "../_core/crypto";

import { logger } from "../_core/logger";

export const whatsappConnectionsRouter = router({
    get: permissionProcedure("monitoring.view")
        .input(z.object({ whatsappNumberId: z.number() }))
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return null;

            try {
                const result = await db.select()
                    .from(whatsappConnections)
                    .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)))
                    .limit(1);

                const row = result[0] ?? null;
                if (!row) return null;

                return {
                    ...row,
                    accessToken: row.accessToken ? maskSecret(row.accessToken) : null,
                    hasAccessToken: Boolean(row.accessToken),
                } as any;
            } catch {
                return null; // whatsapp_connections table may not exist
            }
        }),

    getApiConnections: permissionProcedure("monitoring.view")
        .query(async ({ ctx }) => {
            const db = await getDb();
            if (!db) return [];

            try {
                return await db.select()
                    .from(whatsappConnections)
                    .where(and(
                        eq(whatsappConnections.tenantId, ctx.tenantId),
                        eq(whatsappConnections.isConnected, true),
                        eq(whatsappConnections.connectionType, 'api')
                    ));
            } catch {
                return []; // whatsapp_connections table may not exist
            }
        }),

    setupApi: permissionProcedure("monitoring.manage")
        .input(z.object({
            whatsappNumberId: z.number(),
            accessToken: z.string(),
            phoneNumberId: z.string(),
            businessAccountId: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const waNumber = await db.select()
                .from(whatsappNumbers)
                .where(and(eq(whatsappNumbers.tenantId, ctx.tenantId), eq(whatsappNumbers.id, input.whatsappNumberId)))
                .limit(1);

            if (!waNumber[0]) {
                throw new Error("Número no encontrado");
            }

            let encryptedToken: string;
            try {
                encryptedToken = encryptSecret(input.accessToken);
            } catch {
                throw new Error("Falta DATA_ENCRYPTION_KEY para encriptar el accessToken");
            }

            // Check if connection exists
            const existing = await db.select()
                .from(whatsappConnections)
                .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)))
                .limit(1);

            if (existing[0]) {
                await db.update(whatsappConnections)
                    .set({
                        connectionType: 'api',
                        accessToken: encryptedToken,
                        phoneNumberId: input.phoneNumberId,
                        businessAccountId: input.businessAccountId,
                        isConnected: true,
                    })
                    .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)));
            } else {
                await db.insert(whatsappConnections).values({
                    tenantId: ctx.tenantId,
                    whatsappNumberId: input.whatsappNumberId,
                    connectionType: 'api',
                    accessToken: encryptedToken,
                    phoneNumberId: input.phoneNumberId,
                    businessAccountId: input.businessAccountId,
                    isConnected: true,
                });
            }

            // Update whatsapp number status
            await db.update(whatsappNumbers)
                .set({ isConnected: true, status: 'active' })
                .where(and(eq(whatsappNumbers.tenantId, ctx.tenantId), eq(whatsappNumbers.id, input.whatsappNumberId)));

            return { success: true };
        }),

    generateQr: permissionProcedure("monitoring.manage")
        .input(z.object({ whatsappNumberId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            // Check if connection exists
            let existing = await db.select()
                .from(whatsappConnections)
                .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)))
                .limit(1);

            if (!existing[0]) {
                await db.insert(whatsappConnections).values({
                    tenantId: ctx.tenantId,
                    whatsappNumberId: input.whatsappNumberId,
                    connectionType: 'qr',
                    isConnected: false,
                });
            }

            // E2E / CI helper: allow generating a fake QR without requiring a real Baileys session
            if (process.env.MOCK_BAILEYS_QR === "1" || process.env.NODE_ENV === "test") {
                const qr = `mock-qr-${input.whatsappNumberId}-${Date.now()}`;
                const expiresAt = new Date(Date.now() + 60000);
                await db.update(whatsappConnections)
                    .set({ qrCode: qr, qrExpiresAt: expiresAt })
                    .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)));
                return { qrCode: qr, expiresAt };
            }

            // Import dynamically to avoid top-level side effects if service fails
            const { BaileysService } = await import("../services/baileys");

            // Initialize separate session
            let qrCode: string | undefined;

            await BaileysService.initializeSession(
                input.whatsappNumberId,
                async (qr) => {
                    qrCode = qr;
                    // Update DB with latest QR
                    await db.update(whatsappConnections)
                        .set({ qrCode: qr, qrExpiresAt: new Date(Date.now() + 60000) }) // 1 min validity for UI
                        .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)));
                },
                async (status) => {
                    const isConnected = status === 'connected';
                    await db.update(whatsappConnections)
                        // whatsapp_connections has no `status` column; `isConnected` + timestamps are enough.
                        .set({
                            isConnected,
                            lastPingAt: new Date(),
                            ...(isConnected ? { qrCode: null as any, qrExpiresAt: null as any } : {})
                        })
                        .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)));

                    if (isConnected) {
                        await db.update(whatsappNumbers)
                            .set({ isConnected: true, status: 'active' })
                            .where(and(eq(whatsappNumbers.tenantId, ctx.tenantId), eq(whatsappNumbers.id, input.whatsappNumberId)));
                    }
                }
            );

            // Wait for QR to be generated (poll for up to 15 seconds)
            let attempts = 0;
            while (attempts < 30) {
                qrCode = BaileysService.getQr(input.whatsappNumberId);
                if (qrCode) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            return { qrCode, expiresAt: new Date(Date.now() + 60000) };
        }),

    disconnect: permissionProcedure("monitoring.manage")
        .input(z.object({ whatsappNumberId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            // Fetch existing connection to check type
            const existing = await db.select()
                .from(whatsappConnections)
                .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)))
                .limit(1);

            const connType = existing[0]?.connectionType;

            // 1. Disconnect Baileys socket only for QR connections
            if (connType === 'qr') {
                try {
                    const { BaileysService } = await import("../services/baileys");
                    await BaileysService.disconnect(input.whatsappNumberId);
                    logger.info(`[WhatsApp Disconnect] Baileys session disconnected for number ${input.whatsappNumberId}`);
                } catch (err) {
                    logger.warn(`[WhatsApp Disconnect] Baileys disconnect warning for ${input.whatsappNumberId}:`, err);
                }
            }

            // 2. Clear connection status in DB (clear accessToken for API, sessionData/QR for QR)
            await db.update(whatsappConnections)
                .set({
                    isConnected: false,
                    qrCode: null,
                    qrExpiresAt: null,
                    sessionData: null,
                    ...(connType === 'api' ? { accessToken: null } : {}),
                })
                .where(and(eq(whatsappConnections.tenantId, ctx.tenantId), eq(whatsappConnections.whatsappNumberId, input.whatsappNumberId)));

            // 3. Mark whatsapp number as disconnected
            await db.update(whatsappNumbers)
                .set({ isConnected: false, status: 'disconnected' })
                .where(and(eq(whatsappNumbers.tenantId, ctx.tenantId), eq(whatsappNumbers.id, input.whatsappNumberId)));

            logger.info(`[WhatsApp Disconnect] Number ${input.whatsappNumberId} marked as disconnected in database`);

            return { success: true };
        }),
});
