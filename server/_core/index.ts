import "dotenv/config";
import * as Sentry from "@sentry/node";
import crypto from "crypto";
import express from "express";
import promClient from "prom-client";
import { createServer } from "http";
import net from "net";
import cors from "cors";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerDevBypass } from "./dev-bypass";
import { registerNativeOAuth } from "./native-oauth";
import { registerWhatsAppWebhookRoutes } from "../whatsapp/webhook";
import { registerEmbeddedSignupRoutes } from "../whatsapp/embedded-signup";
import { registerMetaRoutes } from "../meta-routes";
import { registerPayPalWebhookRoutes } from "../routers/paypal-webhook";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./serve-static";
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { appSettings } from "../../drizzle/schema";
import { initReminderScheduler } from "../reminderScheduler";
import { startCampaignWorker } from "../services/campaign-worker";
import { startLogCleanup } from "../services/cleanup-logs";
import { startAutoBackup } from "../services/auto-backup";
import { startSessionCleanup } from "../services/cleanup-sessions";
import { startWorkflowPoller } from "../services/workflow-poller";
import { startTicketStatusWorker } from "../services/ticket-status-worker";
import { startRemindersWorker } from "../services/reminders-worker";
import { startWarmupScheduler } from "../services/warmup-scheduler";
import { runMigrations } from "../scripts/migrate";
import { validateProductionSecrets } from "./validate-env";
import { assertDbConstraints } from "../services/assert-db";
import { assertEnv } from "./assert-env";
import { logger, safeError } from "./logger";
import { registerTestRoutes } from "./test-routes";
import { initWebSocket } from "../services/websocket";
import { validateEnvironment } from "./env-validation";
import { validateCriticalEnv } from "./env";

// Validate environment variables before starting
validateEnvironment();
validateCriticalEnv();

