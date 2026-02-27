import { getDb } from "../db";
import {
  appSettings,
  leads,
  templates,
  pipelines,
  pipelineStages,
  campaigns,
  campaignRecipients,
  conversations,
  chatMessages,
  whatsappNumbers,
  whatsappConnections,
  integrations,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

import { logger } from "../_core/logger";

export type BackupMode = "replace" | "merge";

export interface BackupData {
  version: string;
  timestamp: string;
  tenantId: number;
  encrypted?: boolean;
  data: {
    appSettings?: any[];
    pipelines?: any[];
    pipelineStages?: any[];
    templates?: any[];
    leads: any[];
    campaigns?: any[];
    campaignRecipients?: any[];
    conversations?: any[];
    chatMessages?: any[];
    whatsappNumbers?: any[];
    whatsappConnections?: any[];
    integrations?: any[];
  };
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

/** Strip sensitive fields from backup data */
function sanitizeForBackup(rows: any[]): any[] {
  const SENSITIVE_FIELDS = ["accessToken", "password", "invitationToken", "refreshToken", "appSecret"];
  return rows.map((row: any) => {
    const clean = { ...row };
    for (const field of SENSITIVE_FIELDS) {
      if (field in clean) {
        clean[field] = "[REDACTED]";
      }
    }
    return clean;
  });
}

/**
 * Create a tenant-scoped backup of critical CRM data.
 * SECURITY: Every table is filtered by tenantId to prevent cross-tenant data leakage.
 */
export async function createBackup(tenantId: number): Promise<BackupData> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const tenantFilter = (table: any) => eq(table.tenantId, tenantId);

  const [
    settingsData,
    pipelinesData,
    pipelineStagesData,
    templatesData,
    leadsData,
    campaignsData,
    recipientsData,
    conversationsData,
    messagesData,
    numbersData,
    connectionsData,
    integrationsData,
  ] = await Promise.all([
    db.select().from(appSettings).where(tenantFilter(appSettings)),
    db.select().from(pipelines).where(tenantFilter(pipelines)),
    db.select().from(pipelineStages).where(tenantFilter(pipelineStages)),
    db.select().from(templates).where(tenantFilter(templates)),
    db.select().from(leads).where(tenantFilter(leads)),
    db.select().from(campaigns).where(tenantFilter(campaigns)),
    db.select().from(campaignRecipients).where(tenantFilter(campaignRecipients)),
    db.select().from(conversations).where(tenantFilter(conversations)),
    db.select().from(chatMessages).where(tenantFilter(chatMessages)),
    db.select().from(whatsappNumbers).where(tenantFilter(whatsappNumbers)),
    db.select().from(whatsappConnections).where(tenantFilter(whatsappConnections)),
    db.select().from(integrations).where(tenantFilter(integrations)),
  ]);

  return {
    version: "3.0",
    timestamp: new Date().toISOString(),
    tenantId,
    data: {
      appSettings: sanitizeForBackup(asArray(settingsData)),
      pipelines: asArray(pipelinesData),
      pipelineStages: asArray(pipelineStagesData),
      templates: asArray(templatesData),
      leads: asArray(leadsData),
      campaigns: asArray(campaignsData),
      campaignRecipients: asArray(recipientsData),
      conversations: asArray(conversationsData),
      chatMessages: sanitizeForBackup(asArray(messagesData)),
      whatsappNumbers: asArray(numbersData),
      whatsappConnections: sanitizeForBackup(asArray(connectionsData)),
      integrations: sanitizeForBackup(asArray(integrationsData)),
    },
  };
}

/**
 * Validate backup file structure (supports v1, v2, and v3)
 */
export function validateBackupFile(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  if (!data.version || !data.timestamp || !data.data) return false;
  if (!data.data.leads || !Array.isArray(data.data.leads)) return false;
  return true;
}

/**
 * Restore backup JSON — TENANT-SCOPED.
 * - replace: wipes and restores only current tenant's data (NOT other tenants)
 * - merge: safe merge (only imports leads + templates + pipelines/stages, avoids duplicates)
 */
export async function restoreBackup(backup: any, mode: BackupMode = "replace", tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (!validateBackupFile(backup)) {
    throw new Error("Archivo de backup inválido");
  }

  const data = backup.data ?? {};

  if (mode === "merge") {
    return restoreBackupMergeSafe(data, tenantId);
  }

  return restoreBackupReplaceAll(data, tenantId);
}

/**
 * Replace-all restore — ONLY deletes and inserts rows for the given tenantId.
 * Other tenants are NOT affected.
 */
async function restoreBackupReplaceAll(data: any, tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db.transaction(async (tx) => {
    // Delete ONLY current tenant's data (children first)
    await tx.delete(chatMessages).where(eq(chatMessages.tenantId, tenantId));
    await tx.delete(conversations).where(eq(conversations.tenantId, tenantId));
    await tx.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, tenantId));
    await tx.delete(campaigns).where(eq(campaigns.tenantId, tenantId));
    await tx.delete(templates).where(eq(templates.tenantId, tenantId));
    await tx.delete(pipelineStages).where(eq(pipelineStages.tenantId, tenantId));
    await tx.delete(pipelines).where(eq(pipelines.tenantId, tenantId));
    await tx.delete(integrations).where(eq(integrations.tenantId, tenantId));
    await tx.delete(whatsappConnections).where(eq(whatsappConnections.tenantId, tenantId));
    await tx.delete(whatsappNumbers).where(eq(whatsappNumbers.tenantId, tenantId));
    await tx.delete(leads).where(eq(leads.tenantId, tenantId));
    await tx.delete(appSettings).where(eq(appSettings.tenantId, tenantId));

    const inserted: Record<string, number> = {
      appSettings: 0, pipelines: 0, pipelineStages: 0, templates: 0,
      leads: 0, campaigns: 0, campaignRecipients: 0, conversations: 0,
      chatMessages: 0, whatsappNumbers: 0, whatsappConnections: 0, integrations: 0,
    };

    // Helper: force tenantId on each row before insert
    const withTenant = (rows: any[]) => rows.map(r => ({ ...r, tenantId }));

    // Insert in parent -> children order
    const settings = asArray(data.appSettings);
    if (settings.length) {
      await tx.insert(appSettings).values(withTenant(settings) as any);
      inserted.appSettings = settings.length;
    }

    const pipes = asArray(data.pipelines);
    if (pipes.length) {
      await tx.insert(pipelines).values(withTenant(pipes) as any);
      inserted.pipelines = pipes.length;
    }

    const stages = asArray(data.pipelineStages);
    if (stages.length) {
      await tx.insert(pipelineStages).values(withTenant(stages) as any);
      inserted.pipelineStages = stages.length;
    }

    const tmpl = asArray(data.templates);
    if (tmpl.length) {
      await tx.insert(templates).values(withTenant(tmpl) as any);
      inserted.templates = tmpl.length;
    }

    const leadsData = asArray(data.leads);
    if (leadsData.length) {
      await tx.insert(leads).values(withTenant(leadsData) as any);
      inserted.leads = leadsData.length;
    }

    const nums = asArray(data.whatsappNumbers);
    if (nums.length) {
      await tx.insert(whatsappNumbers).values(withTenant(nums) as any);
      inserted.whatsappNumbers = nums.length;
    }

    const conns = asArray(data.whatsappConnections);
    if (conns.length) {
      await tx.insert(whatsappConnections).values(withTenant(conns) as any);
      inserted.whatsappConnections = conns.length;
    }

    const intgs = asArray(data.integrations);
    if (intgs.length) {
      await tx.insert(integrations).values(withTenant(intgs) as any);
      inserted.integrations = intgs.length;
    }

    const camps = asArray(data.campaigns);
    if (camps.length) {
      await tx.insert(campaigns).values(withTenant(camps) as any);
      inserted.campaigns = camps.length;
    }

    const campRecips = asArray(data.campaignRecipients);
    if (campRecips.length) {
      await tx.insert(campaignRecipients).values(withTenant(campRecips) as any);
      inserted.campaignRecipients = campRecips.length;
    }

    const convs = asArray(data.conversations);
    if (convs.length) {
      await tx.insert(conversations).values(withTenant(convs) as any);
      inserted.conversations = convs.length;
    }

    const msgs = asArray(data.chatMessages);
    if (msgs.length) {
      await tx.insert(chatMessages).values(withTenant(msgs) as any);
      inserted.chatMessages = msgs.length;
    }

    logger.info("✅ Backup restored successfully (tenant-scoped, transactional):", inserted);
    return { success: true, inserted };
  });
}

