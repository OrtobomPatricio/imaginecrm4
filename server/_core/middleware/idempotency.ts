import { Request, Response, NextFunction } from "express";
import Redis from "ioredis";
import { logger } from "../logger";

const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : undefined;

if (redisClient) {
    redisClient.on("error", (err) => logger.error("[Idempotency] Redis Error", err));
}

/**
 * Idempotency Middleware
 * 
 * Prevents duplicate execution of POST/PUT/PATCH/DELETE requests.
 * Expects 'X-Idempotency-Key' header from the client.
 * Keys expire after 24 hours.
 */
export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        return next();
    }

    const key = req.headers["x-idempotency-key"] as string;
    if (!key) {
        return next();
    }

    if (!redisClient) {
        logger.warn("[Idempotency] Skipped - Redis not configured");
        return next();
    }

    const tenantId = (req as any).user?.tenantId || "unknown";
    const idempotencyKey = `idempotency:${tenantId}:${key}`;

    try {
        const existing = await redisClient.get(idempotencyKey);
        if (existing) {
            logger.info({ idempotencyKey, path: req.path }, "[Idempotency] Duplicate request blocked");
            // If we found a key, the request is already being processed or finished.
            // In a pro implementation, we'd store the result and replay it.
            // For now, we return 409 Conflict or 202 if just retried too fast.
            return res.status(409).json({
                error: "conflict",
                message: "This request is already being processed or was already completed."
            });
        }

        // Set key with 24h expiration
        await redisClient.set(idempotencyKey, "processing", "EX", 86400);

        // Wrap res.send to update the status in Redis if needed (optional stage 2)
        next();
    } catch (err) {
        logger.error({ err }, "[Idempotency] Middleware error");
        next();
    }
};
