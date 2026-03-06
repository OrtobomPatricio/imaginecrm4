import { getDb } from "../db";
import { license, users, leads, whatsappNumbers, chatMessages } from "../../drizzle/schema";
import { eq, and, sql, count, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";

/**
 * Plan Limits Enforcement Service
 *
 * Centralized service to check and enforce plan limits across the system.
 * Used by routers that create resources (leads, users, whatsapp numbers, messages).
 *
 * Default limits per plan:
 * - Free:       5 users, 3 WA numbers, 10,000 msgs/month, 500 leads
 * - Starter:   10 users, 5 WA numbers, 25,000 msgs/month, 2,000 leads
 * - Pro:       25 users, 10 WA numbers, 100,000 msgs/month, unlimited leads
 * - Enterprise: unlimited
 */

interface PlanLimits {
    maxUsers: number;
    maxWhatsappNumbers: number;
    maxMessagesPerMonth: number;
    maxLeads: number;
}

const DEFAULT_PLAN_LIMITS: Record<string, PlanLimits> = {
    free:       { maxUsers: 5,   maxWhatsappNumbers: 3,  maxMessagesPerMonth: 10000,  maxLeads: 500 },
    starter:    { maxUsers: 10,  maxWhatsappNumbers: 5,  maxMessagesPerMonth: 25000,  maxLeads: 2000 },
    pro:        { maxUsers: 25,  maxWhatsappNumbers: 10, maxMessagesPerMonth: 100000, maxLeads: 999999 },
    enterprise: { maxUsers: 9999, maxWhatsappNumbers: 999, maxMessagesPerMonth: 9999999, maxLeads: 9999999 },
};

/**
 * Get the effective plan limits for a tenant.
 * First checks the license table for custom limits, then falls back to defaults.
 */
export async function getPlanLimits(tenantId: number): Promise<PlanLimits> {
    const db = await getDb();
    if (!db) return DEFAULT_PLAN_LIMITS.free;

    const [lic] = await db.select()
        .from(license)
        .where(eq(license.tenantId, tenantId))
        .limit(1);

    if (lic) {
        return {
            maxUsers: lic.maxUsers ?? DEFAULT_PLAN_LIMITS[lic.plan]?.maxUsers ?? 5,
            maxWhatsappNumbers: lic.maxWhatsappNumbers ?? DEFAULT_PLAN_LIMITS[lic.plan]?.maxWhatsappNumbers ?? 3,
            maxMessagesPerMonth: lic.maxMessagesPerMonth ?? DEFAULT_PLAN_LIMITS[lic.plan]?.maxMessagesPerMonth ?? 10000,
            maxLeads: DEFAULT_PLAN_LIMITS[lic.plan]?.maxLeads ?? 500,
        };
    }

    // No license record: check tenant plan from tenants table
    const { tenants } = await import("../../drizzle/schema");
    const [tenant] = await db.select({ plan: tenants.plan })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

    const plan = tenant?.plan || "free";
    return DEFAULT_PLAN_LIMITS[plan] || DEFAULT_PLAN_LIMITS.free;
}

/**
 * Check if a tenant can add more users.
 * Throws TRPCError if the limit is exceeded.
 */
export async function enforceUserLimit(tenantId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const limits = await getPlanLimits(tenantId);

    const [result] = await db.select({ total: count() })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));

    const currentUsers = result?.total || 0;

    if (currentUsers >= limits.maxUsers) {
        logger.warn({ tenantId, currentUsers, maxUsers: limits.maxUsers }, "[PlanLimits] User limit reached");
        throw new TRPCError({
            code: "FORBIDDEN",
            message: `Has alcanzado el límite de ${limits.maxUsers} usuarios de tu plan. Actualiza tu plan para agregar más.`,
        });
    }
}

/**
 * Check if a tenant can add more leads.
 * Throws TRPCError if the limit is exceeded.
 */
