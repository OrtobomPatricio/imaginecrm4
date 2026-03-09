import { z } from "zod";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, validatePassword as validateSharedPassword } from "@shared/password-policy";
import { users, tenants, termsAcceptance } from "../../drizzle/schema";
import { getDb } from "../db";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { sendEmail } from "../_core/email";
import { getClientIp } from "../services/security";
import { authRateLimit, clearRateLimit } from "../_core/trpc-rate-limit";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";

/**
 * Resolve tenantId from the request hostname or X-Tenant-Slug header.
 * Supports:
 *   - Subdomain: acme.imaginecrm.com -> slug = "acme"
 *   - Custom header: X-Tenant-Slug: acme
 *   - Query param: ?tenant=acme (fallback for dev)
 * Returns null if no tenant can be resolved (platform-level login).
 */
async function resolveTenantFromRequest(req: any): Promise<number | null> {
    const db = await getDb();
    if (!db) return null;

    let slug: string | null = null;

    // 1. Try X-Tenant-Slug header (used by frontend SPA)
    const headerSlug = req.headers?.["x-tenant-slug"];
    if (headerSlug && typeof headerSlug === "string") {
        slug = headerSlug.trim().toLowerCase();
    }

    // 2. Try subdomain extraction from Host header
    if (!slug) {
        const hostHeader = String(req.headers?.host || "").toLowerCase();
        const host = hostHeader.split(":")[0];
        const configuredBaseDomain = String(process.env.TENANT_BASE_DOMAIN || "").trim().toLowerCase();

        if (configuredBaseDomain && host.endsWith(configuredBaseDomain)) {
            if (host !== configuredBaseDomain) {
                const suffix = `.${configuredBaseDomain}`;
                const candidate = host.endsWith(suffix)
                    ? host.slice(0, -suffix.length)
                    : "";
                if (candidate && !candidate.includes(".") && candidate !== "www" && candidate !== "app" && candidate !== "api") {
                    slug = candidate;
                }
            }
        } else {
            const parts = host.split(".").filter(Boolean);
            // Legacy heuristic only for simple domains (e.g. acme.imaginecrm.com)
            if (parts.length === 3) {
                const candidate = parts[0].toLowerCase();
                if (candidate !== "www" && candidate !== "app" && candidate !== "api") {
                    slug = candidate;
                }
            }
        }
    }

    // 3. Fallback: query param (dev only — disabled in production)
    if (!slug && req.query?.tenant && process.env.NODE_ENV !== "production") {
        slug = String(req.query.tenant).trim().toLowerCase();
    }

    if (!slug) return null;

    // Resolve slug to tenantId
    const tenant = await db.select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);

    return tenant[0]?.id ?? null;
}

