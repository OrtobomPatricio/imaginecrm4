import nodemailer from 'nodemailer';
import { getDb } from '../db';
import { appSettings } from '../../drizzle/schema';
import { desc } from 'drizzle-orm';
import { decryptSecret } from './crypto';

import { logger } from "./logger";

interface SendEmailOptions {
    tenantId: number;
    to: string;
    subject: string;
    html?: string;
    text?: string;
}

export async function getSmtpConfig(tenantId: number) {
    const db = await getDb();
    if (!db) return null;

    const { getOrCreateAppSettings } = await import("../services/app-settings");
    const row = await getOrCreateAppSettings(db, tenantId);

    if (!row.smtpConfig || !row.smtpConfig.host) return null;

    return row.smtpConfig as {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        pass?: string | null;
        from?: string;
    };
}

export async function sendEmail({ tenantId, to, subject, html, text }: SendEmailOptions): Promise<{ sent: boolean; reason?: string }> {
    // Basic email format validation
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        logger.warn({ to }, "[Email Service] Invalid 'to' address, skipping");
        return { sent: false, reason: "INVALID_ADDRESS" };
    }

    const config = await getSmtpConfig(tenantId);

    // If no SMTP config, log and return explicit reason
    if (!config) {
        logger.info(`[Email Service] No SMTP config found for tenant ${tenantId}. Cannot send to ${to}`);
        logger.info(`[Email Service] Subject: ${subject}`);
        return { sent: false, reason: "NO_SMTP_CONFIG" };
    }

    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: decryptSecret(config.pass) ?? "",
        },
    });

    try {
        const info = await transporter.sendMail({
            from: config.from || `"Imagine CRM" <${config.user}>`,
            to,
            subject,
            ...(html ? { html } : {}),
            ...(text ? { text } : {}),
        });
        logger.info(`[Email Service] Email sent: ${info.messageId}`);
        return { sent: true };
    } catch (error) {
        logger.error('[Email Service] Error sending email:', error);
        throw error;
    }
}

export async function verifySmtpConnection(config: any) {
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: decryptSecret(config.pass) ?? "",
        },
    });

    await transporter.verify();
    return true;
}
