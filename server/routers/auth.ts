import { z } from "zod";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { users, tenants, termsAcceptance } from "../../drizzle/schema";
import { getDb } from "../db";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { sendEmail } from "../_core/email";
import { getClientIp } from "../services/security";
import { authRateLimit, clearRateLimit } from "../_core/trpc-rate-limit";
import { logger } from "../_core/logger";

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

    // 3. Fallback: query param (dev only)
    if (!slug && req.query?.tenant) {
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
            customRole: (u as any).customRole,
            loginMethod: u.loginMethod,
            isActive: u.isActive,
            hasSeenTour: u.hasSeenTour,
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
        .input(z.object({ email: z.string().includes("@"), password: z.string() }))
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
                return { success: false, error: e.message };
            }

            // SECURITY FIX (MT-01): Resolve tenantId from request context
            // to prevent cross-tenant user enumeration and login attacks.
            let tenantId: number | null = null;
            try {
                tenantId = await resolveTenantFromRequest(ctx.req);
            } catch (e) {
                logger.error({ err: e, email: normalizedEmail, ip }, "[Auth] Tenant resolution failed, falling back to platform tenant");
                tenantId = null;
            }

            let user;
            if (tenantId) {
                // Tenant-scoped login: only find users within this tenant
                user = await db.select().from(users)
                    .where(and(eq(users.email, normalizedEmail), eq(users.tenantId, tenantId)))
                    .limit(1);
            } else {
                // Platform-level login (superadmin or single-tenant dev mode)
                // Only allow for tenantId=1 (platform tenant) as fallback
                user = await db.select().from(users)
                    .where(and(eq(users.email, normalizedEmail), eq(users.tenantId, 1)))
                    .limit(1);
                logger.warn({ email: normalizedEmail, ip }, "[Auth] Login without tenant context — restricted to platform tenant");
            }

            if (!user[0] || !user[0].password) {
                return { success: false, error: "Credenciales inválidas" };
            }

            // Check if user account is active
            if (!user[0].isActive) {
                return { success: false, error: "Cuenta desactivada. Contacte al administrador." };
            }

            const valid = await bcrypt.compare(input.password, user[0].password);
            if (!valid) {
                return { success: false, error: "Credenciales inválidas" };
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
            password: z.string().min(6),
            termsVersion: z.string().optional(), // Match request for termsVersion
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const user = await db.select().from(users).where(eq(users.invitationToken, input.token)).limit(1);
            if (!user[0]) throw new Error("Invalid token");

            if (user[0].invitationExpires && new Date() > user[0].invitationExpires) {
                throw new Error("Token expired");
            }

            const hashedPassword = await bcrypt.hash(input.password, 10);

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

            return { success: true };
        }),
});
