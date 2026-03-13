/**
 * Runtime schema safety-net — ensures ALL critical tables exist.
 *
 * This runs at server startup (after migrations) using the same `getDb()` pool
 * that workers use.  It is a last-resort guarantee so that workers never see
 * "required tables missing" even if the migration script fails for any reason.
 *
 * Every statement uses CREATE TABLE IF NOT EXISTS and is individually
 * try-caught so one failure cannot block another.
 */
import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { logger, safeError } from "../_core/logger";

const TABLES: Array<{ name: string; ddl: string }> = [
    {
        name: "whatsapp_numbers",
        ddl: `CREATE TABLE IF NOT EXISTS whatsapp_numbers (
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
        )`,
    },
    {
        name: "whatsapp_connections",
        ddl: `CREATE TABLE IF NOT EXISTS whatsapp_connections (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          whatsappNumberId INT NOT NULL,
          connectionType ENUM('api','qr') NOT NULL,
          accessToken TEXT NULL,
          phoneNumberId VARCHAR(50) NULL,
          businessAccountId VARCHAR(50) NULL,
          wabaId VARCHAR(50) NULL,
          setupSource VARCHAR(30) NULL DEFAULT 'manual',
          tokenExpiresAt TIMESTAMP NULL,
          qrCode TEXT NULL,
          qrExpiresAt TIMESTAMP NULL,
          sessionData TEXT NULL,
          isConnected BOOLEAN NOT NULL DEFAULT FALSE,
          lastPingAt TIMESTAMP NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_whatsapp_connections_number (whatsappNumberId)
        )`,
    },
    {
        name: "templates",
        ddl: `CREATE TABLE IF NOT EXISTS templates (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          name VARCHAR(150) NOT NULL,
          content TEXT NOT NULL,
          type ENUM('whatsapp','email') NOT NULL DEFAULT 'whatsapp',
          attachments JSON NULL,
          variables JSON NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "campaigns",
        ddl: `CREATE TABLE IF NOT EXISTS campaigns (
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
        )`,
    },
    {
        name: "campaign_recipients",
        ddl: `CREATE TABLE IF NOT EXISTS campaign_recipients (
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
        )`,
    },
    {
        name: "workflows",
        ddl: `CREATE TABLE IF NOT EXISTS workflows (
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
        )`,
    },
    {
        name: "workflow_jobs",
        ddl: `CREATE TABLE IF NOT EXISTS workflow_jobs (
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
        )`,
    },
    {
        name: "workflow_logs",
        ddl: `CREATE TABLE IF NOT EXISTS workflow_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          workflowId INT NOT NULL,
          entityId INT NOT NULL,
          actionType VARCHAR(50) NOT NULL,
          actionPayload JSON NULL,
          status ENUM('success','failure') NOT NULL DEFAULT 'success',
          errorMessage TEXT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "message_queue",
        ddl: `CREATE TABLE IF NOT EXISTS message_queue (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL DEFAULT 1,
          whatsappNumberId INT NULL,
          recipientPhone VARCHAR(20) NOT NULL,
          messageBody TEXT NOT NULL,
          mediaUrl VARCHAR(500) NULL,
          priority INT NOT NULL DEFAULT 5,
          status ENUM('pending','processing','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
          attempts INT NOT NULL DEFAULT 0,
          maxAttempts INT NOT NULL DEFAULT 3,
          nextAttemptAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          sentAt TIMESTAMP NULL,
          errorMessage TEXT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "sessions",
        ddl: `CREATE TABLE IF NOT EXISTS sessions (
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
        )`,
    },
    {
        name: "onboarding_progress",
        ddl: `CREATE TABLE IF NOT EXISTS onboarding_progress (
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
        )`,
    },
    {
        name: "lead_reminders",
        ddl: `CREATE TABLE IF NOT EXISTS lead_reminders (
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
        )`,
    },
    {
        name: "terms_acceptance",
        ddl: `CREATE TABLE IF NOT EXISTS terms_acceptance (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          userId INT NOT NULL,
          termsVersion VARCHAR(20) NOT NULL,
          acceptedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ipAddress VARCHAR(45) NULL,
          userAgent TEXT NULL,
          UNIQUE KEY idx_terms_user_version (tenantId, userId, termsVersion)
        )`,
    },
    {
        name: "quick_answers",
        ddl: `CREATE TABLE IF NOT EXISTS quick_answers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL DEFAULT 1,
          shortcut TEXT NOT NULL,
          message TEXT NOT NULL,
          attachments JSON NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "support_queues",
        ddl: `CREATE TABLE IF NOT EXISTS support_queues (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(32) NOT NULL,
          greetingMessage TEXT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_support_queues_name (tenantId, name)
        )`,
    },
    {
        name: "support_user_queues",
        ddl: `CREATE TABLE IF NOT EXISTS support_user_queues (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          userId INT NOT NULL,
          queueId INT NOT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_user_queue (tenantId, userId, queueId)
        )`,
    },
    {
        name: "goals",
        ddl: `CREATE TABLE IF NOT EXISTS goals (
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
        )`,
    },
    {
        name: "achievements",
        ddl: `CREATE TABLE IF NOT EXISTS achievements (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          userId INT NOT NULL,
          type VARCHAR(50) NOT NULL,
          unlockedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          metadata JSON NULL
        )`,
    },
    {
        name: "internal_messages",
        ddl: `CREATE TABLE IF NOT EXISTS internal_messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          senderId INT NOT NULL,
          recipientId INT NULL,
          content TEXT NOT NULL,
          attachments JSON NULL,
          isRead BOOLEAN NOT NULL DEFAULT FALSE,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "tags",
        ddl: `CREATE TABLE IF NOT EXISTS tags (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          name VARCHAR(50) NOT NULL,
          color VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
          description TEXT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_tag_name (tenantId, name)
        )`,
    },
    {
        name: "lead_tags",
        ddl: `CREATE TABLE IF NOT EXISTS lead_tags (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          leadId INT NOT NULL,
          tagId INT NOT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_lead_tag (tenantId, leadId, tagId)
        )`,
    },
    {
        name: "conversation_tags",
        ddl: `CREATE TABLE IF NOT EXISTS conversation_tags (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          conversationId INT NOT NULL,
          tagId INT NOT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_conv_tag (tenantId, conversationId, tagId)
        )`,
    },
    {
        name: "lead_notes",
        ddl: `CREATE TABLE IF NOT EXISTS lead_notes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          leadId INT NOT NULL,
          content TEXT NOT NULL,
          createdById INT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "lead_tasks",
        ddl: `CREATE TABLE IF NOT EXISTS lead_tasks (
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
        )`,
    },
    {
        name: "ai_suggestions",
        ddl: `CREATE TABLE IF NOT EXISTS ai_suggestions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          conversationId INT NOT NULL,
          suggestion TEXT NOT NULL,
          context TEXT NULL,
          used BOOLEAN NOT NULL DEFAULT FALSE,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "chatbot_flows",
        ddl: `CREATE TABLE IF NOT EXISTS chatbot_flows (
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
        )`,
    },
    {
        name: "quotations",
        ddl: `CREATE TABLE IF NOT EXISTS quotations (
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
        )`,
    },
    {
        name: "forms",
        ddl: `CREATE TABLE IF NOT EXISTS forms (
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
        )`,
    },
    {
        name: "license",
        ddl: `CREATE TABLE IF NOT EXISTS license (
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
        )`,
    },
    {
        name: "usage_tracking",
        ddl: `CREATE TABLE IF NOT EXISTS usage_tracking (
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
        )`,
    },
    {
        name: "webhooks",
        ddl: `CREATE TABLE IF NOT EXISTS webhooks (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          name VARCHAR(100) NOT NULL,
          url VARCHAR(500) NOT NULL,
          secret VARCHAR(255) NOT NULL,
          events JSON NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "webhook_deliveries",
        ddl: `CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          webhookId INT NOT NULL,
          event VARCHAR(100) NOT NULL,
          payload TEXT NOT NULL,
          responseStatus INT NULL,
          responseBody TEXT NULL,
          success BOOLEAN NOT NULL DEFAULT FALSE,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
    },
    {
        name: "file_uploads",
        ddl: `CREATE TABLE IF NOT EXISTS file_uploads (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL,
          userId INT NULL,
          filename VARCHAR(255) NOT NULL,
          originalName VARCHAR(255) NOT NULL,
          mimeType VARCHAR(100) NOT NULL,
          size INT NOT NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_file_uploads_filename (filename)
        )`,
    },
    {
        name: "app_settings",
        ddl: `CREATE TABLE IF NOT EXISTS app_settings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          tenantId INT NOT NULL DEFAULT 1,
          singleton INT NOT NULL DEFAULT 1,
          companyName VARCHAR(120) NOT NULL DEFAULT 'Imagine Lab CRM',
          logoUrl VARCHAR(500) NULL,
          timezone VARCHAR(60) NOT NULL DEFAULT 'America/Asuncion',
          language VARCHAR(10) NOT NULL DEFAULT 'es',
          currency VARCHAR(10) NOT NULL DEFAULT 'PYG',
          permissionsMatrix JSON NULL,
          scheduling JSON NULL,
          dashboardConfig JSON NULL,
          salesConfig JSON NULL,
          smtpConfig JSON NULL,
          storageConfig JSON NULL,
          aiConfig JSON NULL,
          autoReplyConfig JSON NULL,
          mapsConfig JSON NULL,
          slaConfig JSON NULL,
          securityConfig JSON NULL,
          metaConfig JSON NULL,
          chatDistributionConfig JSON NULL,
          lastAssignedAgentId INT NULL,
          maintenanceMode JSON NULL,
          createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_app_settings_singleton (tenantId, singleton)
        )`,
    },
];

/**
 * Ensure all critical tables exist using the RUNTIME db pool.
 * Called once at server startup, BEFORE workers start.
 * Uses CREATE TABLE IF NOT EXISTS — fully idempotent and safe.
 */
export async function ensureAllTables(): Promise<void> {
    const db = await getDb();
    if (!db) {
        logger.error("[EnsureSchema] No DB connection — cannot ensure tables");
        return;
    }

    let ok = 0;
    let failed = 0;

    for (const { name, ddl } of TABLES) {
        try {
            // CREATE TABLE IF NOT EXISTS is idempotent — no need to check first
            await db.execute(sql.raw(ddl));
            ok++;
        } catch (err) {
            logger.error({ err: safeError(err), table: name }, `[EnsureSchema] Failed to create table ${name}`);
            failed++;
        }
    }

    logger.info({ ok, failed, total: TABLES.length }, "[EnsureSchema] Table check complete");
}
