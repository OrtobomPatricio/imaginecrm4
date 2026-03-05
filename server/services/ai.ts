/**
 * AI Service — Tenant-aware LLM invocation
 *
 * Resolves the correct provider/model/apiKey from tenant's aiConfig,
 * then calls the appropriate API (OpenAI, Anthropic, Gemini via Forge, or direct).
 */
import { getDb } from "../db";
import { getOrCreateAppSettings } from "./app-settings";
import { decryptSecret } from "../_core/crypto";
import { logger } from "../_core/logger";
import { chatMessages } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

type Message = { role: "system" | "user" | "assistant"; content: string };

interface AiConfig {
    provider: "openai" | "anthropic" | "gemini";
    apiKey?: string | null;
    model?: string;
}

const DEFAULT_MODELS: Record<string, string> = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-5-haiku-20241022",
    gemini: "gemini-2.0-flash",
};

const PROVIDER_URLS: Record<string, string> = {
    openai: "https://api.openai.com/v1/chat/completions",
    anthropic: "https://api.anthropic.com/v1/messages",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/**
 * Get the decrypted AI config for a tenant. Returns null if not configured.
 */
export async function getTenantAiConfig(tenantId: number): Promise<AiConfig | null> {
    const db = await getDb();
    if (!db) return null;

    const settings = await getOrCreateAppSettings(db, tenantId);
    const raw = settings.aiConfig as AiConfig | null;
    if (!raw?.provider) return null;

    const apiKey = decryptSecret(raw.apiKey ?? null);
    if (!apiKey) return null;

    return {
        provider: raw.provider,
        apiKey,
        model: raw.model || DEFAULT_MODELS[raw.provider] || "gpt-4o-mini",
    };
}

/**
 * Invoke the LLM with tenant-specific config.
 */
async function invokeTenantLLM(
    config: AiConfig,
    messages: Message[],
    maxTokens = 1024,
): Promise<string> {
    const { provider, apiKey, model } = config;

    if (provider === "anthropic") {
        return invokeAnthropic(apiKey!, model!, messages, maxTokens);
    }

    // OpenAI and Gemini both use OpenAI-compatible API format
    const url = provider === "gemini"
        ? `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
        : PROVIDER_URLS.openai;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0.7,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`${provider} API error ${res.status}: ${text}`);
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? "";
}

async function invokeAnthropic(
    apiKey: string,
    model: string,
    messages: Message[],
    maxTokens: number,
): Promise<string> {
    const systemMsg = messages.find(m => m.role === "system");
    const chatMsgs = messages.filter(m => m.role !== "system");

    const res = await fetch(PROVIDER_URLS.anthropic, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            ...(systemMsg ? { system: systemMsg.content } : {}),
            messages: chatMsgs.map(m => ({ role: m.role, content: m.content })),
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text ?? "";
}

/**
 * Get last N messages from a conversation for context
 */
export async function getConversationContext(
    tenantId: number,
    conversationId: number,
    limit = 15,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
    const db = await getDb();
    if (!db) return [];

    const rows = await db
        .select({
            direction: chatMessages.direction,
            content: chatMessages.content,
        })
        .from(chatMessages)
        .where(
            and(
                eq(chatMessages.tenantId, tenantId),
                eq(chatMessages.conversationId, conversationId),
            ),
        )
        .orderBy(desc(chatMessages.id))
        .limit(limit);

    return rows
        .reverse()
        .filter(r => r.content)
        .map(r => ({
            role: r.direction === "inbound" ? "user" as const : "assistant" as const,
            content: r.content!,
        }));
}

// ─── Public Feature Functions ───────────────────────────────────

/**
 * Feature 1: Generate suggested replies for a conversation
 */
export async function generateSuggestedReplies(
    tenantId: number,
    conversationId: number,
    companyName: string,
): Promise<string[]> {
    const config = await getTenantAiConfig(tenantId);
    if (!config) throw new Error("IA no configurada. Ve a Configuración → Integraciones → IA para agregar tu API key.");

    const context = await getConversationContext(tenantId, conversationId);
    if (context.length === 0) return [];

    const systemPrompt = `Eres un asistente de atención al cliente de "${companyName}". 
Analiza la conversación y genera exactamente 3 respuestas sugeridas que el agente podría enviar.
Las respuestas deben ser profesionales, empáticas y en el mismo idioma que el cliente.
Responde SOLO con un JSON array de 3 strings, sin explicación adicional.
Ejemplo: ["Respuesta 1", "Respuesta 2", "Respuesta 3"]`;

    const messages: Message[] = [
        { role: "system", content: systemPrompt },
        ...context,
        { role: "user", content: "Genera 3 respuestas sugeridas para continuar esta conversación." },
    ];

    const result = await invokeTenantLLM(config, messages, 512);

    try {
        const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) return parsed.slice(0, 3).map(String);
    } catch {
        logger.warn("[AI] Failed to parse suggestions JSON, extracting manually");
    }

    // Fallback: extract quoted strings
    const matches = result.match(/"([^"]{10,})"/g);
    if (matches) return matches.slice(0, 3).map(m => m.replace(/^"|"$/g, ""));

    return [result.trim()];
}

/**
 * Feature 2: Summarize a conversation
 */
export async function summarizeConversation(
    tenantId: number,
    conversationId: number,
    companyName: string,
): Promise<string> {
    const config = await getTenantAiConfig(tenantId);
    if (!config) throw new Error("IA no configurada. Ve a Configuración → Integraciones → IA para agregar tu API key.");

    const context = await getConversationContext(tenantId, conversationId, 30);
    if (context.length === 0) return "No hay mensajes en esta conversación.";

    const systemPrompt = `Eres un asistente de "${companyName}". 
Genera un resumen conciso de la siguiente conversación de atención al cliente.
El resumen debe incluir:
- Motivo del contacto
- Puntos clave discutidos
- Estado actual (resuelto, pendiente, en espera)
- Acciones necesarias (si las hay)
Responde en el mismo idioma de la conversación. Máximo 200 palabras.`;

    const conversationText = context
        .map(m => `${m.role === "user" ? "Cliente" : "Agente"}: ${m.content}`)
        .join("\n");

    const messages: Message[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Conversación:\n${conversationText}\n\nGenera el resumen.` },
    ];

    return invokeTenantLLM(config, messages, 512);
}

/**
 * Feature 3: Generate an auto-reply for incoming message outside business hours
 */
export async function generateAutoReply(
    tenantId: number,
    conversationId: number,
    incomingMessage: string,
    companyName: string,
    autoReplyPrompt?: string,
): Promise<string> {
    const config = await getTenantAiConfig(tenantId);
    if (!config) throw new Error("AI not configured");

    const context = await getConversationContext(tenantId, conversationId, 5);

    const defaultPrompt = `Eres el asistente virtual de "${companyName}". 
Estás respondiendo fuera del horario de atención.
Sé amable, profesional y conciso. Informa que un agente responderá pronto.
Si puedes ayudar con información básica, hazlo. Si no, indica que el equipo contactará al cliente en horario laboral.
Responde en el mismo idioma del cliente. Máximo 2 oraciones.`;

    const messages: Message[] = [
        { role: "system", content: autoReplyPrompt || defaultPrompt },
        ...context,
        { role: "user", content: incomingMessage },
    ];

    return invokeTenantLLM(config, messages, 256);
}
