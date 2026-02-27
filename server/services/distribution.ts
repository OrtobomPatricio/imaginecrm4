
import { getDb } from "../db";
import { appSettings, users, conversations } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../_core/logger";

/**
 * FIX (LOGIC-01): Distribute conversation to agents with proper tenant isolation.
 *
 * Supports distribution modes:
 * - round_robin: Cycle through eligible agents deterministically
 * - least_active: Assign to agent with fewest active conversations
 * - manual: No auto-assignment (admin assigns manually)
 *
 * CRITICAL: Must filter agents by tenantId to prevent cross-tenant assignment.
 */
export async function distributeConversation(conversationId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;

    // 1. Get the conversation to know the tenantId
    const [conv] = await db.select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        assignedToId: conversations.assignedToId,
    })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

    if (!conv) {
        logger.warn({ conversationId }, "[Distribution] Conversation not found");
        return;
    }

    // Already assigned? Skip
    if (conv.assignedToId) return;

    const tenantId = conv.tenantId;

    // 2. Get tenant settings (FILTERED BY TENANT)
    const settingsList = await db.select()
        .from(appSettings)
        .where(eq(appSettings.tenantId, tenantId))
        .limit(1);

    const settings = settingsList[0];
    if (!settings || !settings.chatDistributionConfig) return;

    const config = settings.chatDistributionConfig as any;

    // Manual mode = no auto-assignment
    if (config.mode === "manual" || !config.mode) return;

    // 3. Get eligible agents (FILTERED BY TENANT)
    const allUsers = await db.select()
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.isActive, true)));

    const eligibleAgents = allUsers.filter((u: any) => {
        if (u.role === "viewer") return false;
        if (config.excludeAgentIds?.includes(u.id)) return false;
        return true;
    });

    if (eligibleAgents.length === 0) {
        logger.warn({ tenantId }, "[Distribution] No eligible agents found");
        return;
    }

    // Sort by ID for deterministic order
    eligibleAgents.sort((a: any, b: any) => a.id - b.id);

    let nextAgent = eligibleAgents[0];

    if (config.mode === "round_robin") {
        const lastId = settings.lastAssignedAgentId;
        if (lastId) {
            const lastIndex = eligibleAgents.findIndex((a: any) => a.id === lastId);
            if (lastIndex !== -1 && lastIndex < eligibleAgents.length - 1) {
                nextAgent = eligibleAgents[lastIndex + 1];
            }
            // If last element, cycle back to index 0
        }
    } else if (config.mode === "least_active") {
        // Count active conversations per agent
        const allConvs = await db.select({
            assignedToId: conversations.assignedToId,
        })
            .from(conversations)
            .where(and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.status, "active")
            ));

        const countMap: Record<number, number> = {};
        for (const c of allConvs) {
            if (c.assignedToId) {
                countMap[c.assignedToId] = (countMap[c.assignedToId] || 0) + 1;
            }
        }

        let minCount = Infinity;
        for (const agent of eligibleAgents) {
            const count = countMap[agent.id] || 0;
            if (count < minCount) {
                minCount = count;
                nextAgent = agent;
            }
        }
    }

    // 4. Assign atomically
    await db.transaction(async (tx) => {
        await tx.update(conversations)
            .set({ assignedToId: nextAgent.id })
            .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenantId)));

        await tx.update(appSettings)
            .set({ lastAssignedAgentId: nextAgent.id })
            .where(eq(appSettings.id, settings.id));
    });

    logger.info({
        conversationId,
        tenantId,
        agentId: nextAgent.id,
        agentName: (nextAgent as any).name,
        mode: config.mode,
    }, "[Distribution] Conversation assigned");
}