// Modular Imports
import { requireAuthMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { uploadMiddleware, handleUpload, serveUpload } from "../controllers/upload.controller";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

export async function createApp() {
  // CRITICAL: Validate production secrets BEFORE starting server
  validateProductionSecrets();

  // CRITICAL: Ensure DB is hardened
  await assertDbConstraints();

  const sentryDsn = process.env.SENTRY_DSN;

  if (sentryDsn) {
    try {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || "development",
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
        integrations: [
          // nodeProfilingIntegration(),
        ],
      });
      logger.info("sentry enabled");
    } catch (e) {
      logger.error({ err: safeError(e) }, "sentry init failed");
    }
  }

  const app = express();
  const isProd = process.env.NODE_ENV === "production";

  app.disable("x-powered-by");

  // Trust Proxy Config (must be before rate limiter so req.ip is correct)
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
    logger.info({ trustProxy: true }, "trust proxy enabled");
  }

  // Security Headers (Helmet) — CSP nonce set per-request in serve-static.ts
  app.use(helmet({
    contentSecurityPolicy: false, // Managed per-request with nonce in serve-static.ts
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  }));

  // CORS Config
  app.use(cors({
    origin: (origin, callback) => {
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      if (!origin) return callback(null, true);

      const normalize = (url: string) => url ? url.replace(/\/$/, "") : "";
      const allowedOrigins = [
        process.env.CLIENT_URL,
        process.env.VITE_API_URL,
        process.env.VITE_OAUTH_PORTAL_URL,
      ].filter(Boolean).map(url => normalize(url!));

      if (allowedOrigins.includes(normalize(origin))) {
        callback(null, true);
      } else {
        logger.warn({ origin, allowedOrigins }, "cors blocked - origin mismatch");
        callback(new Error(`Not allowed by CORS. Origin: ${origin}. Allowed: ${allowedOrigins.join(", ")}`));
      }
    },
    credentials: true,
  }));

  // CSRF Protection (Same-Site Guard)
  const allowedSet = new Set([
    process.env.CLIENT_URL,
    process.env.VITE_API_URL,
    process.env.VITE_OAUTH_PORTAL_URL,
  ].filter(Boolean) as string[]);

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/whatsapp") || req.path.startsWith("/api/webhooks") || req.path.startsWith("/api/meta")) {
      return next();
    }
    const method = req.method.toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();
    if (process.env.NODE_ENV !== "production") return next();

    const origin = req.headers.origin;
    if (!origin || !allowedSet.has(origin)) {
      logger.warn({ origin }, "csrf blocked");
      return res.status(403).json({ error: "CSRF blocked" });
    }
    next();
  });

  // Request ID
  app.use((req, res, next) => {
    const id = crypto.randomUUID();
    (req as any).requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  // Structured request logging (no bodies)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info({
        requestId: (req as any).requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        ms: Date.now() - start,
      }, 'http request');
    });
    next();
  });

  // Rate Limiting (AFTER logging so 429 responses are visible in logs)
  app.use(rateLimitMiddleware);

  // Idempotency (Modular)
  try {
    const { idempotencyMiddleware } = await import("./middleware/idempotency");
    app.use(idempotencyMiddleware);
  } catch (e) {
    logger.warn({ err: safeError(e) }, "idempotency middleware load failed, skipping");
  }

  // Body Parsing
  // Keep raw body for WhatsApp signature verification
  app.use(express.json({
    limit: "50kb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ limit: "50kb", extended: true }));

  // Routes
  app.get("/api/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/readyz", async (_req, res) => {
    try {
      const db = await getDb();
      if (db) {
        await db.execute(sql`SELECT 1`);
        return res.status(200).json({ ok: true, db: true });
      }
      return res.status(503).json({ ok: false, db: false });
    } catch (_err) {
      return res.status(503).json({ ok: false, db: false });
    }
  });

  // Prometheus metrics
  const metricsRegister = new promClient.Registry();
  promClient.collectDefaultMetrics({ register: metricsRegister });

  const httpRequestDuration = new promClient.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [metricsRegister],
  });

  const httpRequestsTotal = new promClient.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "status_code"] as const,
    registers: [metricsRegister],
  });

  // Instrument incoming requests
  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();
    res.on("finish", () => {
      const route = req.route?.path || req.path;
      end({ method: req.method, route, status_code: res.statusCode });
      httpRequestsTotal.inc({ method: req.method, status_code: res.statusCode });
    });
    next();
  });

  app.get("/metrics", async (_req, res) => {
    try {
      res.set("Content-Type", metricsRegister.contentType);
      res.end(await metricsRegister.metrics());
    } catch (_err) {
      res.status(500).end();
    }
  });

  // Dev Bypass (debe ir antes que todo para interceptar)
  registerDevBypass(app);

  // OAuth & Webhooks
  registerNativeOAuth(app);
  registerOAuthRoutes(app);
  registerWhatsAppWebhookRoutes(app);
  registerEmbeddedSignupRoutes(app);
  registerMetaRoutes(app);
  registerPayPalWebhookRoutes(app);
  registerTestRoutes(app);

  // File Uploads (Modular)
  // Serve uploaded files securely
  app.get("/api/uploads/:name", requireAuthMiddleware, serveUpload);

  // Handle new uploads
  app.post('/api/upload', requireAuthMiddleware, uploadMiddleware.array('files'), handleUpload);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path, req }) {
        const requestId = (req as any).requestId;
        logger.error(
          { requestId, err: safeError(error), path, code: error.code },
          `tRPC error on ${path ?? "unknown"}`
        );
        if (process.env.SENTRY_DSN) {
          try {
            Sentry.captureException(error, {
              tags: { requestId, tRPCPath: path },
            });
          } catch { /* ignore */ }
        }
      },
    })
  );

  // Serve Frontend (Vite or Static)
  if (process.env.NODE_ENV === "development") {
    const viteModulePath = "./vite";
    const { setupVite } = await import(viteModulePath);
    await setupVite(app);
  } else {
    serveStatic(app);
  }

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const requestId = (req as any).requestId;
    logger.error({ requestId, err: safeError(err), path: req.originalUrl || req.url, method: req.method }, "app error");
    if (process.env.SENTRY_DSN) {
      try {
        Sentry.captureException(err, {
          tags: { requestId },
          extra: { path: req.originalUrl || req.url, method: req.method },
        });
      } catch {
        // ignore
      }
    }
    if (!res.headersSent) {
      res.status(500).send("Internal Application Error");
    }
  });

  return app;
}

