import session from "express-session";
import Redis from "ioredis";
import { logger } from "./logger";

const PREFIX = "sess:";
const FALLBACK_TTL_SECONDS = 24 * 60 * 60;

class RedisSessionStore extends session.Store {
  constructor(private client: Redis, private prefix: string = PREFIX) {
    super();
  }

  private key(sid: string): string {
    return `${this.prefix}${sid}`;
  }

  private ttlSeconds(sess: session.SessionData): number {
    const maxAge = sess?.cookie?.maxAge;
    if (typeof maxAge === "number" && maxAge > 0) {
      return Math.max(1, Math.floor(maxAge / 1000));
    }
    return FALLBACK_TTL_SECONDS;
  }

  get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void): void {
    this.client
      .get(this.key(sid))
      .then((raw) => {
        if (!raw) {
          callback(undefined, null);
          return;
        }
        callback(undefined, JSON.parse(raw));
      })
      .catch((err) => callback(err));
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: any) => void): void {
    const ttl = this.ttlSeconds(sess);
    this.client
      .set(this.key(sid), JSON.stringify(sess), "EX", ttl)
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    this.client
      .del(this.key(sid))
      .then(() => callback?.())
      .catch((err) => callback?.(err));
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    const ttl = this.ttlSeconds(sess);
    this.client
      .expire(this.key(sid), ttl)
      .then(() => callback?.())
      .catch(() => callback?.());
  }
}

let sharedClient: Redis | null = null;
let sharedStore: session.Store | null = null;

export function createOAuthSessionStore(): session.Store | undefined {
  const redisUrl = process.env.REDIS_URL;
  const isProd = process.env.NODE_ENV === "production";
  const requireRedis = process.env.REQUIRE_REDIS_IN_PROD === "1";

  if (!redisUrl) {
    if (isProd && requireRedis) {
      throw new Error("REDIS_URL is required in production when REQUIRE_REDIS_IN_PROD=1 (OAuth session store)");
    }
    if (isProd) {
      logger.warn("[OAuthSession] REDIS_URL not set in production, falling back to MemoryStore");
    }
    return undefined;
  }

  if (sharedStore) return sharedStore;

  sharedClient = new Redis(redisUrl, {
    keyPrefix: "",
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 200, 3000),
  });

  sharedClient.on("connect", () => {
    logger.info("[OAuthSession] Redis connected");
  });

  sharedClient.on("error", (err) => {
    logger.error({ err }, "[OAuthSession] Redis error");
  });

  sharedStore = new RedisSessionStore(sharedClient);
  return sharedStore;
}
