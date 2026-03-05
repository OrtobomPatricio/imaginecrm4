import { makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, WASocket } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import crypto from 'node:crypto';

import { logger } from "../_core/logger";

// Define session storage path
const SESSIONS_DIR = path.resolve(process.cwd(), "server", "sessions");

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// --- Session-at-rest encryption helpers ---
function getSessionEncryptionKey(): Buffer | null {
    const raw = process.env.DATA_ENCRYPTION_KEY;
    if (!raw) return null;
    return crypto.createHash('sha256').update(raw.trim(), 'utf8').digest();
}

function encryptSessionFile(data: Buffer): Buffer {
    const key = getSessionEncryptionKey();
    if (!key) return data; // graceful: no key = plaintext
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    // format: iv(12) + tag(16) + ciphertext
    return Buffer.concat([iv, tag, enc]);
}

function decryptSessionFile(data: Buffer): Buffer {
    const key = getSessionEncryptionKey();
    if (!key) return data;
    if (data.length < 28) return data; // too short to be encrypted
    // Check if this looks like encrypted data (not valid JSON start)
    const firstChar = data[0];
    if (firstChar === 0x7b || firstChar === 0x5b) return data; // '{' or '[' = plaintext JSON
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const enc = data.subarray(28);
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(enc), decipher.final()]);
    } catch {
        // Decryption failed — might be plaintext from before encryption was enabled
        return data;
    }
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

// Guard: prevent concurrent initializeSession for the same userId
const initializingLocks = new Set<number>();

// Typing state cleanup timers
const typingTimers: Map<string, NodeJS.Timeout> = new Map();

// Per-number outbound message throttle (prevents WhatsApp bans)
const sendTimestamps: Map<number, number[]> = new Map();
const MAX_MSGS_PER_MINUTE = 20;

function acquireSendSlot(whatsappNumberId: number): { allowed: boolean; waitMs: number } {
    const now = Date.now();
    const windowMs = 60_000;
    let timestamps = sendTimestamps.get(whatsappNumberId) || [];
    // Remove entries outside the 1-minute window
    timestamps = timestamps.filter(t => now - t < windowMs);
    if (timestamps.length >= MAX_MSGS_PER_MINUTE) {
        const oldestInWindow = timestamps[0];
        const waitMs = windowMs - (now - oldestInWindow) + 50; // small buffer
        return { allowed: false, waitMs };
    }
    timestamps.push(now);
    sendTimestamps.set(whatsappNumberId, timestamps);
    return { allowed: true, waitMs: 0 };
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, ms));
}

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
        // Prevent concurrent initialization for the same WhatsApp number
        if (initializingLocks.has(userId)) {
            logger.warn(`[Baileys] Session ${userId} already initializing, skipping duplicate`);
            return;
        }
        initializingLocks.add(userId);

        const sessionName = `session_${userId}`;
        const sessionPath = path.join(SESSIONS_DIR, sessionName);

        // Setup Auth State (with encrypted file I/O when DATA_ENCRYPTION_KEY is set)
        const { state, saveCreds: rawSaveCreds } = await useMultiFileAuthState(sessionPath);

        // Wrap saveCreds to encrypt files on disk
        const saveCreds = async () => {
            await rawSaveCreds();
            // Post-save: encrypt any plaintext creds files
            if (getSessionEncryptionKey() && fs.existsSync(sessionPath)) {
                try {
                    const files = fs.readdirSync(sessionPath);
                    for (const file of files) {
                        const fp = path.join(sessionPath, file);
                        const raw = fs.readFileSync(fp);
                        // Only encrypt if it looks like plaintext JSON
                        if (raw.length > 0 && (raw[0] === 0x7b || raw[0] === 0x5b)) {
                            fs.writeFileSync(fp, encryptSessionFile(raw));
                        }
                    }
                } catch (e) {
                    logger.warn({ err: e, userId }, '[Baileys] Failed to encrypt session files');
                }
            }
        };
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

                // Release lock before reconnect or terminal state
                initializingLocks.delete(userId);

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
                // Release init lock + reset reconnection counter
                initializingLocks.delete(userId);
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
                        // fromMe messages — echoes of messages WE sent.
                        //
                        // Baileys v6 fires the sent-message echo via process.nextTick
                        // which races with chat.ts updating whatsappMessageId.
                        // We simply skip all fromMe echoes here — chat.ts already
                        // saved the message and emitted the WebSocket event.
                        // The only case we'd want to process fromMe is history sync,
                        // which is handled separately during initial connection.
                        logger.debug({ msgId: msg.key.id }, "Baileys: Skipping fromMe echo");
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

        // Throttle: max 20 msgs/min per WA number to prevent bans
        const slot = acquireSendSlot(userId);
        if (!slot.allowed) {
            logger.warn({ whatsappNumberId: userId, waitMs: slot.waitMs }, "[Baileys] Throttle: rate limit reached, waiting");
            await new Promise(resolve => setTimeout(resolve, slot.waitMs));
            // Re-acquire after wait
            const retry = acquireSendSlot(userId);
            if (!retry.allowed) {
                throw new Error("WhatsApp rate limit exceeded. Try again shortly.");
            }
        }

        // Random inter-message delay (1-3s) to appear human-like
        await randomDelay(1000, 3000);

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
