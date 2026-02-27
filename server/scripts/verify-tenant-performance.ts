import mysql from "mysql2/promise";
import { logger } from "../_core/logger";

type ExplainRow = {
  id: number;
  select_type: string;
  table: string;
  type: string;
  possible_keys: string | null;
  key: string | null;
  key_len: string | null;
  ref: string | null;
  rows: number;
  filtered: number;
  Extra: string | null;
};

type Probe = {
  name: string;
  sql: string;
  params: Array<number | string>;
  expectedIndexHint?: string;
};

function parseTenantId(raw: string | undefined): number {
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`TENANT_ID must be a positive integer (received: ${raw})`);
  }
  return parsed;
}

function isBadPlan(row: ExplainRow): boolean {
  const accessType = (row.type || "").toUpperCase();
  return accessType === "ALL" || !row.key;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error("[TenantPerfVerify] DATABASE_URL is required");
    process.exit(1);
  }

  const tenantId = parseTenantId(process.env.TENANT_ID);
  if (!process.env.TENANT_ID) {
    logger.warn({ tenantId }, "[TenantPerfVerify] TENANT_ID not provided, defaulting to 1");
  }

  const probes: Probe[] = [
    {
      name: "leads_recent",
      sql: "EXPLAIN SELECT id, name, status, createdAt FROM leads WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 50",
      params: [tenantId],
      expectedIndexHint: "idx_leads_tenant_createdAt",
    },
    {
      name: "conversations_recent",
      sql: "EXPLAIN SELECT id, status, lastMessageAt FROM conversations WHERE tenantId = ? ORDER BY lastMessageAt DESC LIMIT 50",
      params: [tenantId],
      expectedIndexHint: "idx_conversations_tenant_lastMessageAt",
    },
    {
      name: "chat_messages_recent",
      sql: "EXPLAIN SELECT id, conversationId, createdAt FROM chat_messages WHERE tenantId = ? ORDER BY createdAt DESC LIMIT 100",
      params: [tenantId],
      expectedIndexHint: "idx_chat_messages_tenant_createdAt",
    },
    {
      name: "message_queue_due",
      sql: "EXPLAIN SELECT id, status, nextAttemptAt FROM message_queue WHERE tenantId = ? AND status IN ('queued','failed') ORDER BY nextAttemptAt ASC LIMIT 100",
      params: [tenantId],
      expectedIndexHint: "idx_message_queue_tenant_status_nextAttemptAt",
    },
    {
      name: "lead_tasks_open_due",
      sql: "EXPLAIN SELECT id, status, dueDate FROM lead_tasks WHERE tenantId = ? AND status = 'pending' ORDER BY dueDate ASC LIMIT 100",
      params: [tenantId],
      expectedIndexHint: "idx_lead_tasks_tenant_status_dueDate",
    },
  ];

  const connection = await mysql.createConnection(databaseUrl);

  try {
    let hasCriticalIssue = false;

    for (const probe of probes) {
      const [rows] = await connection.query(probe.sql, probe.params);
      const explainRows = rows as ExplainRow[];

      if (explainRows.length === 0) {
        logger.warn({ probe: probe.name }, "[TenantPerfVerify] No EXPLAIN rows returned");
        continue;
      }

      for (const row of explainRows) {
        const payload = {
          probe: probe.name,
          table: row.table,
          accessType: row.type,
          key: row.key,
          possibleKeys: row.possible_keys,
          estimatedRows: row.rows,
          filteredPct: row.filtered,
          extra: row.Extra,
          expectedIndexHint: probe.expectedIndexHint,
        };

        if (isBadPlan(row)) {
          hasCriticalIssue = true;
          logger.error(payload, "[TenantPerfVerify] Critical query plan issue (full scan/no key)");
        } else {
          logger.info(payload, "[TenantPerfVerify] Query plan OK");
        }
      }
    }

    if (hasCriticalIssue) {
      logger.error("[TenantPerfVerify] FAILED: at least one critical query is not using an index");
      process.exit(1);
    }

    logger.info("[TenantPerfVerify] OK: all critical tenant queries use indexed plans");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  logger.error({ err: error }, "[TenantPerfVerify] Unexpected failure");
  process.exit(1);
});
