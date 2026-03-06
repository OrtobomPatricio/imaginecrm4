import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { goals, achievements } from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, permissionProcedure, router } from "../_core/trpc";

export const gamificationRouter = router({
    achievements: router({
        list: protectedProcedure.query(async ({ ctx }) => {
            const db = await getDb();
            if (!db || !ctx.user) return [];
            return db.select().from(achievements).where(and(eq(achievements.tenantId, ctx.tenantId), eq(achievements.userId, ctx.user.id)));
        }),

        // Server-side only: unlock is restricted to admin+ to prevent self-awarding
        unlock: permissionProcedure("settings.manage")
            .input(z.object({ type: z.string().min(1).max(100), userId: z.number(), metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() }))
            .mutation(async ({ input, ctx }) => {
                const db = await getDb();
                if (!db) return { success: false };

                // Prevent duplicate achievements
                const [existing] = await db.select({ id: achievements.id }).from(achievements)
                    .where(and(eq(achievements.tenantId, ctx.tenantId), eq(achievements.userId, input.userId), eq(achievements.type, input.type))).limit(1);
                if (existing) return { success: true, alreadyUnlocked: true };

                await db.insert(achievements).values({
                    tenantId: ctx.tenantId,
                    userId: input.userId,
                    type: input.type,
                    metadata: input.metadata,
                });
                return { success: true };
            }),
    }),

    goals: router({
        list: protectedProcedure.query(async ({ ctx }) => {
            const db = await getDb();
            if (!db || !ctx.user) return [];
            return db.select().from(goals).where(and(eq(goals.tenantId, ctx.tenantId), eq(goals.userId, ctx.user.id)));
        }),

        create: protectedProcedure
            .input(z.object({
                type: z.enum(["sales_amount", "deals_closed", "leads_created", "messages_sent"]),
                targetAmount: z.number(),
                period: z.enum(["daily", "weekly", "monthly"]),
                startDate: z.string().transform(s => new Date(s)),
                endDate: z.string().transform(s => new Date(s)),
            }))
            .mutation(async ({ input, ctx }) => {
                const db = await getDb();
                if (!db || !ctx.user) return { success: false };
                await db.insert(goals).values({
                    tenantId: ctx.tenantId,
                    userId: ctx.user.id,
                    type: input.type,
                    targetAmount: input.targetAmount,
                    period: input.period,
                    startDate: input.startDate,
                    endDate: input.endDate,
                });
                return { success: true };
            }),

        // Only allow positive increments, not arbitrary value setting
        updateProgress: protectedProcedure
            .input(z.object({ id: z.number(), increment: z.number().min(0).max(10000) }))
            .mutation(async ({ input, ctx }) => {
                const db = await getDb();
                if (!db) return { success: false };

                const { sql } = await import("drizzle-orm");
                await db.update(goals)
                    .set({ currentAmount: sql`${goals.currentAmount} + ${input.increment}` } as any)
                    .where(and(eq(goals.tenantId, ctx.tenantId), eq(goals.id, input.id), eq(goals.userId, ctx.user!.id)));
                return { success: true };
            }),
    }),
});