async function restoreBackupMergeSafe(data: any, tenantId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // 1) Pipelines + stages (by name, scoped to tenant)
  const existingPipes = await db.select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines).where(eq(pipelines.tenantId, tenantId));
  const pipeNameToId = new Map(existingPipes.map(p => [p.name, p.id]));

  let pipelinesImported = 0;
  let stagesImported = 0;

  for (const p of asArray(data.pipelines)) {
    if (!p?.name) continue;
    if (!pipeNameToId.has(p.name)) {
      const res = await db.insert(pipelines).values({
        tenantId,
        name: p.name,
        isDefault: false,
        createdAt: p.createdAt ?? new Date(),
        updatedAt: p.updatedAt ?? new Date(),
      } as any);
      const newId = (res as any)?.[0]?.insertId;
      if (newId) {
        pipeNameToId.set(p.name, newId);
        pipelinesImported++;
      }
    }
  }

  for (const s of asArray(data.pipelineStages)) {
    const pipeName = (asArray(data.pipelines).find((p: any) => p.id === s.pipelineId)?.name) as string | undefined;
    const mappedPipelineId = pipeName ? pipeNameToId.get(pipeName) : undefined;
    if (!mappedPipelineId) continue;

    const already = await db
      .select({ id: pipelineStages.id, name: pipelineStages.name })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.pipelineId, mappedPipelineId)))
      .limit(500);
    const existsByName = already.some((row: any) => row.name === s.name);
    if (existsByName) continue;

    await db.insert(pipelineStages).values({
      tenantId,
      pipelineId: mappedPipelineId,
      name: s.name,
      type: s.type ?? "open",
      color: s.color ?? "#e2e8f0",
      order: s.order ?? 1,
      createdAt: s.createdAt ?? new Date(),
      updatedAt: s.updatedAt ?? new Date(),
    } as any);
    stagesImported++;
  }

  // 2) Templates (by name + type, scoped to tenant)
  const existingTemplates = await db.select({ id: templates.id, name: templates.name, type: templates.type })
    .from(templates).where(eq(templates.tenantId, tenantId));
  const templateKey = (t: any) => `${t.name}::${t.type}`;
  const existingTemplateKeys = new Set(existingTemplates.map(templateKey));

  let templatesImported = 0;
  for (const t of asArray(data.templates)) {
    if (!t?.name) continue;
    const key = templateKey(t);
    if (existingTemplateKeys.has(key)) continue;
    await db.insert(templates).values({
      tenantId,
      name: t.name,
      content: t.content ?? "",
      type: t.type ?? "whatsapp",
      variables: t.variables ?? null,
      createdAt: t.createdAt ?? new Date(),
    } as any);
    templatesImported++;
  }

  // 3) Leads (dedupe by phone, scoped to tenant)
  const existingLeads = await db.select({ phone: leads.phone })
    .from(leads).where(eq(leads.tenantId, tenantId));
  const phoneSet = new Set(existingLeads.map(l => String(l.phone ?? "").trim()).filter(Boolean));

  const stageRows = await db.select({ id: pipelineStages.id })
    .from(pipelineStages).where(eq(pipelineStages.tenantId, tenantId));
  const validStageIds = new Set(stageRows.map(s => s.id));

  let leadsImported = 0;
  let duplicates = 0;

  for (const l of asArray(data.leads)) {
    const phone = String(l?.phone ?? "").trim();
    if (!phone) continue;

    if (phoneSet.has(phone)) {
      duplicates++;
      continue;
    }

    await db.insert(leads).values({
      tenantId,
      name: l.name ?? "Sin nombre",
      phone,
      email: l.email ?? null,
      country: l.country ?? "Paraguay",
      status: l.status ?? "new",
      notes: l.notes ?? null,
      pipelineStageId: validStageIds.has(l.pipelineStageId) ? l.pipelineStageId : null,
      kanbanOrder: 0,
      createdAt: l.createdAt ?? new Date(),
      updatedAt: l.updatedAt ?? new Date(),
    } as any);

    phoneSet.add(phone);
    leadsImported++;
  }

  return {
    success: true as const,
    mode: "merge" as const,
    imported: {
      pipelines: pipelinesImported,
      pipelineStages: stagesImported,
      templates: templatesImported,
      leads: leadsImported,
      duplicates,
    },
    note: "Merge seguro: solo importa Pipelines/Etapas, Plantillas y Leads. Para restauración completa use 'Reemplazar'.",
  };
}

