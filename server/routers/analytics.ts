/**
 * Analytics Router — Reportes y Analíticas de ImagineCRM
 *
 * Endpoints disponibles:
 *   - overview          → KPIs generales del período (leads, conversaciones, mensajes, tasa de respuesta)
 *   - leadsOverTime     → Nuevos leads por día/semana/mes
 *   - conversionFunnel  → Embudo de conversión por etapas del pipeline
 *   - agentPerformance  → Métricas por agente (conversaciones, tiempo de respuesta, resueltas)
 *   - messageVolume     → Volumen de mensajes entrantes/salientes por día
 *   - campaignStats     → Rendimiento de campañas (enviados, entregados, leídos, fallidos)
 *   - leadSources       → Distribución de leads por fuente
 *   - responseTime      → Tiempo promedio de primera respuesta por agente y canal
 */

import { z } from "zod";
import { permissionProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
    leads,
    conversations,
    chatMessages,
    campaigns,
    campaignRecipients,
    users,
    pipelineStages,
    pipelines,
} from "../../drizzle/schema";
import { eq, and, gte, lte, sql, count, avg, desc, isNotNull } from "drizzle-orm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDateRange(period: string): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date();

    switch (period) {
        case "7d":
            from.setDate(from.getDate() - 7);
            break;
        case "30d":
            from.setDate(from.getDate() - 30);
            break;
        case "90d":
            from.setDate(from.getDate() - 90);
            break;
        case "this_month":
            from.setDate(1);
            from.setHours(0, 0, 0, 0);
            break;
        case "last_month":
            from.setMonth(from.getMonth() - 1);
            from.setDate(1);
            from.setHours(0, 0, 0, 0);
            to.setDate(0); // último día del mes anterior
            to.setHours(23, 59, 59, 999);
            break;
        default: // "7d"
            from.setDate(from.getDate() - 7);
    }

    return { from, to };
}

const periodSchema = z.enum(["7d", "30d", "90d", "this_month", "last_month"]).default("30d");

// ─── Router ──────────────────────────────────────────────────────────────────