async function startServer() {
  const app = await createApp();

  // Start Server
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = process.env.NODE_ENV === "production"
    ? preferredPort
    : await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    logger.warn({ preferredPort, port }, "port busy, using alternative");
  }

  const httpServer = createServer(app);

  // Initialize WebSocket server
  await initWebSocket(httpServer);

  // --- Graceful Shutdown ---
  let isShuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Received shutdown signal — starting graceful shutdown");

    // Stop accepting new connections
    httpServer.close(() => {
      logger.info("HTTP server closed");
    });

    // Give in-flight requests up to 10s to finish
    const forceShutdownTimer = setTimeout(() => {
      logger.warn("Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10_000);
    forceShutdownTimer.unref();

    try {
      // Close DB pool
      const db = await getDb();
      if (db) {
        const pool = (db as any)?._.pool ?? (db as any)?.$pool;
        if (pool?.end) await pool.end();
        logger.info("Database pool closed");
      }
    } catch (e) {
      logger.error({ err: safeError(e) }, "Error closing DB pool during shutdown");
    }

    // Flush Sentry
    if (process.env.SENTRY_DSN) {
      try { await Sentry.close(2000); } catch { /* ignore */ }
    }

    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  httpServer.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "server listening");

    // Background Services
    initReminderScheduler();
    startCampaignWorker();
    startLogCleanup();
    startAutoBackup();
    startSessionCleanup();
    startWorkflowPoller();
    startTicketStatusWorker();
    startRemindersWorker();
    startWarmupScheduler();

    // Database optimization (FULLTEXT indexes)
    import("../services/fulltext-indexes").then(({ createFulltextIndexes }) => {
      createFulltextIndexes().catch(err => logger.error({ err: safeError(err) }, "[FULLTEXT] index creation failed"));
    });

    // Database optimization (covering indexes + CHECK constraints)
    import("../services/db-optimization").then(({ optimizeDatabaseIndexes }) => {
      optimizeDatabaseIndexes().catch(err => logger.error({ err: safeError(err) }, "[DBOptimize] index creation failed"));
    });

    // Archival job (daily cleanup of old messages/logs)
    import("../services/archival-job").then(({ startArchivalJob }) => {
      startArchivalJob();
    }).catch(err => logger.error({ err: safeError(err) }, "[Archival] startup failed"));
    // Start Message Queue Worker
    import("../services/queue-worker").then(({ MessageQueueWorker }) => {
      MessageQueueWorker.getInstance().start();
    }).catch(err => logger.error({ err: safeError(err) }, "[MessageQueue] startup failed"));

    // Restore WhatsApp Sessions
    import("../services/whatsapp-restorer").then(({ startWhatsAppSessions }) => {
      startWhatsAppSessions().catch(err => logger.error({ err: safeError(err) }, "[WhatsAppSession] startup failed"));
    });

    // WhatsApp connection health check (every 5 min)
    import("../services/wa-health-check").then(({ startWAHealthCheck }) => {
      startWAHealthCheck();
    }).catch(err => logger.error({ err: safeError(err) }, "[WAHealthCheck] startup failed"));

    // Application cache (Redis + in-memory fallback)
    import("../services/app-cache").then(({ initCacheRedis }) => {
      initCacheRedis().catch(err => logger.error({ err: safeError(err) }, "[Cache] init failed"));
    });

    // Materialized views (create tables + initial refresh)
    import("../services/materialized-views").then(async ({ createMaterializedViews, refreshMaterializedViews }) => {
      await createMaterializedViews();
      await refreshMaterializedViews();
      // Refresh every 15 minutes
      setInterval(() => refreshMaterializedViews().catch(err => logger.warn({ err: safeError(err) }, "[MV] periodic refresh failed")), 15 * 60 * 1000);
    }).catch(err => logger.error({ err: safeError(err) }, "[MV] startup failed"));

    // APM (Sentry performance monitoring)
    import("../services/apm").then(({ initAPM }) => {
      initAPM();
    }).catch(err => logger.error({ err: safeError(err) }, "[APM] startup failed"));

    // SuperAdmin tables init (internalNotes column, platform_announcements, feature_flags)
    import("../services/superadmin-init").then(({ ensureSuperadminTables }) => {
      ensureSuperadminTables().catch(err => logger.error({ err: safeError(err) }, "[SuperadminInit] startup failed"));
    });
  });
}

