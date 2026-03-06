import { z } from "zod";
import { protectedProcedure, permissionProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tenants, license } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import crypto from "node:crypto";

/**
 * PayPal Billing Router
 *
 * Manages subscriptions, plan changes, and billing events.
 * Requires PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and plan IDs env vars.
 *
 * Plans:
 * - free:       5 users, 3 WA numbers, 10,000 msgs/month
 * - starter:   10 users, 5 WA numbers, 25,000 msgs/month
 * - pro:       25 users, 10 WA numbers, 100,000 msgs/month
 * - enterprise: 9999 users, 999 WA numbers, 9,999,999 msgs/month
 */

const PLANS = {
    free: {
        name: "Gratis",
        maxUsers: 5,
        maxWaNumbers: 3,
        maxMessages: 10000,
        priceMonthly: 0,
    },
    starter: {
        name: "Starter",
        maxUsers: 10,
        maxWaNumbers: 5,
        maxMessages: 25000,
        priceMonthly: 12.90,
    },
    pro: {
        name: "Pro",
        maxUsers: 25,
        maxWaNumbers: 10,
        maxMessages: 100000,
        priceMonthly: 32.90,
    },
    enterprise: {
        name: "Enterprise",
        maxUsers: 9999,
        maxWaNumbers: 999,
        maxMessages: 9999999,
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const res = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
            },
            body: "grant_type=client_credentials",
            signal: controller.signal,
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`PayPal token error ${res.status}: ${text}`);
        }

        const data = (await res.json()) as { access_token: string };
        return data.access_token;
    } finally {
        clearTimeout(timeout);
    }
}

export { getPayPalBaseUrl, getPayPalAccessToken };

