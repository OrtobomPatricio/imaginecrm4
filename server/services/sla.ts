
import { getDb } from "../db";
import { appSettings, conversations, users } from "../../drizzle/schema";
import { and, eq, lte, isNull } from "drizzle-orm";
import { sendEmail } from "../_core/email";

import { logger } from "../_core/logger";

/**
 * Checks for conversations that have exceeded the SLA response time.
 * Should be called periodically (e.g., every 5-10 minutes) via cron.
 */
export async function checkSLA() {
    const db = await getDb();
    if (!db) return;

    // Load ALL tenant settings rather than just first row — each tenant has its own SLA config
    const allSettings = await db.select().from(appSettings);

    for (const settings of allSettings) {
        if (!settings || !settings.slaConfig) continue;

        const { maxResponseTimeMinutes, alertEmail, notifySupervisor } = settings.slaConfig as any;
        if (!notifySupervisor || !alertEmail) continue;

        const thresholdDate = new Date(Date.now() - maxResponseTimeMinutes * 60 * 1000);

        const breached = await db.select()
            .from(conversations)
            .where(and(
                eq(conversations.tenantId, settings.tenantId),
                eq(conversations.status, 'active'),
                lte(conversations.lastMessageAt, thresholdDate),
            ));

        logger.info({ tenantId: settings.tenantId, count: breached.length }, `[SLA] Checked tenant threshold: ${thresholdDate.toISOString()}`);
    }
}

/**
 * Simulates an alert trigger for testing.
 */
export async function testSLAAlert(targetEmail: string, tenantId: number) {
    await sendEmail({
        tenantId,
        to: targetEmail,
        subject: "🚨 Alerta SLA: Conversación desatendida",
        html: `<p>Esta es una prueba del sistema de alertas SLA.</p>`
    });
}