/**
 * Idempotent bootstrap: ensures the admin user from env vars exists.
 * Safe to call on every startup — inserts or updates.
 */
async function bootstrapAdmin() {
  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const pass  = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim();
  if (!email || !pass) {
    logger.warn("startup: BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set — skipping admin bootstrap");
    return;
  }

  const tenantId = Number(process.env.BOOTSTRAP_ADMIN_TENANT_ID ?? "1");
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    logger.warn("startup: invalid BOOTSTRAP_ADMIN_TENANT_ID — skipping admin bootstrap");
    return;
  }

  try {
    const { default: bcrypt } = await import("bcryptjs");
    const { nanoid }          = await import("nanoid");
    const { users }           = await import("../../drizzle/schema");
    const { and, eq }         = await import("drizzle-orm");

    const db = await getDb();
    if (!db) { logger.warn("startup: DB unavailable — skipping admin bootstrap"); return; }

    const hashed = await bcrypt.hash(pass, 12);
    
    // First: check if user exists in the target platform tenant
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
      .limit(1);

    if (existing.length > 0) {
      await db.update(users)
        .set({ password: hashed, role: "owner", loginMethod: "credentials", isActive: true, updatedAt: new Date() } as any)
        .where(eq(users.id, existing[0].id));
      logger.info({ email, tenantId }, "startup: admin user password/role updated to owner");
    } else {
      // Check if user exists in ANY tenant (e.g. created via signup on tenant 2)
      const existingGlobal = await db
        .select({ id: users.id, tenantId: users.tenantId })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingGlobal.length > 0 && existingGlobal[0].tenantId !== tenantId) {
        // Move user to platform tenant and promote to owner
        logger.warn({ email, oldTenantId: existingGlobal[0].tenantId, newTenantId: tenantId }, "startup: admin user found in wrong tenant — reassigning to platform tenant");
        await db.update(users)
          .set({ tenantId, password: hashed, role: "owner", loginMethod: "credentials", isActive: true, updatedAt: new Date() } as any)
          .where(eq(users.id, existingGlobal[0].id));
      } else if (existingGlobal.length === 0) {
        await db.insert(users).values({
          tenantId,
          openId: `local_${nanoid(16)}`,
          name: "Admin",
          email,
          password: hashed,
          role: "owner",
          loginMethod: "credentials",
          isActive: true,
          hasSeenTour: false,
        });
        logger.info({ email, tenantId }, "startup: admin user created");
      }
    }

    // Verify the password works after storing it
    const verify = await db
      .select({ id: users.id, password: users.password })
      .from(users)
      .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
      .limit(1);
    if (verify[0]?.password) {
      const ok = await bcrypt.compare(pass, verify[0].password);
      logger.info({ email, tenantId, passwordVerified: ok }, "startup: admin password verification");
      if (!ok) {
        logger.error({ email, tenantId }, "startup: CRITICAL — password verification failed after bootstrap! Re-hashing...");
        const rehash = await bcrypt.hash(pass, 12);
        await db.update(users).set({ password: rehash } as any).where(eq(users.id, verify[0].id));
      }
    }

    // Clear any rate-limit blocks accumulated for the admin email
    try {
      const { clearRateLimitByPrefix } = await import("./trpc-rate-limit");
      await clearRateLimitByPrefix(`${email}:`);
      // Also clear with just email (no colon suffix) for broader matching
      await clearRateLimitByPrefix(email);
      logger.info("startup: cleared tRPC rate-limit entries for admin email");
    } catch { /* rate limit module not ready yet — harmless */ }

    // Clear Express-level rate limit keys in Redis (uses the same client as the middleware)
    try {
      const { clearAllExpressRateLimits } = await import("./middleware/rate-limit");
      await clearAllExpressRateLimits();
    } catch { /* non-fatal */ }
  } catch (e) {
    logger.error({ err: safeError(e) }, "startup: admin bootstrap failed (non-fatal)");
  }
}

