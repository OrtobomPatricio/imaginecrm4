import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { nanoid } from "nanoid";
import { eq, desc, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { users, appSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { permissionProcedure, router } from "../_core/trpc";
import { sendEmail } from "../_core/email";
import { logAccess } from "../services/security";

export const teamRouter = router({
    listUsers: permissionProcedure("users.view").query(async ({ ctx }) => {
        const db = await getDb();
        if (!db) return [];

        const result = await db.select({
            id: users.id,
            openId: users.openId,
            name: users.name,
            email: users.email,
            role: users.role,
            customRole: users.customRole,
            isActive: users.isActive,
            createdAt: users.createdAt,
            lastSignedIn: users.lastSignedIn,
        }).from(users).where(eq(users.tenantId, ctx.tenantId)).orderBy(desc(users.createdAt));
        return Array.isArray(result) ? result : [];
    }),

    updateRole: permissionProcedure("users.manage")
        .input(z.object({ userId: z.number(), role: z.enum(["owner", "admin", "supervisor", "agent", "viewer"]) }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

            // Only owner can assign owner role
            if (input.role === "owner" && (ctx.user as any).role !== "owner") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can assign owner" });
            }

            // Nobody can downgrade owner except owner itself
            const target = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId))).limit(1);
            if (target[0]?.role === "owner" && (ctx.user as any).role !== "owner") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can change another owner" });
            }

            // Use transaction to prevent TOCTOU race when removing last owner
            await db.transaction(async (tx) => {
                // If removing owner role, check we won't orphan the tenant
                if (target[0]?.role === "owner" && input.role !== "owner") {
                    const ownerCount = await tx.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.role, "owner")));
                    if (ownerCount.length <= 1) {
                        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se puede eliminar el último owner del tenant" });
                    }
                }
                await tx.update(users).set({ role: input.role }).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId)));
            });

            await logAccess({ tenantId: ctx.tenantId, userId: (ctx.user as any).id, action: "updateRole", entityType: "user", entityId: input.userId, metadata: { newRole: input.role } });

            return { success: true } as const;
        }),

    updateCustomRole: permissionProcedure("users.manage")
        .input(z.object({ userId: z.number(), customRole: z.string().max(64).optional().nullable() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

            // Protect owner (only owner can change another owner)
            const target = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId))).limit(1);
            if (target[0]?.role === "owner" && (ctx.user as any).role !== "owner") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can change another owner" });
            }

            const value = input.customRole ? input.customRole.trim() : null;
            if (value && value.toLowerCase() === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden role" }); // BLOCK OWNER ESCALATION

            // Validate customRole (blocks reserved roles + checks matrix)
            if (value) {
                const settings = await db.select().from(appSettings).where(eq(appSettings.tenantId, ctx.tenantId)).limit(1);
                const matrix = settings[0]?.permissionsMatrix ?? {};
                if (!Object.prototype.hasOwnProperty.call(matrix, value)) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "Role does not exist in permissions matrix" });
                }
            }

            await db.update(users).set({ customRole: value }).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId)));
            return { success: true } as const;
        }),

    setActive: permissionProcedure("users.manage")
        .input(z.object({ userId: z.number(), isActive: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

            const target = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId))).limit(1);
            if (target[0]?.role === "owner" && (ctx.user as any).role !== "owner") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can disable owner" });
            }

            // Prevent disabling the last active owner (orphan tenant)
            if (!input.isActive && target[0]?.role === "owner") {
                const activeOwners = await db.select({ id: users.id }).from(users)
                    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.role, "owner"), eq(users.isActive, true)));
                if (activeOwners.length <= 1) {
                    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No se puede deshabilitar al único owner activo del tenant" });
                }
            }

            await db.update(users).set({ isActive: input.isActive }).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId)));

            await logAccess({ tenantId: ctx.tenantId, userId: (ctx.user as any).id, action: "setActive", entityType: "user", entityId: input.userId, metadata: { isActive: input.isActive } });
            return { success: true } as const;
        }),

    create: permissionProcedure("users.manage")
        .input(z.object({
            name: z.string().min(1),
            email: z.string().email(),
            password: z.string().min(8).max(128), // Password required for manual creation
            role: z.enum(["admin", "supervisor", "agent", "viewer"]), // Owner cannot be created this way
        }))
        .mutation(async ({ input, ctx }) => {
            // Enforce plan limits before creating a user
            const { enforceUserLimit } = await import("../services/plan-limits");
            await enforceUserLimit(ctx.tenantId);

            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

            // Check if email already exists
            const existing = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.email, input.email))).limit(1);
            if (existing.length > 0) {
                throw new TRPCError({ code: "CONFLICT", message: "User with this email already exists" });
            }

            const hashedPassword = await bcrypt.hash(input.password, 12);
            const openId = `local_${nanoid(16)}`; // Generate unique openId for local users

            const result = await db.insert(users).values({
                tenantId: ctx.tenantId,
                openId,
                name: input.name,
                email: input.email,
                password: hashedPassword,
                role: input.role,
                loginMethod: "credentials",
                isActive: true,
                hasSeenTour: false,
            });

            return { id: result[0].insertId, success: true };
        }),

    invite: permissionProcedure("users.manage")
        .input(z.object({
            name: z.string().min(1),
            email: z.string().email(),
            role: z.enum(["admin", "supervisor", "agent", "viewer"]),
        }))
        .mutation(async ({ input, ctx }) => {
            // Enforce plan limits before inviting a user
            const { enforceUserLimit } = await import("../services/plan-limits");
            await enforceUserLimit(ctx.tenantId);

            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

            const existing = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.email, input.email))).limit(1);
            if (existing.length > 0) {
                throw new TRPCError({ code: "CONFLICT", message: "User already exists" });
            }

            const token = crypto.randomBytes(32).toString("hex");
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            const openId = `invite_${nanoid(16)}`;

            await db.insert(users).values({
                tenantId: ctx.tenantId,
                openId,
                name: input.name,
                email: input.email,
                role: input.role,
                isActive: true,
                invitationToken: token,
                invitationExpires: expiresAt,
                loginMethod: "credentials",
            });

            const baseUrl = process.env.APP_URL || process.env.VITE_API_URL || "http://localhost:3000";
            const inviteLink = `${baseUrl}/setup-account?token=${token}`;

            const emailResult = await sendEmail({
                tenantId: ctx.tenantId,
                to: input.email,
                subject: "Welcome to Imagine CRM - Setup your account",
                html: `
            <h3>Hello ${input.name}!</h3>
            <p>You have been invited to join Imagine CRM as a <strong>${input.role}</strong>.</p>
            <p>Click the link below to set your password and access the system:</p>
            <a href="${inviteLink}">${inviteLink}</a>
            <p>This link expires in 24 hours.</p>
          `,
            });

            return {
                success: true,
                emailSent: emailResult.sent,
                smtpWarning: emailResult.reason === "NO_SMTP_CONFIG" ? "El usuario fue creado pero el email no se pudo enviar porque SMTP no está configurado. Comparte el link manualmente." : undefined,
                inviteLink: !emailResult.sent ? inviteLink : undefined,
            };
        }),

    delete: permissionProcedure("users.manage")
        .input(z.object({ userId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

            // Get target user
            const target = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId))).limit(1);
            if (!target[0]) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

            // Prevent deleting owner (only owner can delete owner accounts)
            if (target[0].role === "owner" && (ctx.user as any).role !== "owner") {
                throw new TRPCError({ code: "FORBIDDEN", message: "Only owner can delete another owner" });
            }

            // Prevent self-deletion
            if (target[0].id === (ctx.user as any).id) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete yourself" });
            }

            // Prevent deleting the last owner
            if (target[0].role === "owner") {
                const owners = await db.select().from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.role, "owner")));
                if (owners.length <= 1) {
                    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Cannot delete the last owner allowed in the system" });
                }
            }

            // Delete user
            await db.delete(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.id, input.userId)));

            await logAccess({ tenantId: ctx.tenantId, userId: (ctx.user as any).id, action: "deleteUser", entityType: "user", entityId: input.userId });

            return { success: true };
        }),
});
