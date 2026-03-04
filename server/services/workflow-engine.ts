/**
 * Workflow Engine — Motor de Automatización de ImagineCRM
 *
 * Ejecuta workflows (automatizaciones) cuando ocurren eventos en el sistema.
 * Totalmente aislado por tenant: un workflow de un tenant nunca afecta a otro.
 *
 * 🔥 ARQUITECTURA DE ALTA FIABILIDAD (ENTERPRISE GRADE)
 * - Persistencia de estados 'wait' para sobrevivir reinicios del servidor.
 * - Transacciones atómicas (FOR UPDATE) en Round-Robin para prevenir colisiones masivas.
 * - Exponential Backoff Retries nativo para llamadas de red externas (Meta API).
 */

import { getDb } from "../db";
import {
    workflows,
    workflowLogs,
    workflowJobs,
    leads,
    leadTags,
    tags,
    templates,
    users,
    whatsappNumbers,
    whatsappConnections,
    pipelineStages,
    leadNotes,
} from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendCloudMessage } from "../whatsapp/cloud";
import { BaileysService } from "./baileys";
import { decryptSecret } from "../_core/crypto";

import { logger } from "../_core/logger";

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export type WorkflowTriggerType =
    | "lead_created"
    | "lead_updated"
    | "msg_received"
    | "campaign_link_clicked";

export interface WorkflowEventPayload {
    tenantId: number;
    triggerType: WorkflowTriggerType;
    leadId?: number;
    conversationId?: number;
    changedFields?: string[];
    meta?: Record<string, any>;
}

// ─── Tipos de acciones ───────────────────────────────────────────────────────

interface AssignAgentAction { type: "assign_agent"; agentId: number | "round_robin"; }
interface AddTagAction { type: "add_tag"; tagId: number; }
interface RemoveTagAction { type: "remove_tag"; tagId: number; }
interface SendTemplateAction { type: "send_template"; templateId: number; }
interface UpdateStageAction { type: "update_stage"; stageId: number; }
interface SendInternalNoteAction { type: "send_internal_note"; content: string; }
interface WaitAction { type: "wait"; seconds: number; }

type WorkflowAction =
    | AssignAgentAction | AddTagAction | RemoveTagAction | SendTemplateAction
    | UpdateStageAction | SendInternalNoteAction | WaitAction;

// ─── Despachador Principal ───────────────────────────────────────────────────

export async function dispatchWorkflowEvent(payload: WorkflowEventPayload): Promise<void> {
    setImmediate(async () => {
        try {
            await _processEvent(payload);
        } catch (err) {
            logger.error("[WorkflowEngine] Unhandled error in dispatchWorkflowEvent:", err);
        }
    });
}

async function _processEvent(payload: WorkflowEventPayload): Promise<void> {
    const db = (await getDb())!;
    if (!db) return;

    const activeWorkflows = await db
        .select()
        .from(workflows)
        .where(
            and(
                eq(workflows.tenantId, payload.tenantId),
                eq(workflows.isActive, true),
                eq(workflows.triggerType, payload.triggerType)
            )
        );

    if (activeWorkflows.length === 0) return;

    for (const workflow of activeWorkflows) {
        if (!_matchesTriggerConfig(workflow.triggerConfig, payload)) continue;

        logger.info(
            `[WorkflowEngine] Starting workflow #${workflow.id} for tenant ${payload.tenantId}`
        );

        // Comenzamos la ejecución desde el índice 0
        await _executeWorkflowInstance(workflow, payload, 0, db);
    }
}

// ─── Ejecución del Workflow y Suspensión (Wait) ──────────────────────────────

