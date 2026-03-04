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
import { and, eq, lte, sql } from "drizzle-orm";
import { _executeWorkflowInstance } from "./workflow-engine";

import { logger, safeError } from "../_core/logger";

const POLL_INTERVAL_MS = 10000; // Revisar cada 10 segundos

let pollerInterval: NodeJS.Timeout | null = null;
let isPolling = false;
let schemaChecked = false;
let schemaReady = false;

async function ensureWorkflowSchema(): Promise<boolean> {
    if (schemaChecked) return schemaReady;
    schemaChecked = true;

    const db = await getDb();
    if (!db) return false;

    try {
        const [workflowJobsExists] = await db.execute(sql`
            SELECT 1 AS ok
            FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = 'workflow_jobs'
            LIMIT 1
        `) as any;

        const [workflowsExists] = await db.execute(sql`
            SELECT 1 AS ok
            FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = 'workflows'
            LIMIT 1
        `) as any;

        schemaReady = Boolean(workflowJobsExists?.ok || workflowJobsExists?.["ok"]) && Boolean(workflowsExists?.ok || workflowsExists?.["ok"]);

        if (!schemaReady) {
            logger.warn("[WorkflowPoller] Disabled: required tables (workflow_jobs/workflows) are missing in this database.");
        }
    } catch (err) {
        logger.error({ err: safeError(err) }, "[WorkflowPoller] Failed to validate schema, poller disabled");
        schemaReady = false;
    }

    return schemaReady;
}

export function startWorkflowPoller() {
    if (pollerInterval) return;

    logger.info(`[WorkflowPoller] Empieza el monitoreo de colas (Intervalo: ${POLL_INTERVAL_MS}ms)`);

    pollerInterval = setInterval(async () => {
        if (isPolling) return; // Evitar colisiones si el poll anterior tardó mucho
        isPolling = true;

        try {
            const isReady = await ensureWorkflowSchema();
            if (!isReady) {
                stopWorkflowPoller();
                return;
            }
            await pollPendingJobs();
        } catch (err) {
            logger.error({ err: safeError(err) }, "[WorkflowPoller] Error crítico en el ciclo");
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
            // Atomically claim the job: UPDATE ... WHERE status = 'pending' prevents duplicates in multi-instance deployments
            const claimed = await db.update(workflowJobs)
                .set({ status: "processing" as any })
                .where(and(eq(workflowJobs.id, job.id), eq(workflowJobs.status, "pending")));

            if ((claimed as any)[0]?.affectedRows === 0) {
                // Another worker already claimed this job
                continue;
            }

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
            logger.error({ err: safeError(err), jobId: job.id }, `[WorkflowPoller] Error al reanudar Job #${job.id}`);
            // Actualizar a failed
            await db.update(workflowJobs)
                .set({ status: "failed", errorMessage: err?.message ?? "unknown error" })
                .where(eq(workflowJobs.id, job.id));
        }
    }
}
