import { z } from "zod";
import { eq, asc, and, sql } from "drizzle-orm";
import { internalMessages, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { protectedProcedure, router } from "../_core/trpc";

export const internalChatRouter = router({
    send: protectedProcedure
        .input(z.object({
            content: z.string().min(1),
            recipientId: z.number().optional().nullable(),
            attachments: z.array(z.object({
                type: z.enum(['image', 'video', 'file']),
                url: z.string(),
                name: z.string()
            })).optional(),
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db || !ctx.user) throw new Error("Database not available");

            try {
                await db.insert(internalMessages).values({
                    tenantId: ctx.tenantId,
                    senderId: ctx.user.id,
                    recipientId: input.recipientId ?? null,
                    content: input.content,
                    attachments: input.attachments,
                });
                return { success: true };
            } catch (e: any) {
                if (e?.message?.includes("doesn't exist")) {
                    throw new Error("El chat interno no está disponible todavía. La tabla internal_messages no existe.");
                }
                throw e;
            }
        }),

    getHistory: protectedProcedure
        .input(z.object({
            recipientId: z.number().optional().nullable(), // Null = General
        }))
        .query(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db || !ctx.user) return [];

            try {
                if (!input.recipientId) {
                    const msgs = await db.select({
                        id: internalMessages.id,
                        content: internalMessages.content,
                        attachments: internalMessages.attachments,
                        createdAt: internalMessages.createdAt,
                        senderId: internalMessages.senderId,
                        senderName: users.name,
                    })
                        .from(internalMessages)
                        .leftJoin(users, eq(internalMessages.senderId, users.id))
                        .where(and(eq(internalMessages.tenantId, ctx.tenantId), sql`${internalMessages.recipientId} IS NULL`))
                        .orderBy(asc(internalMessages.createdAt))
                        .limit(100);

                    return msgs;
                } else {
                    const msgs = await db.select({
                        id: internalMessages.id,
                        content: internalMessages.content,
                        attachments: internalMessages.attachments,
                        createdAt: internalMessages.createdAt,
                        senderId: internalMessages.senderId,
                        senderName: users.name,
                    })
                        .from(internalMessages)
                        .leftJoin(users, eq(internalMessages.senderId, users.id))
                        .where(
                            and(
                                eq(internalMessages.tenantId, ctx.tenantId),
                                sql`(${internalMessages.senderId} = ${ctx.user.id} AND ${internalMessages.recipientId} = ${input.recipientId}) OR (${internalMessages.senderId} = ${input.recipientId} AND ${internalMessages.recipientId} = ${ctx.user.id})`
                            )
                        )
                        .orderBy(asc(internalMessages.createdAt))
                        .limit(100);

                    return msgs;
                }
            } catch {
                return []; // internal_messages table may not exist
            }
        }),

    // Mark messages as read from a specific sender (or general channel)
    markAsRead: protectedProcedure
        .input(z.object({
            senderId: z.number().optional().nullable(), // Null = General channel updates
        }))
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db || !ctx.user) return { success: false };

            if (!input.senderId) {
                return { success: true };
            } else {
                try {
                    await db.update(internalMessages)
                        .set({ isRead: true })
                        .where(
                            and(
                                eq(internalMessages.tenantId, ctx.tenantId),
                                eq(internalMessages.senderId, input.senderId),
                                eq(internalMessages.recipientId, ctx.user.id),
                                eq(internalMessages.isRead, false)
                            )
                        );
                } catch {
                    // internal_messages table may not exist
                }
            }
            return { success: true };
        }),

    getRecentChats: protectedProcedure.query(async ({ ctx }) => {
        const db = await getDb();
        if (!db || !ctx.user) return [];

        try {
            const allUsers = await db.select({
                id: users.id,
                name: users.name,
                role: users.role,
                isActive: users.isActive
            }).from(users).where(and(eq(users.tenantId, ctx.tenantId), eq(users.isActive, true)));

            // Get unread counts — internal_messages table may not exist yet
            let unreadMap = new Map<number, number>();
            try {
                const unreadCounts = await db.select({
                    senderId: internalMessages.senderId,
                    count: sql<number>`count(*)`
                })
                    .from(internalMessages)
                    .where(
                        and(
                            eq(internalMessages.tenantId, ctx.tenantId),
                            eq(internalMessages.recipientId, ctx.user.id),
                            eq(internalMessages.isRead, false)
                        )
                    )
                    .groupBy(internalMessages.senderId);

                unreadCounts.forEach(r => unreadMap.set(r.senderId, Number(r.count)));
            } catch {
                // internal_messages table missing — all unread = 0
            }

            return allUsers
                .filter(u => u.id !== ctx.user?.id)
                .map(u => ({
                    ...u,
                    unreadCount: unreadMap.get(u.id) || 0
                }))
                .sort((a, b) => (b.unreadCount - a.unreadCount));
        } catch {
            return [];
        }
    }),
});
