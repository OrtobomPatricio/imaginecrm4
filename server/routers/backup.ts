import { z } from "zod";
import { leads } from "../../drizzle/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { getDb } from "../db";
import { permissionProcedure, router } from "../_core/trpc";
import { createBackup, restoreBackup, leadsToCSV, parseCSV, importLeadsFromCSV } from "../services/backup";
import { logAccess, getClientIp } from "../services/security";

export const backupRouter = router({
    createBackup: permissionProcedure("settings.manage")
        .mutation(async ({ ctx }) => {
            const backupData = await createBackup(ctx.tenantId);

            const count = Object.values(backupData.data).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);

            await logAccess({
                userId: ctx.user?.id,
                action: "create_backup",
                metadata: { tenantId: ctx.tenantId, recordCount: count },
                ipAddress: getClientIp(ctx.req),
                userAgent: ctx.req.headers['user-agent'],
            });

            return { backup: backupData, count };
        }),

    restoreBackupJson: permissionProcedure("settings.manage")
        .input(z.object({
            backupJson: z.any(),
            mode: z.enum(["replace", "merge"]).default("replace"),
        }))
        .mutation(async ({ input, ctx }) => {
            const result = await restoreBackup(input.backupJson, input.mode, ctx.tenantId);

            await logAccess({
                userId: ctx.user?.id,
                action: "restore_backup",
                metadata: { mode: input.mode, tenantId: ctx.tenantId, result },
                ipAddress: getClientIp(ctx.req),
                userAgent: ctx.req.headers['user-agent'],
            });

            return result;
        }),

    exportLeadsCSV: permissionProcedure("leads.view")
        .input(z.object({
            status: z.enum(["new", "contacted", "qualified", "negotiation", "won", "lost"]).optional(),
            from: z.string().optional(),
            to: z.string().optional(),
        }).optional())
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const conditions = [eq(leads.tenantId, ctx.tenantId)];

            if (input?.status) {
                conditions.push(eq(leads.status, input.status));
            }
            if (input?.from) {
                conditions.push(gte(leads.createdAt, new Date(input.from)));
            }
            if (input?.to) {
                conditions.push(lte(leads.createdAt, new Date(input.to)));
            }

            const leadsData = await db.select()
                .from(leads)
                .where(and(...conditions))
                .orderBy(desc(leads.createdAt))
                .limit(10000);

            const csvContent = leadsToCSV(leadsData);
            return { csv: csvContent, count: leadsData.length };
        }),

    importLeadsCSV: permissionProcedure("leads.create")
        .input(z.object({ csvContent: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const parsedData = parseCSV(input.csvContent);
            const result = await importLeadsFromCSV(parsedData, ctx.tenantId);

            await logAccess({
                userId: ctx.user?.id,
                action: "import_leads_csv",
                metadata: { tenantId: ctx.tenantId, result },
                ipAddress: getClientIp(ctx.req),
                userAgent: ctx.req.headers['user-agent'],
            });

            return result;
        }),
});
