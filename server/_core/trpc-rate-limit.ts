/**
 * tRPC Rate Limiting
 *
 * Rate limiting specific for tRPC procedures.
 * Protects against brute force attacks on authentication endpoints.
 *
 * Uses Redis when REDIS_URL is available (survives restarts, shared across instances).
 * Falls back to in-memory store for local development.
 */

import { TRPCError } from "@trpc/server";
import Redis from "ioredis";
import { logger } from "./logger";

// ---------- store abstraction ----------

interface RateLimitEntry {
    count: number;
    resetAt: number;
    blocked: boolean;
}

interface RateLimitStore {
    get(key: string): Promise<RateLimitEntry | null>;
    set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
}

// In-memory fallback
class MemoryStore implements RateLimitStore {
    private map = new Map<string, RateLimitEntry>();

    constructor() {
        setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.map.entries()) {
                if (now > entry.resetAt && !entry.blocked) {
                    this.map.delete(key);
                }
            }
        }, 60_000).unref();
    }

    async get(key: string) { return this.map.get(key) ?? null; }
    async set(key: string, entry: RateLimitEntry) { this.map.set(key, entry); }
    async del(key: string) { this.map.delete(key); }
}

// Redis-backed store (shared across instances, survives restarts)
class RedisRateLimitStore implements RateLimitStore {
    private prefix = "trpc_rl:";
    constructor(private redis: Redis) {}

    async get(key: string): Promise<RateLimitEntry | null> {
        try {
            const raw = await this.redis.get(this.prefix + key);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    async set(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void> {
        try {
            const ttlSec = Math.max(Math.ceil(ttlMs / 1000), 1);
            await this.redis.set(this.prefix + key, JSON.stringify(entry), "EX", ttlSec);
        } catch { /* swallow — degrade to allow request */ }
    }

    async del(key: string): Promise<void> {
        try { await this.redis.del(this.prefix + key); } catch { /* ignore */ }
    }
}

// Initialise store
let store: RateLimitStore;
if (process.env.REDIS_URL) {
    try {
        const redis = new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: true,
        });
        redis.connect().catch(() => { /* handled below */ });
        redis.on("error", () => { /* suppress — fallback handled per-op */ });
        store = new RedisRateLimitStore(redis);
        logger.info("[tRPC-RateLimit] Using Redis-backed store");
    } catch {
        store = new MemoryStore();
        logger.warn("[tRPC-RateLimit] Redis init failed, falling back to in-memory store");
    }
} else {
    store = new MemoryStore();
    logger.info("[tRPC-RateLimit] Using in-memory store (set REDIS_URL for persistence)");
}

// ---------- configuration ----------

const AUTH_RATE_LIMIT = {
    maxAttempts: 5,                      // 5 intentos
    windowMs: 15 * 60 * 1000,           // por 15 minutos
    blockDurationMs: 30 * 60 * 1000,    // bloqueo por 30 minutos después de exceder
};

const GENERAL_RATE_LIMIT = {
    maxRequests: 100,       // 100 requests
    windowMs: 60 * 1000,   // por minuto
};

// ---------- public API ----------

/**
 * Rate limit para endpoints de autenticación (login, reset password, etc.)
 */
export async function authRateLimit(identifier: string): Promise<void> {
    const key = `auth:${identifier}`;
    const now = Date.now();

    const entry = await store.get(key);

    if (!entry || now > entry.resetAt) {
        await store.set(key, { count: 1, resetAt: now + AUTH_RATE_LIMIT.windowMs, blocked: false }, AUTH_RATE_LIMIT.windowMs);
        return;
    }

    // Si está bloqueado
    if (entry.blocked) {
        const blockExpiry = entry.resetAt + AUTH_RATE_LIMIT.blockDurationMs;
        if (now < blockExpiry) {
            const minutesLeft = Math.ceil((blockExpiry - now) / 60000);
            throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: `Demasiados intentos fallidos. Cuenta bloqueada por ${minutesLeft} minutos.`,
            });
        } else {
            const newEntry: RateLimitEntry = { count: 1, resetAt: now + AUTH_RATE_LIMIT.windowMs, blocked: false };
            await store.set(key, newEntry, AUTH_RATE_LIMIT.windowMs);
            return;
        }
    }

    // Incrementar contador
    entry.count++;

    if (entry.count > AUTH_RATE_LIMIT.maxAttempts) {
        entry.blocked = true;
        entry.resetAt = now;
        await store.set(key, entry, AUTH_RATE_LIMIT.blockDurationMs);
        throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Demasiados intentos fallidos. Cuenta bloqueada por ${AUTH_RATE_LIMIT.blockDurationMs / 60000} minutos.`,
        });
    }

    await store.set(key, entry, entry.resetAt - now);
}

/**
 * Rate limit general para procedimientos
 */
export async function generalRateLimit(identifier: string): Promise<void> {
    const key = `general:${identifier}`;
    const now = Date.now();

    const entry = await store.get(key);

    if (!entry || now > entry.resetAt) {
        await store.set(key, { count: 1, resetAt: now + GENERAL_RATE_LIMIT.windowMs, blocked: false }, GENERAL_RATE_LIMIT.windowMs);
        return;
    }

    entry.count++;

    if (entry.count > GENERAL_RATE_LIMIT.maxRequests) {
        throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Demasiadas peticiones. Por favor intenta más tarde.",
        });
    }

    await store.set(key, entry, entry.resetAt - now);
}

/**
 * Limpia el rate limit para un identificador específico
 * Útil después de un login exitoso
 */
export function clearRateLimit(identifier: string, type: 'auth' | 'general' = 'auth'): void {
    const key = `${type}:${identifier}`;
    store.del(key).catch(() => { /* ignore */ });
}
