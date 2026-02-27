-- Improve multi-tenant query performance on high-volume tables.
-- Safe/idempotent pattern: create index only if it does not already exist.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'leads' AND index_name = 'idx_leads_tenantId') = 0,
  'CREATE INDEX idx_leads_tenantId ON leads (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'conversations' AND index_name = 'idx_conversations_tenantId') = 0,
  'CREATE INDEX idx_conversations_tenantId ON conversations (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'chat_messages' AND index_name = 'idx_chat_messages_tenantId') = 0,
  'CREATE INDEX idx_chat_messages_tenantId ON chat_messages (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'activity_logs' AND index_name = 'idx_activity_logs_tenantId') = 0,
  'CREATE INDEX idx_activity_logs_tenantId ON activity_logs (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'message_queue' AND index_name = 'idx_message_queue_tenantId') = 0,
  'CREATE INDEX idx_message_queue_tenantId ON message_queue (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'lead_notes' AND index_name = 'idx_lead_notes_tenantId') = 0,
  'CREATE INDEX idx_lead_notes_tenantId ON lead_notes (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'lead_tasks' AND index_name = 'idx_lead_tasks_tenantId') = 0,
  'CREATE INDEX idx_lead_tasks_tenantId ON lead_tasks (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'appointments' AND index_name = 'idx_appointments_tenantId') = 0,
  'CREATE INDEX idx_appointments_tenantId ON appointments (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'campaign_recipients' AND index_name = 'idx_campaign_recipients_tenantId') = 0,
  'CREATE INDEX idx_campaign_recipients_tenantId ON campaign_recipients (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'access_logs' AND index_name = 'idx_access_logs_tenantId') = 0,
  'CREATE INDEX idx_access_logs_tenantId ON access_logs (tenantId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
