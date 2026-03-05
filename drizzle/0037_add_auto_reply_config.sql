-- Add autoReplyConfig column to app_settings for AI auto-reply feature
ALTER TABLE `app_settings` ADD COLUMN IF NOT EXISTS `autoReplyConfig` json DEFAULT NULL;