export async function _executeWorkflowInstance(
    workflow: any,
    payload: WorkflowEventPayload,
    startIndex: number,
    db: any,
    jobId?: number
): Promise<void> {
    const actions: WorkflowAction[] = Array.isArray(workflow.actions) ? workflow.actions : [];
    const MAX_ACTIONS = 50;
    if (actions.length > MAX_ACTIONS) {
        logger.error({ workflowId: workflow.id, actionsCount: actions.length, max: MAX_ACTIONS }, "[Workflows] Workflow exceeds max actions limit");
        return;
    }
    let executionDetails: string[] = [];
    let overallStatus: "success" | "failed" | "suspended" = "success";

    for (let i = startIndex; i < actions.length; i++) {
        const action = actions[i];
        try {
            // 🔴 FIABILIDAD 1: Persistencia Real del Wait (No Memory Leaks)
            if (action.type === "wait") {
                const resumeAt = new Date(Date.now() + action.seconds * 1000);

                if (jobId) {
                    // Si venimos de un Job previo, lo actualizamos
                    await db.update(workflowJobs)
                        .set({ actionIndex: i + 1, resumeAt, status: "pending" })
                        .where(eq(workflowJobs.id, jobId));
                } else {
                    // Si es un evento nuevo, creamos el Job en la BD
                    await db.insert(workflowJobs).values({
                        tenantId: payload.tenantId,
                        workflowId: workflow.id,
                        entityId: payload.leadId ?? payload.conversationId ?? 0,
                        actionIndex: i + 1,
                        payload: payload,
                        status: "pending",
                        resumeAt
                    });
                }

                executionDetails.push(`⏸️ suspended for ${action.seconds}s`);
                logger.info(`[WorkflowEngine] Workflow #${workflow.id} suspended. Resumes at ${resumeAt.toISOString()}`);
                overallStatus = "suspended";
                break; // Detenemos la ejecución en memoria
            }

            await _executeAction(action, payload, db);
            executionDetails.push(`✅ ${action.type}`);
        } catch (err: any) {
            logger.error(
                `[WorkflowEngine] Action "${action.type}" failed in workflow #${workflow.id}:`,
                err?.message
            );
            executionDetails.push(`❌ ${action.type}: ${err?.message ?? "unknown error"}`);
            overallStatus = "failed";
            // Si falla estrepitosamente, cortamos el workflow actual
            break;
        }
    }

    // Si no se suspendió, se completó o falló definitivamente. Registramos el final.
    if (overallStatus !== "suspended") {
        if (jobId) {
            await db.update(workflowJobs)
                .set({ status: overallStatus === "success" ? "completed" : "failed" })
                .where(eq(workflowJobs.id, jobId));
        }

        await db.insert(workflowLogs).values({
            tenantId: payload.tenantId,
            workflowId: workflow.id,
            entityId: payload.leadId ?? payload.conversationId ?? 0,
            status: overallStatus as "success" | "failed",
            details: executionDetails.join("\n"),
        });
    }
}

// ─── Evaluador de configuración ──────────────────────────────────────────────

function _matchesTriggerConfig(triggerConfig: any, payload: WorkflowEventPayload): boolean {
    if (!triggerConfig || typeof triggerConfig !== "object") return true;

    if (payload.triggerType === "lead_updated" && triggerConfig.changedFields && payload.changedFields) {
        const reqFields: string[] = triggerConfig.changedFields;
        if (!reqFields.some(f => payload.changedFields!.includes(f))) return false;
    }
    if (triggerConfig.source && payload.meta?.source) {
        if (triggerConfig.source !== payload.meta.source) return false;
    }
    return true;
}

// ─── Hub de Ejecución de Acciones ─────────────────────────────────────────────

async function _executeAction(action: WorkflowAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    switch (action.type) {
        case "assign_agent": await _actionAssignAgent(action, payload, db); break;
        case "add_tag": await _actionAddTag(action, payload, db); break;
        case "remove_tag": await _actionRemoveTag(action, payload, db); break;
        case "send_template": await _actionSendTemplate(action, payload, db); break;
        case "update_stage": await _actionUpdateStage(action, payload, db); break;
        case "send_internal_note": await _actionSendInternalNote(action, payload, db); break;
        default: logger.warn(`[WorkflowEngine] Unknown action type: ${(action as any).type}`);
    }
}

// ─── Acción: Assign Agent (Atómico) ──────────────────────────────────────────

async function _actionAssignAgent(action: AssignAgentAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    if (!payload.leadId) throw new Error("assign_agent requires leadId");

    // 🔴 FIABILIDAD 2: Serialización Atómica Transaccional para evitar Colisiones de Round-Robin
    await db.transaction(async (tx: any) => {
        let targetAgentId: number;

        if (action.agentId === "round_robin") {
            const agentRows = await tx.execute(sql`
        SELECT u.id, COUNT(l.id) AS lead_count
        FROM users u
        LEFT JOIN leads l ON l.assignedToId = u.id AND l.tenantId = ${payload.tenantId}
        WHERE u.tenantId = ${payload.tenantId}
          AND u.role IN ('agent', 'admin', 'supervisor')
          AND u.isActive = 1
        GROUP BY u.id
        ORDER BY lead_count ASC
        LIMIT 1
        FOR UPDATE
      `);
            const row = (agentRows as any)?.[0]?.[0];
            if (!row) throw new Error("No active agents found for round_robin");
            targetAgentId = row.id;
        } else {
            const agentRows = await tx.select({ id: users.id })
                .from(users)
                .where(and(eq(users.id, action.agentId), eq(users.tenantId, payload.tenantId)))
                .limit(1);
            if (!agentRows[0]) throw new Error(`Agent ${action.agentId} not found`);
            targetAgentId = agentRows[0].id;
        }

        await tx.update(leads)
            .set({ assignedToId: targetAgentId })
            .where(and(eq(leads.id, payload.leadId!), eq(leads.tenantId, payload.tenantId)));
    });
}

