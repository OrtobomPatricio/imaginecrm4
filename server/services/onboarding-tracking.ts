import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { onboardingProgress, tenants } from "../../drizzle/schema";

import { logger } from "../_core/logger";

function buildDefaultOnboardingProgress(tenantId: number) {
    return {
        id: 0,
        tenantId,
        lastStep: "company",
        companyCompleted: false,
        companyData: null,
        teamCompleted: false,
        teamInvites: null,
        whatsappCompleted: false,
        importCompleted: false,
        firstMessageCompleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
    };
}

function isOnboardingSchemaIssue(error: unknown) {
    const message = String((error as any)?.message ?? error ?? "").toLowerCase();
    return /onboarding_progress|doesn't exist|unknown column|er_no_such_table|table .* doesn't exist/.test(message);
}

/**
 * Onboarding Tracking Service
 */

export async function getOrCreateOnboardingProgress(tenantId: number) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    let existing: any;
    try {
        [existing] = await db
            .select()
            .from(onboardingProgress)
            .where(eq(onboardingProgress.tenantId, tenantId))
            .limit(1);
    } catch (error) {
        if (isOnboardingSchemaIssue(error)) {
            logger.warn({ tenantId, err: error }, "[Onboarding] onboarding_progress table/schema missing; returning default progress");
            return buildDefaultOnboardingProgress(tenantId);
        }
        throw error;
    }

    if (existing) return existing;

    // Create new progress record
    try {
        await db.insert(onboardingProgress).values({
            tenantId,
            lastStep: "company"
        });
    } catch (error) {
        logger.error("[MockDB] Failed to insert onboarding record:", error);
    }

    try {
        const [newRecord] = await db
            .select()
            .from(onboardingProgress)
            .where(eq(onboardingProgress.tenantId, tenantId))
            .limit(1);

        return newRecord || buildDefaultOnboardingProgress(tenantId);
    } catch (error) {
        if (isOnboardingSchemaIssue(error)) {
            logger.warn({ tenantId, err: error }, "[Onboarding] onboarding_progress still unavailable after insert; returning default progress");
            return buildDefaultOnboardingProgress(tenantId);
        }
        throw error;
    }
}

export async function updateOnboardingStep(
    tenantId: number,
    step: "company" | "team" | "whatsapp" | "import" | "first-message",
    data: any,
    completed: boolean
) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const updatePayload: any = {
        lastStep: step,
    };

    if (step === "company") {
        updatePayload.companyCompleted = completed;
        updatePayload.companyData = data;
    } else if (step === "team") {
        updatePayload.teamCompleted = completed;
        updatePayload.teamInvites = data;
    } else if (step === "whatsapp") {
        updatePayload.whatsappCompleted = completed;
    } else if (step === "import") {
        updatePayload.importCompleted = completed;
    } else if (step === "first-message") {
        updatePayload.firstMessageCompleted = completed;
    }

    try {
        await db.update(onboardingProgress)
            .set(updatePayload)
            .where(eq(onboardingProgress.tenantId, tenantId));
    } catch (error) {
        if (isOnboardingSchemaIssue(error)) {
            logger.warn({ tenantId, err: error }, "[Onboarding] onboarding_progress table/schema missing; skipping step persistence");
        } else {
            logger.warn("[MockDB] Warning: Could not update onboarding progress in mock DB");
        }
    }

    return { success: true };
}

export async function finalizeOnboarding(tenantId: number) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    try {
        await db.transaction(async (tx) => {
            // 1. Mark as completed in progress table
            await tx.update(onboardingProgress)
                .set({
                    completedAt: new Date(),
                    lastStep: "first-message", // Keep within valid enum; completedAt signals final completion
                    firstMessageCompleted: true
                })
                .where(eq(onboardingProgress.tenantId, tenantId));

            // 2. Update tenant status if necessary
            await tx.update(tenants)
                .set({
                    isActive: true // Ensure tenant is active
                } as any)
                .where(eq(tenants.id, tenantId));
        });
    } catch (error) {
        if (isOnboardingSchemaIssue(error)) {
            logger.warn({ tenantId, err: error }, "[Onboarding] onboarding_progress table/schema missing during finalize; keeping tenant active update best-effort");
            await db.update(tenants)
                .set({
                    isActive: true
                } as any)
                .where(eq(tenants.id, tenantId));
        } else {
            throw error;
        }
    }

    return { success: true };
}
