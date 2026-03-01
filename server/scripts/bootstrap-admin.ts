import "dotenv/config";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";

import { logger } from "../_core/logger";

async function main() {
    const db = await getDb();
    if (!db) throw new Error("DB not available");

    const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
    const pass = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || "").trim();
    const tenantId = Number(process.env.BOOTSTRAP_ADMIN_TENANT_ID ?? "1");
    if (!email || !pass) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD");
    if (!Number.isFinite(tenantId) || tenantId <= 0) throw new Error("BOOTSTRAP_ADMIN_TENANT_ID must be a positive number");

    const hashed = await bcrypt.hash(pass, 12);

    const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, email), eq(users.tenantId, tenantId)))
        .limit(1);

    if (existing.length > 0) {
        await db
            .update(users)
            .set({
                password: hashed,
                role: "owner",
                loginMethod: "credentials",
                isActive: true,
                updatedAt: new Date(),
            } as any)
            .where(eq(users.id, existing[0].id));
        logger.info("admin actualizado");

        // Verify password works
        const verify = await db.select({ id: users.id, password: users.password }).from(users).where(eq(users.id, existing[0].id)).limit(1);
        if (verify[0]?.password) {
            const ok = await bcrypt.compare(pass, verify[0].password);
            logger.info({ passwordVerified: ok }, "bootstrap: admin password verification");
            if (!ok) {
                logger.error("bootstrap: CRITICAL — password re-hash needed!");
                const rehash = await bcrypt.hash(pass, 12);
                await db.update(users).set({ password: rehash } as any).where(eq(users.id, existing[0].id));
                logger.info("bootstrap: password re-hashed successfully");
            }
        }
    } else {
        // Check if user exists in ANY tenant (e.g. created via signup on tenant 2)
        const existingGlobal = await db
            .select({ id: users.id, tenantId: users.tenantId })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (existingGlobal.length > 0 && existingGlobal[0].tenantId !== tenantId) {
            logger.warn({ oldTenantId: existingGlobal[0].tenantId, newTenantId: tenantId }, "bootstrap: admin found in wrong tenant — reassigning");
            await db.update(users)
                .set({
                    tenantId,
                    password: hashed,
                    role: "owner",
                    loginMethod: "credentials",
                    isActive: true,
                    updatedAt: new Date(),
                } as any)
                .where(eq(users.id, existingGlobal[0].id));
            logger.info("admin reasignado a tenant plataforma");
        } else if (existingGlobal.length === 0) {
            await db.insert(users).values({
                tenantId,
                openId: `local_${nanoid(16)}`,
                name: "Admin",
                email,
                password: hashed,
                role: "owner",
                loginMethod: "credentials",
                isActive: true,
                hasSeenTour: false,
            });
            logger.info("admin creado");
        }
    }

    process.exit(0);
}

main().catch(e => { logger.error(e); process.exit(1); });