export const analyticsRouter = router({

    /**
     * KPIs generales del período seleccionado
     * Incluye comparativa con el período anterior para mostrar tendencia (▲/▼)
     */
    overview: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            // Período anterior (misma duración)
            const duration = to.getTime() - from.getTime();
            const prevFrom = new Date(from.getTime() - duration);
            const prevTo = new Date(from.getTime() - 1);

            // ── Leads nuevos ──
            const [leadsNow] = await db
                .select({ count: count() })
                .from(leads)
                .where(and(eq(leads.tenantId, tenantId), gte(leads.createdAt, from), lte(leads.createdAt, to)));

            const [leadsPrev] = await db
                .select({ count: count() })
                .from(leads)
                .where(and(eq(leads.tenantId, tenantId), gte(leads.createdAt, prevFrom), lte(leads.createdAt, prevTo)));

            // ── Conversaciones nuevas ──
            const [convsNow] = await db
                .select({ count: count() })
                .from(conversations)
                .where(and(eq(conversations.tenantId, tenantId), gte(conversations.createdAt, from), lte(conversations.createdAt, to)));

            const [convsPrev] = await db
                .select({ count: count() })
                .from(conversations)
                .where(and(eq(conversations.tenantId, tenantId), gte(conversations.createdAt, prevFrom), lte(conversations.createdAt, prevTo)));

            // ── Mensajes totales ──
            const [msgsNow] = await db
                .select({ count: count() })
                .from(chatMessages)
                .where(and(eq(chatMessages.tenantId, tenantId), gte(chatMessages.createdAt, from), lte(chatMessages.createdAt, to)));

            const [msgsPrev] = await db
                .select({ count: count() })
                .from(chatMessages)
                .where(and(eq(chatMessages.tenantId, tenantId), gte(chatMessages.createdAt, prevFrom), lte(chatMessages.createdAt, prevTo)));

            // ── Conversaciones resueltas ──
            const [resolvedNow] = await db
                .select({ count: count() })
                .from(conversations)
                .where(and(
                    eq(conversations.tenantId, tenantId),
                    eq(conversations.ticketStatus, "closed"),
                    gte(conversations.updatedAt, from),
                    lte(conversations.updatedAt, to)
                ));

            const [resolvedPrev] = await db
                .select({ count: count() })
                .from(conversations)
                .where(and(
                    eq(conversations.tenantId, tenantId),
                    eq(conversations.ticketStatus, "closed"),
                    gte(conversations.updatedAt, prevFrom),
                    lte(conversations.updatedAt, prevTo)
                ));

            // ── Tasa de resolución ──
            const resolutionRate = convsNow.count > 0
                ? Math.round((resolvedNow.count / convsNow.count) * 100)
                : 0;
            const resolutionRatePrev = convsPrev.count > 0
                ? Math.round((resolvedPrev.count / convsPrev.count) * 100)
                : 0;

            // ── Leads ganados (won) ──
            const [wonNow] = await db
                .select({ count: count() })
                .from(leads)
                .where(and(
                    eq(leads.tenantId, tenantId),
                    eq(leads.status, "won"),
                    gte(leads.updatedAt, from),
                    lte(leads.updatedAt, to)
                ));

            const [wonPrev] = await db
                .select({ count: count() })
                .from(leads)
                .where(and(
                    eq(leads.tenantId, tenantId),
                    eq(leads.status, "won"),
                    gte(leads.updatedAt, prevFrom),
                    lte(leads.updatedAt, prevTo)
                ));

            function calcChange(now: number, prev: number): number {
                if (prev === 0) return now > 0 ? 100 : 0;
                return Math.round(((now - prev) / prev) * 100);
            }

            return {
                period: input.period,
                from: from.toISOString(),
                to: to.toISOString(),
                kpis: {
                    newLeads: {
                        value: leadsNow.count,
                        change: calcChange(leadsNow.count, leadsPrev.count),
                    },
                    newConversations: {
                        value: convsNow.count,
                        change: calcChange(convsNow.count, convsPrev.count),
                    },
                    totalMessages: {
                        value: msgsNow.count,
                        change: calcChange(msgsNow.count, msgsPrev.count),
                    },
                    resolvedConversations: {
                        value: resolvedNow.count,
                        change: calcChange(resolvedNow.count, resolvedPrev.count),
                    },
                    resolutionRate: {
                        value: resolutionRate,
                        change: resolutionRate - resolutionRatePrev,
                    },
                    wonLeads: {
                        value: wonNow.count,
                        change: calcChange(wonNow.count, wonPrev.count),
                    },
                },
            };
        }),

    /**
     * Nuevos leads por día en el período seleccionado
     */
    leadsOverTime: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            const rows = await db
                .select({
                    date: sql<string>`DATE(${leads.createdAt})`.as("date"),
                    count: count(),
                })
                .from(leads)
                .where(and(
                    eq(leads.tenantId, tenantId),
                    gte(leads.createdAt, from),
                    lte(leads.createdAt, to)
                ))
                .groupBy(sql`DATE(${leads.createdAt})`)
                .orderBy(sql`DATE(${leads.createdAt})`);

            return rows;
        }),

    /**
     * Embudo de conversión por etapas del pipeline por defecto
     */
    conversionFunnel: permissionProcedure("reports.view")
        .input(z.object({
            period: periodSchema,
            pipelineId: z.number().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            // Obtener el pipeline (por defecto o el especificado)
            let pipelineId = input.pipelineId;
            if (!pipelineId) {
                const [defaultPipeline] = await db
                    .select({ id: pipelines.id, name: pipelines.name })
                    .from(pipelines)
                    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.isDefault, true)))
                    .limit(1);
                pipelineId = defaultPipeline?.id;
            }

            if (!pipelineId) return { stages: [], totalLeads: 0 };

            // Obtener etapas del pipeline ordenadas
            const stages = await db
                .select({ id: pipelineStages.id, name: pipelineStages.name, order: pipelineStages.order })
                .from(pipelineStages)
                .where(and(
                    eq(pipelineStages.tenantId, tenantId),
                    eq(pipelineStages.pipelineId, pipelineId)
                ))
                .orderBy(pipelineStages.order);

            // Contar leads por etapa en el período
            const leadCounts = await db
                .select({
                    stageId: leads.pipelineStageId,
                    count: count(),
                })
                .from(leads)
                .where(and(
                    eq(leads.tenantId, tenantId),
                    gte(leads.createdAt, from),
                    lte(leads.createdAt, to)
                ))
                .groupBy(leads.pipelineStageId);

            const countMap = new Map(leadCounts.map(r => [r.stageId, r.count]));
            const totalLeads = leadCounts.reduce((sum, r) => sum + r.count, 0);

            const result = stages.map(stage => ({
                stageId: stage.id,
                stageName: stage.name,
                order: stage.order,
                count: countMap.get(stage.id) ?? 0,
                percentage: totalLeads > 0
                    ? Math.round(((countMap.get(stage.id) ?? 0) / totalLeads) * 100)
                    : 0,
            }));

            return { stages: result, totalLeads };
        }),

    /**
     * Rendimiento por agente: conversaciones atendidas, resueltas y tiempo promedio de respuesta
     */
    agentPerformance: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            // Conversaciones por agente asignado
            const convsByAgent = await db
                .select({
                    agentId: conversations.assignedToId,
                    total: count(),
                    resolved: sql<number>`SUM(CASE WHEN ${conversations.ticketStatus} = 'closed' THEN 1 ELSE 0 END)`.as("resolved"),
                    pending: sql<number>`SUM(CASE WHEN ${conversations.ticketStatus} = 'pending' THEN 1 ELSE 0 END)`.as("pending"),
                })
                .from(conversations)
                .where(and(
                    eq(conversations.tenantId, tenantId),
                    isNotNull(conversations.assignedToId),
                    gte(conversations.createdAt, from),
                    lte(conversations.createdAt, to)
                ))
                .groupBy(conversations.assignedToId);

            // Mensajes enviados por agente (outbound)
            // Se agrupa por el agente asignado a la conversación
            const msgsByAgent = await db
                .select({
                    agentId: conversations.assignedToId,
                    messagesSent: count(),
                })
                .from(chatMessages)
                .innerJoin(conversations, eq(chatMessages.conversationId, conversations.id))
                .where(and(
                    eq(chatMessages.tenantId, tenantId),
                    eq(chatMessages.direction, "outbound"),
                    gte(chatMessages.createdAt, from),
                    lte(chatMessages.createdAt, to)
                ))
                .groupBy(conversations.assignedToId);

            // Obtener nombres de los agentes
            const agentIds = [
                ...new Set([
                    ...convsByAgent.map(r => r.agentId).filter(Boolean) as number[],
                    ...msgsByAgent.map(r => r.agentId).filter(Boolean) as number[],
                ])
            ];

            let agentNames: Map<number, string> = new Map();
            if (agentIds.length > 0) {
                const agentRows = await db
                    .select({ id: users.id, name: users.name })
                    .from(users)
                    .where(and(eq(users.tenantId, tenantId)));
                agentRows.forEach(a => agentNames.set(a.id, a.name ?? `Agente #${a.id}`));
            }

            const msgsMap = new Map(msgsByAgent.map(r => [r.agentId, r.messagesSent]));

            const result = convsByAgent.map(row => ({
                agentId: row.agentId,
                agentName: row.agentId ? (agentNames.get(row.agentId) ?? `Agente #${row.agentId}`) : "Sin asignar",
                totalConversations: row.total,
                resolvedConversations: Number(row.resolved ?? 0),
                pendingConversations: Number(row.pending ?? 0),
                resolutionRate: row.total > 0
                    ? Math.round((Number(row.resolved ?? 0) / row.total) * 100)
                    : 0,
                messagesSent: row.agentId ? (msgsMap.get(row.agentId) ?? 0) : 0,
            }));

            // Ordenar por total de conversaciones desc
            result.sort((a, b) => b.totalConversations - a.totalConversations);

            return result;
        }),

    /**
     * Volumen de mensajes entrantes y salientes por día
     */
    messageVolume: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            const rows = await db
                .select({
                    date: sql<string>`DATE(${chatMessages.createdAt})`.as("date"),
                    direction: chatMessages.direction,
                    count: count(),
                })
                .from(chatMessages)
                .where(and(
                    eq(chatMessages.tenantId, tenantId),
                    gte(chatMessages.createdAt, from),
                    lte(chatMessages.createdAt, to)
                ))
                .groupBy(sql`DATE(${chatMessages.createdAt})`, chatMessages.direction)
                .orderBy(sql`DATE(${chatMessages.createdAt})`);

            // Pivotar: agrupar por fecha con inbound/outbound como columnas
            const dateMap = new Map<string, { date: string; inbound: number; outbound: number }>();
            for (const row of rows) {
                if (!dateMap.has(row.date)) {
                    dateMap.set(row.date, { date: row.date, inbound: 0, outbound: 0 });
                }
                const entry = dateMap.get(row.date)!;
                if (row.direction === "inbound") entry.inbound = row.count;
                else entry.outbound = row.count;
            }

            return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
        }),

    /**
     * Rendimiento de campañas en el período
     */
    campaignStats: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            const rows = await db
                .select({
                    campaignId: campaigns.id,
                    campaignName: campaigns.name,
                    status: campaigns.status,
                    total: sql<number>`COUNT(${campaignRecipients.id})`.as("total"),
                    sent: sql<number>`SUM(CASE WHEN ${campaignRecipients.status} = 'sent' THEN 1 ELSE 0 END)`.as("sent"),
                    delivered: sql<number>`SUM(CASE WHEN ${campaignRecipients.status} = 'delivered' THEN 1 ELSE 0 END)`.as("delivered"),
                    read: sql<number>`SUM(CASE WHEN ${campaignRecipients.status} = 'read' THEN 1 ELSE 0 END)`.as("read"),
                    failed: sql<number>`SUM(CASE WHEN ${campaignRecipients.status} = 'failed' THEN 1 ELSE 0 END)`.as("failed"),
                })
                .from(campaigns)
                .leftJoin(campaignRecipients, eq(campaignRecipients.campaignId, campaigns.id))
                .where(and(
                    eq(campaigns.tenantId, tenantId),
                    gte(campaigns.createdAt, from),
                    lte(campaigns.createdAt, to)
                ))
                .groupBy(campaigns.id, campaigns.name, campaigns.status)
                .orderBy(desc(campaigns.createdAt));

            return rows.map(row => ({
                campaignId: row.campaignId,
                campaignName: row.campaignName,
                status: row.status,
                total: Number(row.total ?? 0),
                sent: Number(row.sent ?? 0),
                delivered: Number(row.delivered ?? 0),
                read: Number(row.read ?? 0),
                failed: Number(row.failed ?? 0),
                deliveryRate: Number(row.total ?? 0) > 0
                    ? Math.round((Number(row.delivered ?? 0) / Number(row.total ?? 0)) * 100)
                    : 0,
                readRate: Number(row.delivered ?? 0) > 0
                    ? Math.round((Number(row.read ?? 0) / Number(row.delivered ?? 0)) * 100)
                    : 0,
            }));
        }),

    /**
     * Distribución de leads por fuente (source)
     */
    leadSources: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            const rows = await db
                .select({
                    source: sql<string>`COALESCE(${leads.source}, 'manual')`.as("source"),
                    count: count(),
                })
                .from(leads)
                .where(and(
                    eq(leads.tenantId, tenantId),
                    gte(leads.createdAt, from),
                    lte(leads.createdAt, to)
                ))
                .groupBy(sql`COALESCE(${leads.source}, 'manual')`)
                .orderBy(desc(count()));

            const total = rows.reduce((sum, r) => sum + r.count, 0);

            return rows.map(row => ({
                source: row.source,
                count: row.count,
                percentage: total > 0 ? Math.round((row.count / total) * 100) : 0,
            }));
        }),

    /**
     * Tiempo promedio de primera respuesta por agente
     * Calcula el tiempo entre la creación de la conversación y el primer mensaje outbound
     */
    responseTime: permissionProcedure("reports.view")
        .input(z.object({ period: periodSchema }))
        .query(async ({ ctx, input }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const { from, to } = getDateRange(input.period);

            // Tiempo promedio de primera respuesta (en minutos) por agente
            // Usamos la diferencia entre el primer mensaje inbound y el primer mensaje outbound de la conversación
            const rows = await db.execute(sql`
        SELECT
          u.id AS agentId,
          u.name AS agentName,
          COUNT(DISTINCT c.id) AS conversationsHandled,
          ROUND(AVG(
            TIMESTAMPDIFF(MINUTE, first_in.first_inbound, first_out.first_outbound)
          ), 1) AS avgFirstResponseMinutes
        FROM conversations c
        JOIN users u ON u.id = c.assignedToId AND u.tenantId = ${tenantId}
        JOIN (
          SELECT conversationId, MIN(createdAt) AS first_inbound
          FROM chat_messages
          WHERE direction = 'inbound' AND tenantId = ${tenantId}
          GROUP BY conversationId
        ) first_in ON first_in.conversationId = c.id
        JOIN (
          SELECT conversationId, MIN(createdAt) AS first_outbound
          FROM chat_messages
          WHERE direction = 'outbound' AND tenantId = ${tenantId}
          GROUP BY conversationId
        ) first_out ON first_out.conversationId = c.id
        WHERE
          c.tenantId = ${tenantId}
          AND c.assignedToId IS NOT NULL
          AND c.createdAt >= ${from}
          AND c.createdAt <= ${to}
          AND first_out.first_outbound > first_in.first_inbound
        GROUP BY u.id, u.name
        ORDER BY avgFirstResponseMinutes ASC
      `);

            return (rows as any[]).map(row => ({
                agentId: row.agentId,
                agentName: row.agentName ?? `Agente #${row.agentId}`,
                conversationsHandled: Number(row.conversationsHandled ?? 0),
                avgFirstResponseMinutes: Number(row.avgFirstResponseMinutes ?? 0),
                avgFirstResponseFormatted: formatMinutes(Number(row.avgFirstResponseMinutes ?? 0)),
            }));
        }),

    /**
     * Resumen de actividad de los últimos 7 días para el widget del dashboard principal
     */
    activitySummary: permissionProcedure("reports.view")
        .input(z.object({}))
        .query(async ({ ctx }) => {
            const db = (await getDb())!;
            const { tenantId } = ctx.user;
            const from = new Date();
            from.setDate(from.getDate() - 6);
            from.setHours(0, 0, 0, 0);

            // Leads por día (últimos 7 días)
            const leadsByDay = await db
                .select({
                    date: sql<string>`DATE(${leads.createdAt})`.as("date"),
                    count: count(),
                })
                .from(leads)
                .where(and(eq(leads.tenantId, tenantId), gte(leads.createdAt, from)))
                .groupBy(sql`DATE(${leads.createdAt})`)
                .orderBy(sql`DATE(${leads.createdAt})`);

            // Mensajes por día (últimos 7 días)
            const msgsByDay = await db
                .select({
                    date: sql<string>`DATE(${chatMessages.createdAt})`.as("date"),
                    count: count(),
                })
                .from(chatMessages)
                .where(and(eq(chatMessages.tenantId, tenantId), gte(chatMessages.createdAt, from)))
                .groupBy(sql`DATE(${chatMessages.createdAt})`)
                .orderBy(sql`DATE(${chatMessages.createdAt})`);

            // Conversaciones abiertas actualmente
            const [openConvs] = await db
                .select({ count: count() })
                .from(conversations)
                .where(and(
                    eq(conversations.tenantId, tenantId),
                    eq(conversations.ticketStatus, "open")
                ));

            // Leads sin asignar
            const [unassignedLeads] = await db
                .select({ count: count() })
                .from(leads)
                .where(and(
                    eq(leads.tenantId, tenantId),
                    sql`${leads.assignedToId} IS NULL`
                ));

            return {
                leadsByDay,
                msgsByDay,
                openConversations: openConvs.count,
                unassignedLeads: unassignedLeads.count,
            };
        }),
});

// ─── Helpers de formato ──────────────────────────────────────────────────────

function formatMinutes(minutes: number): string {
    if (minutes < 1) return "< 1 min";
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
