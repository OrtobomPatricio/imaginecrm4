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

    logger.info("[Migration] Running schema compatibility checks...");

    if (!(await hasColumn("users", "tenantId"))) {
        await connection.query(`ALTER TABLE users ADD COLUMN tenantId INT NOT NULL DEFAULT 1`);
        logger.warn("[Migration] Patched users.tenantId column");
    }

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

    if (!(await hasColumn("app_settings", "tenantId"))) {
        await connection.query(`ALTER TABLE app_settings ADD COLUMN tenantId INT NOT NULL DEFAULT 1`);
        logger.warn("[Migration] Patched app_settings.tenantId column");
    }

    if (!(await hasColumn("app_settings", "singleton"))) {
        await connection.query(`ALTER TABLE app_settings ADD COLUMN singleton INT NOT NULL DEFAULT 1`);
    }
    if (!(await hasColumn("app_settings", "securityConfig"))) {
        await connection.query(`ALTER TABLE app_settings ADD COLUMN securityConfig JSON NULL`);
    }
    if (!(await hasColumn("app_settings", "metaConfig"))) {
        await connection.query(`ALTER TABLE app_settings ADD COLUMN metaConfig JSON NULL`);
    }

    logger.info("[Migration] Schema compatibility checks completed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations().catch((err) => {
        logger.error({ err: safeError(err) }, "[Migration] Unhandled error");
        process.exit(1);
    });
}
