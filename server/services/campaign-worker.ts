
import cron from "node-cron";
import { getDb } from "../db";
import { campaigns, campaignRecipients, whatsappNumbers, whatsappConnections, templates, leads } from "../../drizzle/schema";
import { eq, and, lte, inArray, sql } from "drizzle-orm";
import { sendCloudTemplate } from "../whatsapp/cloud";
import { sendEmail } from "../_core/email";
import { decryptSecret } from "../_core/crypto";
import { dispatchIntegrationEvent } from "../_core/integrationDispatch";

import { logger } from "../_core/logger";

// Concurrency limit per tick
const BATCH_SIZE = 50;

export function startCampaignWorker() {
    logger.info("[CampaignWorker] Starting worker...");

    // Run every minute
    cron.schedule("* * * * *", async () => {
        try {
            await processScheduledCampaigns();
            await processRunningCampaigns();
        } catch (err) {
            logger.error("[CampaignWorker] Error in cron job:", err);
        }
    });
}

async function processScheduledCampaigns() {
    const db = await getDb();
    if (!db) return;

    const now = new Date();

    // Find campaigns that are scheduled and due — ALL tenants are processed but each is isolated
    const dueCampaigns = await db
        .select()
        .from(campaigns)
        .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, now)));

    for (const campaign of dueCampaigns) {
        // Advisory lock per campaign to prevent double-processing in multi-instance
        try {
            const lockResult = await db.execute(sql`SELECT GET_LOCK(CONCAT('campaign_', ${campaign.id}), 0) AS acquired`);
            const acquired = (lockResult as any)?.[0]?.[0]?.acquired;
            if (acquired !== 1) {
                logger.info(`[CampaignWorker] Campaign ${campaign.id} already being processed by another instance, skipping.`);
                continue;
            }
        } catch {
            // If advisory lock not available (e.g. MockDB), proceed but log warning
            logger.warn(`[CampaignWorker] Advisory lock not available for campaign ${campaign.id}, proceeding without lock.`);
        }

        logger.info(`[CampaignWorker] Starting campaign ${campaign.id}: ${campaign.name} (tenant ${campaign.tenantId})`);
        await db
            .update(campaigns)
            .set({ status: "running", startedAt: now })
            .where(and(eq(campaigns.id, campaign.id), eq(campaigns.tenantId, campaign.tenantId)));

        // Trigger integration webhooks — TENANT-SCOPED connection lookup
        const conn = await db.select().from(whatsappConnections)
            .where(and(
                eq(whatsappConnections.tenantId, campaign.tenantId),
                eq(whatsappConnections.isConnected, true)
            ))
            .limit(1);
        if (conn[0]?.whatsappNumberId) {
            void dispatchIntegrationEvent({
                whatsappNumberId: conn[0].whatsappNumberId,
                event: "campaign_started",
                data: { campaignId: campaign.id, name: campaign.name, type: campaign.type, startedAt: now.toISOString() },
            });
        }

        // Release advisory lock
        try {
            await db.execute(sql`SELECT RELEASE_LOCK(CONCAT('campaign_', ${campaign.id}))`);
        } catch { /* ignore */ }
    }
}

async function processRunningCampaigns() {
    const db = await getDb();
    if (!db) return;

    const running = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.status, "running"));

    for (const campaign of running) {
        // Advisory lock per campaign
        try {
            const lockResult = await db.execute(sql`SELECT GET_LOCK(CONCAT('campaign_run_', ${campaign.id}), 0) AS acquired`);
            const acquired = (lockResult as any)?.[0]?.[0]?.acquired;
            if (acquired !== 1) continue;
        } catch { /* proceed without lock */ }

        try {
            if (campaign.type === "whatsapp") {
                await processWhatsAppCampaignBatch(campaign);
            } else {
                await processEmailCampaignBatch(campaign);
            }
        } finally {
            try {
                await db.execute(sql`SELECT RELEASE_LOCK(CONCAT('campaign_run_', ${campaign.id}))`);
            } catch { /* ignore */ }
        }
    }
}

function renderMessage(template: string, vars: Record<string, any>) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
        const v = (vars as any)[key];
        return v === undefined || v === null ? "" : String(v);
    });
}