const run = async () => {
  logger.info("startup: server version modular-v2");
  assertEnv();

  // --- Process-level crash handlers ---
  process.on("uncaughtException", (err) => {
    logger.fatal({ err: safeError(err) }, "Uncaught exception — shutting down");
    if (process.env.SENTRY_DSN) {
      try { Sentry.captureException(err); } catch { /* ignore */ }
    }
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: safeError(reason) }, "Unhandled rejection");
    if (process.env.SENTRY_DSN) {
      try { Sentry.captureException(reason); } catch { /* ignore */ }
    }
    // In production, exit to let PM2/Docker restart the process
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  });

  if (process.env.RUN_MIGRATIONS === "1") {
    try {
      logger.info("startup: starting database migration");
      await runMigrations();
      logger.info("startup: database migration completed");
    } catch (e) {
      logger.fatal({ err: safeError(e) }, "startup: auto-migration failed");
      process.exit(1);
    }
  }

  // Always ensure bootstrap admin exists (idempotent)
  await bootstrapAdmin();

  await startServer();
  await ensureAppSettings();
};

// Only run if called directly (not imported)
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((e) => { logger.fatal({ err: safeError(e) }, 'startup failed'); process.exit(1); });
}

async function ensureAppSettings() {
  const db = await getDb();
  if (!db) return;

  try {
    const rows = await db.select().from(appSettings).limit(1);
    if (rows.length === 0) {
      logger.info("seed: appSettings empty, creating defaults");
      await db.insert(appSettings).values({
        tenantId: 1,
        companyName: "Imagine Lab CRM",
        timezone: "America/Asuncion",
        language: "es",
        currency: "PYG",
        permissionsMatrix: {
          owner: ["*"],
          admin: [
            "dashboard.*",
            "leads.*",
            "kanban.*",
            "campaigns.*",
            "chat.*",
            "helpdesk.*",
            "scheduling.*",
            "monitoring.*",
            "analytics.*",
            "reports.*",
            "integrations.*",
            "settings.*",
            "users.*",
          ],
          supervisor: [
            "dashboard.view",
            "leads.view",
            "kanban.view",
            "chat.*",
            "helpdesk.*",
            "monitoring.*",
            "analytics.view",
            "reports.view",
          ],
          agent: ["dashboard.view", "leads.*", "kanban.view", "chat.*",
            "helpdesk.*", "scheduling.*"],
          viewer: ["dashboard.view", "leads.view", "kanban.view", "analytics.view", "reports.view"],
        },
        scheduling: { slotMinutes: 15, maxPerSlot: 6, allowCustomTime: true },
        salesConfig: { defaultCommissionRate: 0, currencySymbol: "₲", requireValueOnWon: false },
        chatDistributionConfig: { mode: "manual", excludeAgentIds: [] },
      });
      logger.info("seed: appSettings seeded");
    }
  } catch (e) {
    logger.error({ err: safeError(e) }, "seed: appSettings failed");
  }
}

