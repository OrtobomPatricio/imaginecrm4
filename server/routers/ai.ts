/**
 * AI Router — Suggested replies, conversation summary, auto-reply config
 */
import { z } from "zod";
import { permissionProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { aiSuggestions, conversations, appSettings } from "../../drizzle/schema";
import { generateSuggestedReplies, summarizeConversation } from "../services/ai";
import { getOrCreateAppSettings, updateAppSettings } from "../services/app-settings";
import { logger } from "../_core/logger";

export const aiRouter = router({
    /**
     * Feature 1: Get AI-suggested replies for a conversation
     */
    suggestReplies: permissionProcedure("chat.view")
        .input(z.object({ conversationId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Verify conversation belongs to tenant
            const [conv] = await db.select({ id: conversations.id })
                .from(conversations)
                .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, ctx.tenantId)))
                .limit(1);
            if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversación no encontrada" });

            const settings = await getOrCreateAppSettings(db, ctx.tenantId);
            const companyName = settings.companyName || "la empresa";

            try {
                const suggestions = await generateSuggestedReplies(ctx.tenantId, input.conversationId, companyName);

                // Store in DB for analytics
                for (const suggestion of suggestions) {
                    await db.insert(aiSuggestions).values({
                        tenantId: ctx.tenantId,
                        conversationId: input.conversationId,
                        suggestion,
                        context: JSON.stringify({ generatedBy: ctx.user.id, at: new Date().toISOString() }),
                        used: false,
                    });
                }

                return { suggestions };
            } catch (error: any) {
                logger.error({ err: error }, "[AI] suggestReplies failed");
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: error.message || "Error al generar sugerencias",
                });
            }
        }),

    /**
     * Mark a suggestion as used (for analytics)
     */
    markSuggestionUsed: permissionProcedure("chat.send")
        .input(z.object({ suggestionId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.update(aiSuggestions)
                .set({ used: true })
                .where(and(eq(aiSuggestions.id, input.suggestionId), eq(aiSuggestions.tenantId, ctx.tenantId)));

            return { success: true };
        }),

    /**
     * Feature 2: Summarize a conversation
     */
    summarize: permissionProcedure("chat.view")
        .input(z.object({ conversationId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [conv] = await db.select({ id: conversations.id })
                .from(conversations)
                .where(and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, ctx.tenantId)))
                .limit(1);
            if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversación no encontrada" });

            const settings = await getOrCreateAppSettings(db, ctx.tenantId);
            const companyName = settings.companyName || "la empresa";

            try {
                const summary = await summarizeConversation(ctx.tenantId, input.conversationId, companyName);
                return { summary };
            } catch (error: any) {
                logger.error({ err: error }, "[AI] summarize failed");
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: error.message || "Error al generar resumen",
                });
            }
        }),

    /**
     * Feature 3: Get/Update auto-reply configuration
     */
    getAutoReplyConfig: permissionProcedure("settings.view")
        .query(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const settings = await getOrCreateAppSettings(db, ctx.tenantId);
            const config = (settings as any).autoReplyConfig as AutoReplyConfig | null;

            return config ?? {
                enabled: false,
                mode: "outside_hours" as const,
                businessHoursStart: "09:00",
                businessHoursEnd: "18:00",
                businessDays: [1, 2, 3, 4, 5],
                customPrompt: "",
            };
        }),

    updateAutoReplyConfig: permissionProcedure("settings.manage")
        .input(z.object({
            enabled: z.boolean(),
            mode: z.enum(["always", "outside_hours", "no_agent_online"]),
            businessHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
            businessHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
            businessDays: z.array(z.number().min(0).max(6)),
            customPrompt: z.string().max(1000).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await updateAppSettings(db, ctx.tenantId, {
                autoReplyConfig: input,
            } as any);
            return { success: true };
        }),
});

interface AutoReplyConfig {
    enabled: boolean;
    mode: "always" | "outside_hours" | "no_agent_online";
    businessHoursStart: string;
    businessHoursEnd: string;
    businessDays: number[];
    customPrompt?: string;
}
