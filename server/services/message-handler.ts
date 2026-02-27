import { getDb } from "../db";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { saveBufferToUploads } from "../_core/media-storage";
import { leads, conversations, chatMessages, whatsappNumbers, pipelines, pipelineStages } from "../../drizzle/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { emitToConversation } from "./websocket";
import { normalizeContactPhone } from "../_core/phone";

import { logger } from "../_core/logger";

function unwrapBaileysMessage(msg: any): any {
    let m = msg;
    for (let i = 0; i < 4; i++) {
        if (!m) break;
        if (m.ephemeralMessage?.message) { m = m.ephemeralMessage.message; continue; }
        if (m.viewOnceMessage?.message) { m = m.viewOnceMessage.message; continue; }
        if (m.viewOnceMessageV2?.message) { m = m.viewOnceMessageV2.message; continue; }
        break;
    }
    return m;
}

async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

async function maybeDownloadMedia(innerMessage: any, upsertType: 'append' | 'notify') {
    if (upsertType === 'append' && process.env.WA_MEDIA_DOWNLOAD_ON_SYNC !== '1') {
        return { mediaUrl: null, mediaMimeType: null, mediaName: null };
    }

    const m = innerMessage || {};
    const map: Array<{ key: string; type: any; name: string }> = [
        { key: 'imageMessage', type: 'image', name: 'image' },
        { key: 'videoMessage', type: 'video', name: 'video' },
        { key: 'audioMessage', type: 'audio', name: 'audio' },
        { key: 'documentMessage', type: 'document', name: 'document' },
        { key: 'stickerMessage', type: 'sticker', name: 'sticker' },
    ];

    for (const item of map) {
        const msgObj = m[item.key];
        if (!msgObj) continue;

        const stream = await downloadContentFromMessage(msgObj, item.type);
        const buffer = await streamToBuffer(stream);
        const mimetype = (msgObj.mimetype as string | undefined) || null;
        const filename = (msgObj.fileName as string | undefined) || (msgObj.file_name as string | undefined) || null;

        const saved = saveBufferToUploads({
            buffer,
            originalname: filename || `${item.name}-${Date.now()}`,
            mimetype,
        });

        return { mediaUrl: saved.url, mediaMimeType: mimetype, mediaName: filename || saved.originalname };
    }

    return { mediaUrl: null, mediaMimeType: null, mediaName: null };
}

