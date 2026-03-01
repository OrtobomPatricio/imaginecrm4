import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, users, whatsappNumbers, conversations, leads, sessions, platformAnnouncements } from "../../drizzle/schema";
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
                // Ensure column exists
                await db.execute(sql.raw(
                    `ALTER TABLE tenants ADD COLUMN internalNotes TEXT NULL`
                )).catch(() => { /* column probably already exists */ });

                const [rows] = await db.execute(sql.raw(
                    `SELECT internalNotes FROM tenants WHERE id = ${Number(input.tenantId)}`
                )) as any;
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

            // Ensure column exists
            await db.execute(sql.raw(
                `ALTER TABLE tenants ADD COLUMN internalNotes TEXT NULL`
            )).catch(() => { /* column probably already exists */ });

            await db.execute(sql.raw(
                `UPDATE tenants SET internalNotes = ${input.notes ? `'${input.notes.replace(/'/g, "''")}'` : 'NULL'} WHERE id = ${Number(input.tenantId)}`
            ));

            logger.info(
                { adminId: ctx.user!.id, tenantId: input.tenantId },
                "[Superadmin] Tenant notes updated"
            );

            return { success: true, message: "Notas actualizadas." };
        }),

    // ══════════════════════════════════════════════════════════════
    //  REVENUE TIMELINE (Historical MRR estimation)
    // ══════════════════════════════════════════════════════════════

    /** Estimate MRR timeline based on tenant creation dates and current plans */
    revenueTimeline: superadminGuard
        .input(z.object({
            months: z.number().min(1).max(24).default(12),
        }))
        .query(async ({ input }) => {
            const db = await getDb();
            if (!db) return [];
            try {
                // Get all tenants with their plan and creation date
                const [rows] = await db.execute(sql.raw(`
                    SELECT id, plan, createdAt, status FROM tenants ORDER BY createdAt ASC
                `)) as any;

                const allTenants = (rows ?? []) as Array<{ id: number; plan: string; createdAt: string; status: string }>;
                const PLAN_PRICES: Record<string, number> = { free: 0, starter: 29, pro: 99, enterprise: 299 };

                // Build monthly MRR timeline
                const timeline: Array<{ month: string; mrr: number; tenantCount: number; paidCount: number }> = [];
                const now = new Date();

                for (let i = input.months - 1; i >= 0; i--) {
                    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
                    const monthStr = monthDate.toISOString().slice(0, 7); // YYYY-MM

                    // Tenants that existed by end of this month (and not canceled)
                    const activeTenants = allTenants.filter(t => {
                        const created = new Date(t.createdAt);
                        return created <= monthEnd && t.status !== "canceled";
                    });

                    const mrr = activeTenants.reduce((sum, t) => sum + (PLAN_PRICES[t.plan] ?? 0), 0);
                    const paidCount = activeTenants.filter(t => t.plan !== "free").length;

                    timeline.push({
                        month: monthStr,
                        mrr,
                        tenantCount: activeTenants.length,
                        paidCount,
                    });
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
                // Ensure table exists
                await db.execute(sql.raw(`
                    CREATE TABLE IF NOT EXISTS platform_announcements (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        title VARCHAR(255) NOT NULL,
                        message TEXT NOT NULL,
                        type ENUM('info','warning','critical','maintenance') DEFAULT 'info' NOT NULL,
                        active BOOLEAN DEFAULT TRUE NOT NULL,
                        createdBy INT NULL,
                        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
                    )
                `));

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

            // Ensure table exists
            await db.execute(sql.raw(`
                CREATE TABLE IF NOT EXISTS platform_announcements (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    message TEXT NOT NULL,
                    type ENUM('info','warning','critical','maintenance') DEFAULT 'info' NOT NULL,
                    active BOOLEAN DEFAULT TRUE NOT NULL,
                    createdBy INT NULL,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
                )
            `));

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

    /** Get active announcements (public — for tenants dashboard) */
    getActiveAnnouncements: superadminGuard
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
});
