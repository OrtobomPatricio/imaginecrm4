import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";

import { logger } from "../logger";

// Create Redis Client
const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : undefined;

if (redisClient) {
    logger.info("✅ Redis Rate Limiting habilitado");
    redisClient.on("error", (err) => logger.error("Error del Cliente Redis Rate Limit", err));
}

const makeRedisStore = () =>
    redisClient
        ? new RedisStore({ sendCommand: (...args: string[]) => redisClient.call(args[0], ...args.slice(1)) as any })
        : undefined;

// Default Global Rate Limiter
const globalLimiter = rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000"), // 1 min by default
    max: Number(process.env.RATE_LIMIT_MAX ?? "2000"), // 2000 per min
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore(),
    message: {
        error: "rate_limit",
        message: "Demasiadas peticiones, por favor intenta más tarde."
    }
});

// Sensitive endpoints Map
// NOTE: skipSuccessfulRequests is NOT used here because tRPC batch always
// returns HTTP 200. The increment-then-decrement pattern causes ghost counts
// when the Redis decrement races or fails, leading to false 429s.
// Real brute-force protection is handled by the tRPC-level authRateLimit.
const SENSITIVE_LIMITS: Record<string, ReturnType<typeof rateLimit>> = {
    "auth.loginWithCredentials": rateLimit({
        windowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? "60000"),
        max: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? "60"),
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de login. Espere un momento." }
    }),
    "auth.register": rateLimit({
        windowMs: Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS ?? "60000"),
        max: Number(process.env.RATE_LIMIT_REGISTER_MAX ?? "10"),
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de registro." }
    }),
    "signup.register": rateLimit({
        windowMs: Number(process.env.RATE_LIMIT_REGISTER_WINDOW_MS ?? "60000"),
        max: Number(process.env.RATE_LIMIT_REGISTER_MAX ?? "10"),
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de registro." }
    }),
    "account.resetPassword": rateLimit({
        windowMs: 60000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de intentos." }
    }),
    // Bulk operations protection
    "leads.import": rateLimit({
        windowMs: 60000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de importación." }
    }),
    "leads.bulkDelete": rateLimit({
        windowMs: 60000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de eliminación masiva." }
    }),
    "campaigns.launch": rateLimit({
        windowMs: 60000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        store: makeRedisStore(),
        message: { error: "rate_limit", message: "Excedido el límite de lanzamiento de campañas." }
    }),
};

// Webhook-specific rate limiters (high threshold but not unlimited)
const whatsappWebhookLimiter = rateLimit({
    windowMs: 60000,
    max: Number(process.env.RATE_LIMIT_WEBHOOK_MAX ?? "300"), // 300/min — Meta sends bursts
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore(),
    message: { error: "rate_limit", message: "Webhook rate limit exceeded" }
});

const paypalWebhookLimiter = rateLimit({
    windowMs: 60000,
    max: 60, // PayPal sends far fewer events
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore(),
    message: { error: "rate_limit", message: "Webhook rate limit exceeded" }
});

export const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "OPTIONS") return next();

    // Webhook verification GETs bypass rate limit (Meta/PayPal one-time checks)
    if (req.method === "GET" && (req.path === "/api/whatsapp/webhook" || req.path === "/api/meta/webhook")) {
        return next();
    }

    // Webhook POSTs get specific high-threshold limiters (not unlimited)
    if (req.path.startsWith("/api/whatsapp/webhook") || req.path === "/api/meta/webhook") {
        return whatsappWebhookLimiter(req, res, next);
    }
    if (req.path.startsWith("/api/webhooks")) {
        return paypalWebhookLimiter(req, res, next);
    }
    // Other whatsapp API routes (connect, embedded-signup) use global limiter
    // No bypass needed — they are authenticated endpoints

    // Check sensitive TRPC endpoints
    if (req.path.includes("/api/trpc/")) {
        const procedure = req.path.split("/api/trpc/")[1] || "";
        for (const [key, limiter] of Object.entries(SENSITIVE_LIMITS)) {
            if (procedure === key) {
                return limiter(req, res, next);
            }
        }
    }

    // Default to global limiter
    globalLimiter(req, res, next);
};

/**
 * Flush ALL express-rate-limit keys from Redis.
 * Called on startup to ensure stale rate-limit entries from previous
 * deployments don't block legitimate requests.
 */
export async function clearAllExpressRateLimits(): Promise<void> {
    if (!redisClient) return;
    try {
        let cursor = "0";
        let deleted = 0;
        do {
            const [next, keys] = await redisClient.scan(cursor, "MATCH", "rl:*", "COUNT", 200);
            cursor = next;
            if (keys.length > 0) {
                await redisClient.del(...keys);
                deleted += keys.length;
            }
        } while (cursor !== "0");
        if (deleted > 0) {
            logger.info({ deleted }, "startup: cleared Express rate-limit keys from Redis");
        }
    } catch (e) {
        logger.warn({ err: e }, "startup: failed to clear Express rate-limit keys");
    }
}
