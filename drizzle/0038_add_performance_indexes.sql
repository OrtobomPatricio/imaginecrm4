-- P2-1: Add missing performance indexes
-- messageQueue: queue worker polling index
CREATE INDEX IF NOT EXISTS `idx_mq_status_next_priority` ON `message_queue` (`status`, `nextAttemptAt`, `priority`);
CREATE INDEX IF NOT EXISTS `idx_mq_tenant` ON `message_queue` (`tenantId`);

-- campaignRecipients: campaign worker batch fetching
CREATE INDEX IF NOT EXISTS `idx_cr_campaign_status` ON `campaign_recipients` (`campaignId`, `status`);

-- chatMessages: per-number message history
CREATE INDEX IF NOT EXISTS `idx_chat_messages_wanumber_created` ON `chat_messages` (`whatsappNumberId`, `createdAt`);
