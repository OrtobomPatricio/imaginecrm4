import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, whatsappNumbers, conversations, leads, sessions } from "../../drizzle/schema";
import { eq, desc, sql, count } from "drizzle-orm";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";
import { getAllFlags, setFeatureFlag, getFlagDefinitions } from "../services/feature-flags";

/**
 * Superadmin Router
 *
 * Cross-tenant administration panel for platform owners.
 * Only accessible by users with role === "owner" AND tenantId === 1 (platform tenant).
 *
 * Provides:
 * - List all tenants with usage stats
 * - Impersonate a user in another tenant
 * - Manage feature flags per tenant
 * - Platform-wide stats
 */

const superadminGuard = protectedProcedure.use(async ({ ctx, next }) => {
    const role = ctx.user?.role;
    const tid = ctx.tenantId;
    const isPlatformOwner = role === "owner" && tid === 1;
    logger.info({ role, tenantId: tid, userId: ctx.user?.id, isPlatformOwner }, "[SuperAdmin] guard check");
    if (!isPlatformOwner) {
        throw new TRPCError({
            code: "FORBIDDEN",
            message: `Acceso restringido. Tu rol=${role}, tenantId=${tid}. Se requiere role=owner + tenantId=1.`,
        });
    }
    return next();
});

export const superadminRouter = router({
    /** Debug endpoint: returns current user role and tenantId */
    whoami: protectedProcedure.query(({ ctx }) => {
        return {
            userId: ctx.user?.id,
            role: ctx.user?.role,
            tenantId: ctx.tenantId,
            email: ctx.user?.email,
        };
    }),

    // ── Tenant Management ──

    /** List all tenants with user counts */
    listTenants: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];

            // First get base tenant data (always safe)
            const tenantList = await db
                .select({
                    id: tenants.id,
                    name: tenants.name,
                    slug: tenants.slug,
                    plan: tenants.plan,
                    status: tenants.status,
                    createdAt: tenants.createdAt,
                    updatedAt: tenants.updatedAt,
                })
                .from(tenants)
                .orderBy(desc(tenants.createdAt));

            // Enrich with counts (safe — tables may not exist)
            const safeCountByTenant = async (query: string): Promise<Map<number, number>> => {
                try {
                    const [rows] = await db.execute(sql.raw(query)) as any;
                    const map = new Map<number, number>();
                    for (const row of (rows ?? [])) {
                        map.set(Number(row.tenantId ?? row.tid), Number(row.cnt ?? 0));
                    }
                    return map;
                } catch {
                    return new Map();
                }
            };

            const [userCounts, leadCounts, waCounts] = await Promise.all([
                safeCountByTenant("SELECT tenantId as tid, COUNT(*) as cnt FROM users GROUP BY tenantId"),
                safeCountByTenant("SELECT tenantId as tid, COUNT(*) as cnt FROM leads WHERE deletedAt IS NULL GROUP BY tenantId"),
                safeCountByTenant("SELECT tenantId as tid, COUNT(*) as cnt FROM whatsapp_numbers GROUP BY tenantId"),
            ]);

            return tenantList.map(t => ({
                ...t,
                userCount: userCounts.get(t.id) ?? 0,
                leadCount: leadCounts.get(t.id) ?? 0,
                waNumberCount: waCounts.get(t.id) ?? 0,
            }));
        }),

    /** Get platform-wide stats */
    platformStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return null;

            // Use individual safe queries to handle missing tables gracefully
            const safeCount = async (query: string): Promise<number> => {
                try {
                    const [row] = await db.execute(sql.raw(query)) as any;
                    return Number(row?.[0]?.cnt ?? row?.cnt ?? 0);
                } catch (e) {
                    logger.warn({ query, err: (e as any)?.message }, "[SuperAdmin] stats query failed (table may not exist)");
                    return 0;
                }
            };

            const [totalTenants, totalUsers, totalLeads, totalConversations, totalMessages] = await Promise.all([
                safeCount("SELECT COUNT(*) as cnt FROM tenants"),
                safeCount("SELECT COUNT(*) as cnt FROM users WHERE isActive = 1"),
                safeCount("SELECT COUNT(*) as cnt FROM leads WHERE deletedAt IS NULL"),
                safeCount("SELECT COUNT(*) as cnt FROM conversations"),
                safeCount("SELECT COUNT(*) as cnt FROM chat_messages"),
            ]);

            return { totalTenants, totalUsers, totalLeads, totalConversations, totalMessages };
        }),

    // ── Impersonate ──

    /** Generate an impersonation token for another user */
    impersonateUser: superadminGuard
        .input(z.object({
            targetUserId: z.number(),
            targetTenantId: z.number(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Verify target user exists
            const [targetUser] = await db.select()
                .from(users)
                .where(eq(users.id, input.targetUserId))
                .limit(1);

            if (!targetUser) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado" });
            }

            logger.warn(
                { adminId: ctx.user!.id, targetUserId: input.targetUserId, targetTenantId: input.targetTenantId },
                "[Superadmin] IMPERSONATION initiated"
            );

            // Return impersonation context (the client should create a special session)
            return {
                success: true,
                targetUser: {
                    id: targetUser.id,
                    name: (targetUser as any).name,
                    email: (targetUser as any).email,
                    tenantId: targetUser.tenantId,
                    role: targetUser.role,
                },
                note: "Impersonation mode active. All actions will be logged as the target user.",
            };
        }),

    // ── Tenant Lifecycle Management ──

    /** Suspend a tenant (disable access without deleting data) */
    suspendTenant: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            reason: z.string().max(500).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            if (input.tenantId === 1) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede suspender el tenant de la plataforma." });
            }

            await db.update(tenants)
                .set({ status: "suspended" })
                .where(eq(tenants.id, input.tenantId));

            logger.warn(
                { adminId: ctx.user!.id, tenantId: input.tenantId, reason: input.reason },
                "[Superadmin] Tenant SUSPENDED"
            );

            return { success: true, message: "Tenant suspendido exitosamente." };
        }),

    /** Reactivate a suspended tenant */
    reactivateTenant: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.update(tenants)
                .set({ status: "active" })
                .where(eq(tenants.id, input.tenantId));

            logger.info(
                { adminId: ctx.user!.id, tenantId: input.tenantId },
                "[Superadmin] Tenant REACTIVATED"
            );

            return { success: true, message: "Tenant reactivado exitosamente." };
        }),

    /** Change a tenant's plan */
    changeTenantPlan: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            plan: z.enum(["free", "starter", "pro", "enterprise"]),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.update(tenants)
                .set({ plan: input.plan })
                .where(eq(tenants.id, input.tenantId));

            logger.info(
                { adminId: ctx.user!.id, tenantId: input.tenantId, plan: input.plan },
                "[Superadmin] Tenant plan changed"
            );

            return { success: true, message: `Plan cambiado a ${input.plan}.` };
        }),

    // ── Feature Flags ──

    /** Get all flags for a tenant */
    getFeatureFlags: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .query(async ({ input }) => {
            const flags = await getAllFlags(input.tenantId);
            const definitions = getFlagDefinitions();
            return { flags, definitions };
        }),

    /** Update a feature flag for a tenant */
    setFeatureFlag: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            flag: z.string(),
            enabled: z.boolean(),
        }))
        .mutation(async ({ input, ctx }) => {
            await setFeatureFlag(input.tenantId, input.flag, input.enabled);
            logger.info(
                { adminId: ctx.user!.id, ...input },
                "[Superadmin] Feature flag updated"
            );
            return { success: true };
        }),
});
