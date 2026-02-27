import { getDb } from "../db";
import { sessions } from "../../drizzle/schema";
import { lt } from "drizzle-orm";

import { logger } from "../_core/logger";

// Run every hour
const INTERVAL_MS = 60 * 60 * 1000;

export function startSessionCleanup() {
    logger.info("[System] Starting session cleanup service...");

    // Run immediately mostly for dev feedback, but maybe safer to wait
    runCleanup();

    setInterval(runCleanup, INTERVAL_MS);
}

async function runCleanup() {
    try {
        const db = await getDb();
        if (!db) return;

        const now = new Date();
        // Delete sessions where expiresAt < now
        const result = await db.delete(sessions).where(lt(sessions.expiresAt, now));

        //logger.info(`[Cleanup] Removed expired sessions.`);
    } catch (error) {
        logger.error("[Cleanup] Failed to cleanup sessions:", error);
    }
}
