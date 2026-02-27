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
    const pass = process.env.BOOTSTRAP_ADMIN_PASSWORD;
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
                role: "admin",
                loginMethod: "credentials",
                isActive: true,
                updatedAt: new Date(),
            } as any)
            .where(eq(users.id, existing[0].id));
        logger.info("admin actualizado");
    } else {
        await db.insert(users).values({
            tenantId,
            openId: `local_${nanoid(16)}`,
            name: "Admin",
            email,
            password: hashed,
            role: "admin",
            loginMethod: "credentials",
            isActive: true,
            hasSeenTour: false,
        });
        logger.info("admin creado");
    }

    process.exit(0);
}

main().catch(e => { logger.error(e); process.exit(1); });
