import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, whatsappNumbers, conversations, leads, sessions, platformAnnouncements, activityLogs, appSettings, license, superadminAlerts, chatMessages } from "../../drizzle/schema";
import { eq, desc, sql, count, and, gte, lte, inArray } from "drizzle-orm";
import { logger } from "../_core/logger";
import { TRPCError } from "@trpc/server";
import { getAllFlags, setFeatureFlag, getFlagDefinitions } from "../services/feature-flags";
import { sdk } from "../_core/sdk";
import { getSessionCookieOptions } from "../_core/cookies";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getPlanLimits } from "../services/plan-limits";

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

            // First get base tenant data (always safe)
            const tenantList = await db
                .select({
                    id: tenants.id,
                    name: tenants.name,
                    slug: tenants.slug,
                    plan: tenants.plan,
                    status: tenants.status,
                    stripeCustomerId: tenants.stripeCustomerId,
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
                let where = "1=1";
                if (input.tenantId) where += ` AND al.tenantId = ${Number(input.tenantId)}`;
                if (input.action) {
                    // Sanitize: only allow alphanumeric, underscore, dot, dash
                    const safeAction = input.action.replace(/[^a-zA-Z0-9_.\-]/g, "");
                    if (safeAction) where += ` AND al.action LIKE '%${safeAction}%'`;
                }

                const [countResult] = await db.execute(sql.raw(
                    `SELECT COUNT(*) as cnt FROM activity_logs al WHERE ${where}`
                )) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql.raw(`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.entityId, al.details, al.createdAt
                    FROM activity_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    WHERE ${where}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `)) as any;

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
                let where = "1=1";
                if (input.tenantId) where += ` AND al.tenantId = ${Number(input.tenantId)}`;
                if (input.success !== undefined) where += ` AND al.success = ${input.success ? 1 : 0}`;

                const [countResult] = await db.execute(sql.raw(
                    `SELECT COUNT(*) as cnt FROM access_logs al WHERE ${where}`
                )) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql.raw(`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.ipAddress, al.userAgent,
                           al.success, al.errorMessage, al.createdAt
                    FROM access_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    WHERE ${where}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `)) as any;

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
                const [rows] = await db.execute(sql.raw(`
                    SELECT DATE(createdAt) as date, COUNT(*) as cnt
                    FROM tenants
                    WHERE createdAt >= DATE_SUB(NOW(), INTERVAL ${input.days} DAY)
                    GROUP BY DATE(createdAt)
                    ORDER BY date ASC
                `)) as any;
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
                const [rows] = await db.execute(sql.raw(`
                    SELECT id, name, slug, plan, trialEndsAt, status,
                           DATEDIFF(trialEndsAt, NOW()) as daysLeft
                    FROM tenants
                    WHERE trialEndsAt IS NOT NULL
                      AND trialEndsAt <= DATE_ADD(NOW(), INTERVAL ${input.daysAhead} DAY)
                    ORDER BY trialEndsAt ASC
                `)) as any;
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
                const [rows] = await db.execute(sql.raw(`
                    SELECT t.id, t.name, t.slug, t.plan, t.status,
                           COALESCE(MAX(u.lastSignedIn), t.createdAt) as lastActivity,
                           DATEDIFF(NOW(), COALESCE(MAX(u.lastSignedIn), t.createdAt)) as daysSinceActivity
                    FROM tenants t
                    LEFT JOIN users u ON u.tenantId = t.id
                    GROUP BY t.id
                    HAVING daysSinceActivity >= ${input.inactiveDays}
                    ORDER BY daysSinceActivity DESC
                `)) as any;
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

            const limits = await getPlanLimits(input.tenantId);

            // Get actual counts
            const [[userResult], [leadResult], [waResult]] = await Promise.all([
                db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM users WHERE tenantId = ${Number(input.tenantId)} AND isActive = 1`)) as any,
                db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM leads WHERE tenantId = ${Number(input.tenantId)} AND deletedAt IS NULL`)) as any,
                db.execute(sql.raw(`SELECT COUNT(*) as cnt FROM whatsapp_numbers WHERE tenantId = ${Number(input.tenantId)}`)) as any,
            ]);

            // Get messages this month
            let msgThisMonth = 0;
            try {
                const [msgResult] = await db.execute(sql.raw(
                    `SELECT COUNT(*) as cnt FROM chat_messages WHERE tenantId = ${Number(input.tenantId)} AND createdAt >= DATE_FORMAT(NOW(), '%Y-%m-01')`
                )) as any;
                msgThisMonth = Number(msgResult?.[0]?.cnt ?? 0);
            } catch { /* table might not exist */ }

            return {
                users:    { current: Number(userResult?.[0]?.cnt ?? 0), limit: limits.maxUsers },
                leads:    { current: Number(leadResult?.[0]?.cnt ?? 0), limit: limits.maxLeads },
                whatsapp: { current: Number(waResult?.[0]?.cnt ?? 0),   limit: limits.maxWhatsappNumbers },
                messages: { current: msgThisMonth,                      limit: limits.maxMessagesPerMonth },
            };
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
                let where = "1=1";
                if (input.tenantId) where += ` AND al.tenantId = ${Number(input.tenantId)}`;
                if (input.action) {
                    const safeAction = input.action.replace(/[^a-zA-Z0-9_.\-]/g, "");
                    if (safeAction) where += ` AND al.action LIKE '%${safeAction}%'`;
                }
                const [rows] = await db.execute(sql.raw(`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.entityId, al.createdAt
                    FROM activity_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    WHERE ${where}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit}
                `)) as any;
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
                let where = "1=1";
                if (input.tenantId) where += ` AND al.tenantId = ${Number(input.tenantId)}`;
                if (input.success !== undefined) where += ` AND al.success = ${input.success ? 1 : 0}`;
                const [rows] = await db.execute(sql.raw(`
                    SELECT al.id, al.tenantId, t.name as tenantName, al.userId, u.name as userName,
                           al.action, al.entityType, al.ipAddress, al.userAgent,
                           al.success, al.errorMessage, al.createdAt
                    FROM access_logs al
                    LEFT JOIN tenants t ON t.id = al.tenantId
                    LEFT JOIN users u ON u.id = al.userId
                    WHERE ${where}
                    ORDER BY al.createdAt DESC
                    LIMIT ${input.limit}
                `)) as any;
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
                let where = "s.expiresAt > NOW()";
                if (input.tenantId) where += ` AND s.tenantId = ${Number(input.tenantId)}`;

                const [rows] = await db.execute(sql.raw(`
                    SELECT s.id, s.tenantId, t.name as tenantName, s.userId,
                           u.name as userName, u.email as userEmail, u.role as userRole,
                           s.ipAddress, s.userAgent, s.lastActivityAt, s.expiresAt, s.createdAt
                    FROM sessions s
                    LEFT JOIN tenants t ON t.id = s.tenantId
                    LEFT JOIN users u ON u.id = s.userId
                    WHERE ${where}
                    ORDER BY s.lastActivityAt DESC
                    LIMIT ${input.limit}
                `)) as any;
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

            await db.update(tenants)
                .set({ status: "active" })
                .where(inArray(tenants.id, input.tenantIds));

            logger.warn(
                { adminId: ctx.user!.id, tenantIds: input.tenantIds },
                "[Superadmin] BULK reactivate"
            );

            return { success: true, count: input.tenantIds.length, message: `${input.tenantIds.length} tenants reactivados.` };
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
            stripeCustomerId: z.string().max(255).nullable().optional(),
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
            if (input.stripeCustomerId !== undefined) updates.stripeCustomerId = input.stripeCustomerId;
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

            await logSuperadminAction(ctx.user!.id, "updateTenantLimits", { tenantId: input.tenantId, ...input });
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
                    SELECT t.id, t.name, t.slug, t.plan, t.status, t.stripeCustomerId,
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
                let where = "1=1";
                if (input.tenantId) where += ` AND u.tenantId = ${Number(input.tenantId)}`;
                if (input.role) {
                    const safeRole = input.role.replace(/[^a-zA-Z]/g, "");
                    where += ` AND u.role = '${safeRole}'`;
                }
                if (input.isActive !== undefined) where += ` AND u.isActive = ${input.isActive ? 1 : 0}`;
                if (input.search) {
                    const safeSearch = input.search.replace(/['"\\%_]/g, "");
                    where += ` AND (u.name LIKE '%${safeSearch}%' OR u.email LIKE '%${safeSearch}%')`;
                }

                const [countResult] = await db.execute(sql.raw(
                    `SELECT COUNT(*) as cnt FROM users u WHERE ${where}`
                )) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql.raw(`
                    SELECT u.id, u.tenantId, t.name as tenantName, u.name, u.email,
                           u.role, u.isActive, u.lastSignedIn, u.createdAt
                    FROM users u
                    LEFT JOIN tenants t ON t.id = u.tenantId
                    WHERE ${where}
                    ORDER BY u.lastSignedIn DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `)) as any;

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

            const safeQ = input.query.replace(/['"\\%_]/g, "");
            const result: { leads: any[]; conversations: any[]; messages: any[] } = { leads: [], conversations: [], messages: [] };

            try {
                if (input.entities.includes("leads")) {
                    const [rows] = await db.execute(sql.raw(`
                        SELECT l.id, l.tenantId, t.name as tenantName, l.name, l.phone, l.email, l.status, l.createdAt
                        FROM leads l
                        JOIN tenants t ON t.id = l.tenantId
                        WHERE l.deletedAt IS NULL
                          AND (l.name LIKE '%${safeQ}%' OR l.phone LIKE '%${safeQ}%' OR l.email LIKE '%${safeQ}%')
                        ORDER BY l.createdAt DESC
                        LIMIT ${input.limit}
                    `)) as any;
                    result.leads = rows ?? [];
                }
            } catch { /* table may not exist */ }

            try {
                if (input.entities.includes("conversations")) {
                    const [rows] = await db.execute(sql.raw(`
                        SELECT c.id, c.tenantId, t.name as tenantName, c.contactName, c.contactPhone,
                               c.status, c.lastMessageAt, c.createdAt
                        FROM conversations c
                        JOIN tenants t ON t.id = c.tenantId
                        WHERE c.contactName LIKE '%${safeQ}%' OR c.contactPhone LIKE '%${safeQ}%'
                        ORDER BY c.lastMessageAt DESC
                        LIMIT ${input.limit}
                    `)) as any;
                    result.conversations = rows ?? [];
                }
            } catch { /* table may not exist */ }

            try {
                if (input.entities.includes("messages")) {
                    const [rows] = await db.execute(sql.raw(`
                        SELECT cm.id, cm.tenantId, t.name as tenantName, cm.conversationId,
                               SUBSTRING(cm.content, 1, 200) as content, cm.sender, cm.createdAt
                        FROM chat_messages cm
                        JOIN tenants t ON t.id = cm.tenantId
                        WHERE cm.content LIKE '%${safeQ}%'
                        ORDER BY cm.createdAt DESC
                        LIMIT ${input.limit}
                    `)) as any;
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
            smtpConfig: z.any().optional(),
            metaConfig: z.any().optional(),
            aiConfig: z.any().optional(),
            storageConfig: z.any().optional(),
            securityConfig: z.any().optional(),
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
                let where = "1=1";
                if (input.type) where += ` AND type = '${input.type.replace(/[^a-z_]/g, "")}'`;
                if (input.severity) where += ` AND severity = '${input.severity.replace(/[^a-z]/g, "")}'`;
                if (input.isRead !== undefined) where += ` AND isRead = ${input.isRead ? 1 : 0}`;

                const [countResult] = await db.execute(sql.raw(
                    `SELECT COUNT(*) as cnt FROM superadmin_alerts WHERE ${where}`
                )) as any;
                const total = Number(countResult?.[0]?.cnt ?? 0);

                const [unreadResult] = await db.execute(sql`
                    SELECT COUNT(*) as cnt FROM superadmin_alerts WHERE isRead = 0
                `) as any;
                const unreadCount = Number(unreadResult?.[0]?.cnt ?? 0);

                const [rows] = await db.execute(sql.raw(`
                    SELECT sa.*, t.name as tenantName
                    FROM superadmin_alerts sa
                    LEFT JOIN tenants t ON t.id = sa.tenantId
                    WHERE ${where}
                    ORDER BY sa.createdAt DESC
                    LIMIT ${input.limit} OFFSET ${input.offset}
                `)) as any;

                return { rows: rows ?? [], total, unreadCount };
            } catch { return { rows: [], total: 0, unreadCount: 0 }; }
        }),

    /** Mark alert(s) as read */
    markAlertRead: superadminGuard
        .input(z.object({
            alertId: z.number().optional(),
            all: z.boolean().optional(),
        }))
        .mutation(async ({ input }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            if (input.all) {
                await db.update(superadminAlerts).set({ isRead: true }).where(eq(superadminAlerts.isRead, false));
            } else if (input.alertId) {
                await db.update(superadminAlerts).set({ isRead: true }).where(eq(superadminAlerts.id, input.alertId));
            }

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
});
