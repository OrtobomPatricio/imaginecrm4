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
        "achievements",
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
        "goals",
        "integrations",
        "internal_messages",
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
        "support_queues",
        "support_user_queues",
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

    await ensureColumn("tenants", "trialEndsAt", "`trialEndsAt` TIMESTAMP NULL", "tenants.trialEndsAt column");
    await ensureColumn("tenants", "internalNotes", "`internalNotes` TEXT NULL", "tenants.internalNotes column");

    await ensureColumn("users", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "users.tenantId column");
    await ensureColumn("users", "emailVerified", "`emailVerified` BOOLEAN NOT NULL DEFAULT FALSE", "users.emailVerified column");
    await ensureColumn("users", "emailVerifyToken", "`emailVerifyToken` VARCHAR(255) NULL", "users.emailVerifyToken column");
    await ensureColumn("users", "passwordResetToken", "`passwordResetToken` VARCHAR(255) NULL", "users.passwordResetToken column");
    await ensureColumn("users", "passwordResetExpires", "`passwordResetExpires` TIMESTAMP NULL", "users.passwordResetExpires column");
    await ensureColumn("users", "gdprConsentAt", "`gdprConsentAt` TIMESTAMP NULL", "users.gdprConsentAt column");
    await ensureColumn("users", "gdprConsentVersion", "`gdprConsentVersion` VARCHAR(20) NULL", "users.gdprConsentVersion column");
    await ensureColumn("users", "marketingConsent", "`marketingConsent` BOOLEAN NOT NULL DEFAULT FALSE", "users.marketingConsent column");
    await ensureColumn("users", "marketingConsentAt", "`marketingConsentAt` TIMESTAMP NULL", "users.marketingConsentAt column");
    await ensureColumn("users", "dataRetentionUntil", "`dataRetentionUntil` TIMESTAMP NULL", "users.dataRetentionUntil column");

    await ensureColumn("leads", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "leads.tenantId column");
    await ensureColumn("leads", "deletedAt", "`deletedAt` TIMESTAMP NULL", "leads.deletedAt column");
    await ensureColumn("leads", "externalChatId", "`externalChatId` VARCHAR(255) NULL", "leads.externalChatId column");
    await ensureColumn("chat_messages", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "chat_messages.tenantId column");
    await ensureColumn("conversations", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "conversations.tenantId column");
    await ensureColumn("pipelines", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "pipelines.tenantId column");
    await ensureColumn("pipeline_stages", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "pipeline_stages.tenantId column");
    await ensureColumn("custom_field_definitions", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "custom_field_definitions.tenantId column");

    // Remaining tables that need tenantId (schema defines it but SQL migrations never created it)
    await ensureColumn("reminder_templates", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "reminder_templates.tenantId column");
    await ensureColumn("whatsapp_numbers", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "whatsapp_numbers.tenantId column");
    await ensureColumn("templates", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "templates.tenantId column");
    await ensureColumn("campaigns", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "campaigns.tenantId column");
    await ensureColumn("campaign_recipients", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "campaign_recipients.tenantId column");
    await ensureColumn("activity_logs", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "activity_logs.tenantId column");
    await ensureColumn("integrations", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "integrations.tenantId column");
    await ensureColumn("workflows", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "workflows.tenantId column");
    await ensureColumn("workflow_logs", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "workflow_logs.tenantId column");
    await ensureColumn("appointment_reasons", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "appointment_reasons.tenantId column");
    await ensureColumn("appointments", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "appointments.tenantId column");
    await ensureColumn("support_queues", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "support_queues.tenantId column");
    await ensureColumn("support_user_queues", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "support_user_queues.tenantId column");
    if (!(await hasTable("quick_answers"))) {
        await connection.query(`
            CREATE TABLE quick_answers (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL DEFAULT 1,
              shortcut TEXT NOT NULL,
              message TEXT NOT NULL,
              attachments JSON NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing quick_answers table");
    }
    await ensureColumn("quick_answers", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "quick_answers.tenantId column");
    await ensureColumn("quick_answers", "attachments", "`attachments` JSON NULL", "quick_answers.attachments column");
    await ensureColumn("message_queue", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "message_queue.tenantId column");
    await ensureColumn("whatsapp_connections", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "whatsapp_connections.tenantId column");
    await ensureColumn("whatsapp_connections", "wabaId", "`wabaId` VARCHAR(50) NULL", "whatsapp_connections.wabaId column");
    await ensureColumn("whatsapp_connections", "setupSource", "`setupSource` VARCHAR(30) NULL DEFAULT 'manual'", "whatsapp_connections.setupSource column");
    await ensureColumn("facebook_pages", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "facebook_pages.tenantId column");
    await ensureColumn("access_logs", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "access_logs.tenantId column");
    await ensureColumn("smtp_connections", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "smtp_connections.tenantId column");
    await ensureColumn("goals", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "goals.tenantId column");
    await ensureColumn("achievements", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "achievements.tenantId column");
    await ensureColumn("internal_messages", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "internal_messages.tenantId column");

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

    // ---- Additional feature tables (auto-created if missing) ----

    if (!(await hasTable("support_queues"))) {
        await connection.query(`
            CREATE TABLE support_queues (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(100) NOT NULL,
              color VARCHAR(32) NOT NULL,
              greetingMessage TEXT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_support_queues_name (tenantId, name)
            )
        `);
        logger.warn("[Migration] Created missing support_queues table");
    }

    if (!(await hasTable("support_user_queues"))) {
        await connection.query(`
            CREATE TABLE support_user_queues (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              userId INT NOT NULL,
              queueId INT NOT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_user_queue (tenantId, userId, queueId)
            )
        `);
        logger.warn("[Migration] Created missing support_user_queues table");
    }

    if (!(await hasTable("goals"))) {
        await connection.query(`
            CREATE TABLE goals (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              userId INT NOT NULL,
              type ENUM('sales_amount','deals_closed','leads_created','messages_sent') NOT NULL,
              targetAmount INT NOT NULL,
              currentAmount INT NOT NULL DEFAULT 0,
              period ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'monthly',
              startDate TIMESTAMP NOT NULL,
              endDate TIMESTAMP NOT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing goals table");
    }

    if (!(await hasTable("achievements"))) {
        await connection.query(`
            CREATE TABLE achievements (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              userId INT NOT NULL,
              type VARCHAR(50) NOT NULL,
              unlockedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              metadata JSON NULL
            )
        `);
        logger.warn("[Migration] Created missing achievements table");
    }

    if (!(await hasTable("internal_messages"))) {
        await connection.query(`
            CREATE TABLE internal_messages (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              senderId INT NOT NULL,
              recipientId INT NULL,
              content TEXT NOT NULL,
              attachments JSON NULL,
              isRead BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing internal_messages table");
    }

    if (!(await hasTable("tags"))) {
        await connection.query(`
            CREATE TABLE tags (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(50) NOT NULL,
              color VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
              description TEXT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_tag_name (tenantId, name)
            )
        `);
        logger.warn("[Migration] Created missing tags table");
    }

    if (!(await hasTable("lead_tags"))) {
        await connection.query(`
            CREATE TABLE lead_tags (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              leadId INT NOT NULL,
              tagId INT NOT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_lead_tag (tenantId, leadId, tagId)
            )
        `);
        logger.warn("[Migration] Created missing lead_tags table");
    }

    if (!(await hasTable("conversation_tags"))) {
        await connection.query(`
            CREATE TABLE conversation_tags (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              conversationId INT NOT NULL,
              tagId INT NOT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_conv_tag (tenantId, conversationId, tagId)
            )
        `);
        logger.warn("[Migration] Created missing conversation_tags table");
    }

    if (!(await hasTable("lead_notes"))) {
        await connection.query(`
            CREATE TABLE lead_notes (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              leadId INT NOT NULL,
              content TEXT NOT NULL,
              createdById INT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing lead_notes table");
    }

    if (!(await hasTable("lead_tasks"))) {
        await connection.query(`
            CREATE TABLE lead_tasks (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              leadId INT NOT NULL,
              title VARCHAR(200) NOT NULL,
              description TEXT NULL,
              dueDate TIMESTAMP NULL,
              status ENUM('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
              priority ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
              assignedToId INT NULL,
              createdById INT NULL,
              completedAt TIMESTAMP NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing lead_tasks table");
    }

    if (!(await hasTable("ai_suggestions"))) {
        await connection.query(`
            CREATE TABLE ai_suggestions (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              conversationId INT NOT NULL,
              suggestion TEXT NOT NULL,
              context TEXT NULL,
              used BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing ai_suggestions table");
    }

    if (!(await hasTable("chatbot_flows"))) {
        await connection.query(`
            CREATE TABLE chatbot_flows (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(100) NOT NULL,
              \`trigger\` ENUM('keyword','new_conversation','no_match','hours') NOT NULL,
              triggerValue VARCHAR(200) NULL,
              responses JSON NOT NULL,
              isActive BOOLEAN NOT NULL DEFAULT TRUE,
              hoursOnly BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing chatbot_flows table");
    }

    if (!(await hasTable("quotations"))) {
        await connection.query(`
            CREATE TABLE quotations (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              leadId INT NOT NULL,
              conversationId INT NULL,
              quoteNumber VARCHAR(50) NOT NULL,
              title VARCHAR(200) NOT NULL,
              description TEXT NULL,
              items JSON NOT NULL,
              subtotal DECIMAL(12,2) NOT NULL,
              tax DECIMAL(12,2) DEFAULT '0.00',
              total DECIMAL(12,2) NOT NULL,
              currency VARCHAR(10) NOT NULL DEFAULT 'PYG',
              status ENUM('draft','sent','approved','rejected','expired') NOT NULL DEFAULT 'draft',
              validUntil TIMESTAMP NULL,
              approvedAt TIMESTAMP NULL,
              rejectedAt TIMESTAMP NULL,
              rejectionReason TEXT NULL,
              pdfUrl VARCHAR(500) NULL,
              createdById INT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_quote_number (tenantId, quoteNumber)
            )
        `);
        logger.warn("[Migration] Created missing quotations table");
    }

    if (!(await hasTable("forms"))) {
        await connection.query(`
            CREATE TABLE forms (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(100) NOT NULL,
              slug VARCHAR(100) NOT NULL,
              title VARCHAR(200) NULL,
              description TEXT NULL,
              fields JSON NOT NULL,
              whatsappNumberId INT NULL,
              welcomeMessage TEXT NULL,
              isActive BOOLEAN NOT NULL DEFAULT TRUE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_form_slug (tenantId, slug)
            )
        `);
        logger.warn("[Migration] Created missing forms table");
    }

    if (!(await hasTable("license"))) {
        await connection.query(`
            CREATE TABLE license (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              \`key\` VARCHAR(255) NOT NULL,
              status ENUM('active','expired','canceled','trial') NOT NULL DEFAULT 'trial',
              plan VARCHAR(50) NOT NULL DEFAULT 'starter',
              expiresAt TIMESTAMP NULL,
              maxUsers INT DEFAULT 5,
              maxWhatsappNumbers INT DEFAULT 3,
              maxMessagesPerMonth INT DEFAULT 10000,
              features JSON NULL,
              metadata JSON NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_license_key (\`key\`)
            )
        `);
        logger.warn("[Migration] Created missing license table");
    }

    if (!(await hasTable("usage_tracking"))) {
        await connection.query(`
            CREATE TABLE usage_tracking (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              year INT NOT NULL,
              month INT NOT NULL,
              messagesSent INT DEFAULT 0,
              messagesReceived INT DEFAULT 0,
              activeUsers INT DEFAULT 0,
              activeWhatsappNumbers INT DEFAULT 0,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_usage_year_month (tenantId, year, month)
            )
        `);
        logger.warn("[Migration] Created missing usage_tracking table");
    }

    if (!(await hasTable("webhooks"))) {
        await connection.query(`
            CREATE TABLE webhooks (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              name VARCHAR(100) NOT NULL,
              url VARCHAR(500) NOT NULL,
              secret VARCHAR(255) NOT NULL,
              events JSON NOT NULL,
              active BOOLEAN NOT NULL DEFAULT TRUE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing webhooks table");
    }

    if (!(await hasTable("webhook_deliveries"))) {
        await connection.query(`
            CREATE TABLE webhook_deliveries (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              webhookId INT NOT NULL,
              event VARCHAR(100) NOT NULL,
              payload TEXT NOT NULL,
              responseStatus INT NULL,
              responseBody TEXT NULL,
              success BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing webhook_deliveries table");
    }

    if (!(await hasTable("file_uploads"))) {
        await connection.query(`
            CREATE TABLE file_uploads (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              userId INT NULL,
              filename VARCHAR(255) NOT NULL,
              originalName VARCHAR(255) NOT NULL,
              mimeType VARCHAR(100) NOT NULL,
              size INT NOT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE KEY uniq_file_uploads_filename (filename)
            )
        `);
        logger.warn("[Migration] Created missing file_uploads table");
    }

    // --- SuperAdmin module tables (added in schema but never had SQL migrations) ---

    if (!(await hasTable("platform_announcements"))) {
        await connection.query(`
            CREATE TABLE platform_announcements (
              id INT AUTO_INCREMENT PRIMARY KEY,
              title VARCHAR(255) NOT NULL,
              message TEXT NOT NULL,
              type ENUM('info','warning','critical','maintenance') NOT NULL DEFAULT 'info',
              active BOOLEAN NOT NULL DEFAULT TRUE,
              createdBy INT NULL,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing platform_announcements table");
    }

    if (!(await hasTable("feature_flags"))) {
        await connection.query(`
            CREATE TABLE feature_flags (
              id INT AUTO_INCREMENT PRIMARY KEY,
              tenantId INT NOT NULL,
              flag VARCHAR(100) NOT NULL,
              enabled BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              UNIQUE KEY idx_ff_tenant_flag (tenantId, flag)
            )
        `);
        logger.warn("[Migration] Created missing feature_flags table");
    }

    if (!(await hasTable("superadmin_alerts"))) {
        await connection.query(`
            CREATE TABLE superadmin_alerts (
              id INT AUTO_INCREMENT PRIMARY KEY,
              type ENUM('trial_expiring','quota_exceeded','new_tenant','error','churn_risk','security') NOT NULL,
              severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
              title VARCHAR(255) NOT NULL,
              message TEXT NOT NULL,
              tenantId INT NULL,
              metadata JSON NULL,
              isRead BOOLEAN NOT NULL DEFAULT FALSE,
              createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        logger.warn("[Migration] Created missing superadmin_alerts table");
    }

    await ensureColumn("app_settings", "tenantId", "`tenantId` INT NOT NULL DEFAULT 1", "app_settings.tenantId column");

    // Unique constraint on (tenantId, email) for users — prevents duplicate emails within a tenant
    if (await hasTable("users") && await hasColumn("users", "email") && await hasColumn("users", "tenantId")) {
        const [idxRows] = await connection.query(
            `SELECT COUNT(*) AS cnt
             FROM information_schema.statistics
             WHERE table_schema = DATABASE()
               AND table_name = 'users'
               AND index_name = 'uniq_users_tenant_email'`,
        );
        const hasIdx = Number((idxRows as Array<{ cnt: number }>)[0]?.cnt ?? 0) > 0;
        if (!hasIdx) {
            try {
                await connection.query(
                    `ALTER TABLE users ADD UNIQUE INDEX uniq_users_tenant_email (tenantId, email)`
                );
                logger.warn("[Migration] Added unique index uniq_users_tenant_email (tenantId, email)");
            } catch (e: any) {
                // May fail if duplicates already exist — log but don't crash
                logger.warn({ err: safeError(e) }, "[Migration] Could not add uniq_users_tenant_email (possible duplicate emails). Clean duplicates and retry.");
            }
        }
    }

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
            `SELECT table_name AS tableName
             FROM information_schema.tables
             WHERE table_schema = DATABASE()`
        );

        const existingTables = new Set(
            (tableRows as Array<{ tableName?: string; table_name?: string; TABLE_NAME?: string }>).map((row) => row.tableName ?? row.table_name ?? row.TABLE_NAME ?? "")
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

    // --- Production Performance Indexes ---
    // These composite indexes cover the most frequent query patterns.
    // Uses plain CREATE INDEX + catches ER_DUP_KEYNAME (1061) for idempotency
    // (MySQL < 8.0.29 does NOT support CREATE INDEX IF NOT EXISTS).
    const performanceIndexes = [
        `CREATE INDEX idx_leads_tenant_assigned ON leads(tenantId, assignedToId)`,
        `CREATE INDEX idx_leads_tenant_stage ON leads(tenantId, pipelineStageId)`,
        `CREATE INDEX idx_leads_tenant_deleted ON leads(tenantId, deletedAt)`,
        `CREATE INDEX idx_conv_tenant_assigned ON conversations(tenantId, assignedToId)`,
        `CREATE INDEX idx_conv_tenant_status_last ON conversations(tenantId, status, lastMessageAt)`,
        `CREATE INDEX idx_conv_tenant_phone ON conversations(tenantId, contactPhone)`,
        `CREATE INDEX idx_mq_status_priority ON message_queue(status, nextAttemptAt, priority)`,
        `CREATE INDEX idx_appt_tenant_date ON appointments(tenantId, appointmentDate)`,
        `CREATE INDEX idx_activity_tenant_created ON activity_logs(tenantId, createdAt)`,
        `CREATE INDEX idx_access_tenant_created ON access_logs(tenantId, createdAt)`,
    ];

    let idxCreated = 0;
    for (const stmt of performanceIndexes) {
        try {
            await connection.query(stmt);
            idxCreated++;
        } catch (err: any) {
            // ER_DUP_KEYNAME (1061) = index already exists — safe to ignore
            if (err?.errno !== 1061 && !err?.message?.includes("Duplicate")) {
                logger.warn({ err: err?.message, stmt }, "[Migration] Index creation failed (non-fatal)");
            }
        }
    }
    if (idxCreated > 0) {
        logger.info({ count: idxCreated }, "[Migration] Performance indexes ensured");
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations().catch((err) => {
        logger.error({ err: safeError(err) }, "[Migration] Unhandled error");
        process.exit(1);
    });
}