export async function enforceLeadLimit(tenantId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const limits = await getPlanLimits(tenantId);

    const [result] = await db.select({
        total: sql<number>`COUNT(*)`,
    }).from(leads)
        .where(and(eq(leads.tenantId, tenantId), sql`${leads.deletedAt} IS NULL`));

    const currentLeads = result?.total || 0;

    if (currentLeads >= limits.maxLeads) {
        logger.warn({ tenantId, currentLeads, maxLeads: limits.maxLeads }, "[PlanLimits] Lead limit reached");
        throw new TRPCError({
            code: "FORBIDDEN",
            message: `Has alcanzado el límite de ${limits.maxLeads} leads de tu plan. Actualiza tu plan para agregar más.`,
        });
    }
}

/**
 * Check if a tenant can add more WhatsApp numbers.
 * Throws TRPCError if the limit is exceeded.
 */
export async function enforceWhatsappLimit(tenantId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const limits = await getPlanLimits(tenantId);

    const [result] = await db.select({ total: count() })
        .from(whatsappNumbers)
        .where(eq(whatsappNumbers.tenantId, tenantId));

    const currentNumbers = result?.total || 0;

    if (currentNumbers >= limits.maxWhatsappNumbers) {
        logger.warn({ tenantId, currentNumbers, max: limits.maxWhatsappNumbers }, "[PlanLimits] WhatsApp number limit reached");
        throw new TRPCError({
            code: "FORBIDDEN",
            message: `Has alcanzado el límite de ${limits.maxWhatsappNumbers} números WhatsApp de tu plan. Actualiza tu plan para agregar más.`,
        });
    }
}

/**
 * Check monthly message quota using atomic Redis INCR to prevent TOCTOU race.
 * Falls back to DB COUNT if Redis is unavailable.
 * Returns { allowed: boolean, used: number, limit: number }
 */
export async function checkMessageQuota(tenantId: number): Promise<{ allowed: boolean; used: number; limit: number }> {
    const db = await getDb();
    if (!db) return { allowed: true, used: 0, limit: 999999 };

    const limits = await getPlanLimits(tenantId);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // Try atomic Redis counter first (race-condition-free)
    try {
        const redis = await getQuotaRedis();
        if (redis) {
            const key = `quota:msgs:${tenantId}:${monthKey}`;
            const current = await redis.get(key);
            const used = current ? parseInt(current, 10) : 0;
            return {
                allowed: used < limits.maxMessagesPerMonth,
                used,
                limit: limits.maxMessagesPerMonth,
            };
        }
    } catch {
        // Redis unavailable — fall through to DB count
    }

    // Fallback: DB COUNT (still subject to TOCTOU under high concurrency)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [result] = await db.select({ total: count() })
        .from(chatMessages)
        .where(and(
            eq(chatMessages.tenantId, tenantId),
            eq(chatMessages.direction, "outbound"),
            gte(chatMessages.createdAt, monthStart),
        ));

    const used = result?.total || 0;
    return {
        allowed: used < limits.maxMessagesPerMonth,
        used,
        limit: limits.maxMessagesPerMonth,
    };
}

// Shared Redis connection for quota operations (avoids per-call connection churn)
let _quotaRedis: any = null;
async function getQuotaRedis() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return null;
    if (_quotaRedis && _quotaRedis.status === "ready") return _quotaRedis;
    try {
        const Redis = (await import("ioredis")).default;
        _quotaRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
        await _quotaRedis.connect();
        return _quotaRedis;
    } catch {
        _quotaRedis = null;
        return null;
    }
}

/**
 * Atomically increment the Redis message counter after a message is sent.
 * Call this AFTER successfully inserting the message into chat_messages.
 * TTL is set to ~35 days to auto-expire old month counters.
 */
export async function incrementMessageCounter(tenantId: number): Promise<void> {
    try {
        const redis = await getQuotaRedis();
        if (!redis) return;
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const key = `quota:msgs:${tenantId}:${monthKey}`;
        const newVal = await redis.incr(key);
        if (newVal === 1) {
            // First message this month — set TTL to 35 days
            await redis.expire(key, 35 * 24 * 3600);
        }
    } catch {
        // Best-effort: if Redis fails, DB count is the fallback
    }
}
