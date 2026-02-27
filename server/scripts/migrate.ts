import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "path";
import { fileURLToPath } from "url";

import { logger, safeError } from "../_core/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        logger.error("DATABASE_URL is not defined");
        process.exit(1);
    }

    try {
        const parsed = new URL(connectionString);
        logger.info(
            {
                protocol: parsed.protocol.replace(":", ""),
                host: parsed.hostname,
                port: parsed.port || "3306",
                database: parsed.pathname.replace(/^\//, ""),
                user: parsed.username || "(empty)",
            },
            "[Migration] Connecting to database..."
        );
    } catch {
        logger.warn("[Migration] DATABASE_URL is not a valid URL format");
        logger.info("[Migration] Connecting to database...");
    }

    const connection = await mysql.createConnection({
        uri: connectionString,
        multipleStatements: true,
    });

    const db = drizzle(connection);

    logger.info("[Migration] Running migrations from ./drizzle folder...");

    try {
        await migrate(db, {
            migrationsFolder: path.resolve(process.cwd(), "drizzle")
        });
        await ensureCompatibilitySchema(connection);
        logger.info("[Migration] Success! Database is up to date.");
    } catch (error) {
        logger.error({ err: safeError(error) }, "[Migration] Failed");
        // Do not exit process if imported, let caller handle it? 
        // Or throw.
        throw error;
    } finally {
        await connection.end();
    }
}

