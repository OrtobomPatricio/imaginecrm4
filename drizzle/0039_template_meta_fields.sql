-- Add Meta Cloud API template fields to templates table
ALTER TABLE `templates` ADD COLUMN `metaTemplateName` varchar(150) DEFAULT NULL;
ALTER TABLE `templates` ADD COLUMN `languageCode` varchar(10) DEFAULT 'es';
ALTER TABLE `templates` ADD COLUMN `metaComponents` json DEFAULT NULL;
