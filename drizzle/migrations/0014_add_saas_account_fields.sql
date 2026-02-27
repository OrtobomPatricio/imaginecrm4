-- Migration: Add SaaS account management fields
-- Version: 2026-02-26
-- Description: Adds trial tracking to tenants, email verification and password reset to users

-- Trial tracking on tenants
ALTER TABLE `tenants`
ADD COLUMN `trialEndsAt` TIMESTAMP NULL DEFAULT NULL AFTER `status`;

-- Email verification fields on users
ALTER TABLE `users`
ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT FALSE AFTER `isActive`,
ADD COLUMN `emailVerifyToken` VARCHAR(255) NULL DEFAULT NULL AFTER `emailVerified`;

-- Password reset fields on users
ALTER TABLE `users`
ADD COLUMN `passwordResetToken` VARCHAR(255) NULL DEFAULT NULL AFTER `emailVerifyToken`,
ADD COLUMN `passwordResetExpires` TIMESTAMP NULL DEFAULT NULL AFTER `passwordResetToken`;

-- Index for fast token lookups
CREATE INDEX `idx_users_email_verify_token` ON `users` (`emailVerifyToken`);
CREATE INDEX `idx_users_password_reset_token` ON `users` (`passwordResetToken`);
