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
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, validatePassword as validateSharedPassword } from "../../shared/password-policy";

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
                .where(eq(users.emailVerifyToken, input.token))
                .limit(1);

            if (!user) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Token de verificación inválido o expirado.",
                });
            }

            // Enforce 24h token expiry — extract timestamp from token if present, fallback to updatedAt
            const tokenParts = (user.emailVerifyToken as string).split(".");
            const tokenCreatedAt = tokenParts.length === 2
                ? parseInt(tokenParts[0], 36)
                : new Date(user.updatedAt).getTime();
            const tokenAge = Date.now() - tokenCreatedAt;
            if (tokenAge > VERIFY_TOKEN_EXPIRY_MS) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "El token de verificación ha expirado. Solicita uno nuevo desde tu cuenta.",
                });
            }

            // Scope update to the user's own tenant to prevent cross-tenant verification
            await db.update(users)
                .set({
                    emailVerified: true,
                    emailVerifyToken: null,
                })
                .where(and(eq(users.id, user.id), eq(users.tenantId, user.tenantId)));

            logger.info({ userId: user.id, email: user.email, tenantId: user.tenantId }, "[Account] Email verified");

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

            if ((user as any).emailVerified) {
                return { success: true, message: "Tu email ya está verificado." };
            }

            // Generate new token with embedded timestamp for accurate expiry
            const ts = Date.now().toString(36);
            const newToken = `${ts}.${crypto.randomBytes(32).toString("hex")}`;
            await db.update(users)
                .set({ emailVerifyToken: newToken })
                .where(eq(users.id, user.id));

            const appUrl = process.env.APP_URL || process.env.CLIENT_URL || "https://crm-imagine-crm.yk50nb.easypanel.host";
            const verifyUrl = `${appUrl}/verify-email?token=${newToken}`;

            const result = await sendEmail({
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

            if (!result.sent) {
                logger.warn({ userId: user.id, reason: result.reason }, "[Account] Verification email could not be sent");
                return { success: false, message: "No se pudo enviar el email. Verifica la configuración SMTP." };
            }

            logger.info({ userId: user.id }, "[Account] Verification email resent");
            return { success: true, message: "Email de verificación reenviado." };
        }),

    /**
     * Request password reset (forgot password)
     * Sends a reset link to the user's email.
     * Always returns success to prevent email enumeration.
     */
    requestPasswordReset: publicProcedure
        .input(z.object({
            email: z.string().email(),
            tenantSlug: z.string().min(2).max(100),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Rate limiting
            const ip = getClientIp(ctx.req);
            const rateLimitKey = `reset:${ip}`;
            try {
                await authRateLimit(rateLimitKey);
            } catch (e: any) {
                // Still return success to prevent timing attacks, but log for monitoring
                logger.warn({ ip, email: input.email }, "[Account] Password reset rate-limited");
                return { success: true, message: "Si el email existe, recibirás un enlace de recuperación." };
            }

            const normalizedEmail = input.email.trim().toLowerCase();
            const normalizedSlug = input.tenantSlug.trim().toLowerCase();

            const { tenants } = await import("../../drizzle/schema");

            const [tenant] = await db.select({ id: tenants.id })
                .from(tenants)
                .where(eq(tenants.slug, normalizedSlug))
                .limit(1);

            // Always return success to prevent enumeration
            if (!tenant) {
                logger.info({ email: normalizedEmail, tenantSlug: normalizedSlug }, "[Account] Password reset requested for unknown tenant");
                return { success: true, message: "Si el email existe, recibirás un enlace de recuperación." };
            }

            const [user] = await db.select()
                .from(users)
                .where(and(eq(users.email, normalizedEmail), eq(users.tenantId, tenant.id)))
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
                })
                .where(eq(users.id, user.id));

            const appUrl = process.env.APP_URL || process.env.CLIENT_URL || "https://crm-imagine-crm.yk50nb.easypanel.host";
            const resetUrl = `${appUrl}/reset-password?token=${resetToken}&tenant=${encodeURIComponent(normalizedSlug)}`;

            const emailResult = await sendEmail({
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

            if (!emailResult.sent) {
                logger.warn({ userId: user.id, reason: emailResult.reason }, "[Account] Password reset email could not be sent");
            }

            clearRateLimit(rateLimitKey, 'auth');
            logger.info({ userId: user.id, sent: emailResult.sent }, "[Account] Password reset processed");

            return { success: true, message: "Si el email existe, recibirás un enlace de recuperación." };
        }),

    /**
     * Reset password using the token from the email
     */
    resetPassword: publicProcedure
        .input(z.object({
            token: z.string().min(10),
            newPassword: z.string()
                .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
                .max(PASSWORD_MAX_LENGTH)
                .refine((value) => validateSharedPassword(value).valid, {
                    message: "La contraseña debe incluir mayúscula, minúscula y número",
                }),
        }))
        .mutation(async ({ input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Rate limiting
            const rateLimitKey = `resetpw:${input.token.slice(0, 8)}`;
            try {
                await authRateLimit(rateLimitKey);
            } catch {
                throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Demasiados intentos. Espere un momento." });
            }

            const [user] = await db.select()
                .from(users)
                .where(eq(users.passwordResetToken, input.token))
                .limit(1);

            if (!user) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Token de recuperación inválido o expirado.",
                });
            }

            // Check token expiry
            const resetExpires = user.passwordResetExpires as Date | null;
            if (!resetExpires || new Date() > resetExpires) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "El enlace de recuperación ha expirado. Solicita uno nuevo.",
                });
            }

            // Hash new password and clear token — scope to user's own tenant
            const hashedPassword = await bcrypt.hash(input.newPassword, 12);

            await db.update(users)
                .set({
                    password: hashedPassword,
                    passwordResetToken: null,
                    passwordResetExpires: null,
                })
                .where(and(eq(users.id, user.id), eq(users.tenantId, user.tenantId)));

            logger.info({ userId: user.id, tenantId: user.tenantId }, "[Account] Password reset completed");

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
            currentPassword: z.string().max(128),
            newPassword: z.string()
                .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
                .max(PASSWORD_MAX_LENGTH)
                .refine((value) => validateSharedPassword(value).valid, {
                    message: "La contraseña debe incluir mayúscula, minúscula y número",
                }),
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
