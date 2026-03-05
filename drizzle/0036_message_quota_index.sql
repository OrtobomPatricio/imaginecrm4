-- Performance index for monthly outbound message quota counting
-- Covers: SELECT COUNT(*) FROM chat_messages WHERE tenantId=? AND direction='outbound' AND createdAt >= ?
CREATE INDEX IF NOT EXISTS `idx_chat_messages_tenant_dir_created` ON `chat_messages` (`tenantId`, `direction`, `createdAt`);
