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
    /** Atomically increment count and return updated entry. Implementations without
     *  native atomicity fall back to get+set (acceptable for single-instance). */
    incr(key: string, ttlMs: number, windowMs: number): Promise<RateLimitEntry>;
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
    async incr(key: string, ttlMs: number, windowMs: number): Promise<RateLimitEntry> {
        const now = Date.now();
        const existing = this.map.get(key);
        if (!existing || now > existing.resetAt) {
            const entry: RateLimitEntry = { count: 1, resetAt: now + windowMs, blocked: false };
            this.map.set(key, entry);
            return entry;
        }
        existing.count++;
        return existing;
    }
}

// Redis-backed store (shared across instances, survives restarts)
class RedisRateLimitStore implements RateLimitStore {
    private prefix = "trpc_rl:";
    constructor(private redis: Redis) {}

    // Lua script: atomically increment counter, initialising if expired/missing
    private static INCR_LUA = `
        local key = KEYS[1]
        local ttlSec = tonumber(ARGV[1])
        local windowMs = tonumber(ARGV[2])
        local now = tonumber(ARGV[3])
        local raw = redis.call("GET", key)
        if raw then
            local entry = cjson.decode(raw)
            if now > entry.resetAt then
                entry = { count = 1, resetAt = now + windowMs, blocked = false }
            else
                entry.count = entry.count + 1
            end
            redis.call("SET", key, cjson.encode(entry), "EX", ttlSec)
            return cjson.encode(entry)
        else
            local entry = { count = 1, resetAt = now + windowMs, blocked = false }
            redis.call("SET", key, cjson.encode(entry), "EX", ttlSec)
            return cjson.encode(entry)
        end
    `;

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

    async incr(key: string, ttlMs: number, windowMs: number): Promise<RateLimitEntry> {
        const ttlSec = Math.max(Math.ceil(ttlMs / 1000), 1);
        const now = Date.now();
        try {
            const raw = await this.redis.eval(
                RedisRateLimitStore.INCR_LUA, 1,
                this.prefix + key, ttlSec, windowMs, now,
            ) as string;
            return JSON.parse(raw);
        } catch {
            // Fallback: non-atomic get+set if Lua fails
            const entry = await this.get(key);
            if (!entry || now > entry.resetAt) {
                const fresh: RateLimitEntry = { count: 1, resetAt: now + windowMs, blocked: false };
                await this.set(key, fresh, ttlMs);
                return fresh;
            }
            entry.count++;
            await this.set(key, entry, entry.resetAt - now);
            return entry;
        }
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

    // Check if currently blocked (read-only fast path)
    const existing = await store.get(key);
    if (existing?.blocked) {
        const blockExpiry = existing.resetAt + AUTH_RATE_LIMIT.blockDurationMs;
        if (now < blockExpiry) {
            const minutesLeft = Math.ceil((blockExpiry - now) / 60000);
            throw new TRPCError({
                code: "TOO_MANY_REQUESTS",
                message: `Demasiados intentos fallidos. Cuenta bloqueada por ${minutesLeft} minutos.`,
            });
        }
        // Block expired — reset below via incr
    }

    // Atomically increment counter (safe under concurrency)
    const entry = await store.incr(key, AUTH_RATE_LIMIT.windowMs, AUTH_RATE_LIMIT.windowMs);

    if (entry.count > AUTH_RATE_LIMIT.maxAttempts) {
        entry.blocked = true;
        entry.resetAt = now;
        await store.set(key, entry, AUTH_RATE_LIMIT.blockDurationMs);
        throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Demasiados intentos fallidos. Cuenta bloqueada por ${AUTH_RATE_LIMIT.blockDurationMs / 60000} minutos.`,
        });
    }
}

/**
 * Rate limit general para procedimientos
 */
export async function generalRateLimit(identifier: string): Promise<void> {
    const key = `general:${identifier}`;

    // Atomically increment counter (safe under concurrency)
    const entry = await store.incr(key, GENERAL_RATE_LIMIT.windowMs, GENERAL_RATE_LIMIT.windowMs);

    if (entry.count > GENERAL_RATE_LIMIT.maxRequests) {
        throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Demasiadas peticiones. Por favor intenta más tarde.",
        });
    }
}

/**
 * Limpia el rate limit para un identificador específico
 * Útil después de un login exitoso
 */
export function clearRateLimit(identifier: string, type: 'auth' | 'general' = 'auth'): void {
    const key = `${type}:${identifier}`;
    store.del(key).catch(() => { /* ignore */ });
}

/**
 * Clear all rate-limit entries whose key starts with a given prefix.
 * Used at bootstrap to unblock the admin email regardless of IP.
 */
export async function clearRateLimitByPrefix(prefix: string): Promise<void> {
    // Memory store: iterate map
    if (store instanceof MemoryStore) {
        const fullPrefix = `auth:${prefix}`;
        for (const key of (store as any).map.keys()) {
            if (key.startsWith(fullPrefix)) {
                store.del(key).catch(() => {});
            }
        }
        return;
    }
    // Redis store: SCAN for matching keys
    if (store instanceof RedisRateLimitStore) {
        try {
            const redis = (store as any).redis as Redis;
            const pattern = `trpc_rl:auth:${prefix}*`;
            let cursor = "0";
            do {
                const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
                cursor = next;
                if (keys.length > 0) await redis.del(...keys);
            } while (cursor !== "0");
        } catch { /* swallow */ }
    }
}