// ─── Acción: Add Tag / Remove Tag ────────────────────────────────────────────

async function _actionAddTag(action: AddTagAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    if (!payload.leadId) throw new Error("add_tag requires leadId");
    const tagRows = await db.select({ id: tags.id }).from(tags)
        .where(and(eq(tags.id, action.tagId), eq(tags.tenantId, payload.tenantId))).limit(1);
    if (!tagRows[0]) throw new Error("Tag not found");

    await db.execute(sql`
    INSERT IGNORE INTO lead_tags (tenantId, leadId, tagId, createdAt)
    VALUES (${payload.tenantId}, ${payload.leadId}, ${action.tagId}, NOW())
  `);
}

async function _actionRemoveTag(action: RemoveTagAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    if (!payload.leadId) throw new Error("remove_tag requires leadId");
    await db.delete(leadTags).where(and(
        eq(leadTags.leadId, payload.leadId),
        eq(leadTags.tagId, action.tagId),
        eq(leadTags.tenantId, payload.tenantId)
    ));
}

// ─── Acción: Send Template (CON RETRIES) ─────────────────────────────────────

async function _actionSendTemplate(action: SendTemplateAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    if (!payload.leadId) throw new Error("send_template requires leadId");

    const [lead] = await db.select().from(leads).where(and(eq(leads.id, payload.leadId), eq(leads.tenantId, payload.tenantId))).limit(1);
    if (!lead || !lead.phone) throw new Error("Lead or phone not found");

    const [template] = await db.select().from(templates).where(and(eq(templates.id, action.templateId), eq(templates.tenantId, payload.tenantId))).limit(1);
    if (!template) throw new Error("Template not found");

    const message = _renderTemplate(template.content, {
        name: lead.name, phone: lead.phone, email: lead.email ?? "",
    });

    const [conn] = await db.select().from(whatsappConnections).where(and(eq(whatsappConnections.tenantId, payload.tenantId), eq(whatsappConnections.isConnected, true))).limit(1);
    if (!conn) throw new Error("No active WhatsApp connection");

    const [waNumber] = await db.select().from(whatsappNumbers).where(and(eq(whatsappNumbers.id, conn.whatsappNumberId), eq(whatsappNumbers.tenantId, payload.tenantId))).limit(1);
    if (!waNumber) throw new Error("WhatsApp number not found");

    // 🔴 FIABILIDAD 3: Resiliencia ante Rate Limits (HTTP 429) de Meta API
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            if (conn.type === "api") {
                const accessToken = waNumber.accessToken ? await decryptSecret(waNumber.accessToken) : undefined;
                if (!accessToken) throw new Error("No access token for Cloud API");
                await sendCloudMessage({
                    phoneNumberId: waNumber.phoneNumberId ?? "",
                    accessToken, to: lead.phone, payload: { type: "text", body: message },
                });
            } else {
                await BaileysService.sendMessage(conn.whatsappNumberId, lead.phone, { text: message });
            }
            return; // Éxito, salimos del loop
        } catch (err: any) {
            attempts++;
            const isRateLimit = err?.response?.status === 429 || err?.message?.includes("Rate limit");
            if (attempts >= maxAttempts || (!isRateLimit && attempts > 1)) {
                throw new Error(`Failed to send template after ${attempts} attempts. Error: ${err?.message}`);
            }
            // Exponential backoff: 2s, 4s, 8s...
            const backoffDelay = Math.pow(2, attempts) * 1000;
            logger.warn(`[WorkflowEngine] HTTP 429 / Error sending template. Retrying in ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
    }
}

// ─── Acción: Update Stage ────────────────────────────────────────────────────

async function _actionUpdateStage(action: UpdateStageAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    if (!payload.leadId) throw new Error("update_stage requires leadId");
    const [stage] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, action.stageId), eq(pipelineStages.tenantId, payload.tenantId))).limit(1);
    if (!stage) throw new Error("Stage not found");

    await db.update(leads).set({ pipelineStageId: action.stageId })
        .where(and(eq(leads.id, payload.leadId), eq(leads.tenantId, payload.tenantId)));
}

// ─── Acción: Internal Note ───────────────────────────────────────────────────

async function _actionSendInternalNote(action: SendInternalNoteAction, payload: WorkflowEventPayload, db: any): Promise<void> {
    if (!payload.leadId) throw new Error("send_internal_note requires leadId");
    await db.insert(leadNotes).values({
        tenantId: payload.tenantId,
        leadId: payload.leadId,
        content: `[Automatización] ${action.content}`,
        createdById: null,
    });
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

function _renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => vars[key] ?? "");
}
