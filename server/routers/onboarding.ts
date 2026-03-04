import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
    getOrCreateOnboardingProgress,
    updateOnboardingStep,
    finalizeOnboarding
} from "../services/onboarding-tracking";
import { createDemoData } from "../services/onboarding-demo";
import { getDb } from "../db";
import { tenants, whatsappConnections, whatsappNumbers } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { decryptSecret } from "../_core/crypto";
import { sendCloudMessage } from "../whatsapp/cloud";

import { logger } from "../_core/logger";

/**
 * Onboarding Router
 * Handles state persistence for the multi-step setup wizard.
 */

export const onboardingRouter = router({
    // 1. Get current progress
    getProgress: protectedProcedure
        .query(async ({ ctx }) => {
            return await getOrCreateOnboardingProgress(ctx.tenantId);
        }),

    // 2. Save progress for a specific step
    saveStep: protectedProcedure
        .input(z.object({
            step: z.enum(['company', 'team', 'whatsapp', 'import', 'first-message']),
            data: z.any().optional(),
            completed: z.boolean()
        }))
        .mutation(async ({ input, ctx }) => {
            return await updateOnboardingStep(
                ctx.tenantId,
                input.step,
                input.data,
                input.completed
            );
        }),

    // 3. Skip an optional step
    skipStep: protectedProcedure
        .input(z.object({
            step: z.enum(['team', 'import', 'first-message'])
        }))
        .mutation(async ({ input, ctx }) => {
            return await updateOnboardingStep(
                ctx.tenantId,
                input.step,
                null,
                true // Mark as completed even if skipped
            );
        }),

    // 4. Update Company Info (Step 1)
    updateCompany: protectedProcedure
        .input(z.object({
            name: z.string().min(2),
            timezone: z.string(),
            language: z.string(),
            currency: z.string(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            // Update tenant directly as well
            try {
                await db.update(tenants)
                    .set({
                        name: input.name,
                        // Note: If tenants table had timezone/lang/etc, update them here
                    } as any)
                    .where(eq(tenants.id, ctx.tenantId));
            } catch (error) {
                logger.warn("[MockDB] Warning: Could not update tenant name in mock DB");
            }

            return await updateOnboardingStep(
                ctx.tenantId,
                "company",
                input,
                true
            );
        }),

    // 5. Finalize Onboarding
    complete: protectedProcedure
        .mutation(async ({ ctx }) => {
            // Seed demo data first (best-effort, never blocks completion)
            try {
                await createDemoData(ctx.tenantId, ctx.user!.id);
            } catch (e) {
                logger.error({ tenantId: ctx.tenantId, err: e }, "[Onboarding] Demo data seeding failed (non-fatal)");
            }

            // Mark as finished — this is the critical step
            return await finalizeOnboarding(ctx.tenantId);
        }),

    // 6. Send a real test message via an active WhatsApp connection
    sendTestMessage: protectedProcedure
        .input(z.object({
            phone: z.string().min(8).max(20),
            message: z.string().min(1).max(2000),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            // Find first connected Cloud API connection for this tenant
            const conns = await db.select()
                .from(whatsappConnections)
                .where(and(
                    eq(whatsappConnections.tenantId, ctx.tenantId),
                    eq(whatsappConnections.isConnected, true),
                    eq(whatsappConnections.connectionType, "api"),
                ))
                .limit(1);

            if (conns.length === 0) {
                return { success: false, reason: "NO_WHATSAPP", message: "No hay conexión de WhatsApp activa. Conecta una primero en el paso anterior." };
            }

            const conn = conns[0];
            const token = decryptSecret(conn.accessToken);
            if (!token || !conn.phoneNumberId) {
                return { success: false, reason: "INVALID_CONNECTION", message: "La conexión de WhatsApp no tiene credenciales válidas." };
            }

            // Clean phone number
            const cleanPhone = input.phone.replace(/[^0-9]/g, "");

            try {
                const result = await sendCloudMessage({
                    accessToken: token,
                    phoneNumberId: conn.phoneNumberId,
                    to: cleanPhone,
                    payload: { type: "text", body: input.message },
                });

                logger.info({ tenantId: ctx.tenantId, messageId: result.messageId, to: cleanPhone }, "[Onboarding] Test message sent");
                return { success: true, messageId: result.messageId };
            } catch (err: any) {
                logger.warn({ err: err?.message, tenantId: ctx.tenantId }, "[Onboarding] Test message failed");
                return { success: false, reason: "SEND_FAILED", message: err?.message || "Error al enviar el mensaje" };
            }
        }),
});
