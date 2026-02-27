import { z } from "zod";
import { getDb } from "../db";
import { smtpConnections } from "../../drizzle/schema";
import { permissionProcedure, router } from "../_core/trpc";
import { verifySmtpConnection, sendEmail } from "../_core/email";
import { eq, and } from "drizzle-orm";
import { encryptSecret } from "../_core/crypto";

export const smtpRouter = router({
    list: permissionProcedure("settings.view")
        .query(async ({ ctx }) => {
            const db = await getDb();
            if (!db) return [];
            return await db.select().from(smtpConnections)
                .where(eq(smtpConnections.tenantId, ctx.tenantId))
                .orderBy(smtpConnections.createdAt);
        }),

    create: permissionProcedure("settings.manage")
        .input(z.object({
            name: z.string().min(1).max(100),
            host: z.string().min(1).max(255),
            port: z.number().int().min(1).max(65535),
            secure: z.boolean(),
            user: z.string().min(1).max(255),
            password: z.string().min(1),
            fromEmail: z.string().includes("@").optional(),
            fromName: z.string().max(100).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            // Password is encrypted before storage using AES-256-GCM
            const encryptedPass = encryptSecret(input.password);

            const [result] = await db.insert(smtpConnections).values({
                tenantId: ctx.tenantId,
                ...input,
                password: encryptedPass, // Storing encrypted
                isActive: true,
                isDefault: false,
                testStatus: "untested",
                lastTested: null,
            }).$returningId();

            return { success: true, id: result.id };
        }),

    delete: permissionProcedure("settings.manage")
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return { success: false };

            await db.delete(smtpConnections).where(
                and(eq(smtpConnections.id, input.id), eq(smtpConnections.tenantId, ctx.tenantId))
            );
            return { success: true };
        }),

    test: permissionProcedure("settings.manage")
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const [connection] = await db
                .select()
                .from(smtpConnections)
                .where(and(eq(smtpConnections.id, input.id), eq(smtpConnections.tenantId, ctx.tenantId)))
                .limit(1);

            if (!connection) throw new Error("Connection not found");

            try {
                let pass = connection.password || "";
                try {
                    const decrypted = await import("../_core/crypto").then(m => m.decryptSecret(pass));
                    if (decrypted) pass = decrypted;
                } catch (e) {
                    // Fallback to raw password for legacy entries
                }

                await verifySmtpConnection({
                    host: connection.host,
                    port: connection.port,
                    secure: connection.secure,
                    user: connection.user,
                    pass: pass,
                });

                await db
                    .update(smtpConnections)
                    .set({ testStatus: "success", lastTested: new Date() })
                    .where(and(eq(smtpConnections.id, input.id), eq(smtpConnections.tenantId, ctx.tenantId)));

                return { success: true, status: "success" };
            } catch (error) {
                await db
                    .update(smtpConnections)
                    .set({ testStatus: "failed", lastTested: new Date() })
                    .where(and(eq(smtpConnections.id, input.id), eq(smtpConnections.tenantId, ctx.tenantId)));

                throw new Error(`Test failed: ${error instanceof Error ? error.message : "Unknown error"}`);
            }
        }),

    setDefault: permissionProcedure("settings.manage")
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return { success: false };

            // Unset all defaults for THIS tenant only
            await db.update(smtpConnections)
                .set({ isDefault: false })
                .where(eq(smtpConnections.tenantId, ctx.tenantId));

            // Set this one as default (verified it belongs to this tenant)
            await db
                .update(smtpConnections)
                .set({ isDefault: true })
                .where(and(eq(smtpConnections.id, input.id), eq(smtpConnections.tenantId, ctx.tenantId)));

            return { success: true };
        }),

    verifySmtpTest: permissionProcedure("settings.manage")
        .input(z.object({ email: z.string().includes("@") }))
        .mutation(async ({ input, ctx }) => {
            const sent = await sendEmail({
                tenantId: ctx.tenantId,
                to: input.email,
                subject: "Test SMTP Connection - Imagine CRM",
                html: "<p>If you see this, your SMTP configuration is working correctly! 🚀</p>",
            });
            if (!sent) throw new Error("Failed to send email. Check server logs.");
            return { success: true };
        }),
});
