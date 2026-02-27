import mysql from "mysql2/promise";
import { logger } from "../_core/logger";

type ExpectedIndex = {
  table: string;
  name: string;
  columns: string;
};

const expectedIndexes: ExpectedIndex[] = [
  { table: "leads", name: "idx_leads_tenantId", columns: "tenantId" },
  { table: "leads", name: "idx_leads_tenant_createdAt", columns: "tenantId,createdAt" },
  { table: "leads", name: "idx_leads_tenant_status", columns: "tenantId,status" },
  { table: "conversations", name: "idx_conversations_tenantId", columns: "tenantId" },
  { table: "conversations", name: "idx_conversations_tenant_lastMessageAt", columns: "tenantId,lastMessageAt" },
  { table: "chat_messages", name: "idx_chat_messages_tenantId", columns: "tenantId" },
  { table: "chat_messages", name: "idx_chat_messages_tenant_createdAt", columns: "tenantId,createdAt" },
  { table: "activity_logs", name: "idx_activity_logs_tenantId", columns: "tenantId" },
  { table: "activity_logs", name: "idx_activity_logs_tenant_createdAt", columns: "tenantId,createdAt" },
  { table: "message_queue", name: "idx_message_queue_tenantId", columns: "tenantId" },
  { table: "message_queue", name: "idx_message_queue_tenant_status_nextAttemptAt", columns: "tenantId,status,nextAttemptAt" },
  { table: "lead_notes", name: "idx_lead_notes_tenantId", columns: "tenantId" },
  { table: "lead_tasks", name: "idx_lead_tasks_tenantId", columns: "tenantId" },
  { table: "lead_tasks", name: "idx_lead_tasks_tenant_status_dueDate", columns: "tenantId,status,dueDate" },
  { table: "appointments", name: "idx_appointments_tenantId", columns: "tenantId" },
  { table: "campaign_recipients", name: "idx_campaign_recipients_tenantId", columns: "tenantId" },
  { table: "campaign_recipients", name: "idx_campaign_recipients_tenant_status", columns: "tenantId,status" },
  { table: "access_logs", name: "idx_access_logs_tenantId", columns: "tenantId" },
  { table: "access_logs", name: "idx_access_logs_tenant_createdAt", columns: "tenantId,createdAt" },
  { table: "lead_reminders", name: "idx_lead_reminders_tenant_status_scheduledAt", columns: "tenantId,status,scheduledAt" },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    logger.error("[TenantIndexVerify] DATABASE_URL is required");
    process.exit(1);
  }

  const connection = await mysql.createConnection(databaseUrl);

  try {
    const indexNames = expectedIndexes.map((i) => i.name);
    const placeholders = indexNames.map(() => "?").join(",");

    const [rows] = await connection.query(
      `SELECT
         TABLE_NAME as tableName,
         INDEX_NAME as indexName,
         GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') as columnsList
       FROM information_schema.statistics
       WHERE TABLE_SCHEMA = DATABASE()
         AND INDEX_NAME IN (${placeholders})
       GROUP BY TABLE_NAME, INDEX_NAME`,
      indexNames,
    );

    const existing = new Map<string, string>();
    for (const row of rows as Array<{ tableName: string; indexName: string; columnsList: string }>) {
      existing.set(`${row.tableName}:${row.indexName}`, row.columnsList || "");
    }

    const missing: ExpectedIndex[] = [];
    const mismatched: Array<ExpectedIndex & { found: string }> = [];

    for (const expected of expectedIndexes) {
      const key = `${expected.table}:${expected.name}`;
      const found = existing.get(key);

      if (!found) {
        missing.push(expected);
        continue;
      }

      if (found !== expected.columns) {
        mismatched.push({ ...expected, found });
      }
    }

    if (missing.length === 0 && mismatched.length === 0) {
      logger.info({ checked: expectedIndexes.length }, "[TenantIndexVerify] OK: all expected tenant indexes are present");
      return;
    }

    if (missing.length > 0) {
      for (const index of missing) {
        logger.error({ table: index.table, index: index.name, expectedColumns: index.columns }, "[TenantIndexVerify] Missing index");
      }
    }

    if (mismatched.length > 0) {
      for (const index of mismatched) {
        logger.error(
          { table: index.table, index: index.name, expectedColumns: index.columns, foundColumns: index.found },
          "[TenantIndexVerify] Index column mismatch",
        );
      }
    }

    process.exit(1);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  logger.error({ err: error }, "[TenantIndexVerify] Unexpected failure");
  process.exit(1);
});
