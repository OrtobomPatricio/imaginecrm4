import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { tenants } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger } from "../_core/logger";
import { getPayPalBaseUrl, getPayPalAccessToken } from "./billing";

/**
 * PayPal Webhook Handler
 *
 * Processes PayPal billing events:
 * - BILLING.SUBSCRIPTION.ACTIVATED → Update tenant plan
 * - BILLING.SUBSCRIPTION.CANCELLED → Downgrade to free
 * - BILLING.SUBSCRIPTION.SUSPENDED → Suspend tenant
 * - PAYMENT.SALE.COMPLETED → Ensure tenant is active
 * - PAYMENT.SALE.DENIED → Suspend tenant
 *
 * Requires PAYPAL_WEBHOOK_ID env var for signature verification.
 */

async function verifyPayPalWebhook(req: Request): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
        logger.warn("[PayPalWebhook] PAYPAL_WEBHOOK_ID not set, skipping verification");
        return false;
    }

    try {
        const token = await getPayPalAccessToken();
        const baseUrl = getPayPalBaseUrl();

        const verifyBody = {
            auth_algo: req.headers["paypal-auth-algo"],
            cert_url: req.headers["paypal-cert-url"],
            transmission_id: req.headers["paypal-transmission-id"],
            transmission_sig: req.headers["paypal-transmission-sig"],
            transmission_time: req.headers["paypal-transmission-time"],
            webhook_id: webhookId,
            webhook_event: req.body,
        };

        const res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(verifyBody),
        });

        if (!res.ok) {
            const text = await res.text();
            logger.error({ status: res.status, body: text }, "[PayPalWebhook] Verification API error");
            return false;
        }

        const data = (await res.json()) as { verification_status: string };
        return data.verification_status === "SUCCESS";
    } catch (err) {
        logger.error({ err }, "[PayPalWebhook] Verification failed");
        return false;
    }
}

/** Parse custom_id format: "tenantId|plan" */
function parseCustomId(customId?: string): { tenantId: number; plan: string } | null {
    if (!customId) return null;
    const parts = customId.split("|");
    if (parts.length !== 2) return null;
    const tenantId = Number(parts[0]);
    const plan = parts[1];
    if (!tenantId || !plan) return null;
    return { tenantId, plan };
}

// Simple in-memory deduplication for webhook event IDs (PayPal can redeliver)
// All operations below are idempotent SETs, so duplicates are safe but wasteful.
const processedEventIds = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEDUP_MAX_SIZE = 500;

function pruneProcessedEvents(): void {
    const now = Date.now();
    for (const [id, ts] of processedEventIds) {
        if (now - ts > DEDUP_TTL_MS) processedEventIds.delete(id);
    }
}

