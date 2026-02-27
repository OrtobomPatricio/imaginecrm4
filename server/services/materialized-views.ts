import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "../_core/logger";

/**
 * Materialized Views for Dashboard and Reporting
 *
 * Creates pre-computed aggregate tables that are refreshed periodically,
 * dramatically speeding up dashboard queries and reports.
 *
 * Views:
 * 1. mv_lead_counts_by_status — Leads aggregated by status per tenant
 * 2. mv_daily_message_volume — Messages per day per tenant
 * 3. mv_pipeline_summary — Pipeline stage counts and values
 * 4. mv_agent_performance — Messages handled per agent
 *
 * Refresh strategy: Called by a cron job every 15 minutes.
 * Run manually: `npx tsx server/scripts/refresh-materialized-views.ts`
 */

export async function createMaterializedViews(): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const views = [
        // 1. Lead counts by status per tenant
        `CREATE TABLE IF NOT EXISTS mv_lead_counts_by_status (
            tenantId INT NOT NULL,
            status VARCHAR(50) NOT NULL,
            cnt INT NOT NULL DEFAULT 0,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenantId, status),
            INDEX idx_mv_leads_tenant (tenantId)
        )`,

        // 2. Daily message volume
        `CREATE TABLE IF NOT EXISTS mv_daily_message_volume (
            tenantId INT NOT NULL,
            msgDate DATE NOT NULL,
            totalMessages INT NOT NULL DEFAULT 0,
            inbound INT NOT NULL DEFAULT 0,
            outbound INT NOT NULL DEFAULT 0,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenantId, msgDate),
            INDEX idx_mv_volume_tenant (tenantId)
        )`,

        // 3. Pipeline summary
        `CREATE TABLE IF NOT EXISTS mv_pipeline_summary (
            tenantId INT NOT NULL,
            pipelineId INT NOT NULL,
            stageId INT NOT NULL,
            stageName VARCHAR(100) NOT NULL DEFAULT '',
            leadCount INT NOT NULL DEFAULT 0,
            totalValue DECIMAL(15,2) NOT NULL DEFAULT 0,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenantId, pipelineId, stageId),
            INDEX idx_mv_pipeline_tenant (tenantId)
        )`,

        // 4. Agent performance
        `CREATE TABLE IF NOT EXISTS mv_agent_performance (
            tenantId INT NOT NULL,
            userId INT NOT NULL,
            periodDate DATE NOT NULL,
            messagesHandled INT NOT NULL DEFAULT 0,
            leadsAssigned INT NOT NULL DEFAULT 0,
            avgResponseTimeSec INT DEFAULT NULL,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (tenantId, userId, periodDate),
            INDEX idx_mv_agent_tenant (tenantId)
        )`,
    ];

    for (const stmt of views) {
        try {
            await db.execute(sql.raw(stmt));
        } catch (err: any) {
            if (!err?.message?.includes("already exists")) {
                logger.error({ err, stmt: stmt.slice(0, 50) }, "[MV] Failed to create materialized view");
            }
        }
    }

    logger.info("[MV] Materialized view tables ensured");
}

/**
 * Refresh all materialized views with fresh data.
 * Called by cron every 15 minutes.
 */
export async function refreshMaterializedViews(): Promise<void> {
    const db = await getDb();
    if (!db) return;

    const start = Date.now();

    const runRefreshStep = async (name: string, query: ReturnType<typeof sql>) => {
        try {
            await db.execute(query);
        } catch (err: any) {
            logger.error(
                {
                    step: name,
                    err: err?.message,
                    cause: err?.cause?.message,
                    code: err?.code ?? err?.cause?.code,
                },
                "[MV] Step failed"
            );
        }
    };

    try {
        // 1. Refresh lead counts
        await runRefreshStep("mv_lead_counts_by_status", sql`
            REPLACE INTO mv_lead_counts_by_status (tenantId, status, cnt, updatedAt)
            SELECT
                COALESCE(tenantId, 1) as tenantId,
                COALESCE(NULLIF(status, ''), 'new') as status,
                COUNT(*) as cnt,
                NOW()
            FROM leads
            WHERE COALESCE(tenantId, 0) > 0
            GROUP BY COALESCE(tenantId, 1), COALESCE(NULLIF(status, ''), 'new')
        `);

        // 2. Refresh daily message volume (last 90 days)
        await runRefreshStep("mv_daily_message_volume", sql`
            REPLACE INTO mv_daily_message_volume (tenantId, msgDate, totalMessages, inbound, outbound, updatedAt)
            SELECT
                tenantId,
                DATE(createdAt) as msgDate,
                COUNT(*) as totalMessages,
                SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) as inbound,
                SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) as outbound,
                NOW()
            FROM chat_messages
            WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
            GROUP BY tenantId, DATE(createdAt)
        `);

        // 3. Refresh pipeline summary
        await runRefreshStep("mv_pipeline_summary", sql`
            REPLACE INTO mv_pipeline_summary (tenantId, pipelineId, stageId, stageName, leadCount, totalValue, updatedAt)
            SELECT
                ps.tenantId,
                ps.pipelineId,
                ps.id as stageId,
                ps.name as stageName,
                COUNT(l.id) as leadCount,
                COALESCE(SUM(l.value), 0) as totalValue,
                NOW()
            FROM pipeline_stages ps
            LEFT JOIN leads l ON l.pipelineStageId = ps.id
            GROUP BY ps.tenantId, ps.pipelineId, ps.id, ps.name
        `);

        // 4. Refresh agent performance (last 30 days)
        await runRefreshStep("mv_agent_performance", sql`
            REPLACE INTO mv_agent_performance (tenantId, userId, periodDate, messagesHandled, leadsAssigned, updatedAt)
            SELECT
                cm.tenantId,
                c.assignedToId as userId,
                DATE(cm.createdAt) as periodDate,
                COUNT(*) as messagesHandled,
                0,
                NOW()
            FROM chat_messages cm
            JOIN conversations c ON c.id = cm.conversationId
            WHERE cm.direction = 'outbound'
              AND cm.createdAt >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
              AND c.assignedToId IS NOT NULL
            GROUP BY cm.tenantId, c.assignedToId, DATE(cm.createdAt)
        `);

        const elapsed = Date.now() - start;
        logger.info({ elapsedMs: elapsed }, "[MV] All materialized views refreshed");

    } catch (err: any) {
        logger.error({ err: err.message, stack: err.stack }, "[MV] Failed to refresh materialized views");
    }
}

// Allow running as standalone script only when explicitly requested.
// This avoids accidental process termination when bundled into dist/index.js.
if (process.env.RUN_MV_STANDALONE === "1") {
    (async () => {
        await createMaterializedViews();
        await refreshMaterializedViews();
        process.exit(0);
    })();
}
