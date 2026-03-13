-- Add tokenExpiresAt to whatsapp_connections for Meta token auto-renewal
-- NOTE: Removed AFTER `setupSource` clause — setupSource is added by ensureCompatibilitySchema at runtime
-- and may not exist when this migration runs. Column position is cosmetic.
ALTER TABLE `whatsapp_connections` ADD COLUMN `tokenExpiresAt` timestamp NULL DEFAULT NULL;