async function completeCampaign(db: any, campaign: typeof campaigns.$inferSelect) {
    const completedAt = new Date();
    await db.update(campaigns)
        .set({ status: "completed", completedAt })
        .where(and(eq(campaigns.id, campaign.id), eq(campaigns.tenantId, campaign.tenantId)));

    // TENANT-SCOPED connection lookup
    const conn = await db.select().from(whatsappConnections)
        .where(and(
            eq(whatsappConnections.tenantId, campaign.tenantId),
            eq(whatsappConnections.isConnected, true)
        ))
        .limit(1);
    if (conn[0]?.whatsappNumberId) {
        void dispatchIntegrationEvent({
            whatsappNumberId: conn[0].whatsappNumberId,
            event: "campaign_completed",
            data: { campaignId: campaign.id, name: campaign.name, type: campaign.type, completedAt: completedAt.toISOString() },
        });
    }
}

async function processEmailCampaignBatch(campaign: typeof campaigns.$inferSelect) {
    const db = await getDb();
    if (!db) return;

    const recipients = await db
        .select()
        .from(campaignRecipients)
        .where(and(
            eq(campaignRecipients.campaignId, campaign.id),
            eq(campaignRecipients.tenantId, campaign.tenantId),
            eq(campaignRecipients.status, "pending")
        ))
        .limit(BATCH_SIZE);

    if (recipients.length === 0) {
        logger.info(`[CampaignWorker] Email campaign ${campaign.id} completed.`);
        await completeCampaign(db, campaign);
        return;
    }

    for (const recipient of recipients) {
        try {
            // TENANT-SCOPED lead lookup
            const leadRes = await db
                .select({
                    email: leads.email,
                    name: leads.name,
                    phone: leads.phone,
                    country: leads.country,
                    notes: leads.notes,
                })
                .from(leads)
                .where(and(eq(leads.id, recipient.leadId), eq(leads.tenantId, campaign.tenantId)))
                .limit(1);

            const lead = leadRes[0];
            if (!lead || !lead.email) {
                await updateRecipientStatus(db, recipient.id, "failed", "Lead sin email");
                await db.update(campaigns)
                    .set({ messagesFailed: sql`${campaigns.messagesFailed} + 1` })
                    .where(eq(campaigns.id, campaign.id));
                continue;
            }

            const html = renderMessage(campaign.message || "", {
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                country: lead.country,
                notes: lead.notes,
            });

            const ok = await sendEmail({
                tenantId: campaign.tenantId,
                to: String(lead.email),
                subject: campaign.name,
                html,
                text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
            });

            if (!ok) {
                await updateRecipientStatus(db, recipient.id, "failed", "SMTP no configurado");
                await db.update(campaigns)
                    .set({ messagesFailed: sql`${campaigns.messagesFailed} + 1` })
                    .where(eq(campaigns.id, campaign.id));
                continue;
            }

            const now = new Date();
            await db.update(campaignRecipients)
                .set({
                    status: "delivered",
                    sentAt: now,
                    deliveredAt: now,
                })
                .where(eq(campaignRecipients.id, recipient.id));

            await db.update(campaigns)
                .set({
                    messagesSent: sql`${campaigns.messagesSent} + 1`,
                    messagesDelivered: sql`${campaigns.messagesDelivered} + 1`,
                })
                .where(eq(campaigns.id, campaign.id));

        } catch (error: any) {
            logger.error(`[CampaignWorker] Failed to email recipient ${recipient.id}:`, error.message);
            await updateRecipientStatus(db, recipient.id, "failed", error.message);
            await db.update(campaigns)
                .set({ messagesFailed: sql`${campaigns.messagesFailed} + 1` })
                .where(eq(campaigns.id, campaign.id));
        }
    }
}

