/**
 * Warm-up Scheduler
 * -----------------
 * Runs once daily to:
 * 1. Increment `warmupDay` for numbers in "warming_up" status (up to 28 days).
 * 2. Scale `dailyMessageLimit` from 20 → 1000 over the 28-day ramp.
 * 3. Transition numbers to "active" once warmup is complete.
 * 4. Reset `messagesSentToday` for ALL numbers (daily counter reset).
 */

import { eq, and, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { whatsappNumbers } from "../../drizzle/schema";
import { logger, safeError } from "../_core/logger";

const WARMUP_DAYS = 28;
const MIN_LIMIT = 20;
const MAX_LIMIT = 1000;

/** Calculate the daily message limit for a given warmup day (linear ramp). */
function computeLimit(day: number): number {
  if (day >= WARMUP_DAYS) return MAX_LIMIT;
  return Math.min(MAX_LIMIT, MIN_LIMIT + Math.round((day / WARMUP_DAYS) * (MAX_LIMIT - MIN_LIMIT)));
}

let timer: ReturnType<typeof setInterval> | null = null;

async function runWarmupTick(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // ── 1. Advance warming_up numbers ──
    const warmingNumbers = await db
      .select({
        id: whatsappNumbers.id,
        warmupDay: whatsappNumbers.warmupDay,
      })
      .from(whatsappNumbers)
      .where(
        and(
          eq(whatsappNumbers.status, "warming_up"),
          lt(whatsappNumbers.warmupDay, WARMUP_DAYS)
        )
      );

    for (const num of warmingNumbers) {
      const newDay = num.warmupDay + 1;
      const newLimit = computeLimit(newDay);
      const isGraduated = newDay >= WARMUP_DAYS;

      await db
        .update(whatsappNumbers)
        .set({
          warmupDay: newDay,
          dailyMessageLimit: newLimit,
          ...(isGraduated ? { status: "active" as const } : {}),
        })
        .where(eq(whatsappNumbers.id, num.id));

      if (isGraduated) {
        logger.info({ numberId: num.id, newLimit }, "[WarmupScheduler] Number graduated to active");
      }
    }

    if (warmingNumbers.length > 0) {
      logger.info({ count: warmingNumbers.length }, "[WarmupScheduler] Advanced warmup for numbers");
    }

    // ── 2. Reset messagesSentToday for ALL numbers ──
    await db
      .update(whatsappNumbers)
      .set({ messagesSentToday: 0 })
      .where(sql`1=1`);

    logger.info("[WarmupScheduler] Daily messagesSentToday counter reset");
  } catch (err) {
    logger.error({ err: safeError(err) }, "[WarmupScheduler] Tick failed");
  }
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export function startWarmupScheduler(): void {
  // Run the first tick after a short delay (let the DB fully connect first).
  setTimeout(() => {
    runWarmupTick().catch((e) =>
      logger.error({ err: safeError(e) }, "[WarmupScheduler] Initial tick failed")
    );
  }, 30_000); // 30 s after boot

  // Then repeat every 24 h.
  timer = setInterval(() => {
    runWarmupTick().catch((e) =>
      logger.error({ err: safeError(e) }, "[WarmupScheduler] Tick failed")
    );
  }, TWENTY_FOUR_HOURS);

  logger.info("[WarmupScheduler] Scheduled (every 24 h)");
}

export function stopWarmupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
