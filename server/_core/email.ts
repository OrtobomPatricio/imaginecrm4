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

interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass?: string | null;
    from?: string;
}

/**
 * Get SMTP config from per-tenant DB settings.
 * Falls back to .env platform-level SMTP if tenant has no config.
 */
export async function getSmtpConfig(tenantId: number): Promise<SmtpConfig | null> {
    // 1. Try per-tenant SMTP config from DB
    const db = await getDb();
    if (db) {
        const { getOrCreateAppSettings } = await import("../services/app-settings");
        const row = await getOrCreateAppSettings(db, tenantId);
        if (row.smtpConfig && row.smtpConfig.host) {
            return row.smtpConfig as SmtpConfig;
        }
    }

    // 2. Fallback to .env platform-level SMTP
    const envHost = process.env.SMTP_HOST;
    const envUser = process.env.SMTP_USER;
    if (envHost && envUser) {
        logger.info(`[Email Service] Using platform .env SMTP fallback for tenant ${tenantId}`);
        return {
            host: envHost,
            port: parseInt(process.env.SMTP_PORT || "465", 10),
            secure: (process.env.SMTP_PORT || "465") === "465",
            user: envUser,
            pass: process.env.SMTP_PASS || null,
            from: process.env.SMTP_FROM || `"Imagine CRM" <${envUser}>`,
        };
    }

    return null;
}

export async function sendEmail({ tenantId, to, subject, html, text }: SendEmailOptions): Promise<{ sent: boolean; reason?: string }> {
    // Basic email format validation
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        logger.warn({ to }, "[Email Service] Invalid 'to' address, skipping");
        return { sent: false, reason: "INVALID_ADDRESS" };
    }

    const config = await getSmtpConfig(tenantId);

    // If no SMTP config (neither DB nor .env), log and return explicit reason
    if (!config) {
        logger.warn(`[Email Service] No SMTP config found for tenant ${tenantId} (neither DB nor .env). Cannot send to ${to}`);
        logger.warn(`[Email Service] Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env for platform-level email.`);
        return { sent: false, reason: "NO_SMTP_CONFIG" };
    }

    // For .env fallback, pass is plain text; for DB config, pass is encrypted
    const isEnvFallback = config.host === process.env.SMTP_HOST && config.user === process.env.SMTP_USER;
    const password = isEnvFallback ? (config.pass ?? "") : (decryptSecret(config.pass) ?? "");

    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: password,
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
        logger.info({ messageId: info.messageId, to }, `[Email Service] Email sent successfully`);
        return { sent: true };
    } catch (error) {
        logger.error({ err: error, to, subject }, '[Email Service] Error sending email');
        return { sent: false, reason: "SEND_FAILED" };
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
