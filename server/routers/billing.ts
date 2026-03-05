import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, license } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";

/**
 * PayPal Billing Router
 *
 * Manages subscriptions, plan changes, and billing events.
 * Requires PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and plan IDs env vars.
 *
 * Plans:
 * - free:       5 users, 1 WA number,  1,000 msgs/month
 * - starter:   10 users, 3 WA numbers, 10,000 msgs/month
 * - pro:       50 users, 10 WA numbers, 100,000 msgs/month
 * - enterprise: unlimited
 */

const PLANS = {
    free: {
        name: "Gratis",
        maxUsers: 5,
        maxWaNumbers: 1,
        maxMessages: 1000,
        priceMonthly: 0,
    },
    starter: {
        name: "Starter",
        maxUsers: 10,
        maxWaNumbers: 3,
        maxMessages: 10000,
        priceMonthly: 12.90,
    },
    pro: {
        name: "Pro",
        maxUsers: 50,
        maxWaNumbers: 10,
        maxMessages: 100000,
        priceMonthly: 32.90,
    },
    enterprise: {
        name: "Enterprise",
        maxUsers: 9999,
        maxWaNumbers: 50,
        maxMessages: 1000000,
        priceMonthly: 99.90,
    },
} as const;

/* ── PayPal helpers ──────────────────────────────────────────── */

function getPayPalBaseUrl(): string {
    return process.env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(): Promise<string> {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) throw new Error("PayPal credentials missing");

    const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        },
        body: "grant_type=client_credentials",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PayPal token error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as { access_token: string };
    return data.access_token;
}

export { getPayPalBaseUrl, getPayPalAccessToken };

export const billingRouter = router({
    /** Get current plan and usage */
    getCurrentPlan: protectedProcedure
        .query(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [tenant] = await db.select()
                .from(tenants)
                .where(eq(tenants.id, ctx.tenantId))
                .limit(1);

            const currentPlan = ((tenant as any)?.plan as keyof typeof PLANS) || "free";
            const planInfo = PLANS[currentPlan] ?? PLANS.free;

            return {
                plan: currentPlan,
                planInfo,
                allPlans: PLANS,
                paypalSubscriptionId: (tenant as any)?.paypalSubscriptionId ?? null,
                trialEndsAt: (tenant as any)?.trialEndsAt ?? null,
            };
        }),

    /** Create a PayPal subscription for a plan upgrade */
    createSubscription: protectedProcedure
        .input(z.object({
            plan: z.enum(["starter", "pro", "enterprise"]),
        }))
        .mutation(async ({ input, ctx }) => {
            const clientId = process.env.PAYPAL_CLIENT_ID;
            if (!clientId) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "PayPal no está configurado. Contacta al administrador.",
                });
            }

            const planId = process.env[`PAYPAL_PLAN_${input.plan.toUpperCase()}`];
            if (!planId) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: `Plan de PayPal no configurado para: ${input.plan}`,
                });
            }

            try {
                const token = await getPayPalAccessToken();
                const baseUrl = getPayPalBaseUrl();
                const returnBase = process.env.APP_URL || process.env.CLIENT_URL || "";

                const res = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        plan_id: planId,
                        application_context: {
                            brand_name: "ImagineCRM",
                            locale: "es-ES",
                            shipping_preference: "NO_SHIPPING",
                            user_action: "SUBSCRIBE_NOW",
                            return_url: `${returnBase}/settings?tab=billing&success=true&plan=${input.plan}&tenantId=${ctx.tenantId}`,
                            cancel_url: `${returnBase}/settings?tab=billing&cancelled=true`,
                        },
                        custom_id: `${ctx.tenantId}|${input.plan}`,
                    }),
                });

                if (!res.ok) {
                    const text = await res.text();
                    logger.error({ status: res.status, body: text }, "[Billing] PayPal subscription create failed");
                    throw new Error(`PayPal API ${res.status}`);
                }

                const sub = (await res.json()) as { id: string; links: Array<{ rel: string; href: string }> };
                const approveLink = sub.links.find((l) => l.rel === "approve");

                logger.info(
                    { tenantId: ctx.tenantId, plan: input.plan, subscriptionId: sub.id },
                    "[Billing] PayPal subscription created"
                );

                return { url: approveLink?.href ?? null, subscriptionId: sub.id };
            } catch (err: any) {
                logger.error({ err }, "[Billing] Failed to create PayPal subscription");
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error al crear suscripción de PayPal",
                });
            }
        }),

    /** Get PayPal subscription management link */
    getManageUrl: protectedProcedure
        .mutation(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [tenant] = await db.select().from(tenants)
                .where(eq(tenants.id, ctx.tenantId)).limit(1);

            const subId = (tenant as any)?.paypalSubscriptionId;
            if (!subId) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "No hay suscripción activa.",
                });
            }

            // PayPal doesn't have a billing portal like Stripe.
            // Users manage subscriptions at paypal.com directly.
            const isLive = process.env.PAYPAL_MODE === "live";
            const url = isLive
                ? `https://www.paypal.com/myaccount/autopay`
                : `https://www.sandbox.paypal.com/myaccount/autopay`;

            return { url };
        }),

    /** Confirm subscription after PayPal redirect (called from frontend on success) */
    confirmSubscription: protectedProcedure
        .input(z.object({
            subscriptionId: z.string().min(1),
            plan: z.enum(["starter", "pro", "enterprise"]),
        }))
        .mutation(async ({ input, ctx }) => {
            try {
                const token = await getPayPalAccessToken();
                const baseUrl = getPayPalBaseUrl();

                // Verify subscription status with PayPal
                const res = await fetch(`${baseUrl}/v1/billing/subscriptions/${input.subscriptionId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!res.ok) {
                    throw new Error(`PayPal verify error ${res.status}`);
                }

                const sub = (await res.json()) as { id: string; status: string; custom_id?: string };

                if (sub.status !== "ACTIVE" && sub.status !== "APPROVED") {
                    throw new TRPCError({
                        code: "PRECONDITION_FAILED",
                        message: `Suscripción no activa: ${sub.status}`,
                    });
                }

                // Verify this subscription belongs to this tenant
                const expectedCustomId = `${ctx.tenantId}|${input.plan}`;
                if (sub.custom_id && sub.custom_id !== expectedCustomId) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Suscripción no válida para este tenant." });
                }

                const db = await getDb();
                if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

                await db.update(tenants).set({
                    plan: input.plan,
                    paypalSubscriptionId: input.subscriptionId,
                } as any).where(eq(tenants.id, ctx.tenantId));

                // Sync license limits with the new plan
                const planLimits = PLANS[input.plan];
                const [existingLicense] = await db.select().from(license)
                    .where(eq(license.tenantId, ctx.tenantId)).limit(1);

                if (existingLicense) {
                    await db.update(license).set({
                        status: 'active',
                        plan: input.plan,
                        maxUsers: planLimits.maxUsers,
                        maxWhatsappNumbers: planLimits.maxWaNumbers,
                        maxMessagesPerMonth: planLimits.maxMessages,
                        updatedAt: new Date(),
                    }).where(and(eq(license.tenantId, ctx.tenantId), eq(license.id, existingLicense.id)));
                }

                logger.info(
                    { tenantId: ctx.tenantId, plan: input.plan, subscriptionId: input.subscriptionId },
                    "[Billing] PayPal subscription confirmed"
                );

                return { success: true, plan: input.plan };
            } catch (err: any) {
                if (err instanceof TRPCError) throw err;
                logger.error({ err }, "[Billing] Failed to confirm subscription");
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Error al confirmar suscripción" });
            }
        }),
});
