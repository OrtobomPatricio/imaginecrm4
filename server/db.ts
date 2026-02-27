import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import * as mockDb from './db-mock';

import { logger } from "./_core/logger";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
// Lazily create the drizzle instance so local tooling can run without a DB.
let _pool: mysql.Pool | null = null;

export async function getDb() {
  if (_db) return _db;

  const isProd = process.env.NODE_ENV === "production";
  const allowMockDb = !isProd && (process.env.ALLOW_MOCK_DB === "1" || process.env.NODE_ENV === "test");

  if (!process.env.DATABASE_URL) {
    if (allowMockDb || process.env.USE_MOCK_DB === "true") {
      logger.info("[Database] Using MOCK database (no DATABASE_URL and mock explicitly enabled)");
      _db = await mockDb.getDb();
      return _db;
    }
    if (isProd) {
      logger.error("[Database] DATABASE_URL missing in production. Exiting.");
      process.exit(1);
    }
  }

  try {
    if (!_pool) {
      logger.info("[Database] Initializing MySQL connection pool...");
      _pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        multipleStatements: false,
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        idleTimeout: 60000,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
      });
    }

    // Health check
    const connection = await _pool.getConnection();
    await connection.ping();
    connection.release();

    _db = drizzle(_pool as any);
    logger.info("[Database] MySQL connection initialized successfully.");
  } catch (error) {
    logger.error("[Database] MySQL Connection FAILURE:", error);
    if (isProd) {
      logger.error("[Database] Production mode forbids mock DB fallback. Exiting.");
      process.exit(1);
    }
    if (allowMockDb || process.env.USE_MOCK_DB === "true") {
      logger.info("[Database] Falling back to MOCK database (explicitly enabled for non-production)...");
      _db = await mockDb.getDb();
    } else {
      throw error;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  if (!user.tenantId) {
    throw new Error("User tenantId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    logger.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      tenantId: user.tenantId,
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'owner';
      updateSet.role = 'owner';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    logger.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    logger.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUsersByEmail(email: string) {
  const database = await getDb();
  if (!database) return [];
  return database.select().from(users).where(eq(users.email, email)).limit(10);
}

export async function resolveProvisionedOAuthUser(openId: string, email?: string | null) {
  const userByOpenId = await getUserByOpenId(openId);
  if (userByOpenId) return userByOpenId;

  if (!email) return null;
  const usersByEmail = await getUsersByEmail(email);
  if (usersByEmail.length === 1) return usersByEmail[0];
  if (usersByEmail.length > 1) {
    const err = new Error("OAuth user is ambiguous across tenants");
    (err as any).code = "AMBIGUOUS_TENANT";
    throw err;
  }

  return null;
}

// Feature queries are defined in their respective routers and services.
