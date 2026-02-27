/**
 * Workflow Poller — Recuperador de Trabajos Suspendidos
 * 
 * Este servicio se ejecuta en background de forma continua (Interval).
 * Su responsabilidad es buscar en la BD (workflow_jobs) los trabajos
 * que estaban en estado "wait" y cuyo tiempo de suspensión (resumeAt) 
 * ya se ha cumplido, para reanudarlos.
 */

import { getDb } from "../db";
import { workflowJobs, workflows } from "../../drizzle/schema";
import { and, eq, lte } from "drizzle-orm";
import { _executeWorkflowInstance } from "./workflow-engine";

import { logger } from "../_core/logger";

const POLL_INTERVAL_MS = 10000; // Revisar cada 10 segundos

let pollerInterval: NodeJS.Timeout | null = null;
let isPolling = false;

export function startWorkflowPoller() {
    if (pollerInterval) return;

    logger.info(`[WorkflowPoller] Empieza el monitoreo de colas (Intervalo: ${POLL_INTERVAL_MS}ms)`);

    pollerInterval = setInterval(async () => {
        if (isPolling) return; // Evitar colisiones si el poll anterior tardó mucho
        isPolling = true;

        try {
            await pollPendingJobs();
        } catch (err) {
            logger.error("[WorkflowPoller] Error crítico en el ciclo:", err);
        } finally {
            isPolling = false;
        }
    }, POLL_INTERVAL_MS);
}

export function stopWorkflowPoller() {
    if (pollerInterval) {
        clearInterval(pollerInterval);
        pollerInterval = null;
        logger.info("[WorkflowPoller] Monitoreo detenido");
    }
}

async function pollPendingJobs() {
    const db = await getDb();
    if (!db) return;

    const now = new Date();

    // Buscar jobs en estado "pending" cuyo resumeAt sea <= ahora
    const readyJobs = await db.select({
        id: workflowJobs.id,
        tenantId: workflowJobs.tenantId,
        workflowId: workflowJobs.workflowId,
        actionIndex: workflowJobs.actionIndex,
        payload: workflowJobs.payload,
    })
        .from(workflowJobs)
        .where(
            and(
                eq(workflowJobs.status, "pending"),
                lte(workflowJobs.resumeAt, now)
            )
        )
        .limit(50); // Lote de hasta 50 jobs para no ahogar memoria

    if (readyJobs.length === 0) return;

    logger.info(`[WorkflowPoller] ⚡ Despertando ${readyJobs.length} jobs suspendidos...`);

    for (const job of readyJobs) {
        try {
            // 1. Marcar como "processing" (evitar que otro nodo del cluster lo tome)
            // Como aquí no tenemos enum "processing", lo dejamos pending pero podemos 
            // confiar en la naturaleza asíncrona serial de este loop para no duplicar.
            // En un entorno de múltiples workers se requeriría FOR UPDATE o UPDATE ... WHERE status = 'pending'.

            const workflowRows = await db
                .select()
                .from(workflows)
                .where(
                    and(
                        eq(workflows.id, job.workflowId),
                        eq(workflows.isActive, true)
                    )
                )
                .limit(1);

            const workflow = workflowRows[0];

            if (!workflow) {
                // Workflow fue desactivado o borrado mientras se esperaba
                await db.update(workflowJobs)
                    .set({ status: "failed", errorMessage: "Workflow is no longer active" })
                    .where(eq(workflowJobs.id, job.id));
                continue;
            }

            logger.info(`[WorkflowPoller] Reanudando Job #${job.id} (Workflow #${job.workflowId}) desde acción #${job.actionIndex}`);

            // Reanudar la ejecución del flujo desde el índice pausado
            await _executeWorkflowInstance(
                workflow,
                job.payload,
                job.actionIndex,
                db,
                job.id
            );

        } catch (err: any) {
            logger.error(`[WorkflowPoller] Error al reanudar Job #${job.id}:`, err);
            // Actualizar a failed
            await db.update(workflowJobs)
                .set({ status: "failed", errorMessage: err?.message ?? "unknown error" })
                .where(eq(workflowJobs.id, job.id));
        }
    }
}
