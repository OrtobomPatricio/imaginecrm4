import { getDb } from "../db";
import { leads, pipelines, pipelineStages, chatMessages, conversations } from "../../drizzle/schema";
import { logger } from "../_core/logger";

/**
 * Onboarding Demo Service
 * Seeds initial data to make the CRM feel alive for new users.
 */

export async function createDemoData(tenantId: number, userId: number) {
    const db = await getDb();
    if (!db) return;

    try {
        logger.info({ tenantId }, "[Onboarding] Seeding demo data");

        // 1. Create a Default Pipeline if none exists
        let pipelineId: number | null = null;
        try {
            const result = await db.insert(pipelines).values({
                tenantId,
                name: "Ventas Demo",
                description: "Pipeline de ejemplo cargado durante el onboarding",
            } as any);

            pipelineId = (result as any)?.[0]?.insertId ?? (result as any)?.insertId ?? null;
        } catch (err) {
            logger.warn({ tenantId, err }, "[Onboarding] Could not create demo pipeline");
        }

        if (!pipelineId) {
            logger.warn({ tenantId }, "[Onboarding] No pipelineId — skipping stages and leads");
            return { success: false };
        }

        // 2. Create Stages
        const stages = [
            { name: "Contacto Inicial", color: "#3b82f6", order: 1 },
            { name: "En Negociación", color: "#f59e0b", order: 2 },
            { name: "Cerrado Ganado", color: "#10b981", order: 3 },
        ];

        for (const s of stages) {
            try {
                await db.insert(pipelineStages).values({
                    tenantId,
                    pipelineId,
                    name: s.name,
                    color: s.color,
                    order: s.order
                });
            } catch (err) {
                logger.warn({ tenantId, stage: s.name, err }, "[Onboarding] Could not create pipeline stage");
            }
        }

        // Get the first stage ID for leads
        let firstStageId: number | null = null;
        try {
            const [firstStage] = await db
                .select()
                .from(pipelineStages)
                .where(eq(pipelineStages.pipelineId, pipelineId))
                .limit(1);
            firstStageId = firstStage?.id ?? null;
        } catch (err) {
            logger.warn({ tenantId, err }, "[Onboarding] Could not fetch first stage");
        }

        // 3. Create Demo Leads
        const demoLeads = [
            { name: "Juan Pérez", email: "juan@ejemplo.com", phone: "+541122334455", country: "AR" },
            { name: "María García", email: "maria@ejemplo.com", phone: "+541166778899", country: "AR" },
            { name: "Tech Solutions", email: "info@tech.com", phone: "+541199887766", country: "AR" },
        ];

        for (const l of demoLeads) {
            try {
                await db.insert(leads).values({
                    tenantId,
                    name: l.name,
                    email: l.email,
                    phone: l.phone,
                    country: l.country,
                    status: "new",
                    pipelineStageId: firstStageId,
                    assignedToId: userId
                } as any);
            } catch (err) {
                logger.warn({ tenantId, lead: l.name, err }, "[Onboarding] Could not create demo lead");
            }
        }

        return { success: true };
    } catch (err) {
        logger.error({ tenantId, err }, "[Onboarding] Demo seeding failed");
        return { success: false };
    }
}

import { eq } from "drizzle-orm";