export function registerPayPalWebhookRoutes(app: Express): void {
    app.post("/api/webhooks/paypal", async (req: Request, res: Response) => {
        const webhookId = process.env.PAYPAL_WEBHOOK_ID;
        if (!webhookId) {
            logger.warn("[PayPalWebhook] PAYPAL_WEBHOOK_ID not set, ignoring");
            return res.sendStatus(400);
        }

        // Verify webhook signature
        const verified = await verifyPayPalWebhook(req);
        if (!verified) {
            logger.warn("[PayPalWebhook] Signature verification failed");
            return res.status(400).send("Webhook verification failed");
        }

        const event = req.body;
        const eventType: string = event?.event_type ?? "";
        const resource = event?.resource ?? {};
        const eventId: string | undefined = event?.id;

        // Deduplicate: skip if this event was already processed recently
        if (eventId && processedEventIds.has(eventId)) {
            logger.debug({ eventId, eventType }, "[PayPalWebhook] Duplicate event skipped");
            return res.json({ received: true, duplicate: true });
        }

        logger.info({ eventType, id: eventId }, "[PayPalWebhook] Event received");

        try {
            const db = await getDb();
            if (!db) return res.sendStatus(500);

            switch (eventType) {
                /* ── Subscription activated (user approved + first payment) ──── */
                case "BILLING.SUBSCRIPTION.ACTIVATED": {
                    const subscriptionId = resource.id as string;
                    const customId = resource.custom_id as string | undefined;
                    const parsed = parseCustomId(customId);

                    if (parsed) {
                        await db.update(tenants).set({
                            plan: parsed.plan,
                            paypalSubscriptionId: subscriptionId,
                            status: "active",
                        } as any).where(eq(tenants.id, parsed.tenantId));

                        logger.info(
                            { tenantId: parsed.tenantId, plan: parsed.plan, subscriptionId },
                            "[PayPalWebhook] Subscription activated"
                        );
                    } else {
                        logger.warn({ subscriptionId, customId }, "[PayPalWebhook] Could not parse custom_id");
                    }
                    break;
                }

                /* ── Subscription cancelled ──── */
                case "BILLING.SUBSCRIPTION.CANCELLED": {
                    const subscriptionId = resource.id as string;
                    const customId = resource.custom_id as string | undefined;
                    const parsed = parseCustomId(customId);

                    if (parsed) {
                        await db.update(tenants).set({
                            plan: "free",
                        } as any).where(eq(tenants.id, parsed.tenantId));
                    } else {
                        // Fallback: find by subscription ID
                        await db.update(tenants).set({
                            plan: "free",
                        } as any).where(eq((tenants as any).paypalSubscriptionId, subscriptionId));
                    }

                    logger.warn({ subscriptionId }, "[PayPalWebhook] Subscription cancelled → free");
                    break;
                }

                /* ── Subscription suspended (payment failure) ──── */
                case "BILLING.SUBSCRIPTION.SUSPENDED": {
                    const subscriptionId = resource.id as string;
                    const customId = resource.custom_id as string | undefined;
                    const parsed = parseCustomId(customId);

                    if (parsed) {
                        await db.update(tenants).set({
                            status: "suspended",
                        } as any).where(eq(tenants.id, parsed.tenantId));
                    } else {
                        await db.update(tenants).set({
                            status: "suspended",
                        } as any).where(eq((tenants as any).paypalSubscriptionId, subscriptionId));
                    }

                    logger.error({ subscriptionId }, "[PayPalWebhook] Subscription suspended");
                    break;
                }

                /* ── Payment completed ──── */
                case "PAYMENT.SALE.COMPLETED": {
                    const billingAgreementId = resource.billing_agreement_id as string | undefined;
                    if (billingAgreementId) {
                        await db.update(tenants).set({
                            status: "active",
                        } as any).where(eq((tenants as any).paypalSubscriptionId, billingAgreementId));

                        logger.info({ billingAgreementId }, "[PayPalWebhook] Payment completed, tenant active");
                    }
                    break;
                }

                /* ── Payment denied ──── */
                case "PAYMENT.SALE.DENIED":
                case "PAYMENT.SALE.REFUNDED": {
                    const billingAgreementId = resource.billing_agreement_id as string | undefined;
                    if (billingAgreementId) {
                        await db.update(tenants).set({
                            status: "suspended",
                        } as any).where(eq((tenants as any).paypalSubscriptionId, billingAgreementId));

                        logger.error({ billingAgreementId }, "[PayPalWebhook] Payment denied/refunded, tenant suspended");
                    }
                    break;
                }

                default:
                    logger.debug({ eventType }, "[PayPalWebhook] Unhandled event");
            }

            // Mark event as processed for deduplication
            if (eventId) {
                processedEventIds.set(eventId, Date.now());
                if (processedEventIds.size > DEDUP_MAX_SIZE) pruneProcessedEvents();
            }

            res.json({ received: true });
        } catch (err) {
            logger.error({ err }, "[PayPalWebhook] Processing error");
            res.status(500).send("Webhook processing error");
        }
    });

    logger.info("[PayPalWebhook] Registered at /api/webhooks/paypal");
}
