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
    const REQUIRED_SCHEMA_TABLES = [
        "access_logs",
        "activity_logs",
        "ai_suggestions",
        "app_settings",
        "appointment_reasons",
        "appointments",
        "campaign_recipients",
        "campaigns",
        "chat_messages",
        "chatbot_flows",
        "conversation_tags",
        "conversations",
        "custom_field_definitions",
        "facebook_pages",
        "file_uploads",
        "forms",
        "integrations",
        "lead_notes",
        "lead_reminders",
        "lead_tags",
        "lead_tasks",
        "leads",
        "license",
        "message_queue",
        "onboarding_progress",
        "pipeline_stages",
        "pipelines",
        "quick_answers",
        "quotations",
        "reminder_templates",
        "sessions",
        "smtp_connections",
        "tags",
        "templates",
        "tenants",
        "terms_acceptance",
        "usage_tracking",
        "users",
        "webhook_deliveries",
        "webhooks",
        "whatsapp_connections",
        "whatsapp_numbers",
        "workflow_jobs",
        "workflow_logs",
        "workflows",
    ] as const;

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

    if (!(await hasTable("onboarding_progress"))) {
        await connection.query(`
            CREATE TABLE onboarding_progress (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              companyCompleted BOOLEAN NOT NULL DEFAULT FALSE,
              teamCompleted BOOLEAN NOT NULL DEFAULT FALSE,
              whatsappCompleted BOOLEAN NOT NULL DEFAULT FALSE,
              importCompleted BOOLEAN NOT NULL DEFAULT FALSE,
              firstMessageCompleted BOOLEAN NOT NULL DEFAULT FALSE,
              startedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              completedAt TIMESTAMP NULL,
              lastStep VARCHAR(50) NOT NULL DEFAULT 'company',
              companyData JSON NULL,
              teamInvites JSON NULL,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_onboarding_progress_tenantId (tenantId)
            )
        `);
        logger.warn("[Migration] Created missing onboarding_progress table");
    }

    await ensureColumn("sessions", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "sessions.tenantId column");
    await ensureColumn("sessions", "userId", "`userId` INT NOT NULL", "sessions.userId column");
    await ensureColumn("sessions", "sessionToken", "`sessionToken` VARCHAR(255) NOT NULL", "sessions.sessionToken column");
    await ensureColumn("sessions", "lastActivityAt", "`lastActivityAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP", "sessions.lastActivityAt column");
    await ensureColumn("sessions", "expiresAt", "`expiresAt` TIMESTAMP NOT NULL", "sessions.expiresAt column");
    await ensureColumn("sessions", "createdAt", "`createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP", "sessions.createdAt column");

    await ensureColumn("onboarding_progress", "tenantId", "`tenantId` INT NOT NULL", "onboarding_progress.tenantId column");
    await ensureColumn("onboarding_progress", "companyCompleted", "`companyCompleted` BOOLEAN NOT NULL DEFAULT FALSE", "onboarding_progress.companyCompleted column");
    await ensureColumn("onboarding_progress", "teamCompleted", "`teamCompleted` BOOLEAN NOT NULL DEFAULT FALSE", "onboarding_progress.teamCompleted column");
    await ensureColumn("onboarding_progress", "whatsappCompleted", "`whatsappCompleted` BOOLEAN NOT NULL DEFAULT FALSE", "onboarding_progress.whatsappCompleted column");
    await ensureColumn("onboarding_progress", "importCompleted", "`importCompleted` BOOLEAN NOT NULL DEFAULT FALSE", "onboarding_progress.importCompleted column");
    await ensureColumn("onboarding_progress", "firstMessageCompleted", "`firstMessageCompleted` BOOLEAN NOT NULL DEFAULT FALSE", "onboarding_progress.firstMessageCompleted column");
    await ensureColumn("onboarding_progress", "startedAt", "`startedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP", "onboarding_progress.startedAt column");
    await ensureColumn("onboarding_progress", "completedAt", "`completedAt` TIMESTAMP NULL", "onboarding_progress.completedAt column");
    await ensureColumn("onboarding_progress", "lastStep", "`lastStep` VARCHAR(50) NOT NULL DEFAULT 'company'", "onboarding_progress.lastStep column");
    await ensureColumn("onboarding_progress", "companyData", "`companyData` JSON NULL", "onboarding_progress.companyData column");
    await ensureColumn("onboarding_progress", "teamInvites", "`teamInvites` JSON NULL", "onboarding_progress.teamInvites column");
    await ensureColumn("onboarding_progress", "updatedAt", "`updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP", "onboarding_progress.updatedAt column");

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

    {
        const [idxRows] = await connection.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'onboarding_progress'
               AND index_name = 'uniq_onboarding_progress_tenantId'`,
        );
        const hasIdx = Number((idxRows as Array<{ cnt: number }>)[0]?.cnt ?? 0) > 0;
        if (!hasIdx) {
            await connection.query(`ALTER TABLE onboarding_progress ADD UNIQUE INDEX uniq_onboarding_progress_tenantId (tenantId)`);
            logger.warn("[Migration] Added missing uniq_onboarding_progress_tenantId index");
        }
    }

    if (!(await hasTable("whatsapp_numbers"))) {
        await connection.query(`
            CREATE TABLE whatsapp_numbers (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              phoneNumber VARCHAR(20) NOT NULL,
              displayName VARCHAR(100) NULL,
              country VARCHAR(50) NOT NULL,
              countryCode VARCHAR(5) NOT NULL,
              status ENUM('active','warming_up','blocked','disconnected') NOT NULL DEFAULT 'warming_up',
              warmupDay INT NOT NULL DEFAULT 0,
              warmupStartDate TIMESTAMP NULL,
              dailyMessageLimit INT NOT NULL DEFAULT 20,
              messagesSentToday INT NOT NULL DEFAULT 0,
              totalMessagesSent INT NOT NULL DEFAULT 0,
              lastConnected TIMESTAMP NULL,
              isConnected BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_whatsapp_phone (tenantId, phoneNumber)
            )
        `);
        logger.warn("[Migration] Created missing whatsapp_numbers table");
    }

    if (!(await hasTable("whatsapp_connections"))) {
        await connection.query(`
            CREATE TABLE whatsapp_connections (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              whatsappNumberId INT NOT NULL,
              connectionType ENUM('api','qr') NOT NULL,
              accessToken TEXT NULL,
              phoneNumberId VARCHAR(50) NULL,
              businessAccountId VARCHAR(50) NULL,
              qrCode TEXT NULL,
              qrExpiresAt TIMESTAMP NULL,
              sessionData TEXT NULL,
              isConnected BOOLEAN NOT NULL DEFAULT FALSE,
              lastPingAt TIMESTAMP NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_whatsapp_connections_number (whatsappNumberId)
            )
        `);
        logger.warn("[Migration] Created missing whatsapp_connections table");
    }

    if (!(await hasTable("templates"))) {
        await connection.query(`
            CREATE TABLE templates (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(150) NOT NULL,
              content TEXT NOT NULL,
              type ENUM('whatsapp','email') NOT NULL DEFAULT 'whatsapp',
              attachments JSON NULL,
              variables JSON NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing templates table");
    }

    if (!(await hasTable("campaigns"))) {
        await connection.query(`
            CREATE TABLE campaigns (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(200) NOT NULL,
              message TEXT NOT NULL,
              type ENUM('whatsapp','email') NOT NULL DEFAULT 'whatsapp',
              templateId INT NULL,
              audienceConfig JSON NULL,
              status ENUM('draft','scheduled','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
              scheduledAt TIMESTAMP NULL,
              startedAt TIMESTAMP NULL,
              completedAt TIMESTAMP NULL,
              totalRecipients INT NOT NULL DEFAULT 0,
              messagesSent INT NOT NULL DEFAULT 0,
              messagesDelivered INT NOT NULL DEFAULT 0,
              messagesRead INT NOT NULL DEFAULT 0,
              messagesFailed INT NOT NULL DEFAULT 0,
              createdById INT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_campaigns_tenant_status_schedule (tenantId, status, scheduledAt)
            )
        `);
        logger.warn("[Migration] Created missing campaigns table");
    }

    if (!(await hasTable("campaign_recipients"))) {
        await connection.query(`
            CREATE TABLE campaign_recipients (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              campaignId INT NOT NULL,
              leadId INT NOT NULL,
              whatsappNumberId INT NULL,
              whatsappMessageId VARCHAR(128) NULL,
              status ENUM('pending','sent','delivered','failed','read') NOT NULL DEFAULT 'pending',
              sentAt TIMESTAMP NULL,
              deliveredAt TIMESTAMP NULL,
              readAt TIMESTAMP NULL,
              errorMessage TEXT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY unique_campaign_lead (tenantId, campaignId, leadId),
              INDEX idx_campaign_recipients_campaign_status (campaignId, status)
            )
        `);
        logger.warn("[Migration] Created missing campaign_recipients table");
    }

    if (!(await hasTable("workflows"))) {
        await connection.query(`
            CREATE TABLE workflows (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(200) NOT NULL,
              description TEXT NULL,
              isActive BOOLEAN NOT NULL DEFAULT TRUE,
              triggerType ENUM('lead_created','lead_updated','msg_received','campaign_link_clicked') NOT NULL,
              triggerConfig JSON NULL,
              actions JSON NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_workflows_tenant_active (tenantId, isActive)
            )
        `);
        logger.warn("[Migration] Created missing workflows table");
    }

    if (!(await hasTable("workflow_jobs"))) {
        await connection.query(`
            CREATE TABLE workflow_jobs (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              workflowId INT NOT NULL,
              entityId INT NOT NULL,
              actionIndex INT NOT NULL DEFAULT 0,
              payload JSON NOT NULL,
              status ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
              resumeAt TIMESTAMP NOT NULL,
              errorMessage TEXT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_workflow_jobs_resume_pending (status, resumeAt),
              INDEX idx_workflow_jobs_tenant_pending (tenantId, status)
            )
        `);
        logger.warn("[Migration] Created missing workflow_jobs table");
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

    {
        const [tableRows] = await connection.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = DATABASE()`
        );

        const existingTables = new Set(
            (tableRows as Array<{ table_name: string }>).map((row) => row.table_name)
        );

        const missingRequiredTables = REQUIRED_SCHEMA_TABLES.filter((table) => !existingTables.has(table));

        if (missingRequiredTables.length > 0) {
            const list = missingRequiredTables.join(", ");
            const shouldFail = process.env.FAIL_ON_MISSING_SCHEMA_TABLES === "1";

            if (shouldFail) {
                logger.error({ missingTables: missingRequiredTables }, "[Migration] Required schema tables are missing after migrations");
                throw new Error(`[Migration] Missing required tables after migration: ${list}`);
            }

            logger.warn({ missingTables: missingRequiredTables }, `[Migration] Missing required tables after migration (continuing startup): ${list}`);
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
