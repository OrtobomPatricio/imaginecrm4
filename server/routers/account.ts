import { z } from "zod";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { users } from "../../drizzle/schema";
import { getDb } from "../db";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { sendEmail } from "../_core/email";
import { getClientIp } from "../services/security";
import { authRateLimit, clearRateLimit } from "../_core/trpc-rate-limit";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";

/**
 * Account Router
 *
 * Handles account-level operations that are missing for a complete SaaS:
 * - Email verification (confirm ownership of email address)
 * - Password reset (forgot password flow)
 * - Change password (authenticated user)
 * - Resend verification email
 */

/** Token expiry: 1 hour for password reset, 24 hours for email verification */
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const accountRouter = router({
    /**
     * Verify email address using the token sent during signup
     */
    verifyEmail: publicProcedure
        .input(z.object({ token: z.string().min(10) }))
        .mutation(async ({ input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [user] = await db.select()
                .from(users)
                .where(eq((users as any).emailVerifyToken, input.token))
                .limit(1);

            if (!user) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Token de verificación inválido o expirado.",
                });
            }

            await db.update(users)
                .set({
                    emailVerified: true,
                    emailVerifyToken: null,
                } as any)
                .where(eq(users.id, user.id));

            logger.info({ userId: user.id, email: user.email }, "[Account] Email verified");

            return {
                success: true,
                message: "Email verificado exitosamente.",
            };
        }),

    /**
     * Resend verification email
     */
    resendVerification: protectedProcedure
        .mutation(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const user = ctx.user!;
            const userData = user as any;

            if (userData.emailVerified) {
                return { success: true, message: "Tu email ya está verificado." };
            }

            // Generate new token
            const newToken = crypto.randomBytes(32).toString("hex");
            await db.update(users)
                .set({ emailVerifyToken: newToken } as any)
                .where(eq(users.id, user.id));

            const appUrl = process.env.APP_URL || "https://app.imaginecrm.com";
            const verifyUrl = `${appUrl}/verify-email?token=${newToken}`;

            await sendEmail({
                tenantId: ctx.tenantId,
                to: user.email!,
                subject: "Verifica tu email - Imagine CRM",
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>Verificación de Email</h2>
                        <p>Hola ${user.name},</p>
                        <p>Haz clic en el siguiente enlace para verificar tu email:</p>
                        <p><a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px;">Verificar Email</a></p>
                        <p style="color: #666; font-size: 12px;">Este enlace expira en 24 horas.</p>
                    </div>
                `,
            });

            logger.info({ userId: user.id }, "[Account] Verification email resent");
            return { success: true, message: "Email de verificación reenviado." };
        }),

    /**
     * Request password reset (forgot password)
     * Sends a reset link to the user's email.
     * Always returns success to prevent email enumeration.
     */
    requestPasswordReset: publicProcedure
        .input(z.object({ email: z.string().email() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Rate limiting
            const ip = getClientIp(ctx.req);
            const rateLimitKey = `reset:${ip}`;
            try {
                await authRateLimit(rateLimitKey);
            } catch (e: any) {
                // Still return success to prevent timing attacks
                return { success: true, message: "Si el email existe, recibirás un enlace de recuperación." };
            }

            const [user] = await db.select()
                .from(users)
                .where(eq(users.email, input.email))
                .limit(1);

            // Always return success (prevent email enumeration)
            if (!user) {
                logger.info({ email: input.email }, "[Account] Password reset requested for non-existent email");
                return { success: true, message: "Si el email existe, recibirás un enlace de recuperación." };
            }

            // Generate reset token with expiry
            const resetToken = crypto.randomBytes(32).toString("hex");
            const resetExpires = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

            await db.update(users)
                .set({
                    passwordResetToken: resetToken,
                    passwordResetExpires: resetExpires,
                } as any)
                .where(eq(users.id, user.id));

            const appUrl = process.env.APP_URL || "https://app.imaginecrm.com";
            const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;

            await sendEmail({
                tenantId: user.tenantId,
                to: user.email!,
                subject: "Recuperar contraseña - Imagine CRM",
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>Recuperar Contraseña</h2>
                        <p>Hola ${user.name || "usuario"},</p>
                        <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el siguiente enlace:</p>
                        <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px;">Restablecer Contraseña</a></p>
                        <p style="color: #666; font-size: 12px;">Este enlace expira en 1 hora. Si no solicitaste este cambio, ignora este email.</p>
                    </div>
                `,
            });

            clearRateLimit(rateLimitKey, 'auth');
            logger.info({ userId: user.id }, "[Account] Password reset email sent");

            return { success: true, message: "Si el email existe, recibirás un enlace de recuperación." };
        }),

    /**
     * Reset password using the token from the email
     */
    resetPassword: publicProcedure
        .input(z.object({
            token: z.string().min(10),
            newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
        }))
        .mutation(async ({ input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [user] = await db.select()
                .from(users)
                .where(eq((users as any).passwordResetToken, input.token))
                .limit(1);

            if (!user) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Token de recuperación inválido o expirado.",
                });
            }

            // Check token expiry
            const resetExpires = (user as any).passwordResetExpires as Date | null;
            if (!resetExpires || new Date() > resetExpires) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "El enlace de recuperación ha expirado. Solicita uno nuevo.",
                });
            }

            // Hash new password and clear token
            const hashedPassword = await bcrypt.hash(input.newPassword, 12);

            await db.update(users)
                .set({
                    password: hashedPassword,
                    passwordResetToken: null,
                    passwordResetExpires: null,
                } as any)
                .where(eq(users.id, user.id));

            logger.info({ userId: user.id }, "[Account] Password reset completed");

            return {
                success: true,
                message: "Contraseña actualizada exitosamente. Ya puedes iniciar sesión.",
            };
        }),

    /**
     * Change password (authenticated user)
     */
    changePassword: protectedProcedure
        .input(z.object({
            currentPassword: z.string(),
            newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [user] = await db.select()
                .from(users)
                .where(eq(users.id, ctx.user!.id))
                .limit(1);

            if (!user || !user.password) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "No se puede cambiar la contraseña para este tipo de cuenta.",
                });
            }

            const valid = await bcrypt.compare(input.currentPassword, user.password);
            if (!valid) {
                throw new TRPCError({
                    code: "UNAUTHORIZED",
                    message: "La contraseña actual es incorrecta.",
                });
            }

            if (input.currentPassword === input.newPassword) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "La nueva contraseña debe ser diferente a la actual.",
                });
            }

            const hashedPassword = await bcrypt.hash(input.newPassword, 12);

            await db.update(users)
                .set({ password: hashedPassword })
                .where(eq(users.id, user.id));

            logger.info({ userId: user.id }, "[Account] Password changed");

            return {
                success: true,
                message: "Contraseña actualizada exitosamente.",
            };
        }),
});