async function processWhatsAppCampaignBatch(campaign: typeof campaigns.$inferSelect) {
    const db = await getDb();
    if (!db) return;

    // 1. Get recipients pending — TENANT-SCOPED
    const recipients = await db
        .select()
        .from(campaignRecipients)
        .where(and(
            eq(campaignRecipients.campaignId, campaign.id),
            eq(campaignRecipients.tenantId, campaign.tenantId),
            eq(campaignRecipients.status, "pending")
        ))
        .limit(BATCH_SIZE);

    if (recipients.length === 0) {
        logger.info(`[CampaignWorker] WhatsApp campaign ${campaign.id} completed.`);
        await completeCampaign(db, campaign);
        return;
    }

    // 2. Get connection credentials — TENANT-SCOPED + API only
    const connections = await db.select()
        .from(whatsappConnections)
        .where(and(
            eq(whatsappConnections.tenantId, campaign.tenantId),
            eq(whatsappConnections.isConnected, true),
            eq(whatsappConnections.connectionType, "api")
        ));

    if (connections.length === 0) {
        logger.warn(`[CampaignWorker] No active Meta Cloud API connections found for tenant ${campaign.tenantId}. Pausing campaign ${campaign.id}.`);
        await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, campaign.id));
        return;
    }

    const defaultConnection = connections[0];
    const resolvedDefaultAccessToken = decryptSecret(defaultConnection.accessToken);
    const resolvedDefaultPhoneNumberId = defaultConnection.phoneNumberId;

    if (!resolvedDefaultAccessToken || !resolvedDefaultPhoneNumberId) {
        logger.error(`[CampaignWorker] Connection ${defaultConnection.id} missing credentials.`);
        await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, campaign.id));
        return;
    }

    // 3. Get Template — TENANT-SCOPED
    let templateName = "";
    let languageCode = "es";

    if (campaign.templateId) {
        const tmpl = await db.select().from(templates)
            .where(and(eq(templates.id, campaign.templateId), eq(templates.tenantId, campaign.tenantId)))
            .limit(1);
        if (tmpl[0]) {
            templateName = tmpl[0].name;
        }
    }

    if (!templateName) {
        logger.error(`[CampaignWorker] Campaign ${campaign.id} has no valid template.`);
        await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, campaign.id));
        return;
    }

    // 4. Send Messages
    for (const recipient of recipients) {
        try {
            // TENANT-SCOPED lead lookup
            const leadRes = await db
                .select({ phone: leads.phone, name: leads.name })
                .from(leads)
                .where(and(eq(leads.id, recipient.leadId), eq(leads.tenantId, campaign.tenantId)))
                .limit(1);

            if (!leadRes[0] || !leadRes[0].phone) {
                await updateRecipientStatus(db, recipient.id, "failed", "Lead no encontrado o sin teléfono");
                await db.update(campaigns)
                    .set({ messagesFailed: sql`${campaigns.messagesFailed} + 1` })
                    .where(eq(campaigns.id, campaign.id));
                continue;
            }

            const phone = leadRes[0].phone.replace(/\D/g, "");

            // Connection selection — ONLY from tenant's connections
            const connForRecipient = recipient.whatsappNumberId
                ? connections.find(c => c.whatsappNumberId === recipient.whatsappNumberId) ?? defaultConnection
                : defaultConnection;

            const accessToken = decryptSecret(connForRecipient.accessToken) ?? resolvedDefaultAccessToken;
            const phoneNumberId = connForRecipient.phoneNumberId ?? resolvedDefaultPhoneNumberId;

            if (!accessToken || !phoneNumberId) {
                await updateRecipientStatus(db, recipient.id, "failed", "WhatsApp connection missing credentials");
                await db.update(campaigns)
                    .set({ messagesFailed: sql`${campaigns.messagesFailed} + 1` })
                    .where(eq(campaigns.id, campaign.id));
                continue;
            }

            const { messageId } = await sendCloudTemplate({
                accessToken,
                phoneNumberId,
                to: phone,
                templateName,
                languageCode
            });

            await db.update(campaignRecipients)
                .set({
                    status: "sent",
                    sentAt: new Date(),
                    whatsappNumberId: connForRecipient.whatsappNumberId,
                    whatsappMessageId: messageId,
                })
                .where(eq(campaignRecipients.id, recipient.id));

            await db.update(campaigns)
                .set({ messagesSent: sql`${campaigns.messagesSent} + 1` })
                .where(eq(campaigns.id, campaign.id));

        } catch (error: any) {
            logger.error(`[CampaignWorker] Failed to send to recipient ${recipient.id}:`, error.message);
            await updateRecipientStatus(db, recipient.id, "failed", error.message);
            await db.update(campaigns)
                .set({ messagesFailed: sql`${campaigns.messagesFailed} + 1` })
                .where(eq(campaigns.id, campaign.id));
        }
    }
}

async function updateRecipientStatus(db: any, id: number, status: any, errorMessage?: string) {
    await db.update(campaignRecipients)
        .set({ status, errorMessage: errorMessage || null })
        .where(eq(campaignRecipients.id, id));
}
