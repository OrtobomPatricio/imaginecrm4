import { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, WASocket } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import fs from 'fs';
import path from 'path';
import pino from 'pino';

import { logger } from "../_core/logger";

// Define session storage path
const SESSIONS_DIR = path.resolve(process.cwd(), "server", "sessions");

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

interface ConnectionState {
    status: 'connecting' | 'connected' | 'disconnected' | 'qr_ready';
    qr?: string;
    socket?: WASocket;
    typingJids?: Set<string>; // Track who is typing
    reconnectAttempts?: number;  // ✅ Track reconnection attempts
    lastReconnectAt?: Date;      // ✅ Track last reconnection time
}

// In-memory store for active connections
const connections: Map<number, ConnectionState> = new Map();

// Typing state cleanup timers
const typingTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Bridge Baileys presence events to the WebSocket typing indicator.
 * userId here is whatsappNumbers.id (the CRM WhatsApp number record).
 */
async function emitContactTyping(whatsappNumberId: number, jid: string, isTyping: boolean): Promise<void> {
    try {
        if (!jid || jid.includes("status@broadcast") || jid.includes("@lid")) return;

        const { isIOInitialized, emitToConversation } = await import("./websocket");
        if (!isIOInitialized()) return;

        const { getDb } = await import("../db");
        const { normalizeContactPhone } = await import("../_core/phone");
        const { eq, and } = await import("drizzle-orm");
        const { whatsappNumbers: waNums, conversations } = await import("../../drizzle/schema");

        const db = await getDb();
        if (!db) return;

        // Resolve tenantId
        const waRow = await db.select({ tenantId: waNums.tenantId })
            .from(waNums)
            .where(eq(waNums.id, whatsappNumberId))
            .limit(1);
        const tenantId = waRow[0]?.tenantId;
        if (!tenantId) return;

        // Find the conversation
        const phone = normalizeContactPhone(jid);
        const convRows = await db.select({ id: conversations.id })
            .from(conversations)
            .where(and(
                eq(conversations.whatsappNumberId, whatsappNumberId),
                eq(conversations.contactPhone, phone),
                eq(conversations.channel, "whatsapp"),
            ))
            .limit(1);

        const convId = convRows[0]?.id;
        if (!convId) return;

        emitToConversation(convId, "conversation:typing", {
            conversationId: convId,
            userId: 0,         // 0 = contact, not an agent
            userName: "Contacto",
            isTyping,
        }, tenantId);
    } catch {
        // Best-effort; don't crash the Baileys socket over a typing indicator
    }
}

