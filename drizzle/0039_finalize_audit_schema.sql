-- 0039_finalize_audit_schema.sql
-- This migration captures all manual schema hardening and table structure patches applied during the final audit.

-- 1. Hardening Chat Messages
ALTER TABLE `chat_messages` ADD COLUMN IF NOT EXISTS `direction` varchar(20) DEFAULT 'inbound' NOT NULL;
ALTER TABLE `chat_messages` ADD COLUMN IF NOT EXISTS `userId` int;

-- 2. Hardening Leads Reporting
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `status` varchar(50) DEFAULT 'new' NOT NULL;
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `value` decimal(15,2);

-- 3. Hardening Users (GDPR and Multi-tenancy)
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `gdprConsentAt` timestamp NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `gdprConsentVersion` int;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `marketingConsent` tinyint(1) DEFAULT 0;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `marketingConsentAt` timestamp NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `dataRetentionUntil` timestamp NULL;
-- Use a generic approach for tenantId if missing, default to 1 (which will be the main tenant created by bootstrap)
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `tenantId` int NOT NULL DEFAULT 1;

-- 4. Recreate Reminders Worker Table
DROP TABLE IF EXISTS `lead_reminders`;
CREATE TABLE `lead_reminders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` int NOT NULL,
  `leadId` int NOT NULL,
  `conversationId` int,
  `createdById` int NOT NULL,
  `scheduledAt` timestamp NOT NULL,
  `timezone` varchar(60) NOT NULL DEFAULT 'UTC',
  `message` text NOT NULL,
  `messageType` enum('text','image','document','template') NOT NULL DEFAULT 'text',
  `mediaUrl` varchar(500),
  `mediaName` varchar(200),
  `buttons` json,
  `status` enum('scheduled','sent','failed','cancelled') NOT NULL DEFAULT 'scheduled',
  `errorMessage` text,
  `sentAt` timestamp,
  `response` varchar(100),
  `respondedAt` timestamp,
  `isRecurring` tinyint NOT NULL DEFAULT 0,
  `recurrencePattern` enum('daily','weekly','monthly'),
  `recurrenceEndDate` timestamp,
  `parentReminderId` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `lead_reminders_id` PRIMARY KEY(`id`)
);

ALTER TABLE `lead_reminders` ADD CONSTRAINT `lead_reminders_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `lead_reminders` ADD CONSTRAINT `lead_reminders_leadId_leads_id_fk` FOREIGN KEY (`leadId`) REFERENCES `leads`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `lead_reminders` ADD CONSTRAINT `lead_reminders_createdById_users_id_fk` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;

-- 5. Add tenantId to other core tables if missing (Pipeline Stages)
ALTER TABLE `pipeline_stages` ADD COLUMN IF NOT EXISTS `tenantId` int NOT NULL DEFAULT 1;

-- 6. Add tenantId to custom_fields
ALTER TABLE `custom_fields` ADD COLUMN IF NOT EXISTS `tenantId` int NOT NULL DEFAULT 1;

-- Note: Materialized Views are generated dynamically by the backend service on startup, so they are not included here.