async function ensureCompatibilitySchema(connection: mysql.Connection) {
    const hasColumn = async (table: string, column: string) => {
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.columns
             WHERE table_schema = DATABASE()
               AND table_name = ?
               AND column_name = ?`,
            [table, column],
        );
        return Number((rows as Array<{ cnt: number }>)[0]?.cnt ?? 0) > 0;
    };

    const hasTable = async (table: string) => {
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.tables
             WHERE table_schema = DATABASE()
               AND table_name = ?`,
            [table],
        );
        return Number((rows as Array<{ cnt: number }>)[0]?.cnt ?? 0) > 0;
    };

    const ensureColumn = async (
        table: string,
        column: string,
        columnDefinition: string,
        logLabel: string,
    ) => {
        if (!(await hasTable(table))) {
            return;
        }

        if (!(await hasColumn(table, column))) {
            await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN ${columnDefinition}`);
            logger.warn(`[Migration] Patched ${logLabel}`);
        }
    };

    logger.info("[Migration] Running schema compatibility checks...");

    if (!(await hasTable("tenants"))) {
        await connection.query(`
            CREATE TABLE tenants (
              id INT AUTO_INCREMENT PRIMARY KEY,
              name VARCHAR(200) NOT NULL,
              slug VARCHAR(100) NOT NULL,
              plan ENUM('free','starter','pro','enterprise') NOT NULL DEFAULT 'free',
              stripeCustomerId VARCHAR(255) NULL,
              status ENUM('active','suspended','canceled') NOT NULL DEFAULT 'active',
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY idx_tenant_slug (slug)
            )
        `);
        logger.warn("[Migration] Created missing tenants table");
    }

    {
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS cnt FROM tenants WHERE id = 1`
        );
        const hasPlatformTenant = Number((rows as Array<{ cnt: number }>)[0]?.cnt ?? 0) > 0;
        if (!hasPlatformTenant) {
            await connection.query(
                `INSERT INTO tenants (id, name, slug, plan, status) VALUES (1, 'Platform', 'platform', 'enterprise', 'active')`
            );
            logger.warn("[Migration] Seeded platform tenant (id=1)");
        }
    }

    await ensureColumn("users", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "users.tenantId column");
    await ensureColumn("users", "gdprConsentAt", "`gdprConsentAt` TIMESTAMP NULL", "users.gdprConsentAt column");
    await ensureColumn("users", "gdprConsentVersion", "`gdprConsentVersion` VARCHAR(20) NULL", "users.gdprConsentVersion column");
    await ensureColumn("users", "marketingConsent", "`marketingConsent` BOOLEAN NOT NULL DEFAULT FALSE", "users.marketingConsent column");
    await ensureColumn("users", "marketingConsentAt", "`marketingConsentAt` TIMESTAMP NULL", "users.marketingConsentAt column");
    await ensureColumn("users", "dataRetentionUntil", "`dataRetentionUntil` TIMESTAMP NULL", "users.dataRetentionUntil column");

    await ensureColumn("leads", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "leads.tenantId column");
    await ensureColumn("chat_messages", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "chat_messages.tenantId column");
    await ensureColumn("conversations", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "conversations.tenantId column");
    await ensureColumn("pipeline_stages", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "pipeline_stages.tenantId column");

    if (!(await hasTable("lead_reminders"))) {
        await connection.query(`
            CREATE TABLE lead_reminders (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              leadId INT NOT NULL,
              conversationId INT NULL,
              createdById INT NOT NULL,
              scheduledAt TIMESTAMP NOT NULL,
              timezone VARCHAR(50) NULL,
              message TEXT NOT NULL,
              messageType ENUM('text','image','document','template') DEFAULT 'text',
              mediaUrl VARCHAR(500) NULL,
              mediaName VARCHAR(200) NULL,
              buttons JSON NULL,
              status ENUM('scheduled','sent','failed','cancelled') DEFAULT 'scheduled',
              sentAt TIMESTAMP NULL,
              errorMessage TEXT NULL,
              response VARCHAR(200) NULL,
              respondedAt TIMESTAMP NULL,
              isRecurring BOOLEAN DEFAULT FALSE,
              recurrencePattern ENUM('daily','weekly','monthly') NULL,
              recurrenceEndDate TIMESTAMP NULL,
              parentReminderId INT NULL,
              createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
              updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_lead_reminders_tenant_status_scheduledAt (tenantId, status, scheduledAt)
            )
        `);
        logger.warn("[Migration] Created missing lead_reminders table");
    }

    if (!(await hasTable("terms_acceptance"))) {
        await connection.query(`
            CREATE TABLE terms_acceptance (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              userId INT NOT NULL,
              termsVersion VARCHAR(20) NOT NULL,
              acceptedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              ipAddress VARCHAR(45) NULL,
              userAgent TEXT NULL,
              UNIQUE KEY idx_terms_user_version (tenantId, userId, termsVersion)
            )
        `);
        logger.warn("[Migration] Created missing terms_acceptance table");
    }

    if (!(await hasTable("sessions"))) {
        await connection.query(`
            CREATE TABLE sessions (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              userId INT NOT NULL,
              sessionToken VARCHAR(255) NOT NULL,
              ipAddress VARCHAR(45) NULL,
              userAgent TEXT NULL,
              lastActivityAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              expiresAt TIMESTAMP NOT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_sessions_token (sessionToken)
            )
        `);
        logger.warn("[Migration] Created missing sessions table");
    }

    await ensureColumn("sessions", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "sessions.tenantId column");
    await ensureColumn("sessions", "userId", "`userId` INT NOT NULL", "sessions.userId column");
    await ensureColumn("sessions", "sessionToken", "`sessionToken` VARCHAR(255) NOT NULL", "sessions.sessionToken column");
    await ensureColumn("sessions", "lastActivityAt", "`lastActivityAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP", "sessions.lastActivityAt column");
    await ensureColumn("sessions", "expiresAt", "`expiresAt` TIMESTAMP NOT NULL", "sessions.expiresAt column");
    await ensureColumn("sessions", "createdAt", "`createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP", "sessions.createdAt column");

    {
        const [idxRows] = await connection.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'sessions'
               AND index_name = 'uniq_sessions_token'`,
        );
        const hasIdx = Number((idxRows as Array<{ cnt: number }>)[0]?.cnt ?? 0) > 0;
        if (!hasIdx) {
            await connection.query(`ALTER TABLE sessions ADD UNIQUE INDEX uniq_sessions_token (sessionToken)`);
            logger.warn("[Migration] Added missing uniq_sessions_token index");
        }
    }

    await ensureColumn("app_settings", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "app_settings.tenantId column");

    await ensureColumn("app_settings", "singleton", "`singleton` INT NOT NULL DEFAULT 1", "app_settings.singleton column");
    await ensureColumn("app_settings", "securityConfig", "`securityConfig` JSON NULL", "app_settings.securityConfig column");
    await ensureColumn("app_settings", "metaConfig", "`metaConfig` JSON NULL", "app_settings.metaConfig column");

    if (await hasTable("app_settings")) {
        const [idxRows] = await connection.query(
            `SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS cols
             FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'app_settings'
               AND index_name = 'uniq_app_settings_singleton'`,
        );

        const cols = String((idxRows as Array<{ cols: string | null }>)[0]?.cols ?? "");

        if (!cols) {
            await connection.query(
                `ALTER TABLE app_settings
                 ADD UNIQUE INDEX uniq_app_settings_singleton (tenantId, singleton)`
            );
            logger.warn("[Migration] Added missing app_settings uniq_app_settings_singleton (tenantId, singleton)");
        } else if (cols === "singleton") {
            await connection.query(`ALTER TABLE app_settings DROP INDEX uniq_app_settings_singleton`);
            await connection.query(
                `ALTER TABLE app_settings
                 ADD UNIQUE INDEX uniq_app_settings_singleton (tenantId, singleton)`
            );
            logger.warn("[Migration] Rebuilt legacy app_settings uniq_app_settings_singleton to (tenantId, singleton)");
        }
    }

    logger.info("[Migration] Schema compatibility checks completed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations().catch((err) => {
        logger.error({ err: safeError(err) }, "[Migration] Unhandled error");
        process.exit(1);
    });
}