export const billingRouter = router({
    /** Return PayPal client-side config (public, no secrets) */
    getPayPalConfig: protectedProcedure
        .query(() => {
            const clientId = process.env.PAYPAL_CLIENT_ID ?? "";
            const mode = process.env.PAYPAL_MODE ?? "sandbox";
            return { clientId, mode };
        }),

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
    createSubscription: permissionProcedure("settings.manage")
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
                            return_url: `${returnBase}/settings?tab=billing&success=true&plan=${input.plan}`,
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
    getManageUrl: permissionProcedure("settings.manage")
        .query(async ({ ctx }) => {
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

    /** Create a PayPal vault setup token for inline card fields */
    createVaultSetupToken: permissionProcedure("settings.manage")
        .input(z.object({
            plan: z.enum(["starter", "pro", "enterprise"]),
        }))
        .mutation(async ({ input, ctx }) => {
            const clientId = process.env.PAYPAL_CLIENT_ID;
            if (!clientId) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "PayPal no está configurado.",
                });
            }

            try {
                const token = await getPayPalAccessToken();
                const baseUrl = getPayPalBaseUrl();

                const res = await fetch(`${baseUrl}/v3/vault/setup-tokens`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        payment_source: {
                            card: {},
                        },
                        metadata: {
                            custom_id: `${ctx.tenantId}|${input.plan}`,
                        },
                    }),
                });

                if (!res.ok) {
                    const text = await res.text();
                    logger.error({ status: res.status, body: text }, "[Billing] Vault setup-token create failed");
                    throw new Error(`PayPal vault ${res.status}`);
                }

                const data = (await res.json()) as { id: string };
                logger.info(
                    { tenantId: ctx.tenantId, setupTokenId: data.id },
                    "[Billing] Vault setup token created"
                );

                return { setupTokenId: data.id };
            } catch (err: any) {
                if (err instanceof TRPCError) throw err;
                logger.error({ err }, "[Billing] Failed to create vault setup token");
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error al preparar el formulario de tarjeta",
                });
            }
        }),

    /** Complete card subscription: vault the card, then create subscription with payment source */
    completeCardSubscription: permissionProcedure("settings.manage")
        .input(z.object({
            plan: z.enum(["starter", "pro", "enterprise"]),
            vaultSetupToken: z.string().min(1),
        }))
        .mutation(async ({ input, ctx }) => {
            const planId = process.env[`PAYPAL_PLAN_${input.plan.toUpperCase()}`];
            if (!planId) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: `Plan no configurado: ${input.plan}`,
                });
            }

            try {
                const token = await getPayPalAccessToken();
                const baseUrl = getPayPalBaseUrl();

                // Step 1: Create payment token from vault setup token
                const vaultRes = await fetch(`${baseUrl}/v3/vault/payment-tokens`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        payment_source: {
                            token: {
                                id: input.vaultSetupToken,
                                type: "SETUP_TOKEN",
                            },
                        },
                    }),
                });

                if (!vaultRes.ok) {
                    const text = await vaultRes.text();
                    logger.error({ status: vaultRes.status, body: text }, "[Billing] Payment token creation failed");
                    throw new Error(`Vault payment-token ${vaultRes.status}`);
                }

                const paymentToken = (await vaultRes.json()) as { id: string };

                // Step 2: Create subscription with the vaulted card as payment source
                const subRes = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        plan_id: planId,
                        payment_source: {
                            card: {
                                vault_id: paymentToken.id,
                            },
                        },
                        application_context: {
                            brand_name: "ImagineCRM",
                            locale: "es-ES",
                            shipping_preference: "NO_SHIPPING",
                            user_action: "SUBSCRIBE_NOW",
                        },
                        custom_id: `${ctx.tenantId}|${input.plan}`,
                    }),
                });

                if (!subRes.ok) {
                    const text = await subRes.text();
                    logger.error({ status: subRes.status, body: text }, "[Billing] Card subscription create failed");
                    throw new Error(`PayPal subscription ${subRes.status}`);
                }

                const sub = (await subRes.json()) as { id: string; status: string };

                // Step 3: Activate the subscription in our DB
                const db = await getDb();
                if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

                await db.update(tenants).set({
                    plan: input.plan,
                    status: "active",
                    paypalSubscriptionId: sub.id,
                } as any).where(eq(tenants.id, ctx.tenantId));

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
                } else {
                    await db.insert(license).values({
                        tenantId: ctx.tenantId,
                        key: `lic_${crypto.randomBytes(16).toString("hex")}`,
                        status: 'active',
                        plan: input.plan,
                        maxUsers: planLimits.maxUsers,
                        maxWhatsappNumbers: planLimits.maxWaNumbers,
                        maxMessagesPerMonth: planLimits.maxMessages,
                    });
                }

                logger.info(
                    { tenantId: ctx.tenantId, plan: input.plan, subscriptionId: sub.id },
                    "[Billing] Card subscription completed"
                );

                return { success: true, plan: input.plan, subscriptionId: sub.id };
            } catch (err: any) {
                if (err instanceof TRPCError) throw err;
                logger.error({ err }, "[Billing] Card subscription flow failed");
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error al procesar el pago con tarjeta",
                });
            }
        }),

    /** Cancel active PayPal subscription */
    cancelSubscription: permissionProcedure("settings.manage")
        .mutation(async ({ ctx }) => {
            const db = await getDb();
            if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

            const [tenant] = await db.select().from(tenants)
                .where(eq(tenants.id, ctx.tenantId)).limit(1);

            const subId = (tenant as any)?.paypalSubscriptionId;
            if (!subId) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "No hay suscripción activa para cancelar.",
                });
            }

            // Validate format before interpolating into URL
            if (!/^[A-Za-z0-9_-]+$/.test(subId)) {
                logger.error({ subId, tenantId: ctx.tenantId }, "[Billing] Invalid subscription ID format in DB");
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ID de suscripción corrupto." });
            }

            try {
                const token = await getPayPalAccessToken();
                const baseUrl = getPayPalBaseUrl();

                // Cancel subscription via PayPal API
                const res = await fetch(`${baseUrl}/v1/billing/subscriptions/${subId}/cancel`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        reason: "Customer requested cancellation from CRM settings",
                    }),
                });

                // 204 = success, 422 = already cancelled
                if (!res.ok && res.status !== 422) {
                    const text = await res.text();
                    logger.error({ status: res.status, body: text }, "[Billing] PayPal cancel failed");
                    throw new Error(`PayPal cancel ${res.status}`);
                }

                // Downgrade tenant to free plan
                await db.update(tenants).set({
                    plan: "free",
                    paypalSubscriptionId: null,
                } as any).where(eq(tenants.id, ctx.tenantId));

                // Update license to free limits
                const freeLimits = PLANS.free;
                const [existingLicense] = await db.select().from(license)
                    .where(eq(license.tenantId, ctx.tenantId)).limit(1);

                if (existingLicense) {
                    await db.update(license).set({
                        status: "active",
                        plan: "free",
                        maxUsers: freeLimits.maxUsers,
                        maxWhatsappNumbers: freeLimits.maxWaNumbers,
                        maxMessagesPerMonth: freeLimits.maxMessages,
                        updatedAt: new Date(),
                    }).where(and(eq(license.tenantId, ctx.tenantId), eq(license.id, existingLicense.id)));
                } else {
                    await db.insert(license).values({
                        tenantId: ctx.tenantId,
                        key: `lic_${crypto.randomBytes(16).toString("hex")}`,
                        status: "active",
                        plan: "free",
                        maxUsers: freeLimits.maxUsers,
                        maxWhatsappNumbers: freeLimits.maxWaNumbers,
                        maxMessagesPerMonth: freeLimits.maxMessages,
                    });
                }

                logger.info(
                    { tenantId: ctx.tenantId, subscriptionId: subId },
                    "[Billing] Subscription cancelled"
                );

                return { success: true };
            } catch (err: any) {
                if (err instanceof TRPCError) throw err;
                logger.error({ err }, "[Billing] Failed to cancel subscription");
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Error al cancelar la suscripción",
                });
            }
        }),

    /** Confirm subscription after PayPal redirect (called from frontend on success) */
    confirmSubscription: permissionProcedure("settings.manage")
        .input(z.object({
            subscriptionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "ID de suscripción inválido"),
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

                // Verify this subscription belongs to this tenant (MANDATORY)
                const expectedCustomId = `${ctx.tenantId}|${input.plan}`;
                if (!sub.custom_id || sub.custom_id !== expectedCustomId) {
                    logger.warn({ tenantId: ctx.tenantId, customId: sub.custom_id, expected: expectedCustomId }, "[Billing] custom_id mismatch on confirm");
                    throw new TRPCError({ code: "FORBIDDEN", message: "Suscripción no válida para este tenant." });
                }

                const db = await getDb();
                if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

                await db.update(tenants).set({
                    plan: input.plan,
                    status: "active",
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
                } else {
                    await db.insert(license).values({
                        tenantId: ctx.tenantId,
                        key: `lic_${crypto.randomBytes(16).toString("hex")}`,
                        status: 'active',
                        plan: input.plan,
                        maxUsers: planLimits.maxUsers,
                        maxWhatsappNumbers: planLimits.maxWaNumbers,
                        maxMessagesPerMonth: planLimits.maxMessages,
                    });
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
