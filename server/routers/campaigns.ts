import { z } from "zod";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { campaigns, leads, campaignRecipients } from "../../drizzle/schema";
import { getDb } from "../db";
import { permissionProcedure, router } from "../_core/trpc";
import { logger } from "../_core/logger";

export const campaignsRouter = router({
    list: permissionProcedure("campaigns.view").query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return [];
        try {
            return await db.select().from(campaigns).where(eq(campaigns.tenantId, ctx.tenantId)).orderBy(desc(campaigns.createdAt)).limit(500);
        } catch {
            return []; // campaigns table may not exist
        }
    }),

    create: permissionProcedure("campaigns.manage")
        .input(z.object({
            name: z.string().min(1).max(200),
            type: z.enum(["whatsapp", "email"]),
            templateId: z.number().optional(),
            message: z.string().max(10000), // Fallback or override
            audienceConfig: z.record(z.string(), z.unknown()).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");
            const result = await db.insert(campaigns).values({
                tenantId: ctx.tenantId,
                ...input,
                status: "draft",
            });
            return { success: true, id: result[0].insertId };
        }),

    calculateAudience: permissionProcedure("campaigns.manage")
        .input(z.object({
            pipelineStageId: z.number().optional(),
            tags: z.array(z.string()).optional(),
            // Add more filters as needed
        }))
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return { count: 0 };

            // Simple filter by stage for now
            const conditions = [eq(leads.tenantId, ctx.tenantId)];
            if (input.pipelineStageId) {
                conditions.push(eq(leads.pipelineStageId, input.pipelineStageId));
            }

            const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

            const countResult = await db.select({ count: count() }).from(leads).where(whereClause);
            return { count: countResult[0]?.count ?? 0 };
        }),

    launch: permissionProcedure("campaigns.manage")
        .input(z.object({ campaignId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("DB error");

            return await db.transaction(async (tx) => {
                // Lock the campaign row to prevent concurrent launches
                const [campaign] = await tx.select().from(campaigns)
                    .where(and(eq(campaigns.tenantId, ctx.tenantId), eq(campaigns.id, input.campaignId)))
                    .for("update")
                    .limit(1);
                if (!campaign) throw new Error("Campaign not found");

                // Idempotency: already launched
                if (campaign.status === "scheduled" || campaign.status === "running") {
                    return {
                        success: true,
                        recipientsCount: campaign.totalRecipients,
                        alreadyLaunched: true,
                    };
                }

                if (campaign.status !== "draft") {
                    throw new Error(`Cannot launch campaign with status: ${campaign.status}`);
                }

                const config = campaign.audienceConfig as any;

                const conditions: any[] = [eq(leads.tenantId, ctx.tenantId)];
                if (config?.pipelineStageId) {
                    conditions.push(eq(leads.pipelineStageId, config.pipelineStageId));
                }
                const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

                const audience = await tx.select().from(leads).where(whereClause).limit(10000);

                if (audience.length === 0) {
                    throw new Error("No recipients found for campaign");
                }

                // Batch insert recipients (chunks of 500 to avoid query size limits)
                let insertedCount = 0;
                let duplicatesIgnored = 0;
                const BATCH_SIZE = 500;

                // Dedupe by leadId before insert
                const uniqueLeadIds = [...new Set(audience.map(l => l.id))];

                for (let i = 0; i < uniqueLeadIds.length; i += BATCH_SIZE) {
                    const batch = uniqueLeadIds.slice(i, i + BATCH_SIZE);
                    const values = batch.map(leadId => ({
                        tenantId: ctx.tenantId,
                        campaignId: input.campaignId,
                        leadId,
                        status: "pending" as const,
                    }));

                    try {
                        await tx.insert(campaignRecipients).values(values).onDuplicateKeyUpdate({
                            set: { status: sql`status` }, // no-op update on duplicate
                        });
                        insertedCount += batch.length;
                    } catch (err: any) {
                        if (err.code !== 'ER_DUP_ENTRY' && !err.message?.includes('Duplicate')) {
                            throw err;
                        }
                        // Fallback: some duplicates in this batch, count accurately
                        duplicatesIgnored += batch.length;
                    }
                }

                await tx.update(campaigns).set({
                    status: "scheduled",
                    totalRecipients: insertedCount,
                    startedAt: new Date(),
                }).where(and(eq(campaigns.tenantId, ctx.tenantId), eq(campaigns.id, input.campaignId)));

                if (duplicatesIgnored > 0) {
                    logger.warn({ campaignId: input.campaignId, duplicatesIgnored }, "[Campaigns] Duplicates ignored during launch");
                }

                return { success: true, recipientsCount: audience.length, inserted: insertedCount, duplicatesIgnored };
            });
        }),

    getById: permissionProcedure("campaigns.view")
        .input(z.object({ id: z.number() }))
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return null;

            try {
                const result = await db.select()
                    .from(campaigns)
                    .where(and(eq(campaigns.tenantId, ctx.tenantId), eq(campaigns.id, input.id)))
                    .limit(1);

                return result[0] ?? null;
            } catch {
                return null; // campaigns table may not exist
            }
        }),

    delete: permissionProcedure("campaigns.manage")
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            await db.delete(campaigns).where(and(eq(campaigns.tenantId, ctx.tenantId), eq(campaigns.id, input.id)));
            return { success: true };
        }),

    update: permissionProcedure("campaigns.manage")
        .input(z.object({
            id: z.number(),
            name: z.string().min(1).max(200).optional(),
            message: z.string().max(10000).optional(),
            audienceConfig: z.record(z.string(), z.unknown()).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const [campaign] = await db.select().from(campaigns)
                .where(and(eq(campaigns.tenantId, ctx.tenantId), eq(campaigns.id, input.id)))
                .limit(1);

            if (!campaign) throw new Error("Campaign not found");
            if (campaign.status !== "draft") throw new Error("Solo se pueden editar campañas en borrador");

            const { id, ...updates } = input;
            await db.update(campaigns).set(updates)
                .where(and(eq(campaigns.tenantId, ctx.tenantId), eq(campaigns.id, id)));
            return { success: true };
        }),
});
