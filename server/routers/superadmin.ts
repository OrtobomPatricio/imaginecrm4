import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, sessions, platformAnnouncements, activityLogs, appSettings, license, superadminAlerts, webhooks, workflows } from "../../drizzle/schema";
import { eq, desc, sql, count, and, inArray, type SQL } from "drizzle-orm";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";
import { getAllFlags, setFeatureFlag, getFlagDefinitions } from "../services/feature-flags";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { COOKIE_NAME } from "@shared/const";
import { getPlanLimits } from "../services/plan-limits";
import { getOrCreateAppSettings, updateAppSettings, getPlatformMetaConfig } from "../services/app-settings";
import { encryptSecret } from "../_core/crypto";

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

/** Persist superadmin action to activity_logs for audit trail */
async function logSuperadminAction(
    adminId: number,
    action: string,
    details?: Record<string, any>,
    targetTenantId?: number,
) {
    try {
        const db = await getDb();
        if (!db) return;
        await db.insert(activityLogs).values({
            tenantId: targetTenantId ?? 1,
            userId: adminId,
            action: `superadmin.${action}`,
            entityType: "superadmin",
            details: details ?? null,
        });
    } catch (e) {
        logger.warn({ err: (e as any)?.message, action }, "[SuperAdmin] audit log insert failed");
    }
}

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
            try {

            // First get base tenant data (always safe)
            const tenantList = await db
                .select({
                    id: tenants.id,
                    name: tenants.name,
                    slug: tenants.slug,
                    plan: tenants.plan,
                    status: tenants.status,
                    paypalSubscriptionId: tenants.paypalSubscriptionId,
                    trialEndsAt: tenants.trialEndsAt,
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

            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] listTenants failed");
                return [];
            }
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
            await logSuperadminAction(ctx.user!.id, "impersonate", { targetUserId: input.targetUserId, targetTenantId: input.targetTenantId });

            // Create a real session token for the target user
            const openId = (targetUser as any).openId;
            if (!openId) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "El usuario no tiene openId. No se puede impersonar." });
            }

            const sessionToken = await sdk.createSessionToken(openId, {
                name: (targetUser as any).name || "",
                expiresInMs: 2 * 60 * 60 * 1000, // 2 hours only for impersonation
                ipAddress: ctx.req.ip ?? null,
                userAgent: ctx.req.headers["user-agent"] ?? null,
            });

            // Set the cookie so the browser is now logged in as the target user
            const cookieOptions = getSessionCookieOptions(ctx.req);
            ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: 2 * 60 * 60 * 1000 });

            return {
                success: true,
                targetUser: {
                    id: targetUser.id,
                    name: (targetUser as any).name,
                    email: (targetUser as any).email,
                    tenantId: targetUser.tenantId,
                    role: targetUser.role,
                },
                note: "Sesión de impersonación activa (2h). Recarga la página para ver el cambio.",
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
            await logSuperadminAction(ctx.user!.id, "suspendTenant", { tenantId: input.tenantId, reason: input.reason }, input.tenantId);

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
            await logSuperadminAction(ctx.user!.id, "reactivateTenant", { tenantId: input.tenantId }, input.tenantId);

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
            await logSuperadminAction(ctx.user!.id, "changeTenantPlan", { tenantId: input.tenantId, plan: input.plan }, input.tenantId);

            return { success: true, message: `Plan cambiado a ${input.plan}.` };
        }),

    // ── Tenant Users ──

    /** List all users for a specific tenant */
    listTenantUsers: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const userList = await db.select({
                    id: users.id,
                    name: (users as any).name,
                    email: (users as any).email,
                    role: users.role,
                    isActive: users.isActive,
                    lastSignedIn: (users as any).lastSignedIn,
                    createdAt: users.createdAt,
                }).from(users).where(eq(users.tenantId, input.tenantId));
                return userList;
            } catch {
                return [];
            }
        }),

    // ── Feature Flags ──

    /** Get all flags for a tenant */
    getFeatureFlags: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .query(async ({ input }) => {
            try {
                const flags = await getAllFlags(input.tenantId);
                const definitions = getFlagDefinitions();
                return { flags, definitions };
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] getFeatureFlags failed");
                return { flags: {}, definitions: [] };
            }
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
            await logSuperadminAction(ctx.user!.id, "setFeatureFlag", { tenantId: input.tenantId, flag: input.flag, enabled: input.enabled }, input.tenantId);
            return { success: true };
        }),

    // ══════════════════════════════════════════════════════════════
    //  SYSTEM HEALTH & OPERATIONS
    // ══════════════════════════════════════════════════════════════

    /** System health: uptime, memory, Node version, env */
    systemHealth: superadminGuard
        .query(async () => {
            const mem = process.memoryUsage();
            const upSeconds = process.uptime();

            // Test DB connection
            let dbStatus = "disconnected";
            try {
                const db = await getDb();
                if (db) {
                    await db.execute(sql.raw("SELECT 1"));
                    dbStatus = "connected";
                }
            } catch { dbStatus = "error"; }

            // Test Redis
            let redisStatus = "unknown";
            try {
                const { cacheGet } = await import("../services/app-cache");
                await cacheGet("__health_check__");
                redisStatus = "connected";
            } catch { redisStatus = "disconnected"; }

            return {
                nodeVersion: process.version,
                nodeEnv: process.env.NODE_ENV ?? "development",
                platform: process.platform,
                uptimeSeconds: Math.floor(upSeconds),
                uptimeFormatted: `${Math.floor(upSeconds / 86400)}d ${Math.floor((upSeconds % 86400) / 3600)}h ${Math.floor((upSeconds % 3600) / 60)}m`,
                memory: {
                    rss: Math.round(mem.rss / 1024 / 1024),
                    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
                    external: Math.round(mem.external / 1024 / 1024),
                },
                dbStatus,
                redisStatus,
                timestamp: new Date().toISOString(),
            };
        }),

    // ══════════════════════════════════════════════════════════════
    //  WHATSAPP HEALTH
    // ══════════════════════════════════════════════════════════════

    /** Cross-tenant WhatsApp connection status */
    whatsappHealth: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql.raw(`
                    SELECT wn.id, wn.tenantId, t.name as tenantName, wn.phoneNumber, wn.displayName,
                           wn.status, wn.isConnected, wn.lastConnected, wn.totalMessagesSent,
                           wn.messagesSentToday, wn.dailyMessageLimit, wn.warmupDay
                    FROM whatsapp_numbers wn
                    JOIN tenants t ON t.id = wn.tenantId
                    ORDER BY wn.isConnected ASC, wn.tenantId ASC
                `)) as any;
                return (rows ?? []).map((r: any) => ({
                    ...r,
                    isConnected: Boolean(r.isConnected),
                }));
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] whatsappHealth query failed");
                return [];
            }
        }),

    // ══════════════════════════════════════════════════════════════
    //  ACTIVITY & ACCESS LOGS
    // ══════════════════════════════════════════════════════════════

    /** Cross-tenant activity log viewer */
    activityLogs: superadminGuard
        .input(z.object({
            tenantId: z.number().optional(),
            action: z.string().optional(),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const conditions: SQL[] = [];
                if (input.tenantId) conditions.push(sql`al.tenantId = ${input.tenantId}`);
                if (input.action) {
                    const safeAction = input.action.replace(/[^a-zA-Z0-9_.\-]/g, "");
                    if (safeAction) conditions.push(sql`al.action LIKE ${'%' + safeAction + '%'}`);
                }
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [countResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM activity_logs al ${whereClause}
                `) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.entityId, al.details, al.createdAt
                    FROM activity_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    ${whereClause}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;

                return { rows: rows ?? [], total };
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] activityLogs query failed");
                return { rows: [], total: 0 };
            }
        }),

    /** Security access log viewer (IPs, failed logins, etc.) */
    accessLogs: superadminGuard
        .input(z.object({
            tenantId: z.number().optional(),
            success: z.boolean().optional(),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const conditions: SQL[] = [];
                if (input.tenantId) conditions.push(sql`al.tenantId = ${input.tenantId}`);
                if (input.success !== undefined) conditions.push(sql`al.success = ${input.success ? 1 : 0}`);
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [countResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM access_logs al ${whereClause}
                `) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.ipAddress, al.userAgent,
                           al.success, al.errorMessage, al.createdAt
                    FROM access_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    ${whereClause}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;

                return { rows: rows ?? [], total };
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] accessLogs query failed");
                return { rows: [], total: 0 };
            }
        }),

    // ══════════════════════════════════════════════════════════════
    //  GROWTH & ANALYTICS
    // ══════════════════════════════════════════════════════════════

    /** Tenant growth over time (new registrations per day) */
    tenantGrowth: superadminGuard
        .input(z.object({
            days: z.number().min(7).max(365).default(30),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT DATE(createdAt) as date, COUNT(*) as cnt
                    FROM tenants
                    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)
                    GROUP BY DATE(createdAt)
                    ORDER BY date ASC
                `) as any;
                return (rows ?? []).map((r: any) => ({
                    date: r.date,
                    count: Number(r.cnt),
                }));
            } catch { return []; }
        }),

    /** Trial expiration tracker */
    expiringTrials: superadminGuard
        .input(z.object({
            daysAhead: z.number().min(0).max(90).default(7),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT id, name, slug, plan, trialEndsAt, status,
                           DATEDIFF(trialEndsAt, NOW()) as daysLeft
                    FROM tenants
                    WHERE trialEndsAt IS NOT NULL
                      AND trialEndsAt <= DATE_ADD(NOW(), INTERVAL ${input.daysAhead} DAY)
                    ORDER BY trialEndsAt ASC
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    /** Churn detection: tenants with zero activity in last N days */
    inactiveTenants: superadminGuard
        .input(z.object({
            inactiveDays: z.number().min(1).max(365).default(14),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name, t.slug, t.plan, t.status,
                           COALESCE(MAX(u.lastSignedIn), t.createdAt) as lastActivity,
                           DATEDIFF(NOW(), COALESCE(MAX(u.lastSignedIn), t.createdAt)) as daysSinceActivity
                    FROM tenants t
                    LEFT JOIN users u ON u.tenantId = t.id
                    GROUP BY t.id
                    HAVING daysSinceActivity >= ${input.inactiveDays}
                    ORDER BY daysSinceActivity DESC
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    /** Onboarding funnel: completion rates across tenants */
    onboardingFunnel: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return null;
            try {
                const [rows] = await db.execute(sql.raw(`
                    SELECT
                        COUNT(*) as total,
                        SUM(companyCompleted) as company,
                        SUM(teamCompleted) as team,
                        SUM(whatsappCompleted) as whatsapp,
                        SUM(importCompleted) as import_step,
                        SUM(firstMessageCompleted) as firstMessage,
                        SUM(CASE WHEN completedAt IS NOT NULL THEN 1 ELSE 0 END) as fullyCompleted
                    FROM onboarding_progress
                `)) as any;
                const r = rows?.[0];
                if (!r) return null;
                return {
                    total: Number(r.total),
                    company: Number(r.company),
                    team: Number(r.team),
                    whatsapp: Number(r.whatsapp),
                    importStep: Number(r.import_step),
                    firstMessage: Number(r.firstMessage),
                    fullyCompleted: Number(r.fullyCompleted),
                };
            } catch { return null; }
        }),

    // ══════════════════════════════════════════════════════════════
    //  MESSAGE & WORKFLOW QUEUES
    // ══════════════════════════════════════════════════════════════

    /** Message queue status (pending/processing/sent/failed) */
    messageQueueStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql.raw(`
                    SELECT mq.tenantId, t.name as tenantName, mq.status, COUNT(*) as cnt
                    FROM message_queue mq
                    JOIN tenants t ON t.id = mq.tenantId
                    GROUP BY mq.tenantId, t.name, mq.status
                    ORDER BY mq.tenantId
                `)) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    /** Workflow jobs status (pending/completed/failed) */
    workflowJobStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql.raw(`
                    SELECT wj.tenantId, t.name as tenantName, wj.status, COUNT(*) as cnt,
                           SUM(CASE WHEN wj.errorMessage IS NOT NULL THEN 1 ELSE 0 END) as withErrors
                    FROM workflow_jobs wj
                    JOIN tenants t ON t.id = wj.tenantId
                    GROUP BY wj.tenantId, t.name, wj.status
                    ORDER BY wj.tenantId
                `)) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    // ══════════════════════════════════════════════════════════════
    //  STORAGE USAGE
    // ══════════════════════════════════════════════════════════════

    /** Storage usage per tenant (file uploads) */
    storageUsage: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql.raw(`
                    SELECT fu.tenantId, t.name as tenantName,
                           COUNT(*) as fileCount,
                           COALESCE(SUM(fu.size), 0) as totalBytes
                    FROM file_uploads fu
                    JOIN tenants t ON t.id = fu.tenantId
                    GROUP BY fu.tenantId, t.name
                    ORDER BY totalBytes DESC
                `)) as any;
                return (rows ?? []).map((r: any) => ({
                    ...r,
                    totalBytes: Number(r.totalBytes),
                    totalMB: Math.round(Number(r.totalBytes) / 1024 / 1024 * 100) / 100,
                    fileCount: Number(r.fileCount),
                }));
            } catch { return []; }
        }),

    // ══════════════════════════════════════════════════════════════
    //  USER MANAGEMENT ACROSS TENANTS
    // ══════════════════════════════════════════════════════════════

    /** Toggle user active/inactive */
    toggleUserActive: superadminGuard
        .input(z.object({
            userId: z.number(),
            isActive: z.boolean(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.update(users)
                .set({ isActive: input.isActive })
                .where(eq(users.id, input.userId));

            logger.warn(
                { adminId: ctx.user!.id, targetUserId: input.userId, isActive: input.isActive },
                "[Superadmin] User active status changed"
            );
            await logSuperadminAction(ctx.user!.id, "toggleUserActive", { userId: input.userId, isActive: input.isActive });

            return { success: true, message: input.isActive ? "Usuario activado." : "Usuario desactivado." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  USAGE VS PLAN LIMITS
    // ══════════════════════════════════════════════════════════════

    /** Get actual usage vs plan limits for a given tenant */
    usageVsLimits: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return null;
            try {

            const limits = await getPlanLimits(input.tenantId);

            // Get actual counts
            const [[userResult], [leadResult], [waResult]] = await Promise.all([
                db.execute(sql`SELECT COUNT(*) as cnt FROM users WHERE tenantId = ${input.tenantId} AND isActive = 1`) as any,
                db.execute(sql`SELECT COUNT(*) as cnt FROM leads WHERE tenantId = ${input.tenantId} AND deletedAt IS NULL`) as any,
                db.execute(sql`SELECT COUNT(*) as cnt FROM whatsapp_numbers WHERE tenantId = ${input.tenantId}`) as any,
            ]);

            // Get messages this month
            let msgThisMonth = 0;
            try {
                const [msgResult] = await db.execute(sql`SELECT COUNT(*) as cnt FROM chat_messages WHERE tenantId = ${input.tenantId} AND createdAt >= DATE_FORMAT(NOW(), '%Y-%m-01')`) as any;
                msgThisMonth = Number(msgResult?.[0]?.cnt ?? 0);
            } catch { /* table might not exist */ }

            return {
                users:    { current: Number(userResult?.[0]?.cnt ?? 0), limit: limits.maxUsers },
                leads:    { current: Number(leadResult?.[0]?.cnt ?? 0), limit: limits.maxLeads },
                whatsapp: { current: Number(waResult?.[0]?.cnt ?? 0),   limit: limits.maxWhatsappNumbers },
                messages: { current: msgThisMonth,                      limit: limits.maxMessagesPerMonth },
            };

            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] usageVsLimits failed");
                return null;
            }
        }),

    // ══════════════════════════════════════════════════════════════
    //  EXPORT LOGS
    // ══════════════════════════════════════════════════════════════

    /** Export activity logs as JSON (client converts to CSV) */
    exportActivityLogs: superadminGuard
        .input(z.object({
            tenantId: z.number().optional(),
            action: z.string().optional(),
            limit: z.number().min(1).max(10000).default(5000),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const conditions: SQL[] = [];
                if (input.tenantId) conditions.push(sql`al.tenantId = ${input.tenantId}`);
                if (input.action) {
                    const safeAction = input.action.replace(/[^a-zA-Z0-9_.\-]/g, "");
                    if (safeAction) conditions.push(sql`al.action LIKE ${'%' + safeAction + '%'}`);
                }
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [rows] = await db.execute(sql`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.entityId, al.createdAt
                    FROM activity_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    ${whereClause}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit}
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    /** Export access logs as JSON (client converts to CSV) */
    exportAccessLogs: superadminGuard
        .input(z.object({
            tenantId: z.number().optional(),
            success: z.boolean().optional(),
            limit: z.number().min(1).max(10000).default(5000),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const conditions: SQL[] = [];
                if (input.tenantId) conditions.push(sql`al.tenantId = ${input.tenantId}`);
                if (input.success !== undefined) conditions.push(sql`al.success = ${input.success ? 1 : 0}`);
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [rows] = await db.execute(sql`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.ipAddress, al.userAgent,
                           al.success, al.errorMessage, al.createdAt
                    FROM access_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    ${whereClause}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit}
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    /** Force password reset — sets a random password */
    forcePasswordReset: superadminGuard
        .input(z.object({ userId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const crypto = await import("crypto");
            const bcrypt = await import("bcryptjs");
            const tempPassword = crypto.randomBytes(8).toString("hex"); // 16 chars
            const hashed = await bcrypt.hash(tempPassword, 12);

            await db.update(users)
                .set({ password: hashed } as any)
                .where(eq(users.id, input.userId));

            logger.warn(
                { adminId: ctx.user!.id, targetUserId: input.userId },
                "[Superadmin] Force password reset"
            );
            await logSuperadminAction(ctx.user!.id, "forcePasswordReset", { userId: input.userId });

            return {
                success: true,
                tempPassword,
                message: "Contraseña reseteada. Comparte la contraseña temporal de forma segura.",
            };
        }),

    // ══════════════════════════════════════════════════════════════
    //  SESSION MANAGEMENT (CROSS-TENANT)
    // ══════════════════════════════════════════════════════════════

    /** List all active sessions across tenants */
    listSessions: superadminGuard
        .input(z.object({
            tenantId: z.number().optional(),
            limit: z.number().min(1).max(200).default(50),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const conditions: SQL[] = [sql`s.expiresAt > NOW()`];
                if (input.tenantId) conditions.push(sql`s.tenantId = ${input.tenantId}`);
                const whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

                const [rows] = await db.execute(sql`
                    SELECT s.id, s.tenantId, t.name as tenantName, s.userId,
                           u.name as userName, u.email as userEmail, u.role as userRole,
                           s.ipAddress, s.userAgent, s.lastActivityAt, s.expiresAt, s.createdAt
                    FROM sessions s
                    LEFT JOIN tenants t ON t.id = s.tenantId
                    LEFT JOIN users u ON u.id = s.userId
                    ${whereClause}
                    ORDER BY s.lastActivityAt DESC
                    LIMIT ${input.limit}
                `) as any;
                return rows ?? [];
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] listSessions failed");
                return [];
            }
        }),

    /** Force logout a specific session */
    forceLogout: superadminGuard
        .input(z.object({ sessionId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.delete(sessions).where(eq(sessions.id, input.sessionId));
            logger.warn(
                { adminId: ctx.user!.id, sessionId: input.sessionId },
                "[Superadmin] Force logout session"
            );
            await logSuperadminAction(ctx.user!.id, "forceLogout", { sessionId: input.sessionId });
            return { success: true, message: "Sesión terminada." };
        }),

    /** Force logout all sessions for a tenant */
    forceLogoutTenant: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const result = await db.delete(sessions).where(eq(sessions.tenantId, input.tenantId));
            logger.warn(
                { adminId: ctx.user!.id, tenantId: input.tenantId },
                "[Superadmin] Force logout ALL sessions for tenant"
            );
            await logSuperadminAction(ctx.user!.id, "forceLogoutTenant", { tenantId: input.tenantId }, input.tenantId);
            return { success: true, message: `Todas las sesiones del tenant ${input.tenantId} terminadas.` };
        }),

    // ══════════════════════════════════════════════════════════════
    //  BULK OPERATIONS
    // ══════════════════════════════════════════════════════════════

    /** Bulk change plan for multiple tenants */
    bulkChangePlan: superadminGuard
        .input(z.object({
            tenantIds: z.array(z.number()).min(1).max(100),
            plan: z.enum(["free", "starter", "pro", "enterprise"]),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Protect platform tenant
            const ids = input.tenantIds.filter(id => id !== 1);
            if (ids.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay tenants válidos para actualizar." });

            await db.update(tenants)
                .set({ plan: input.plan })
                .where(inArray(tenants.id, ids));

            logger.warn(
                { adminId: ctx.user!.id, tenantIds: ids, plan: input.plan },
                "[Superadmin] BULK plan change"
            );
            await logSuperadminAction(ctx.user!.id, "bulkChangePlan", { tenantIds: ids, plan: input.plan });

            return { success: true, count: ids.length, message: `Plan cambiado a ${input.plan} para ${ids.length} tenants.` };
        }),

    /** Bulk suspend multiple tenants */
    bulkSuspend: superadminGuard
        .input(z.object({
            tenantIds: z.array(z.number()).min(1).max(100),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const ids = input.tenantIds.filter(id => id !== 1);
            if (ids.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede suspender el tenant de plataforma." });

            await db.update(tenants)
                .set({ status: "suspended" })
                .where(inArray(tenants.id, ids));

            await logSuperadminAction(ctx.user!.id, "bulkSuspend", { tenantIds: ids, count: ids.length });
            logger.warn(
                { adminId: ctx.user!.id, tenantIds: ids },
                "[Superadmin] BULK suspend"
            );

            return { success: true, count: ids.length, message: `${ids.length} tenants suspendidos.` };
        }),

    /** Bulk reactivate multiple tenants */
    bulkReactivate: superadminGuard
        .input(z.object({
            tenantIds: z.array(z.number()).min(1).max(100),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Filter out platform tenant (id=1)
            const ids = input.tenantIds.filter(id => id !== 1);
            if (ids.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede reactivar el tenant de plataforma." });

            await db.update(tenants)
                .set({ status: "active" })
                .where(inArray(tenants.id, ids));

            await logSuperadminAction(ctx.user!.id, "bulkReactivate", { tenantIds: ids, count: ids.length });
            logger.warn(
                { adminId: ctx.user!.id, tenantIds: ids },
                "[Superadmin] BULK reactivate"
            );

            return { success: true, count: ids.length, message: `${ids.length} tenants reactivados.` };
        }),

    // ══════════════════════════════════════════════════════════════
    //  TENANT NOTES (Internal CRM)
    // ══════════════════════════════════════════════════════════════

    /** Get internal notes for a tenant */
    getTenantNotes: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { notes: "" };
            try {
                const [rows] = await db.execute(sql`
                    SELECT internalNotes FROM tenants WHERE id = ${input.tenantId}
                `) as any;
                return { notes: rows?.[0]?.internalNotes ?? "" };
            } catch {
                return { notes: "" };
            }
        }),

    /** Update internal notes for a tenant */
    updateTenantNotes: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            notes: z.string().max(10000),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.execute(sql`
                UPDATE tenants SET internalNotes = ${input.notes || null} WHERE id = ${input.tenantId}
            `);

            await logSuperadminAction(ctx.user!.id, "updateTenantNotes", { tenantId: input.tenantId }, input.tenantId);
            logger.info(
                { adminId: ctx.user!.id, tenantId: input.tenantId },
                "[Superadmin] Tenant notes updated"
            );

            return { success: true, message: "Notas actualizadas." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  REVENUE TIMELINE (Historical MRR estimation)
    // ══════════════════════════════════════════════════════════════

    /** Estimate MRR timeline — uses plan change history from activity_logs when available */
    revenueTimeline: superadminGuard
        .input(z.object({
            months: z.number().min(1).max(24).default(12),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                // Get all tenants with their plan and creation date
                const [tRows] = await db.execute(sql`
                    SELECT id, plan, createdAt, status FROM tenants ORDER BY createdAt ASC
                `) as any;

                const allTenants = (tRows ?? []) as Array<{ id: number; plan: string; createdAt: string; status: string }>;
                const PLAN_PRICES: Record<string, number> = { free: 0, starter: 29, pro: 99, enterprise: 299 };

                // Try to get plan change history from activity_logs
                let planHistory: Array<{ tenantId: number; action: string; details: string; createdAt: string }> = [];
                try {
                    const [hRows] = await db.execute(sql`
                        SELECT tenantId, action, details, createdAt FROM activity_logs
                        WHERE action IN ('plan_change', 'tenant.plan_change', 'changeTenantPlan')
                        ORDER BY createdAt ASC
                    `) as any;
                    planHistory = hRows ?? [];
                } catch { /* table might not exist or no records */ }

                // Build a map: tenantId -> array of {date, plan}
                const planTimeline = new Map<number, Array<{ date: Date; plan: string }>>();
                for (const t of allTenants) {
                    planTimeline.set(t.id, [{ date: new Date(t.createdAt), plan: "free" }]);
                }
                for (const h of planHistory) {
                    const existing = planTimeline.get(h.tenantId);
                    if (existing) {
                        // Try to extract plan from details JSON
                        try {
                            const d = typeof h.details === "string" ? JSON.parse(h.details) : h.details;
                            const plan = d?.plan || d?.newPlan || d?.to;
                            if (plan && PLAN_PRICES[plan] !== undefined) {
                                existing.push({ date: new Date(h.createdAt), plan });
                            }
                        } catch { /* ignore unparseable */ }
                    }
                }

                // Build monthly MRR timeline
                const timeline: Array<{ month: string; mrr: number; tenantCount: number; paidCount: number }> = [];
                const now = new Date();

                for (let i = input.months - 1; i >= 0; i--) {
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
                    const monthStr = new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7);

                    let mrr = 0;
                    let tenantCount = 0;
                    let paidCount = 0;

                    for (const t of allTenants) {
                        const created = new Date(t.createdAt);
                        if (created > monthEnd || t.status === "canceled") continue;
                        tenantCount++;

                        // Find the plan active at monthEnd
                        const changes = planTimeline.get(t.id) ?? [];
                        let planAtMonth = t.plan; // fallback to current plan
                        for (const c of changes) {
                            if (c.date <= monthEnd) planAtMonth = c.plan;
                        }

                        const price = PLAN_PRICES[planAtMonth] ?? 0;
                        mrr += price;
                        if (planAtMonth !== "free") paidCount++;
                    }

                    timeline.push({ month: monthStr, mrr, tenantCount, paidCount });
                }

                return timeline;
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] revenueTimeline failed");
                return [];
            }
        }),

    // ══════════════════════════════════════════════════════════════
    //  PLATFORM ANNOUNCEMENTS
    // ══════════════════════════════════════════════════════════════

    /** List all announcements */
    listAnnouncements: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const results = await db.select().from(platformAnnouncements).orderBy(desc(platformAnnouncements.createdAt));
                return results;
            } catch (e) {
                logger.warn({ err: (e as any)?.message }, "[SuperAdmin] listAnnouncements failed");
                return [];
            }
        }),

    /** Create a new announcement */
    createAnnouncement: superadminGuard
        .input(z.object({
            title: z.string().min(1).max(255),
            message: z.string().min(1).max(5000),
            type: z.enum(["info", "warning", "critical", "maintenance"]).default("info"),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.insert(platformAnnouncements).values({
                title: input.title,
                message: input.message,
                type: input.type,
                createdBy: ctx.user!.id,
            });

            await logSuperadminAction(ctx.user!.id, "createAnnouncement", { title: input.title, type: input.type });
            logger.info(
                { adminId: ctx.user!.id, title: input.title, type: input.type },
                "[Superadmin] Announcement created"
            );

            return { success: true, message: "Anuncio creado." };
        }),

    /** Toggle announcement active status */
    toggleAnnouncement: superadminGuard
        .input(z.object({
            id: z.number(),
            active: z.boolean(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.update(platformAnnouncements)
                .set({ active: input.active })
                .where(eq(platformAnnouncements.id, input.id));

            await logSuperadminAction(ctx.user!.id, "toggleAnnouncement", { announcementId: input.id, active: input.active });
            logger.info(
                { adminId: ctx.user!.id, announcementId: input.id, active: input.active },
                "[Superadmin] Announcement toggled"
            );

            return { success: true, message: input.active ? "Anuncio activado." : "Anuncio desactivado." };
        }),

    /** Delete an announcement */
    deleteAnnouncement: superadminGuard
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.delete(platformAnnouncements).where(eq(platformAnnouncements.id, input.id));

            await logSuperadminAction(ctx.user!.id, "deleteAnnouncement", { announcementId: input.id });
            logger.warn(
                { adminId: ctx.user!.id, announcementId: input.id },
                "[Superadmin] Announcement deleted"
            );

            return { success: true, message: "Anuncio eliminado." };
        }),

    /** Get active announcements (public — accessible to all authenticated users) */
    getActiveAnnouncements: protectedProcedure
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const results = await db.select()
                    .from(platformAnnouncements)
                    .where(eq(platformAnnouncements.active, true))
                    .orderBy(desc(platformAnnouncements.createdAt));
                return results;
            } catch { return []; }
        }),

    // ══════════════════════════════════════════════════════════════
    //  P1: SUPERADMIN AUDIT LOG VIEWER
    // ══════════════════════════════════════════════════════════════

    /** View superadmin-specific actions (filtered from activity_logs) */
    superadminAuditLog: superadminGuard
        .input(z.object({
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const [countResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM activity_logs WHERE action LIKE 'superadmin.%'
                `) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);
                const [rows] = await db.execute(sql`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.details, al.createdAt
                    FROM activity_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    WHERE al.action LIKE 'superadmin.%'
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                return { rows: rows ?? [], total };
            } catch { return { rows: [], total: 0 }; }
        }),

    // ══════════════════════════════════════════════════════════════
    //  P2: FULL TENANT CRUD
    // ══════════════════════════════════════════════════════════════

    /** Create a new tenant */
    createTenant: superadminGuard
        .input(z.object({
            name: z.string().min(1).max(200),
            slug: z.string().min(1).max(100).regex(/^[a-z0-9\-]+$/),
            plan: z.enum(["free", "starter", "pro", "enterprise"]).default("free"),
            trialEndsAt: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Check slug uniqueness
            const [existing] = await db.select({ id: tenants.id })
                .from(tenants)
                .where(eq(tenants.slug, input.slug))
                .limit(1);
            if (existing) throw new TRPCError({ code: "CONFLICT", message: `El slug "${input.slug}" ya existe.` });

            const [result] = await db.insert(tenants).values({
                name: input.name,
                slug: input.slug,
                plan: input.plan,
                trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
            }).$returningId();

            const newId = (result as any)?.id ?? (result as any)?.insertId;

            // Create default appSettings row
            try {
                await db.insert(appSettings).values({
                    tenantId: newId,
                    companyName: input.name,
                });
            } catch { /* may already exist */ }

            await logSuperadminAction(ctx.user!.id, "createTenant", { tenantId: newId, name: input.name, slug: input.slug, plan: input.plan });
            logger.info({ adminId: ctx.user!.id, tenantId: newId }, "[Superadmin] Tenant created");

            return { success: true, tenantId: newId, message: `Tenant "${input.name}" creado.` };
        }),

    /** Update tenant details */
    updateTenant: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            name: z.string().min(1).max(200).optional(),
            slug: z.string().min(1).max(100).regex(/^[a-z0-9\-]+$/).optional(),
            paypalSubscriptionId: z.string().max(255).nullable().optional(),
            trialEndsAt: z.string().nullable().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const updates: Record<string, any> = {};
            if (input.name !== undefined) updates.name = input.name;
            if (input.slug !== undefined) {
                // Check slug uniqueness
                const [existing] = await db.select({ id: tenants.id })
                    .from(tenants)
                    .where(and(eq(tenants.slug, input.slug), sql`id != ${input.tenantId}`))
                    .limit(1);
                if (existing) throw new TRPCError({ code: "CONFLICT", message: `El slug "${input.slug}" ya está en uso.` });
                updates.slug = input.slug;
            }
            if (input.paypalSubscriptionId !== undefined) updates.paypalSubscriptionId = input.paypalSubscriptionId;
            if (input.trialEndsAt !== undefined) updates.trialEndsAt = input.trialEndsAt ? new Date(input.trialEndsAt) : null;

            if (Object.keys(updates).length === 0) {
                return { success: true, message: "Sin cambios." };
            }

            await db.update(tenants).set(updates).where(eq(tenants.id, input.tenantId));

            await logSuperadminAction(ctx.user!.id, "updateTenant", { tenantId: input.tenantId, updates });
            return { success: true, message: "Tenant actualizado." };
        }),

    /** Archive (cancel) a tenant — deactivate all users & sessions */
    archiveTenant: superadminGuard
        .input(z.object({ tenantId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            if (input.tenantId === 1) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede archivar el tenant de la plataforma." });
            }

            await db.update(tenants).set({ status: "canceled" }).where(eq(tenants.id, input.tenantId));
            await db.update(users).set({ isActive: false }).where(eq(users.tenantId, input.tenantId));
            await db.delete(sessions).where(eq(sessions.tenantId, input.tenantId));

            await logSuperadminAction(ctx.user!.id, "archiveTenant", { tenantId: input.tenantId });
            logger.warn({ adminId: ctx.user!.id, tenantId: input.tenantId }, "[Superadmin] Tenant ARCHIVED");

            return { success: true, message: "Tenant archivado. Usuarios desactivados y sesiones eliminadas." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  P3: CUSTOM LIMITS PER TENANT
    // ══════════════════════════════════════════════════════════════

    /** Update custom limits for a tenant (upsert into license table) */
    updateTenantLimits: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            maxUsers: z.number().min(1).max(10000).optional(),
            maxWhatsappNumbers: z.number().min(1).max(1000).optional(),
            maxMessagesPerMonth: z.number().min(100).max(10000000).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Check if license row exists
            const [existing] = await db.select({ id: license.id })
                .from(license)
                .where(eq(license.tenantId, input.tenantId))
                .limit(1);

            if (existing) {
                const updates: Record<string, any> = {};
                if (input.maxUsers !== undefined) updates.maxUsers = input.maxUsers;
                if (input.maxWhatsappNumbers !== undefined) updates.maxWhatsappNumbers = input.maxWhatsappNumbers;
                if (input.maxMessagesPerMonth !== undefined) updates.maxMessagesPerMonth = input.maxMessagesPerMonth;

                if (Object.keys(updates).length > 0) {
                    await db.update(license).set(updates).where(eq(license.id, existing.id));
                }
            } else {
                // Create license row
                const crypto = await import("crypto");
                await db.insert(license).values({
                    tenantId: input.tenantId,
                    key: `lic_${crypto.randomBytes(16).toString("hex")}`,
                    plan: "starter",
                    maxUsers: input.maxUsers ?? 5,
                    maxWhatsappNumbers: input.maxWhatsappNumbers ?? 3,
                    maxMessagesPerMonth: input.maxMessagesPerMonth ?? 10000,
                });
            }

            await logSuperadminAction(ctx.user!.id, "updateTenantLimits", { ...input });
            return { success: true, message: "Límites actualizados." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  P4: TRIAL / SUBSCRIPTION MANAGEMENT
    // ══════════════════════════════════════════════════════════════

    /** Set or extend trial end date */
    setTrialDate: superadminGuard
        .input(z.object({
            tenantId: z.number(),
            trialEndsAt: z.string().nullable(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            await db.update(tenants)
                .set({ trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null })
                .where(eq(tenants.id, input.tenantId));

            await logSuperadminAction(ctx.user!.id, "setTrialDate", { tenantId: input.tenantId, trialEndsAt: input.trialEndsAt });
            return { success: true, message: input.trialEndsAt ? `Trial extendido hasta ${input.trialEndsAt}.` : "Trial removido." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  P5: DATA EXPORT
    // ══════════════════════════════════════════════════════════════

    /** Export all tenants with enriched data */
    exportTenants: superadminGuard
        .query(async ({ ctx }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name, t.slug, t.plan, t.status, t.paypalSubscriptionId,
                           t.trialEndsAt, t.createdAt,
                           COUNT(DISTINCT u.id) as userCount,
                           COUNT(DISTINCT l.id) as leadCount,
                           COUNT(DISTINCT wn.id) as waNumberCount
                    FROM tenants t
                    LEFT JOIN users u ON u.tenantId = t.id AND u.isActive = 1
                    LEFT JOIN leads l ON l.tenantId = t.id AND l.deletedAt IS NULL
                    LEFT JOIN whatsapp_numbers wn ON wn.tenantId = t.id
                    GROUP BY t.id
                    ORDER BY t.createdAt DESC
                `) as any;

                await logSuperadminAction(ctx.user!.id, "exportTenants", { count: (rows ?? []).length });
                return rows ?? [];
            } catch { return []; }
        }),

    /** Export all users cross-tenant */
    exportAllUsers: superadminGuard
        .input(z.object({
            tenantId: z.number().optional(),
            limit: z.number().min(1).max(10000).default(5000),
        }))
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                let query = sql`
                    SELECT u.id, u.tenantId, t.name as tenantName, u.name, u.email,
                           u.role, u.isActive, u.lastSignedIn, u.createdAt
                    FROM users u
                    LEFT JOIN tenants t ON t.id = u.tenantId
                `;
                if (input.tenantId) {
                    query = sql`${query} WHERE u.tenantId = ${input.tenantId}`;
                }
                query = sql`${query} ORDER BY u.createdAt DESC LIMIT ${input.limit}`;

                const [rows] = await db.execute(query) as any;
                await logSuperadminAction(ctx.user!.id, "exportAllUsers", { count: (rows ?? []).length });
                return rows ?? [];
            } catch { return []; }
        }),

    /** Export platform metrics snapshot */
    exportMetrics: superadminGuard
        .query(async ({ ctx }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const PLAN_PRICES: Record<string, number> = { free: 0, starter: 29, pro: 99, enterprise: 299 };
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name, t.slug, t.plan, t.status,
                           COUNT(DISTINCT u.id) as users,
                           COUNT(DISTINCT l.id) as leads,
                           COUNT(DISTINCT wn.id) as waNumbers,
                           COALESCE(SUM(DISTINCT fu.size), 0) as storageBytes
                    FROM tenants t
                    LEFT JOIN users u ON u.tenantId = t.id AND u.isActive = 1
                    LEFT JOIN leads l ON l.tenantId = t.id AND l.deletedAt IS NULL
                    LEFT JOIN whatsapp_numbers wn ON wn.tenantId = t.id
                    LEFT JOIN file_uploads fu ON fu.tenantId = t.id
                    GROUP BY t.id
                    ORDER BY t.id
                `) as any;

                const enriched = (rows ?? []).map((r: any) => ({
                    ...r,
                    mrr: PLAN_PRICES[r.plan] ?? 0,
                    storageMB: Math.round(Number(r.storageBytes ?? 0) / 1024 / 1024 * 100) / 100,
                }));

                await logSuperadminAction(ctx.user!.id, "exportMetrics", { count: enriched.length });
                return enriched;
            } catch { return []; }
        }),

    // ══════════════════════════════════════════════════════════════
    //  P6: CROSS-TENANT USER MANAGEMENT
    // ══════════════════════════════════════════════════════════════

    /** List all users across all tenants (paginated, searchable) */
    listAllUsers: superadminGuard
        .input(z.object({
            search: z.string().max(100).optional(),
            tenantId: z.number().optional(),
            role: z.enum(["owner", "admin", "supervisor", "agent", "viewer"]).optional(),
            isActive: z.boolean().optional(),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const conditions: SQL[] = [];
                if (input.tenantId) conditions.push(sql`u.tenantId = ${input.tenantId}`);
                if (input.role) conditions.push(sql`u.role = ${input.role}`);
                if (input.isActive !== undefined) conditions.push(sql`u.isActive = ${input.isActive ? 1 : 0}`);
                if (input.search) {
                    const safeSearch = input.search.replace(/['"\\%_]/g, "");
                    conditions.push(sql`(u.name LIKE ${'%' + safeSearch + '%'} OR u.email LIKE ${'%' + safeSearch + '%'})`);
                }
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [countResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM users u ${whereClause}
                `) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql`
                    SELECT u.id, u.tenantId, t.name as tenantName, u.name, u.email,
                           u.role, u.isActive, u.lastSignedIn, u.createdAt
                    FROM users u
                    LEFT JOIN tenants t ON t.id = u.tenantId
                    ${whereClause}
                    ORDER BY u.lastSignedIn DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;

                return { rows: rows ?? [], total };
            } catch { return { rows: [], total: 0 }; }
        }),

    /** Change a user's role */
    changeUserRole: superadminGuard
        .input(z.object({
            userId: z.number(),
            role: z.enum(["owner", "admin", "supervisor", "agent", "viewer"]),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Don't allow demoting the only owner of a tenant
            if (input.role !== "owner") {
                const [targetUser] = await db.select({ tenantId: users.tenantId, role: users.role })
                    .from(users).where(eq(users.id, input.userId)).limit(1);
                if (targetUser && targetUser.role === "owner") {
                    const ownerCount = await db.select({ cnt: count() })
                        .from(users)
                        .where(and(eq(users.tenantId, targetUser.tenantId), eq(users.role, "owner"), eq(users.isActive, true)));
                    if (Number(ownerCount[0]?.cnt ?? 0) <= 1) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede cambiar el rol del único owner del tenant." });
                    }
                }
            }

            await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));

            await logSuperadminAction(ctx.user!.id, "changeUserRole", { userId: input.userId, role: input.role });
            return { success: true, message: `Rol cambiado a ${input.role}.` };
        }),

    /** Delete a user permanently */
    deleteUser: superadminGuard
        .input(z.object({ userId: z.number() }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            // Don't allow deleting the only owner
            const [targetUser] = await db.select({ tenantId: users.tenantId, role: users.role })
                .from(users).where(eq(users.id, input.userId)).limit(1);
            if (!targetUser) throw new TRPCError({ code: "NOT_FOUND", message: "Usuario no encontrado." });

            if (targetUser.role === "owner") {
                const ownerCount = await db.select({ cnt: count() })
                    .from(users)
                    .where(and(eq(users.tenantId, targetUser.tenantId), eq(users.role, "owner"), eq(users.isActive, true)));
                if (Number(ownerCount[0]?.cnt ?? 0) <= 1) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: "No se puede eliminar el único owner del tenant." });
                }
            }

            // Delete sessions first, then user
            await db.delete(sessions).where(eq(sessions.userId, input.userId));
            await db.delete(users).where(eq(users.id, input.userId));

            await logSuperadminAction(ctx.user!.id, "deleteUser", { userId: input.userId, tenantId: targetUser.tenantId });
            return { success: true, message: "Usuario eliminado." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  P7: GLOBAL SEARCH CROSS-TENANT
    // ══════════════════════════════════════════════════════════════

    /** Search leads, conversations, and messages across all tenants */
    globalSearch: superadminGuard
        .input(z.object({
            query: z.string().min(2).max(100),
            entities: z.array(z.enum(["leads", "conversations", "messages"])).min(1).default(["leads", "conversations"]),
            limit: z.number().min(1).max(50).default(20),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { leads: [], conversations: [], messages: [] };

            const searchTerm = '%' + input.query + '%';
            const result: { leads: any[]; conversations: any[]; messages: any[] } = { leads: [], conversations: [], messages: [] };

            try {
                if (input.entities.includes("leads")) {
                    const [rows] = await db.execute(sql`
                        SELECT l.id, l.tenantId, t.name as tenantName, l.name, l.phone, l.email, l.status, l.createdAt
                        FROM leads l
                        JOIN tenants t ON t.id = l.tenantId
                        WHERE l.deletedAt IS NULL
                          AND (l.name LIKE ${searchTerm} OR l.phone LIKE ${searchTerm} OR l.email LIKE ${searchTerm})
                        ORDER BY l.createdAt DESC
                        LIMIT ${input.limit}
                    `) as any;
                    result.leads = rows ?? [];
                }
            } catch { /* table may not exist */ }

            try {
                if (input.entities.includes("conversations")) {
                    const [rows] = await db.execute(sql`
                        SELECT c.id, c.tenantId, t.name as tenantName, c.contactName, c.contactPhone,
                               c.status, c.lastMessageAt, c.createdAt
                        FROM conversations c
                        JOIN tenants t ON t.id = c.tenantId
                        WHERE c.contactName LIKE ${searchTerm} OR c.contactPhone LIKE ${searchTerm}
                        ORDER BY c.lastMessageAt DESC
                        LIMIT ${input.limit}
                    `) as any;
                    result.conversations = rows ?? [];
                }
            } catch { /* table may not exist */ }

            try {
                if (input.entities.includes("messages")) {
                    const [rows] = await db.execute(sql`
                        SELECT cm.id, cm.tenantId, t.name as tenantName, cm.conversationId,
                               SUBSTRING(cm.content, 1, 200) as content, cm.sender, cm.createdAt
                        FROM chat_messages cm
                        JOIN tenants t ON t.id = cm.tenantId
                        WHERE cm.content LIKE ${searchTerm}
                        ORDER BY cm.createdAt DESC
                        LIMIT ${input.limit}
                    `) as any;
                    result.messages = rows ?? [];
                }
            } catch { /* table may not exist */ }

            return result;
        }),

    // ══════════════════════════════════════════════════════════════
    //  P8: PLATFORM CONFIGURATION
    // ══════════════════════════════════════════════════════════════

    /** Get platform-level configuration (tenant ID = 1) */
    getPlatformConfig: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return null;
            try {
                const [row] = await db.select()
                    .from(appSettings)
                    .where(eq(appSettings.tenantId, 1))
                    .limit(1);
                return row ?? null;
            } catch { return null; }
        }),

    /** Update platform-level configuration sections */
    updatePlatformConfig: superadminGuard
        .input(z.object({
            smtpConfig: z.object({
                host: z.string().max(255).optional(),
                port: z.number().int().min(1).max(65535).optional(),
                user: z.string().max(255).optional(),
                pass: z.string().max(500).optional(),
                from: z.string().max(255).optional(),
                secure: z.boolean().optional(),
            }).passthrough().optional(),
            metaConfig: z.object({
                appId: z.string().max(255).optional(),
                appSecret: z.string().max(500).optional(),
                verifyToken: z.string().max(255).optional(),
                webhookUrl: z.string().max(500).optional(),
            }).passthrough().optional(),
            aiConfig: z.object({
                provider: z.string().max(50).optional(),
                apiKey: z.string().max(500).optional(),
                model: z.string().max(100).optional(),
                maxTokens: z.number().int().min(1).max(100000).optional(),
            }).passthrough().optional(),
            storageConfig: z.object({
                provider: z.string().max(50).optional(),
                bucket: z.string().max(255).optional(),
                region: z.string().max(50).optional(),
                accessKey: z.string().max(500).optional(),
                secretKey: z.string().max(500).optional(),
            }).passthrough().optional(),
            securityConfig: z.object({
                maxLoginAttempts: z.number().int().min(1).max(100).optional(),
                sessionTimeout: z.number().int().min(60).max(86400000).optional(),
                requireMfa: z.boolean().optional(),
                ipWhitelist: z.array(z.string().max(45)).max(100).optional(),
            }).passthrough().optional(),
            companyName: z.string().max(120).optional(),
            timezone: z.string().max(60).optional(),
            language: z.string().max(10).optional(),
            currency: z.string().max(10).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const updates: Record<string, any> = {};
            if (input.smtpConfig !== undefined) updates.smtpConfig = input.smtpConfig;
            if (input.metaConfig !== undefined) updates.metaConfig = input.metaConfig;
            if (input.aiConfig !== undefined) updates.aiConfig = input.aiConfig;
            if (input.storageConfig !== undefined) updates.storageConfig = input.storageConfig;
            if (input.securityConfig !== undefined) updates.securityConfig = input.securityConfig;
            if (input.companyName !== undefined) updates.companyName = input.companyName;
            if (input.timezone !== undefined) updates.timezone = input.timezone;
            if (input.language !== undefined) updates.language = input.language;
            if (input.currency !== undefined) updates.currency = input.currency;

            if (Object.keys(updates).length === 0) {
                return { success: true, message: "Sin cambios." };
            }

            await db.update(appSettings).set(updates).where(eq(appSettings.tenantId, 1));

            await logSuperadminAction(ctx.user!.id, "updatePlatformConfig", { sections: Object.keys(updates) });
            return { success: true, message: "Configuración de plataforma actualizada." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  P9: SUPERADMIN ALERTS SYSTEM
    // ══════════════════════════════════════════════════════════════

    /** List superadmin alerts */
    listAlerts: superadminGuard
        .input(z.object({
            type: z.enum(["trial_expiring", "quota_exceeded", "new_tenant", "error", "churn_risk", "security"]).optional(),
            severity: z.enum(["info", "warning", "critical"]).optional(),
            isRead: z.boolean().optional(),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0, unreadCount: 0 };
            try {
                const conditions: SQL[] = [];
                if (input.type) conditions.push(sql`type = ${input.type}`);
                if (input.severity) conditions.push(sql`severity = ${input.severity}`);
                if (input.isRead !== undefined) conditions.push(sql`isRead = ${input.isRead ? 1 : 0}`);
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [countResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM superadmin_alerts ${whereClause}
                `) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [unreadResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM superadmin_alerts WHERE isRead = 0
                `) as any;
                const unreadCount = Number(unreadResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql`
                    SELECT sa.*, t.name as tenantName
                    FROM superadmin_alerts sa
                    LEFT JOIN tenants t ON t.id = sa.tenantId
                    ${whereClause}
                    ORDER BY sa.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;

                return { rows: rows ?? [], total, unreadCount };
            } catch { return { rows: [], total: 0, unreadCount: 0 }; }
        }),

    /** Mark alert(s) as read */
    markAlertRead: superadminGuard
        .input(z.object({
            alertId: z.number().optional(),
            all: z.boolean().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            if (input.all) {
                await db.update(superadminAlerts).set({ isRead: true }).where(eq(superadminAlerts.isRead, false));
            } else if (input.alertId) {
                await db.update(superadminAlerts).set({ isRead: true }).where(eq(superadminAlerts.id, input.alertId));
            }

            await logSuperadminAction(ctx.user!.id, "markAlertRead", { alertId: input.alertId, all: input.all });
            return { success: true, message: "Alertas marcadas como leídas." };
        }),

    /** Generate alerts manually (check trials, quotas, churn) */
    generateAlerts: superadminGuard
        .mutation(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            let generated = 0;

            // 1. Trials expiring in next 3 days
            try {
                const [rows] = await db.execute(sql`
                    SELECT id, name, trialEndsAt, DATEDIFF(trialEndsAt, NOW()) as daysLeft
                    FROM tenants
                    WHERE trialEndsAt IS NOT NULL
                      AND trialEndsAt <= DATE_ADD(NOW(), INTERVAL 3 DAY)
                      AND trialEndsAt >= NOW()
                      AND id NOT IN (SELECT DISTINCT COALESCE(tenantId, 0) FROM superadmin_alerts WHERE type = 'trial_expiring' AND createdAt >= DATE_SUB(NOW(), INTERVAL 1 DAY))
                `) as any;
                for (const r of (rows ?? []) as any[]) {
                    await db.insert(superadminAlerts).values({
                        type: "trial_expiring",
                        severity: Number(r.daysLeft) <= 1 ? "critical" : "warning",
                        title: `Trial expira: ${r.name}`,
                        message: `El tenant "${r.name}" (ID: ${r.id}) tiene su trial expirando en ${r.daysLeft} día(s).`,
                        tenantId: Number(r.id),
                    });
                    generated++;
                }
            } catch { /* table may not exist */ }

            // 2. Inactive tenants (14+ days) — churn risk
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name,
                           DATEDIFF(NOW(), COALESCE(MAX(u.lastSignedIn), t.createdAt)) as daysSince
                    FROM tenants t
                    LEFT JOIN users u ON u.tenantId = t.id
                    WHERE t.status = 'active' AND t.id != 1
                    GROUP BY t.id
                    HAVING daysSince >= 14
                       AND t.id NOT IN (SELECT DISTINCT COALESCE(tenantId, 0) FROM superadmin_alerts WHERE type = 'churn_risk' AND createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY))
                `) as any;
                for (const r of (rows ?? []) as any[]) {
                    await db.insert(superadminAlerts).values({
                        type: "churn_risk",
                        severity: Number(r.daysSince) >= 30 ? "critical" : "warning",
                        title: `Riesgo de churn: ${r.name}`,
                        message: `El tenant "${r.name}" lleva ${r.daysSince} días sin actividad.`,
                        tenantId: Number(r.id),
                    });
                    generated++;
                }
            } catch { /* table may not exist */ }

            await logSuperadminAction(ctx.user!.id, "generateAlerts", { generated });
            return { success: true, generated, message: `${generated} alertas generadas.` };
        }),

    // ══════════════════════════════════════════════════════════════
    //  P10: ENHANCED REAL-TIME METRICS (improved polling)
    // ══════════════════════════════════════════════════════════════

    /** Fast KPI snapshot for real-time polling (lightweight query) */
    liveKpis: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return null;
            try {
                const [rows] = await db.execute(sql`
                    SELECT
                        (SELECT COUNT(*) FROM tenants WHERE status = 'active') as activeTenants,
                        (SELECT COUNT(*) FROM users WHERE isActive = 1) as activeUsers,
                        (SELECT COUNT(*) FROM sessions WHERE expiresAt > NOW()) as activeSessions,
                        (SELECT COUNT(*) FROM chat_messages WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 1 HOUR)) as messagesLastHour,
                        (SELECT COUNT(*) FROM leads WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND deletedAt IS NULL) as leadsToday,
                        (SELECT COUNT(*) FROM conversations WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) as conversationsToday
                `) as any;
                return rows?.[0] ?? null;
            } catch { return null; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 1: Impersonation Audit Trail
       ══════════════════════════════════════════════════════════════════════ */
    listImpersonationEvents: superadminGuard
        .input(z.object({ limit: z.number().min(1).max(200).default(50), offset: z.number().min(0).default(0) }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const [rows] = await db.execute(sql`
                    SELECT al.id, al.userId, al.action, al.details, al.entityId AS targetTenantId,
                           al.createdAt, u.name AS adminName, u.email AS adminEmail,
                           t.name AS targetTenantName
                    FROM activity_logs al
                    LEFT JOIN users u ON u.id = al.userId
                    LEFT JOIN tenants t ON t.id = al.entityId
                    WHERE al.action = 'superadmin.impersonate'
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                const [cntRows] = await db.execute(sql`
                    SELECT COUNT(*) as total FROM activity_logs WHERE action = 'superadmin.impersonate'
                `) as any;
                return { rows: rows ?? [], total: Number(cntRows?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    getImpersonationStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return { byAdmin: [], byTenant: [], total: 0 };
            try {
                const [byAdmin] = await db.execute(sql`
                    SELECT al.userId, u.name, u.email, COUNT(*) as cnt
                    FROM activity_logs al
                    LEFT JOIN users u ON u.id = al.userId
                    WHERE al.action = 'superadmin.impersonate'
                    GROUP BY al.userId, u.name, u.email
                    ORDER BY cnt DESC LIMIT 20
                `) as any;
                const [byTenant] = await db.execute(sql`
                    SELECT al.entityId AS tenantId, t.name AS tenantName, COUNT(*) as cnt
                    FROM activity_logs al
                    LEFT JOIN tenants t ON t.id = al.entityId
                    WHERE al.action = 'superadmin.impersonate'
                    GROUP BY al.entityId, t.name
                    ORDER BY cnt DESC LIMIT 20
                `) as any;
                const [cntRows] = await db.execute(sql`
                    SELECT COUNT(*) as total FROM activity_logs WHERE action = 'superadmin.impersonate'
                `) as any;
                return { byAdmin: byAdmin ?? [], byTenant: byTenant ?? [], total: Number(cntRows?.[0]?.total ?? 0) };
            } catch { return { byAdmin: [], byTenant: [], total: 0 }; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 2: Per-Tenant Onboarding Tracker
       ══════════════════════════════════════════════════════════════════════ */
    listOnboardingProgress: superadminGuard
        .input(z.object({
            status: z.enum(["all", "completed", "stalled", "in_progress"]).default("all"),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().min(0).default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {

                const conditions: SQL[] = [];
                if (input.status === "completed") conditions.push(sql`op.completedAt IS NOT NULL`);
                else if (input.status === "stalled") conditions.push(sql`op.completedAt IS NULL AND op.updatedAt < DATE_SUB(NOW(), INTERVAL 3 DAY)`);
                else if (input.status === "in_progress") conditions.push(sql`op.completedAt IS NULL AND op.updatedAt >= DATE_SUB(NOW(), INTERVAL 3 DAY)`);
                const whereClause = conditions.length > 0
                    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
                    : sql``;

                const [rows] = await db.execute(sql`
                    SELECT op.*, t.name AS tenantName, t.plan, t.status AS tenantStatus,
                           TIMESTAMPDIFF(HOUR, op.startedAt, COALESCE(op.completedAt, NOW())) AS hoursElapsed
                    FROM onboarding_progress op
                    JOIN tenants t ON t.id = op.tenantId
                    ${whereClause}
                    ORDER BY op.updatedAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;

                const [cntRows] = await db.execute(sql`
                    SELECT COUNT(*) as total FROM onboarding_progress op ${whereClause}
                `) as any;

                return { rows: rows ?? [], total: Number(cntRows?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 3: Workflow & Automation Oversight
       ══════════════════════════════════════════════════════════════════════ */
    listAllWorkflows: superadminGuard
        .input(z.object({ limit: z.number().min(1).max(200).default(50), offset: z.number().min(0).default(0) }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const [rows] = await db.execute(sql`
                    SELECT w.id, w.tenantId, w.name, w.description, w.isActive, w.triggerType, w.createdAt, w.updatedAt,
                           t.name AS tenantName,
                           (SELECT COUNT(*) FROM workflow_logs wl WHERE wl.workflowId = w.id AND wl.status = 'success') AS successCount,
                           (SELECT COUNT(*) FROM workflow_logs wl WHERE wl.workflowId = w.id AND wl.status = 'failed') AS failCount,
                           (SELECT COUNT(*) FROM workflow_jobs wj WHERE wj.workflowId = w.id AND wj.status = 'pending') AS pendingJobs
                    FROM workflows w
                    JOIN tenants t ON t.id = w.tenantId
                    ORDER BY w.updatedAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                const [cntRows] = await db.execute(sql`SELECT COUNT(*) as total FROM workflows`) as any;
                return { rows: rows ?? [], total: Number(cntRows?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    getWorkflowErrors: superadminGuard
        .input(z.object({ workflowId: z.number() }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT wl.id, wl.entityId, wl.status, wl.details, wl.createdAt,
                           t.name AS tenantName
                    FROM workflow_logs wl
                    JOIN workflows w ON w.id = wl.workflowId
                    JOIN tenants t ON t.id = wl.tenantId
                    WHERE wl.workflowId = ${input.workflowId} AND wl.status = 'failed'
                    ORDER BY wl.createdAt DESC LIMIT 50
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    toggleWorkflowActive: superadminGuard
        .input(z.object({ workflowId: z.number(), isActive: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            await db.update(workflows).set({ isActive: input.isActive }).where(eq(workflows.id, input.workflowId));
            await logSuperadminAction(ctx.user!.id, "toggleWorkflow", { workflowId: input.workflowId, isActive: input.isActive });
            return { ok: true, message: input.isActive ? "Workflow activado" : "Workflow desactivado" };
        }),

    getWorkflowStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return null;
            try {
                const [rows] = await db.execute(sql`
                    SELECT
                        (SELECT COUNT(*) FROM workflows) AS totalWorkflows,
                        (SELECT COUNT(*) FROM workflows WHERE isActive = 1) AS activeWorkflows,
                        (SELECT COUNT(*) FROM workflow_logs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS executions24h,
                        (SELECT COUNT(*) FROM workflow_logs WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND status = 'failed') AS failures24h,
                        (SELECT COUNT(*) FROM workflow_jobs WHERE status = 'pending') AS pendingJobs
                `) as any;
                return rows?.[0] ?? null;
            } catch { return null; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 4: Webhook Management
       ══════════════════════════════════════════════════════════════════════ */
    listAllWebhooks: superadminGuard
        .input(z.object({ limit: z.number().min(1).max(200).default(50), offset: z.number().min(0).default(0) }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const [rows] = await db.execute(sql`
                    SELECT wh.id, wh.tenantId, wh.name, wh.url, wh.events, wh.active, wh.createdAt,
                           t.name AS tenantName,
                           (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhookId = wh.id) AS totalDeliveries,
                           (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhookId = wh.id AND wd.success = 1) AS successDeliveries,
                           (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhookId = wh.id AND wd.success = 0) AS failedDeliveries
                    FROM webhooks wh
                    JOIN tenants t ON t.id = wh.tenantId
                    ORDER BY wh.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                const [cnt] = await db.execute(sql`SELECT COUNT(*) as total FROM webhooks`) as any;
                return { rows: rows ?? [], total: Number(cnt?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    getWebhookDeliveries: superadminGuard
        .input(z.object({ webhookId: z.number(), limit: z.number().min(1).max(100).default(30) }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT id, event, responseStatus, success, createdAt
                    FROM webhook_deliveries
                    WHERE webhookId = ${input.webhookId}
                    ORDER BY createdAt DESC
                    LIMIT ${input.limit}
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    toggleWebhook: superadminGuard
        .input(z.object({ webhookId: z.number(), active: z.boolean() }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            await db.update(webhooks).set({ active: input.active }).where(eq(webhooks.id, input.webhookId));
            await logSuperadminAction(ctx.user!.id, "toggleWebhook", { webhookId: input.webhookId, active: input.active });
            return { ok: true, message: input.active ? "Webhook activado" : "Webhook desactivado" };
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 5: Campaign Monitoring
       ══════════════════════════════════════════════════════════════════════ */
    listAllCampaigns: superadminGuard
        .input(z.object({
            status: z.enum(["all", "draft", "scheduled", "running", "paused", "completed", "cancelled"]).default("all"),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().min(0).default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const statusCondition = input.status !== "all" ? sql`AND c.status = ${input.status}` : sql``;
                const [rows] = await db.execute(sql`
                    SELECT c.id, c.tenantId, c.name, c.type, c.status, c.scheduledAt, c.startedAt, c.completedAt,
                           c.totalRecipients, c.messagesSent, c.messagesDelivered, c.messagesRead, c.messagesFailed,
                           c.createdAt, t.name AS tenantName
                    FROM campaigns c
                    JOIN tenants t ON t.id = c.tenantId
                    WHERE 1=1 ${statusCondition}
                    ORDER BY c.updatedAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                const [cnt] = await db.execute(sql`
                    SELECT COUNT(*) as total FROM campaigns c WHERE 1=1 ${statusCondition}
                `) as any;
                return { rows: rows ?? [], total: Number(cnt?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    getCampaignStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return null;
            try {
                const [rows] = await db.execute(sql`
                    SELECT
                        (SELECT COUNT(*) FROM campaigns WHERE status = 'running') AS running,
                        (SELECT COUNT(*) FROM campaigns WHERE status = 'scheduled') AS scheduled,
                        (SELECT COUNT(*) FROM campaigns) AS total,
                        (SELECT COALESCE(SUM(messagesSent), 0) FROM campaigns) AS totalSent,
                        (SELECT COALESCE(SUM(messagesDelivered), 0) FROM campaigns) AS totalDelivered,
                        (SELECT COALESCE(SUM(messagesRead), 0) FROM campaigns) AS totalRead,
                        (SELECT COALESCE(SUM(messagesFailed), 0) FROM campaigns) AS totalFailed
                `) as any;
                return rows?.[0] ?? null;
            } catch { return null; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 6: Template Oversight
       ══════════════════════════════════════════════════════════════════════ */
    listAllTemplates: superadminGuard
        .input(z.object({
            type: z.enum(["all", "whatsapp", "email"]).default("all"),
            limit: z.number().min(1).max(200).default(50),
            offset: z.number().min(0).default(0),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const typeCondition = input.type !== "all" ? sql`AND tpl.type = ${input.type}` : sql``;
                const [rows] = await db.execute(sql`
                    SELECT tpl.id, tpl.tenantId, tpl.name, tpl.content, tpl.type, tpl.variables, tpl.createdAt,
                           t.name AS tenantName
                    FROM templates tpl
                    JOIN tenants t ON t.id = tpl.tenantId
                    WHERE 1=1 ${typeCondition}
                    ORDER BY tpl.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                const [cnt] = await db.execute(sql`
                    SELECT COUNT(*) as total FROM templates tpl WHERE 1=1 ${typeCondition}
                `) as any;
                return { rows: rows ?? [], total: Number(cnt?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    getTemplateStats: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name AS tenantName,
                           SUM(CASE WHEN tpl.type = 'whatsapp' THEN 1 ELSE 0 END) AS whatsappCount,
                           SUM(CASE WHEN tpl.type = 'email' THEN 1 ELSE 0 END) AS emailCount,
                           COUNT(tpl.id) AS totalTemplates
                    FROM tenants t
                    LEFT JOIN templates tpl ON tpl.tenantId = t.id
                    GROUP BY t.id, t.name
                    ORDER BY totalTemplates DESC
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    copyTemplateToTenant: superadminGuard
        .input(z.object({ templateId: z.number(), targetTenantId: z.number() }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            const [src] = await db.execute(sql`SELECT * FROM templates WHERE id = ${input.templateId} LIMIT 1`) as any;
            const template = (src as any)?.[0];
            if (!template) throw new TRPCError({ code: "NOT_FOUND", message: "Template no encontrado" });
            await db.execute(sql`
                INSERT INTO templates (tenantId, name, content, type, attachments, variables, createdAt, updatedAt)
                VALUES (${input.targetTenantId}, ${template.name + " (copy)"}, ${template.content}, ${template.type},
                        ${template.attachments ? JSON.stringify(template.attachments) : null},
                        ${template.variables ? JSON.stringify(template.variables) : null}, NOW(), NOW())
            `);
            await logSuperadminAction(ctx.user!.id, "copyTemplate", { templateId: input.templateId, targetTenantId: input.targetTenantId });
            return { ok: true, message: "Template copiado" };
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 7: License/API Key Management
       ══════════════════════════════════════════════════════════════════════ */
    listAllLicenses: superadminGuard
        .input(z.object({ limit: z.number().min(1).max(200).default(50), offset: z.number().min(0).default(0) }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { rows: [], total: 0 };
            try {
                const [rows] = await db.execute(sql`
                    SELECT l.*, t.name AS tenantName, t.plan AS tenantPlan, t.status AS tenantStatus
                    FROM license l
                    JOIN tenants t ON t.id = l.tenantId
                    ORDER BY l.updatedAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `) as any;
                const [cnt] = await db.execute(sql`SELECT COUNT(*) as total FROM license`) as any;
                return { rows: rows ?? [], total: Number(cnt?.[0]?.total ?? 0) };
            } catch { return { rows: [], total: 0 }; }
        }),

    rotateLicenseKey: superadminGuard
        .input(z.object({ licenseId: z.number() }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            const crypto = await import("crypto");
            const newKey = `lic_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
            await db.update(license).set({ key: newKey }).where(eq(license.id, input.licenseId));
            await logSuperadminAction(ctx.user!.id, "rotateLicenseKey", { licenseId: input.licenseId });
            return { ok: true, message: "Clave rotada", newKey };
        }),

    updateLicenseStatus: superadminGuard
        .input(z.object({ licenseId: z.number(), status: z.enum(["active", "expired", "canceled", "trial"]) }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            await db.update(license).set({ status: input.status }).where(eq(license.id, input.licenseId));
            await logSuperadminAction(ctx.user!.id, "updateLicenseStatus", { licenseId: input.licenseId, status: input.status });
            return { ok: true, message: `Licencia actualizada a ${input.status}` };
        }),

    updateLicenseFeatures: superadminGuard
        .input(z.object({ licenseId: z.number(), features: z.array(z.string()) }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            await db.update(license).set({ features: input.features }).where(eq(license.id, input.licenseId));
            await logSuperadminAction(ctx.user!.id, "updateLicenseFeatures", { licenseId: input.licenseId, features: input.features });
            return { ok: true, message: "Features actualizados" };
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 8: Tenant Comparison
       ══════════════════════════════════════════════════════════════════════ */
    compareTenants: superadminGuard
        .input(z.object({ tenantIds: z.array(z.number()).min(2).max(5) }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                const results: any[] = [];
                for (const tid of input.tenantIds) {
                    const [tRows] = await db.execute(sql`
                        SELECT t.*,
                            (SELECT COUNT(*) FROM users WHERE tenantId = ${tid} AND isActive=1) AS activeUsers,
                            (SELECT COUNT(*) FROM leads WHERE tenantId = ${tid} AND deletedAt IS NULL) AS totalLeads,
                            (SELECT COUNT(*) FROM conversations WHERE tenantId = ${tid}) AS totalConversations,
                            (SELECT COUNT(*) FROM chat_messages WHERE tenantId = ${tid}) AS totalMessages,
                            (SELECT COUNT(*) FROM whatsapp_numbers WHERE tenantId = ${tid}) AS waNumbers,
                            (SELECT COUNT(*) FROM workflows WHERE tenantId = ${tid} AND isActive=1) AS activeWorkflows,
                            (SELECT COUNT(*) FROM campaigns WHERE tenantId = ${tid}) AS totalCampaigns,
                            (SELECT COALESCE(SUM(size), 0) FROM file_uploads WHERE tenantId = ${tid}) AS storageBytes,
                            (SELECT completedAt FROM onboarding_progress WHERE tenantId = ${tid} LIMIT 1) AS onboardingCompletedAt
                        FROM tenants t WHERE t.id = ${tid} LIMIT 1
                    `) as any;
                    if (tRows?.[0]) results.push(tRows[0]);
                }
                return results;
            } catch { return []; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 9: Tenant Health Score
       ══════════════════════════════════════════════════════════════════════ */
    computeHealthScores: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name, t.plan, t.status, t.createdAt,
                        (SELECT COUNT(*) FROM users u WHERE u.tenantId = t.id AND u.isActive=1) AS activeUsers,
                        (SELECT MAX(u.lastSignedIn) FROM users u WHERE u.tenantId = t.id) AS lastActivity,
                        (SELECT COUNT(*) FROM leads l WHERE l.tenantId = t.id AND l.deletedAt IS NULL AND l.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS recentLeads,
                        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.tenantId = t.id AND cm.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS recentMessages,
                        (SELECT COUNT(*) FROM whatsapp_numbers wn WHERE wn.tenantId = t.id) AS waNumbers,
                        (SELECT completedAt FROM onboarding_progress op WHERE op.tenantId = t.id LIMIT 1) AS onboardingCompletedAt
                    FROM tenants t
                    WHERE t.status = 'active'
                    ORDER BY t.id
                `) as any;

                // Compute scores
                return (rows ?? []).map((r: any) => {
                    let score = 0;
                    // Activity (max 30): last login within 1 day = 30, 3 days = 20, 7 days = 10, else 0
                    const lastAct = r.lastActivity ? (Date.now() - new Date(r.lastActivity).getTime()) / 86400000 : 999;
                    if (lastAct <= 1) score += 30;
                    else if (lastAct <= 3) score += 20;
                    else if (lastAct <= 7) score += 10;

                    // Users (max 15): >3 users = 15, >1 = 10, 1 = 5
                    const users = Number(r.activeUsers);
                    if (users >= 3) score += 15;
                    else if (users >= 2) score += 10;
                    else if (users >= 1) score += 5;

                    // Engagement (max 25): recent messages
                    const msgs = Number(r.recentMessages);
                    if (msgs >= 100) score += 25;
                    else if (msgs >= 20) score += 15;
                    else if (msgs >= 1) score += 8;

                    // Growth (max 15): recent leads
                    const lds = Number(r.recentLeads);
                    if (lds >= 10) score += 15;
                    else if (lds >= 3) score += 10;
                    else if (lds >= 1) score += 5;

                    // Onboarding (max 15): completed
                    if (r.onboardingCompletedAt) score += 15;
                    else score += 5; // partial credit

                    return { ...r, healthScore: Math.min(score, 100) };
                });
            } catch { return []; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 10: Maintenance Mode
       ══════════════════════════════════════════════════════════════════════ */
    getMaintenanceStatus: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return { platformMaintenance: false, message: "" };
            try {
                const [rows] = await db.execute(sql`
                    SELECT value FROM app_settings WHERE tenantId = 1 AND \`key\` = 'maintenance_mode' LIMIT 1
                `) as any;
                if (rows?.[0]?.value) {
                    const val = typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
                    return { platformMaintenance: val.enabled ?? false, message: val.message ?? "" };
                }
                return { platformMaintenance: false, message: "" };
            } catch { return { platformMaintenance: false, message: "" }; }
        }),

    setMaintenanceMode: superadminGuard
        .input(z.object({ enabled: z.boolean(), message: z.string().max(500).default("Sistema en mantenimiento. Volvemos pronto.") }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            const val = JSON.stringify({ enabled: input.enabled, message: input.message });
            await db.execute(sql`
                INSERT INTO app_settings (tenantId, \`key\`, value)
                VALUES (1, 'maintenance_mode', ${val})
                ON DUPLICATE KEY UPDATE value = ${val}
            `);
            await logSuperadminAction(ctx.user!.id, "setMaintenanceMode", { enabled: input.enabled });
            return { ok: true, message: input.enabled ? "Modo mantenimiento ACTIVADO" : "Modo mantenimiento DESACTIVADO" };
        }),

    setTenantMaintenanceMode: superadminGuard
        .input(z.object({ tenantId: z.number(), enabled: z.boolean(), message: z.string().max(500).default("") }))
        .mutation(async ({ ctx, input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            const val = JSON.stringify({ enabled: input.enabled, message: input.message });
            await db.execute(sql`
                INSERT INTO app_settings (tenantId, \`key\`, value)
                VALUES (${input.tenantId}, 'maintenance_mode', ${val})
                ON DUPLICATE KEY UPDATE value = ${val}
            `);
            await logSuperadminAction(ctx.user!.id, "setTenantMaintenanceMode", { tenantId: input.tenantId, enabled: input.enabled }, input.tenantId);
            return { ok: true, message: `Mantenimiento ${input.enabled ? "activado" : "desactivado"} para tenant ${input.tenantId}` };
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 11: Churn Prediction
       ══════════════════════════════════════════════════════════════════════ */
    churnPrediction: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id, t.name, t.plan, t.status, t.createdAt,
                        (SELECT MAX(u.lastSignedIn) FROM users u WHERE u.tenantId = t.id) AS lastLogin,
                        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.tenantId = t.id AND cm.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS messagesLast7d,
                        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.tenantId = t.id AND cm.createdAt BETWEEN DATE_SUB(NOW(), INTERVAL 14 DAY) AND DATE_SUB(NOW(), INTERVAL 7 DAY)) AS messagesPrev7d,
                        (SELECT COUNT(*) FROM leads l WHERE l.tenantId = t.id AND l.deletedAt IS NULL AND l.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS leadsLast7d,
                        (SELECT COUNT(*) FROM leads l WHERE l.tenantId = t.id AND l.deletedAt IS NULL AND l.createdAt BETWEEN DATE_SUB(NOW(), INTERVAL 14 DAY) AND DATE_SUB(NOW(), INTERVAL 7 DAY)) AS leadsPrev7d,
                        (SELECT COUNT(*) FROM users u WHERE u.tenantId = t.id AND u.isActive = 1) AS activeUsers,
                        (SELECT completedAt FROM onboarding_progress op WHERE op.tenantId = t.id LIMIT 1) AS onboardingCompleted
                    FROM tenants t
                    WHERE t.status = 'active'
                `) as any;

                return (rows ?? []).map((r: any) => {
                    const factors: string[] = [];
                    let risk = 0;

                    // Login recency (max 30)
                    const lastLogin = r.lastLogin ? (Date.now() - new Date(r.lastLogin).getTime()) / 86400000 : 999;
                    if (lastLogin > 14) { risk += 30; factors.push(`Sin login hace ${Math.round(lastLogin)}d`); }
                    else if (lastLogin > 7) { risk += 15; factors.push(`Último login hace ${Math.round(lastLogin)}d`); }

                    // Message volume decline (max 25)
                    const msgNow = Number(r.messagesLast7d);
                    const msgPrev = Number(r.messagesPrev7d);
                    if (msgPrev > 0 && msgNow === 0) { risk += 25; factors.push("0 mensajes esta semana (antes tenía)"); }
                    else if (msgPrev > 0 && msgNow < msgPrev * 0.5) { risk += 15; factors.push("Mensajes cayeron >50%"); }

                    // Lead creation decline (max 20)
                    const leadsNow = Number(r.leadsLast7d);
                    const leadsPrev = Number(r.leadsPrev7d);
                    if (leadsPrev > 0 && leadsNow === 0) { risk += 20; factors.push("0 leads nuevos esta semana"); }
                    else if (leadsPrev > 0 && leadsNow < leadsPrev * 0.5) { risk += 10; factors.push("Leads cayeron >50%"); }

                    // Onboarding not completed (max 15)
                    if (!r.onboardingCompleted) { risk += 15; factors.push("Onboarding incompleto"); }

                    // Few users (max 10)
                    if (Number(r.activeUsers) <= 1) { risk += 10; factors.push("Solo 1 usuario activo"); }

                    return {
                        id: r.id, name: r.name, plan: r.plan, status: r.status,
                        churnScore: Math.min(risk, 100),
                        factors,
                        lastLogin: r.lastLogin,
                        messagesLast7d: msgNow,
                        leadsLast7d: leadsNow,
                    };
                }).sort((a: any, b: any) => b.churnScore - a.churnScore);
            } catch { return []; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 12: Data Retention Preview
       ══════════════════════════════════════════════════════════════════════ */
    previewRetentionPurge: superadminGuard
        .input(z.object({
            retentionDays: z.number().min(30).max(3650).default(365),
            dataType: z.enum(["messages", "activity_logs", "access_logs", "files"]),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return { count: 0 };
            try {
                const tableMap: Record<string, string> = {
                    messages: "chat_messages",
                    activity_logs: "activity_logs",
                    access_logs: "access_logs",
                    files: "file_uploads",
                };
                const table = tableMap[input.dataType];
                if (!table) return { count: 0 };
                // Table name is from a static allowlist — safe to use sql.raw() for identifier only
                const [rows] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM ${sql.raw(table)}
                    WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${input.retentionDays} DAY)
                `) as any;
                return { count: Number(rows?.[0]?.cnt ?? 0) };
            } catch { return { count: 0 }; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       MEDIUM PRIORITY — Feature 13: File/Storage Overview
       ══════════════════════════════════════════════════════════════════════ */
    storageOverview: superadminGuard
        .query(async () => {
            const db = await getDb();
            if (!db) return [];
            try {
                const [rows] = await db.execute(sql`
                    SELECT t.id AS tenantId, t.name AS tenantName, t.plan,
                           COUNT(f.id) AS fileCount,
                           COALESCE(SUM(f.size), 0) AS totalBytes,
                           MAX(f.createdAt) AS lastUpload
                    FROM tenants t
                    LEFT JOIN file_uploads f ON f.tenantId = t.id
                    GROUP BY t.id, t.name, t.plan
                    ORDER BY totalBytes DESC
                `) as any;
                return rows ?? [];
            } catch { return []; }
        }),

    /* ══════════════════════════════════════════════════════════════════════
       PLATFORM META CONFIGURATION
       Allows the platform owner to configure Meta App credentials once.
       All tenants automatically inherit these for Embedded Signup.
       ══════════════════════════════════════════════════════════════════════ */

    /** Get current platform Meta config (appId visible, secret masked) */
    getPlatformMetaConfig: superadminGuard
        .query(async () => {
            const cfg = await getPlatformMetaConfig();
            return {
                appId: cfg.appId,
                configId: cfg.configId,
                hasSecret: !!cfg.appSecret,
            };
        }),

    /** Save platform-level Meta App credentials (stored in tenant 1's appSettings) */
    savePlatformMetaConfig: superadminGuard
        .input(z.object({
            appId: z.string().max(50).optional(),
            appSecret: z.string().max(512).optional(),
            embeddedSignupConfigId: z.string().max(100).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) throw new Error("Database not available");

            const current = await getOrCreateAppSettings(db, 1);
            const prevMeta = (current.metaConfig as Record<string, any>) ?? {};

            const metaConfigUpdate: Record<string, any> = { ...prevMeta };
            if (input.appId !== undefined) metaConfigUpdate.appId = input.appId;
            if (input.embeddedSignupConfigId !== undefined) metaConfigUpdate.embeddedSignupConfigId = input.embeddedSignupConfigId;
            // Only update secret if provided and non-empty
            if (input.appSecret && input.appSecret.trim()) {
                metaConfigUpdate.appSecret = encryptSecret(input.appSecret.trim());
            }

            await updateAppSettings(db, 1, { metaConfig: metaConfigUpdate });
            await logSuperadminAction(ctx.user!.id, "savePlatformMetaConfig", { appId: input.appId ?? "(unchanged)" });

            return { success: true };
        }),
});
