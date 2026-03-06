import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { InsertUser, users, tenants, appSettings, termsAcceptance } from "../drizzle/schema";
import { ENV } from './_core/env';

import { logger } from "./_core/logger";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
// Lazily create the drizzle instance so local tooling can run without a DB.
let _pool: mysql.Pool | null = null;
let _mockDbLoader: Promise<{ getDb: () => Promise<any> }> | null = null;

async function loadMockDb() {
  if (!_mockDbLoader) {
    _mockDbLoader = import("./db-mock");
  }
  return _mockDbLoader;
}

export async function getDb() {
  if (_db) return _db;

  const isProd = process.env.NODE_ENV === "production";
  const explicitMockRequested = process.env.USE_MOCK_DB === "true";
  const allowMockDb = !isProd && (process.env.ALLOW_MOCK_DB === "1" || process.env.NODE_ENV === "test" || explicitMockRequested);

  if (isProd && explicitMockRequested) {
    logger.error("[Database] USE_MOCK_DB=true is not allowed in production. Ignoring mock mode.");
  }

  if (!process.env.DATABASE_URL) {
    if (allowMockDb) {
      logger.info("[Database] Using MOCK database (no DATABASE_URL and mock explicitly enabled)");
      const mockDb = await loadMockDb();
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
        // Enable SSL/TLS only when explicitly requested (DB_SSL=1)
        // Internal Docker connections (e.g. EasyPanel) don't need SSL
        ...(process.env.DB_SSL === "1" ? { ssl: { rejectUnauthorized: true } } : {}),
      });
    }

    // Health check
    const connection = await _pool.getConnection();
    await connection.ping();
    connection.release();

    _db = drizzle(_pool as any);
    logger.info("[Database] MySQL connection initialized successfully.");
  } catch (error) {
    logger.error({ err: error }, "[Database] MySQL Connection FAILURE");
    if (isProd) {
      logger.error("[Database] Production mode forbids mock DB fallback. Exiting.");
      process.exit(1);
    }
    if (allowMockDb) {
      logger.info("[Database] Falling back to MOCK database (explicitly enabled for non-production)...");
      const mockDb = await loadMockDb();
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
  if (usersByEmail.length === 1) {
    const matched = usersByEmail[0];
    // Only link the new openId if no other user already owns it (prevent identity collision)
    const existingOwner = await getUserByOpenId(openId);
    if (existingOwner && existingOwner.id !== matched.id) {
      logger.warn({ openId, matchedUserId: matched.id, existingOwnerId: existingOwner.id },
        "[OAuth] openId already belongs to another user — skipping link");
      return null;
    }
    // Link the OAuth provider's openId so future logins are direct (no email fallback)
    if (!existingOwner) {
      const database = await getDb();
      if (database) {
        await database.update(users)
          .set({ openId })
          .where(eq(users.id, matched.id));
        matched.openId = openId;
      }
    }
    return matched;
  }
  if (usersByEmail.length > 1) {
    const err = new Error("OAuth user is ambiguous across tenants");
    (err as any).code = "AMBIGUOUS_TENANT";
    throw err;
  }

  return null;
}

const TRIAL_DAYS = 14;
const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "superadmin", "platform", "system",
  "support", "help", "billing", "mail", "ftp", "ssh", "test",
  "staging", "dev", "demo", "status", "docs", "blog", "cdn",
]);
const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  owner: ["*"],
  admin: [
    "dashboard.*", "leads.*", "kanban.*", "campaigns.*", "chat.*",
    "helpdesk.*", "scheduling.*", "monitoring.*", "analytics.*",
    "reports.*", "integrations.*", "settings.*", "users.*", "backups.*",
  ],
  supervisor: [
    "dashboard.view", "leads.view", "leads.update", "leads.create",
    "kanban.view", "kanban.update", "chat.*", "helpdesk.*",
    "monitoring.*", "analytics.view", "reports.view", "scheduling.view",
  ],
  agent: [
    "dashboard.view", "leads.view", "leads.create", "leads.update",
    "leads.edit", "kanban.view", "kanban.update", "chat.view",
    "chat.send", "helpdesk.view", "scheduling.*",
  ],
  viewer: [
    "dashboard.view", "leads.view", "kanban.view",
    "analytics.view", "reports.view", "helpdesk.view",
  ],
};

/**
 * Auto-provision a new tenant + owner for an OAuth user who doesn't exist yet.
 * Controlled by OAUTH_AUTO_REGISTER=true env var.
 * Returns the newly created user record, or null if auto-register is disabled.
 */
