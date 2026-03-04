import { eq, and, isNotNull, lt } from "drizzle-orm";
import { getDb } from "../db";
import {
    users,
    leads,
    chatMessages,
    accessLogs,
    sessions,
    activityLogs,
    leadNotes,
    leadTasks,
    conversations,
    fileUploads
} from "../../drizzle/schema";
import { logger } from "../_core/logger";

/**
 * GDPR Deletion Service
 * Implements Right to Erasure (Art. 17).
 */

/**
 * Scheduled job to find users with dataRetentionUntil past due and purge them.
 */
export async function processScheduledDeletions() {
    const db = await getDb();
    if (!db) return;

    const now = new Date();

    // Find users whose retention period has expired
    const expiredUsers = await db
        .select({ id: users.id, tenantId: users.tenantId, email: users.email })
        .from(users)
        .where(and(
            isNotNull(users.dataRetentionUntil),
            lt(users.dataRetentionUntil, now)
        ));

    if (expiredUsers.length === 0) return;

    logger.info({ count: expiredUsers.length }, "[GDPR] Processing scheduled deletions");

    for (const user of expiredUsers) {
        try {
            await purgeUserData(user.id, user.tenantId);
            logger.info({ userId: user.id }, "[GDPR] User purged successfully");
        } catch (err) {
            logger.error({ userId: user.id, err }, "[GDPR] Failed to purge user");
        }
    }
}

/**
 * Hard delete/Anonymize all data for a specific user
 */
export async function purgeUserData(userId: number, tenantId: number) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    await db.transaction(async (tx) => {
        // 1. Anonymize Leads (keep commercial data but remove PII)
        await tx.update(leads)
            .set({
                name: "[ANONYMIZED]",
                email: "deleted@gdpr.local",
                phone: "[DELETED]",
                assignedToId: null
            } as any)
            .where(and(eq(leads.tenantId, tenantId), eq(leads.assignedToId, userId)));

        // 2. Clear Messages PII
        await tx.update(chatMessages)
            .set({
                content: "[MESSAGE PURGED BY GDPR REQUEST]",
                mediaUrl: null
            } as any)
            .where(and(eq(chatMessages.tenantId, tenantId), eq((chatMessages as any).userId, userId)));

        // 3. Delete activity logs (contain action details that may include PII)
        await tx.delete(activityLogs)
            .where(and(eq(activityLogs.tenantId, tenantId), eq(activityLogs.userId, userId)));

        // 4. Delete access logs
        await tx.delete(accessLogs)
            .where(and(eq(accessLogs.tenantId, tenantId), eq(accessLogs.userId, userId)));

        // 5. Anonymize lead notes created by this user
        await tx.update(leadNotes)
            .set({ content: "[NOTE PURGED BY GDPR REQUEST]", createdById: null } as any)
            .where(and(eq(leadNotes.tenantId, tenantId), eq(leadNotes.createdById, userId)));

        // 6. Unassign lead tasks from this user
        await tx.update(leadTasks)
            .set({ assignedToId: null } as any)
            .where(and(eq(leadTasks.tenantId, tenantId), eq(leadTasks.assignedToId, userId)));

        // 7. Unassign conversations from this user
        await tx.update(conversations)
            .set({ assignedToId: null } as any)
            .where(and(eq(conversations.tenantId, tenantId), eq(conversations.assignedToId, userId)));

        // 8. Nullify file upload ownership (files retained for business records)
        await tx.update(fileUploads)
            .set({ userId: null } as any)
            .where(and(eq(fileUploads.tenantId, tenantId), eq(fileUploads.userId, userId)));

        // 9. Delete Sessions
        await tx.delete(sessions)
            .where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId)));

        // 10. Finally delete the user account
        // Tables with onDelete:"cascade" (supportUserQueues, leadReminders, termsAcceptance,
        // goals, achievements, internalMessages.senderId) are auto-deleted.
        // Tables with onDelete:"set null" (campaigns.createdById, integrations.createdById,
        // appointments.createdById, quotations.createdById) are auto-nullified.
        await tx.delete(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    });
}
