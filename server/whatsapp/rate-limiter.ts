/**
 * Simple per-phoneNumberId token bucket rate limiter for outbound Meta Cloud API calls.
 * Meta allows ~80 messages/second per phone number (business tier).
 * We use a conservative limit to stay safely within bounds.
 */

import { logger } from "../_core/logger";

const DEFAULT_MAX_TOKENS = 60;        // max burst per phone number
const DEFAULT_REFILL_PER_SEC = 50;    // refill rate per second
const DEFAULT_TIMEOUT_MS = 10_000;    // max wait time before rejecting

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

function getBucket(phoneNumberId: string): Bucket {
  let bucket = buckets.get(phoneNumberId);
  if (!bucket) {
    bucket = { tokens: DEFAULT_MAX_TOKENS, lastRefill: Date.now() };
    buckets.set(phoneNumberId, bucket);
  }
  return bucket;
}

function refill(bucket: Bucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(DEFAULT_MAX_TOKENS, bucket.tokens + elapsed * DEFAULT_REFILL_PER_SEC);
  bucket.lastRefill = now;
}

/**
 * Acquire a token from the rate limiter for the given phoneNumberId.
 * If the bucket is empty, waits until a token is available (up to timeout).
 * Throws if timeout is exceeded.
 */
export async function acquireSendToken(phoneNumberId: string): Promise<void> {
  const bucket = getBucket(phoneNumberId);
  refill(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return;
  }

  // Wait for a token to become available
  const start = Date.now();
  return new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      refill(bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - start > DEFAULT_TIMEOUT_MS) {
        clearInterval(interval);
        logger.warn({ phoneNumberId }, "[RateLimit] Meta API send token timeout — throttling");
        reject(new Error("Meta API rate limit: too many messages, try again later"));
      }
    }, 100);
  });
}