export async function autoProvisionOAuthUser(oauthUser: { openId: string; name?: string; email?: string; platform?: string }) {
  if (process.env.OAUTH_AUTO_REGISTER !== "true") return null;
  if (!oauthUser.email) return null;

  const database = await getDb();
  if (!database) return null;

  // Check email uniqueness before creating
  const existingByEmail = await database.select({ id: users.id }).from(users)
    .where(eq(users.email, oauthUser.email.trim().toLowerCase())).limit(1);
  if (existingByEmail.length > 0) return null;

  const displayName = oauthUser.name || oauthUser.email.split("@")[0];
  const slug = nanoid(10).toLowerCase();

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  let tenantId = 0;

  await database.transaction(async (tx) => {
    const tenantResult = await tx.insert(tenants).values({
      name: `${displayName}'s Workspace`,
      slug,
      plan: "pro",
      status: "active",
      trialEndsAt: trialEnd,
    });
    tenantId = tenantResult[0].insertId;

    await tx.insert(users).values({
      tenantId,
      openId: oauthUser.openId,
      name: displayName,
      email: oauthUser.email!.trim().toLowerCase(),
      loginMethod: oauthUser.platform || "oauth",
      role: "owner",
      isActive: true,
      emailVerified: true,
    });

    await tx.insert(appSettings).values({
      tenantId,
      companyName: `${displayName}'s Workspace`,
      permissionsMatrix: DEFAULT_PERMISSIONS,
      scheduling: { slotMinutes: 15, maxPerSlot: 6, allowCustomTime: true },
    });
  });

  logger.info({ tenantId, email: oauthUser.email, platform: oauthUser.platform }, "[OAuth] Auto-provisioned new tenant");

  return getUserByOpenId(oauthUser.openId);
}

/**
 * Create a new tenant + owner from OAuth signup with user-provided company data.
 * Like email signup but uses OAuth identity instead of password.
 */
export async function createOAuthSignupTenant(
  oauthUser: { openId: string; name?: string; email?: string; platform?: string },
  signup: { companyName: string; slug: string; timezone?: string; language?: string; currency?: string; termsVersion?: string }
) {
  if (!oauthUser.email) return null;

  const database = await getDb();
  if (!database) return null;

  const normalizedEmail = oauthUser.email.trim().toLowerCase();
  const slugRegex = /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/;
  if (!slugRegex.test(signup.slug)) return null;
  if (RESERVED_SLUGS.has(signup.slug)) return null;

  const existingTenants = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, signup.slug)).limit(1);
  if (existingTenants.length > 0) return null;

  const existingUsers = await database.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existingUsers.length > 0) return null;

  const displayName = oauthUser.name || normalizedEmail.split("@")[0];
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  await database.transaction(async (tx) => {
    const tenantResult = await tx.insert(tenants).values({
      name: signup.companyName,
      slug: signup.slug,
      plan: "pro",
      status: "active",
      trialEndsAt: trialEnd,
    });
    const tenantId = tenantResult[0].insertId;

    await tx.insert(users).values({
      tenantId,
      openId: oauthUser.openId,
      name: displayName,
      email: normalizedEmail,
      loginMethod: oauthUser.platform || "oauth",
      role: "owner",
      isActive: true,
      emailVerified: true,
    });

    // Record terms acceptance
    if (signup.termsVersion) {
      const userRow = await tx.select({ id: users.id }).from(users)
        .where(eq(users.openId, oauthUser.openId)).limit(1);
      if (userRow[0]) {
        await tx.insert(termsAcceptance).values({
          tenantId,
          userId: userRow[0].id,
          termsVersion: signup.termsVersion,
          ipAddress: null,
          userAgent: null,
        });
      }
    }

    await tx.insert(appSettings).values({
      tenantId,
      companyName: signup.companyName,
      timezone: signup.timezone || "America/Asuncion",
      language: signup.language || "es",
      currency: signup.currency || "USD",
      permissionsMatrix: DEFAULT_PERMISSIONS,
      scheduling: { slotMinutes: 15, maxPerSlot: 6, allowCustomTime: true },
    });
  });

  logger.info({ email: normalizedEmail, platform: oauthUser.platform, slug: signup.slug }, "[OAuth Signup] Created new tenant");
  return getUserByOpenId(oauthUser.openId);
}

// Feature queries are defined in their respective routers and services.
