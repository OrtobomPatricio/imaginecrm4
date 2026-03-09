-- Add tokenExpiresAt to whatsapp_connections for Meta token auto-renewal
ALTER TABLE `whatsapp_connections` ADD COLUMN `tokenExpiresAt` timestamp NULL DEFAULT NULL AFTER `setupSource`;