/**
 * Convert leads to CSV format
 */
export function leadsToCSV(leadsData: any[]): string {
  if (leadsData.length === 0) return "nombre,telefono,email,pais,estado,notas\n";

  const headers = ["nombre", "telefono", "email", "pais", "estado", "notas"];
  const rows = leadsData.map((lead) => [
    lead.name || "",
    lead.phone || "",
    lead.email || "",
    lead.country || "",
    lead.status || "",
    (lead.notes || "").replace(/\"/g, '""'),
  ]);

  const csvContent = [headers.join(","), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(","))].join("\n");
  return csvContent;
}

/**
 * Parse CSV and return structured data
 */
export function parseCSV(csvContent: string): any[] {
  const lines = csvContent.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/\"/g, ""));
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]
      .split(/,(?=(?:(?:[^\"]*\"){2})*[^\"]*$)/)
      .map((v) => v.trim().replace(/^\"|\"$/g, ""));
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    data.push(row);
  }

  return data;
}

/**
 * Import leads from CSV with deduplication — TENANT-SCOPED
 */
export async function importLeadsFromCSV(csvData: any[], tenantId: number): Promise<{ imported: number; duplicates: number; errors: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let imported = 0;
  let duplicates = 0;
  let errors = 0;

  // Only check duplicates within the same tenant
  const existingLeads = await db.select({ phone: leads.phone })
    .from(leads).where(eq(leads.tenantId, tenantId));
  const existingPhones = new Set(existingLeads.map((l) => l.phone));

  for (const row of csvData) {
    try {
      const phone = row.telefono || row.phone;
      const name = row.nombre || row.name;

      if (!phone || !name) {
        errors++;
        continue;
      }

      if (existingPhones.has(phone)) {
        duplicates++;
        continue;
      }

      await db.insert(leads).values({
        tenantId,
        name,
        phone,
        email: row.email || null,
        country: row.pais || row.country || "Paraguay",
        status: (row.estado || row.status || "new") as any,
        notes: row.notas || row.notes || null,
      } as any);

      existingPhones.add(phone);
      imported++;
    } catch (error) {
      logger.error("[Import] Failed to import lead:", error);
      errors++;
    }
  }

  return { imported, duplicates, errors };
}

// ── Encryption helpers for auto-backup ──

const ALGO = "aes-256-gcm";

export function encryptBackup(data: BackupData, key: string): Buffer {
  const iv = crypto.randomBytes(16);
  const keyBuf = crypto.scryptSync(key, "crm-backup-salt", 32);
  const cipher = crypto.createCipheriv(ALGO, keyBuf, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: [16-byte IV][16-byte auth tag][encrypted data]
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBackup(buf: Buffer, key: string): BackupData {
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const keyBuf = crypto.scryptSync(key, "crm-backup-salt", 32);
  const decipher = crypto.createDecipheriv(ALGO, keyBuf, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
