-- ============================================================
-- FIX: Create missing tables in production database
-- Run this in EasyPanel MySQL console or via container shell:
--   mysql -u mysql -p crm < fix_missing_tables.sql
-- ============================================================

-- 1) app_settings (most critical — every request needs this)
CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL DEFAULT 1,
  `singleton` INT NOT NULL DEFAULT 1,
  `companyName` VARCHAR(120) NOT NULL DEFAULT 'Imagine Lab CRM',
  `logoUrl` VARCHAR(500) NULL,
  `timezone` VARCHAR(60) NOT NULL DEFAULT 'America/Asuncion',
  `language` VARCHAR(10) NOT NULL DEFAULT 'es',
  `currency` VARCHAR(10) NOT NULL DEFAULT 'PYG',
  `permissionsMatrix` JSON NULL,
  `scheduling` JSON NULL,
  `dashboardConfig` JSON NULL,
  `salesConfig` JSON NULL,
  `smtpConfig` JSON NULL,
  `storageConfig` JSON NULL,
  `aiConfig` JSON NULL,
  `autoReplyConfig` JSON NULL,
  `mapsConfig` JSON NULL,
  `slaConfig` JSON NULL,
  `securityConfig` JSON NULL,
  `metaConfig` JSON NULL,
  `chatDistributionConfig` JSON NULL,
  `lastAssignedAgentId` INT NULL,
  `maintenanceMode` JSON NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_app_settings_singleton` (`tenantId`, `singleton`)
);

-- Seed default row for tenant 1 if missing
INSERT IGNORE INTO `app_settings` (`tenantId`, `singleton`, `companyName`)
  VALUES (1, 1, 'Imagine Lab CRM');

-- 2) whatsapp_numbers
CREATE TABLE IF NOT EXISTS `whatsapp_numbers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL,
  `phoneNumber` VARCHAR(20) NOT NULL,
  `displayName` VARCHAR(100) NULL,
  `country` VARCHAR(50) NOT NULL DEFAULT '',
  `countryCode` VARCHAR(5) NOT NULL DEFAULT '',
  `status` ENUM('active','warming_up','blocked','disconnected') NOT NULL DEFAULT 'warming_up',
  `warmupDay` INT NOT NULL DEFAULT 0,
  `warmupStartDate` TIMESTAMP NULL,
  `dailyMessageLimit` INT NOT NULL DEFAULT 20,
  `messagesSentToday` INT NOT NULL DEFAULT 0,
  `totalMessagesSent` INT NOT NULL DEFAULT 0,
  `lastConnected` TIMESTAMP NULL,
  `isConnected` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_whatsapp_phone` (`tenantId`, `phoneNumber`)
);

-- 3) whatsapp_connections
CREATE TABLE IF NOT EXISTS `whatsapp_connections` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL,
  `whatsappNumberId` INT NOT NULL,
  `connectionType` ENUM('api','qr') NOT NULL,
  `accessToken` TEXT NULL,
  `phoneNumberId` VARCHAR(50) NULL,
  `businessAccountId` VARCHAR(50) NULL,
  `wabaId` VARCHAR(50) NULL,
  `setupSource` VARCHAR(30) NULL DEFAULT 'manual',
  `tokenExpiresAt` TIMESTAMP NULL,
  `qrCode` TEXT NULL,
  `qrExpiresAt` TIMESTAMP NULL,
  `sessionData` TEXT NULL,
  `isConnected` BOOLEAN NOT NULL DEFAULT FALSE,
  `lastPingAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_whatsapp_connections_number` (`whatsappNumberId`)
);

-- 4) campaigns
CREATE TABLE IF NOT EXISTS `campaigns` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `message` TEXT NOT NULL,
  `type` ENUM('whatsapp','email') NOT NULL DEFAULT 'whatsapp',
  `templateId` INT NULL,
  `audienceConfig` JSON NULL,
  `status` ENUM('draft','scheduled','running','paused','completed','cancelled') NOT NULL DEFAULT 'draft',
  `scheduledAt` TIMESTAMP NULL,
  `startedAt` TIMESTAMP NULL,
  `completedAt` TIMESTAMP NULL,
  `totalRecipients` INT NOT NULL DEFAULT 0,
  `messagesSent` INT NOT NULL DEFAULT 0,
  `messagesDelivered` INT NOT NULL DEFAULT 0,
  `messagesRead` INT NOT NULL DEFAULT 0,
  `messagesFailed` INT NOT NULL DEFAULT 0,
  `createdById` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_campaigns_tenant_status_schedule` (`tenantId`, `status`, `scheduledAt`)
);

-- 5) campaign_recipients
CREATE TABLE IF NOT EXISTS `campaign_recipients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL,
  `campaignId` INT NOT NULL,
  `leadId` INT NOT NULL,
  `whatsappNumberId` INT NULL,
  `whatsappMessageId` VARCHAR(128) NULL,
  `status` ENUM('pending','sent','delivered','failed','read') NOT NULL DEFAULT 'pending',
  `sentAt` TIMESTAMP NULL,
  `deliveredAt` TIMESTAMP NULL,
  `readAt` TIMESTAMP NULL,
  `errorMessage` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_campaign_lead` (`tenantId`, `campaignId`, `leadId`),
  INDEX `idx_campaign_recipients_campaign_status` (`campaignId`, `status`)
);

-- 6) workflows
CREATE TABLE IF NOT EXISTS `workflows` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `triggerType` ENUM('lead_created','lead_updated','msg_received','campaign_link_clicked') NOT NULL,
  `triggerConfig` JSON NULL,
  `actions` JSON NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_workflows_tenant_active` (`tenantId`, `isActive`)
);

-- 7) workflow_jobs
CREATE TABLE IF NOT EXISTS `workflow_jobs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `tenantId` INT NOT NULL,
  `workflowId` INT NOT NULL,
  `entityId` INT NOT NULL,
  `actionIndex` INT NOT NULL DEFAULT 0,
  `payload` JSON NOT NULL,
  `status` ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  `resumeAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `errorMessage` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_workflow_jobs_resume_pending` (`status`, `resumeAt`),
  INDEX `idx_workflow_jobs_tenant_pending` (`tenantId`, `status`)
);

SELECT 'All missing tables created successfully!' AS result;