export const BaileysService = {
    getSocket(userId: number) {
        return connections.get(userId)?.socket;
    },

    async initializeSession(userId: number, onQrUpdate: (qr: string) => void, onStatusUpdate: (status: string) => void) {
        const sessionName = `session_${userId}`;
        const sessionPath = path.join(SESSIONS_DIR, sessionName);

        // Setup Auth State
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }) as any,
            printQRInTerminal: false,
            auth: state,
            browser: ["Imagine CRM", "Chrome", "10.0"],
            syncFullHistory: true, // Enable full history sync
        });

        // Update local state
        connections.set(userId, { status: 'connecting', socket: sock });
        onStatusUpdate('connecting');

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                connections.set(userId, { ...connections.get(userId)!, status: 'qr_ready', qr });
                onQrUpdate(qr);
                onStatusUpdate('qr_ready');
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                const currentConn = connections.get(userId) || { status: 'disconnected' as const };
                const attempts = (currentConn.reconnectAttempts || 0) + 1;
                const MAX_RECONNECT_ATTEMPTS = 5;

                connections.set(userId, {
                    ...currentConn,
                    status: 'disconnected',
                    reconnectAttempts: attempts
                });
                onStatusUpdate('disconnected');

                if (shouldReconnect && attempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.min(1000 * Math.pow(2, attempts), 30000); // Exponencial max 30s
                    logger.info(`[Baileys] Reconnecting ${userId} in ${delay}ms (attempt ${attempts}/${MAX_RECONNECT_ATTEMPTS})`);

                    setTimeout(() => {
                        this.initializeSession(userId, onQrUpdate, onStatusUpdate);
                    }, delay);
                } else if (attempts >= MAX_RECONNECT_ATTEMPTS) {
                    logger.error(`[Baileys] Max reconnection attempts reached for ${userId}, giving up`);
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                    }
                } else {
                    // Logged out - clear session
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true, force: true });
                    }
                }
            } else if (connection === 'open') {
                // ✅ Reset reconnection counter on successful connect
                connections.set(userId, { ...connections.get(userId)!, status: 'connected', qr: undefined, reconnectAttempts: 0 });
                onStatusUpdate('connected');
            }
        });

        // Typing Indicators
        sock.ev.on('presence.update', async (update) => {
            const jid = update.id;
            const presences = update.presences || {};

            // Check if any participant is composing
            const isTyping = Object.values(presences).some(
                (p: any) => p.lastKnownPresence === 'composing'
            );

            const conn = connections.get(userId);
            if (conn) {
                if (!conn.typingJids) conn.typingJids = new Set();

                if (isTyping) {
                    conn.typingJids.add(jid);

                    // Auto-clear after 3 seconds
                    const timerKey = `${userId}-${jid}`;
                    if (typingTimers.has(timerKey)) {
                        clearTimeout(typingTimers.get(timerKey)!);
                    }
                    typingTimers.set(timerKey, setTimeout(() => {
                        conn.typingJids?.delete(jid);
                        typingTimers.delete(timerKey);
                        // Emit typing=false when auto-cleared
                        emitContactTyping(userId, jid, false).catch(() => {});
                    }, 3000));
                } else {
                    conn.typingJids.delete(jid);
                }
            }

            // Broadcast to WebSocket so the agent UI shows the typing indicator
            emitContactTyping(userId, jid, isTyping).catch(() => {});
        });

        // Read Receipts
        sock.ev.on('messages.update', async (updates) => {
            for (const update of updates) {
                if (update.update.status === 3) { // Status 3 = read
                    try {
                        const { MessageHandler } = await import("./message-handler");
                        await MessageHandler.handleMessageUpdate(userId, update.key.id!, 'read');
                    } catch (e) {
                        logger.error("Baileys: Error updating message status", e);
                    }
                }
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            logger.info("Baileys: messages.upsert received type:", m.type);

            if (m.messages && m.messages.length > 0) {
                for (const msg of m.messages) {
                    // Check if it's a message from another user (not us)
                    if (!msg.key.fromMe) {
                        try {
                            logger.info("Baileys: Invoking MessageHandler for msg:", msg.key.id);
                            const { MessageHandler } = await import("./message-handler");
                            // Pass the upsert type (notify vs append) to handle history correctly
                            await MessageHandler.handleIncomingMessage(userId, msg, m.type);
                        } catch (e) {
                            logger.error("Baileys: Error invoking MessageHandler", e);
                        }
                    } else {
                        // fromMe messages:
                        // - 'notify' (real-time) = echo of a message WE just sent via chat.sendMessage.
                        //   The message is already in the DB, so SKIP to avoid duplicates.
                        // - 'append' (history sync) = old sent messages being synced from the phone.
                        //   These need to be processed so the chat history is complete.
                        if (m.type === 'append') {
                            try {
                                const { MessageHandler } = await import("./message-handler");
                                await MessageHandler.handleIncomingMessage(userId, msg, m.type);
                            } catch (e) {
                                logger.error("Baileys: Error invoking MessageHandler for own message", e);
                            }
                        } else {
                            // Real-time fromMe echo — update whatsappMessageId on existing record
                            // so the dedup guard works for future history syncs
                            try {
                                const { getDb } = await import("../db");
                                const { chatMessages } = await import("../../drizzle/schema");
                                const { eq, and, isNull, desc } = await import("drizzle-orm");
                                const db = await getDb();
                                if (db && msg.key.id) {
                                    // Find the most recent pending/sent outbound message for this conversation
                                    const jid = msg.key.remoteJid;
                                    if (jid) {
                                        const { normalizeContactPhone } = await import("../_core/phone");
                                        const phone = normalizeContactPhone(jid);
                                        const { conversations } = await import("../../drizzle/schema");
                                        const convRows = await db.select({ id: conversations.id })
                                            .from(conversations)
                                            .where(and(
                                                eq(conversations.whatsappNumberId, userId),
                                                eq(conversations.contactPhone, phone),
                                                eq(conversations.channel, 'whatsapp'),
                                            ))
                                            .limit(1);
                                        if (convRows[0]) {
                                            // Patch the most recent outbound message that has no whatsappMessageId
                                            await db.update(chatMessages)
                                                .set({ whatsappMessageId: msg.key.id } as any)
                                                .where(and(
                                                    eq(chatMessages.conversationId, convRows[0].id),
                                                    eq(chatMessages.whatsappNumberId, userId),
                                                    eq(chatMessages.direction, 'outbound'),
                                                    isNull(chatMessages.whatsappMessageId),
                                                ));
                                        }
                                    }
                                }
                            } catch (e) {
                                logger.debug({ err: e }, "Baileys: Could not patch whatsappMessageId for fromMe echo (non-fatal)");
                            }
                        }
                    }
                }
            }
        });

        return sock;
    },

    async disconnect(userId: number) {
        const conn = connections.get(userId);
        if (conn?.socket) {
            try {
                // ✅ Cerrar WebSocket correctamente
                await conn.socket.logout(); // Cierra y limpia sesión
            } catch (err) {
                logger.error(`[Baileys] Error during logout for ${userId}:`, err);
                // Forzar cierre si logout falla
                conn.socket.ws.close();
            }

            connections.delete(userId);

            // Cleanup session files
            const sessionName = `session_${userId}`;
            const sessionPath = path.join(SESSIONS_DIR, sessionName);
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }
    },

    getStatus(userId: number) {
        return connections.get(userId)?.status || 'disconnected';
    },

    async sendMessage(userId: number, to: string, content: any) {
        const conn = connections.get(userId);
        if (!conn?.socket) throw new Error("WhatsApp connection not active");

        const jid = to.includes('@') ? to : `${to.replace('+', '')}@s.whatsapp.net`;
        return await conn.socket.sendMessage(jid, content);
    },

    async sendReadReceipt(userId: number, to: string, messageId: string, participant?: string) {
        const conn = connections.get(userId);
        if (!conn?.socket) return; // Silent fail if not connected

        const jid = to.includes('@') ? to : `${to.replace('+', '')}@s.whatsapp.net`;

        // Correct way to send read receipt in Baileys
        await conn.socket.readMessages([
            {
                remoteJid: jid,
                id: messageId,
                participant: participant // needed for groups, optional for DMs
            }
        ]);
    },

    getQr(userId: number) {
        return connections.get(userId)?.qr;
    },

    getTypingStatus(userId: number, jid: string) {
        const conn = connections.get(userId);
        return conn?.typingJids?.has(jid) || false;
    },

    getAllTypingJids(userId: number) {
        const conn = connections.get(userId);
        return Array.from(conn?.typingJids || []);
    }
};
