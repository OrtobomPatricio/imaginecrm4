/**
 * SINGLE SOURCE OF TRUTH for plan definitions.
 *
 * Every module that needs plan limits MUST import from here.
 * Never duplicate these values — if you need to change a limit,
 * change it here and it propagates everywhere.
 */

export interface PlanLimits {
    maxUsers: number;
    maxWhatsappNumbers: number;
    maxMessagesPerMonth: number;
    maxLeads: number;
}

export interface PlanDefinition extends PlanLimits {
    name: string;
    priceMonthly: number;
}

export const PLAN_DEFINITIONS: Record<string, PlanDefinition> = {
    free: {
        name: "Gratis",
        maxUsers: 5,
        maxWhatsappNumbers: 3,
        maxMessagesPerMonth: 10000,
        maxLeads: 500,
        priceMonthly: 0,
    },
    starter: {
        name: "Starter",
        maxUsers: 10,
        maxWhatsappNumbers: 5,
        maxMessagesPerMonth: 25000,
        maxLeads: 2000,
        priceMonthly: 12.90,
    },
    pro: {
        name: "Pro",
        maxUsers: 25,
        maxWhatsappNumbers: 10,
        maxMessagesPerMonth: 100000,
        maxLeads: 999999,
        priceMonthly: 32.90,
    },
    enterprise: {
        name: "Enterprise",
        maxUsers: 9999,
        maxWhatsappNumbers: 999,
        maxMessagesPerMonth: 9999999,
        maxLeads: 9999999,
        priceMonthly: 99.90,
    },
} as const;

/** Get limits for a plan, defaulting to free if unknown */
export function getPlanDefinition(plan: string): PlanDefinition {
    return PLAN_DEFINITIONS[plan] ?? PLAN_DEFINITIONS.free;
}

/** Get just the resource limits (no name/price) */
export function getPlanResourceLimits(plan: string): PlanLimits {
    const def = getPlanDefinition(plan);
    return {
        maxUsers: def.maxUsers,
        maxWhatsappNumbers: def.maxWhatsappNumbers,
        maxMessagesPerMonth: def.maxMessagesPerMonth,
        maxLeads: def.maxLeads,
    };
}
