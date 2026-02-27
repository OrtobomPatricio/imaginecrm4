-- Multi-tenant compound indexes for common list/report/query patterns.
-- Idempotent: creates each index only if it does not already exist.

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'leads' AND index_name = 'idx_leads_tenant_createdAt') = 0,
  'CREATE INDEX idx_leads_tenant_createdAt ON leads (tenantId, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'leads' AND index_name = 'idx_leads_tenant_status') = 0,
  'CREATE INDEX idx_leads_tenant_status ON leads (tenantId, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'conversations' AND index_name = 'idx_conversations_tenant_lastMessageAt') = 0,
  'CREATE INDEX idx_conversations_tenant_lastMessageAt ON conversations (tenantId, lastMessageAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'chat_messages' AND index_name = 'idx_chat_messages_tenant_createdAt') = 0,
  'CREATE INDEX idx_chat_messages_tenant_createdAt ON chat_messages (tenantId, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'activity_logs' AND index_name = 'idx_activity_logs_tenant_createdAt') = 0,
  'CREATE INDEX idx_activity_logs_tenant_createdAt ON activity_logs (tenantId, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'access_logs' AND index_name = 'idx_access_logs_tenant_createdAt') = 0,
  'CREATE INDEX idx_access_logs_tenant_createdAt ON access_logs (tenantId, createdAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'campaign_recipients' AND index_name = 'idx_campaign_recipients_tenant_status') = 0,
  'CREATE INDEX idx_campaign_recipients_tenant_status ON campaign_recipients (tenantId, status)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'message_queue' AND index_name = 'idx_message_queue_tenant_status_nextAttemptAt') = 0,
  'CREATE INDEX idx_message_queue_tenant_status_nextAttemptAt ON message_queue (tenantId, status, nextAttemptAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'lead_tasks' AND index_name = 'idx_lead_tasks_tenant_status_dueDate') = 0,
  'CREATE INDEX idx_lead_tasks_tenant_status_dueDate ON lead_tasks (tenantId, status, dueDate)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'lead_reminders' AND index_name = 'idx_lead_reminders_tenant_status_scheduledAt') = 0,
  'CREATE INDEX idx_lead_reminders_tenant_status_scheduledAt ON lead_reminders (tenantId, status, scheduledAt)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