export const MessageHandler = {
    async handleMessageUpdate(userId: number, whatsappMessageId: string, status: 'read' | 'delivered') {
        logger.info(`[MessageHandler] Updating message ${whatsappMessageId} status to ${status}`);
        const db = await getDb();
        if (!db) { logger.error("[MessageHandler] No DB connection"); return; }

        const waNumber = await db.select({ tenantId: whatsappNumbers.tenantId }).from(whatsappNumbers).where(eq(whatsappNumbers.id, userId)).limit(1);
        const tenantId = waNumber[0]?.tenantId;
        if (!tenantId) {
            logger.error(`[MessageHandler] Cannot resolve tenant for whatsappNumberId=${userId}`);
            return;
        }

        const updates: any = {};
        if (status === 'read') updates.readAt = new Date();
        if (status === 'delivered') updates.deliveredAt = new Date();

        const result = await db.update(chatMessages)
            .set(updates)
            .where(and(
                eq(chatMessages.tenantId, tenantId),
                eq(chatMessages.whatsappMessageId, whatsappMessageId),
                eq(chatMessages.whatsappNumberId, userId)
            ));

        if (result) {
            const messages = await db.select({ id: chatMessages.id, conversationId: chatMessages.conversationId })
                .from(chatMessages)
                .where(and(eq(chatMessages.tenantId, tenantId), eq(chatMessages.whatsappMessageId, whatsappMessageId)))
                .limit(1);

            if (messages[0]) {
                emitToConversation(messages[0].conversationId, "message:status", {
                    messageId: messages[0].id,
                    status,
                    timestamp: new Date(),
                });
            }
        }
    },

    async handleIncomingMessage(userId: number, message: any, upsertType: 'append' | 'notify' = 'notify') {
        logger.info(`[MessageHandler] Received ${upsertType} msg ${message.key?.id} from ${message.key?.remoteJid}`);
        const db = await getDb();
        if (!db) { logger.error("[MessageHandler] No DB connection"); return; }

        const jid = message.key.remoteJid;
        if (!jid || jid.includes('status@broadcast') || jid.includes('@lid')) return;

        const waNumber = await db.select({ tenantId: whatsappNumbers.tenantId })
            .from(whatsappNumbers)
            .where(eq(whatsappNumbers.id, userId))
            .limit(1);
        const tenantId = waNumber[0]?.tenantId;
        if (!tenantId) {
            logger.error(`[MessageHandler] Cannot resolve tenant for whatsappNumberId=${userId}`);
            return;
        }

        const existingMessage = await db.select({ id: chatMessages.id })
            .from(chatMessages)
            .where(and(
                eq(chatMessages.tenantId, tenantId),
                eq(chatMessages.whatsappNumberId, userId),
                eq(chatMessages.whatsappMessageId, message.key.id),
                eq(chatMessages.whatsappConnectionType, "qr")
            ))
            .limit(1);

        if (existingMessage.length > 0) return;

        const fromMe = message.key.fromMe;
        const locationMessage = message.message?.locationMessage;
        let locationData: { latitude?: number; longitude?: number; locationName?: string } | null = null;
        if (locationMessage) {
            locationData = {
                latitude: locationMessage.degreesLatitude,
                longitude: locationMessage.degreesLongitude,
                locationName: locationMessage.name || null,
            };
        }

        const text = message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            (locationMessage ? `📍 Ubicación${locationMessage.name ? ': ' + locationMessage.name : ''}` : null) ||
            (message.message?.imageMessage ? "Image" : null) ||
            (message.message?.videoMessage ? "Video" : null) ||
            (message.message?.audioMessage ? "Audio" : null) ||
            (message.message?.documentMessage ? "Document" : null) ||
            (message.message?.stickerMessage ? "Sticker" : null) ||
            "Media/Unknown";

        const messageTimestamp = message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000) : new Date();
        const phoneNumber = normalizeContactPhone(jid);
        const contactName = message.pushName || "Unknown";

        try {
            let leadId: number;
            const existingLead = await db.select().from(leads)
                .where(and(eq(leads.tenantId, tenantId), eq(leads.phone, phoneNumber))).limit(1);

            if (existingLead.length > 0) {
                leadId = existingLead[0].id;
                const contactDate = upsertType === 'notify' ? new Date() : messageTimestamp;
                const currentLastContact = existingLead[0].lastContactedAt;
                if (!currentLastContact || contactDate > currentLastContact) {
                    await db.update(leads).set({ lastContactedAt: contactDate }).where(eq(leads.id, leadId));
                }
            } else {
                let stageId: number | null = null;
                let nextOrder = 0;

                const defaultPipeline = await db.select().from(pipelines)
                    .where(and(eq(pipelines.tenantId, tenantId), eq(pipelines.isDefault, true))).limit(1);
                if (defaultPipeline[0]) {
                    const firstStage = await db.select().from(pipelineStages)
                        .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.pipelineId, defaultPipeline[0].id)))
                        .orderBy(asc(pipelineStages.order))
                        .limit(1);

                    if (firstStage[0]) {
                        stageId = firstStage[0].id;
                        const maxRows = await db.select({ max: sql<number>`max(${leads.kanbanOrder})` })
                            .from(leads)
                            .where(and(eq(leads.tenantId, tenantId), eq(leads.pipelineStageId, stageId)));
                        nextOrder = ((maxRows[0] as any)?.max ?? 0) + 1;
                    }
                }

                const [newLead] = await db.insert(leads).values({
                    tenantId,
                    name: contactName !== "Unknown" ? contactName : phoneNumber,
                    phone: phoneNumber,
                    country: "Unknown",
                    pipelineStageId: stageId,
                    kanbanOrder: nextOrder,
                    source: "whatsapp_inbound",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    lastContactedAt: messageTimestamp,
                }).$returningId();
                leadId = newLead.id;
            }

            let conversationId: number;
            const existingConv = await db.select().from(conversations).where(and(
                eq(conversations.tenantId, tenantId),
                eq(conversations.leadId, leadId),
                eq(conversations.whatsappNumberId, userId),
                eq(conversations.channel, 'whatsapp'),
                eq(conversations.whatsappConnectionType, 'qr'),
                eq(conversations.externalChatId, jid)
            )).limit(1);

            if (existingConv.length > 0) {
                conversationId = existingConv[0].id;
                const updates: any = {};

                if (upsertType === 'notify' && !fromMe) {
                    updates.unreadCount = (existingConv[0].unreadCount || 0) + 1;
                    updates.lastMessageAt = new Date();
                    updates.status = 'active';
                    if (existingConv[0].ticketStatus === 'closed') updates.ticketStatus = 'open';
                } else if (upsertType === 'append' || fromMe) {
                    if (!existingConv[0].lastMessageAt || messageTimestamp > existingConv[0].lastMessageAt) {
                        updates.lastMessageAt = messageTimestamp;
                    }
                }

                if (Object.keys(updates).length > 0) {
                    await db.update(conversations).set(updates).where(eq(conversations.id, conversationId));
                }
            } else {
                const [newConv] = await db.insert(conversations).values({
                    tenantId,
                    channel: 'whatsapp',
                    whatsappNumberId: userId,
                    whatsappConnectionType: 'qr',
                    externalChatId: jid,
                    leadId,
                    contactPhone: phoneNumber,
                    contactName,
                    unreadCount: (upsertType === 'notify' && !fromMe) ? 1 : 0,
                    lastMessageAt: messageTimestamp,
                    status: 'active'
                }).$returningId();
                conversationId = newConv.id;
            }

            const inner = unwrapBaileysMessage(message.message);
            let msgType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'location' = 'text';
            if (inner?.imageMessage) msgType = 'image';
            else if (inner?.videoMessage) msgType = 'video';
            else if (inner?.audioMessage) msgType = 'audio';
            else if (inner?.documentMessage) msgType = 'document';
            else if (inner?.stickerMessage) msgType = 'sticker';
            else if (inner?.locationMessage || locationData) msgType = 'location';

            const media = await maybeDownloadMedia(inner, upsertType);
            const [inserted] = await db.insert(chatMessages).values({
                tenantId,
                conversationId,
                whatsappNumberId: userId,
                whatsappConnectionType: 'qr',
                direction: fromMe ? 'outbound' : 'inbound',
                messageType: msgType,
                content: text,
                mediaUrl: media.mediaUrl,
                mediaName: media.mediaName,
                mediaMimeType: media.mediaMimeType,
                latitude: locationData?.latitude ? locationData.latitude.toString() : null,
                longitude: locationData?.longitude ? locationData.longitude.toString() : null,
                locationName: locationData?.locationName ?? null,
                whatsappMessageId: message.key.id,
                status: fromMe ? 'sent' : 'delivered',
                deliveredAt: fromMe ? null : messageTimestamp,
                sentAt: messageTimestamp,
                createdAt: messageTimestamp,
            }).$returningId();

            emitToConversation(conversationId, "message:new", {
                id: inserted.id,
                conversationId,
                content: text,
                fromMe,
                createdAt: messageTimestamp,
            });
        } catch (error) {
            logger.error("Error handling incoming message:", error);
        }
    }
};
