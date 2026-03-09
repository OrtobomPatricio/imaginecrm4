import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { workflows } from "../../drizzle/schema";
import { getDb } from "../db";
import { permissionProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const workflowsRouter = router({
    list: permissionProcedure("campaigns.view").query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return [];
        try {
            return await db.select().from(workflows).where(eq(workflows.tenantId, ctx.tenantId)).orderBy(desc(workflows.createdAt));
        } catch {
            return []; // workflows table may not exist
        }
    }),

    get: permissionProcedure("campaigns.view")
        .input(z.object({ id: z.number() }))
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");
            try {
                const result = await db.select().from(workflows).where(and(eq(workflows.tenantId, ctx.tenantId), eq(workflows.id, input.id))).limit(1);
                if (!result[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow no encontrado" });
                return result[0];
            } catch (e: any) {
                if (e?.message?.includes("doesn't exist")) {
                    throw new Error("La tabla de workflows no existe todav\u00eda.");
                }
                throw e;
            }
        }),

    create: permissionProcedure("campaigns.manage")
        .input(z.object({
            name: z.string().min(1).max(200),
            description: z.string().max(1000).optional(),
            triggerType: z.enum(["lead_created", "lead_updated", "msg_received", "campaign_link_clicked"]),
            triggerConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
            actions: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const result = await db.insert(workflows).values({
                tenantId: ctx.tenantId,
                ...input,
                isActive: true
            });
            return { success: true, id: result[0].insertId };
        }),

    update: permissionProcedure("campaigns.manage")
        .input(z.object({
            id: z.number(),
            name: z.string().max(200).optional(),
            description: z.string().max(1000).optional(),
            triggerType: z.enum(["lead_created", "lead_updated", "msg_received", "campaign_link_clicked"]).optional(),
            triggerConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
            actions: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))).optional(),
            isActive: z.boolean().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("DB error");

            const { id, ...data } = input;
            await db.update(workflows).set(data).where(and(eq(workflows.tenantId, ctx.tenantId), eq(workflows.id, id)));
            return { success: true };
        }),

    toggle: permissionProcedure("campaigns.manage")
        .input(z.object({ id: z.number(), isActive: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");
            await db.update(workflows).set({ isActive: input.isActive }).where(and(eq(workflows.tenantId, ctx.tenantId), eq(workflows.id, input.id)));
            return { success: true };
        }),

    delete: permissionProcedure("campaigns.manage")
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");
            await db.delete(workflows).where(and(eq(workflows.tenantId, ctx.tenantId), eq(workflows.id, input.id)));
            return { success: true };
        }),
});