export const authRouter = router({
    me: publicProcedure.query(opts => {
        const u = opts.ctx.user;
        if (!u) return null;
        return {
            id: u.id,
            openId: u.openId,
            name: u.name,
            email: u.email,
            role: u.role,
            tenantId: u.tenantId,
            customRole: (u as any).customRole,
            loginMethod: u.loginMethod,
            isActive: u.isActive,
            hasSeenTour: u.hasSeenTour,
            emailVerified: (u as any).emailVerified ?? true,
        };
    }),

    logout: publicProcedure.mutation(async ({ ctx }) => {
        const token = ctx.req.cookies[COOKIE_NAME];
        if (token) {
            await sdk.revokeSession(token);
        }
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        return { success: true } as const;
    }),

    markTourSeen: protectedProcedure.mutation(async ({ ctx }) => {
        const db = await getDb();
        if (!db || !ctx.user) return { success: false };

        await db.update(users)
            .set({ hasSeenTour: true })
            .where(eq(users.id, ctx.user.id));

        return { success: true };
    }),

    loginWithCredentials: publicProcedure
        .input(z.object({ email: z.string().email().max(254), password: z.string().max(128), tenantSlug: z.string().max(100).optional() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return { success: false, error: "Database not available" };

            const normalizedEmail = input.email.trim().toLowerCase();

            // Rate limiting por email e IP
            const ip = getClientIp(ctx.req);
            const rateLimitKey = `${normalizedEmail}:${ip}`;

            try {
                await authRateLimit(rateLimitKey);
            } catch (e: any) {
                throw e; // Re-throw TRPCError (TOO_MANY_REQUESTS) so HTTP 429 is returned
            }

            // SECURITY FIX (MT-01): Resolve tenantId from explicit slug first,
            // then auto-resolve from email if the user belongs to a single tenant.
            let tenantId: number | null = null;
            if (input.tenantSlug) {
                const slug = input.tenantSlug.trim().toLowerCase();
                const tenant = await db.select({ id: tenants.id })
                    .from(tenants)
                    .where(eq(tenants.slug, slug))
                    .limit(1);
                tenantId = tenant[0]?.id ?? null;
                if (!tenantId) {
                    return { success: false, error: "Organización no encontrada." };
                }
            } else {
                // No slug provided — auto-resolve by looking up the email across tenants
                const matches = await db.select({ tenantId: users.tenantId })
                    .from(users)
                    .where(eq(users.email, normalizedEmail))
                    .limit(3); // Only need to know if 0, 1, or >1

                const uniqueTenants = [...new Set(matches.map(m => m.tenantId))];

                if (uniqueTenants.length === 1) {
                    tenantId = uniqueTenants[0];
                } else if (uniqueTenants.length > 1) {
                    return { success: false, error: "Tu email está en varias organizaciones. Ingresá el nombre de tu organización para continuar." };
                }
                // If 0 matches, tenantId stays null — will return "Credenciales inválidas" below
            }

            let user;
            if (tenantId) {
                // Tenant-scoped login: only find users within this tenant
                user = await db.select().from(users)
                    .where(and(eq(users.email, normalizedEmail), eq(users.tenantId, tenantId)))
                    .limit(1);
            } else {
                // No tenant resolved and no email matches — return generic error
                return { success: false, error: "Credenciales inválidas" };
            }

            if (!user[0] || !user[0].password) {
                logger.warn({ email: normalizedEmail, tenantId: tenantId ?? 1, ip, userFound: !!user[0], hasPassword: !!user[0]?.password }, "[Auth] Login failed: user not found or no password");
                return { success: false, error: "Credenciales inválidas" };
            }

            // Compare password FIRST — prevents account-state enumeration without valid credentials
            const valid = await bcrypt.compare(input.password, user[0].password);
            if (!valid) {
                logger.warn({ email: normalizedEmail, userId: user[0].id, ip }, "[Auth] Login failed: invalid password");
                return { success: false, error: "Credenciales inválidas" };
            }

            // Check active status only AFTER password is verified (anti-enumeration)
            if (!user[0].isActive) {
                logger.warn({ email: normalizedEmail, userId: user[0].id, ip }, "[Auth] Login failed: account disabled");
                return { success: false, error: "Cuenta desactivada. Contacte al administrador." };
            }

            // Limpiar rate limit después de login exitoso
            clearRateLimit(rateLimitKey, 'auth');

            const sessionToken = await sdk.createSessionToken(user[0].openId, {
                name: user[0].name || "",
                expiresInMs: ONE_YEAR_MS,
                ipAddress: ip,
                userAgent: (ctx.req.headers["user-agent"] as string),
            });

            const cookieOptions = getSessionCookieOptions(ctx.req);
            ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

            await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user[0].id));

            return { success: true };
        }),

    acceptInvitation: publicProcedure
        .input(z.object({
            token: z.string(),
            password: z.string()
                .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
                .max(PASSWORD_MAX_LENGTH)
                .refine((value) => validateSharedPassword(value).valid, {
                    message: "La contraseña debe incluir mayúscula, minúscula y número",
                }),
            termsVersion: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            // Rate limit by IP to prevent brute-force token guessing
            const ip = getClientIp(ctx.req);
            await authRateLimit(`invite:${ip}`);

            const user = await db.select().from(users).where(eq(users.invitationToken, input.token)).limit(1);
            if (!user[0]) throw new TRPCError({ code: "BAD_REQUEST", message: "Token de invitación inválido" });

            if (user[0].invitationExpires && new Date() > user[0].invitationExpires) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "El token de invitación ha expirado" });
            }

            // Prevent reactivation of intentionally disabled accounts (no active invitation)
            if (user[0].isActive === false && !user[0].invitationToken) {
                throw new TRPCError({ code: "FORBIDDEN", message: "La cuenta ha sido desactivada por un administrador" });
            }

            // Block replay: If user already has a password set, the invitation was already accepted
            if (user[0].password) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "La invitación ya fue aceptada. Inicia sesión con tu contraseña." });
            }

            const hashedPassword = await bcrypt.hash(input.password, 12);

            // Transaction to ensure both user update and terms acceptance are recorded
            await db.transaction(async (tx) => {
                await tx.update(users)
                    .set({
                        password: hashedPassword,
                        invitationToken: null,
                        invitationExpires: null,
                        isActive: true,
                        loginMethod: 'credentials'
                    })
                    .where(eq(users.id, user[0].id));

                if (input.termsVersion) {
                    await tx.insert(termsAcceptance).values({
                        tenantId: user[0].tenantId,
                        userId: user[0].id,
                        termsVersion: input.termsVersion,
                        ipAddress: getClientIp(ctx.req),
                        userAgent: (ctx.req.headers["user-agent"] as string),
                    });
                }
            });

            // Auto-login: create session so user doesn't have to login again
            const sessionToken = await sdk.createSessionToken(user[0].openId, {
                name: user[0].name || '',
                expiresInMs: ONE_YEAR_MS,
                ipAddress: getClientIp(ctx.req),
                userAgent: ctx.req.headers["user-agent"] as string,
            });
            const cookieOptions = getSessionCookieOptions(ctx.req);
            ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

            return { success: true };
        }),
});
