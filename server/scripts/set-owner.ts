
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

import { logger } from "../_core/logger";

async function main() {
    const email = process.argv[2];
    if (!email) {
        logger.error("Usage: npm run set-owner <email>");
        process.exit(1);
    }

    logger.info(`Setting owner role for: ${email}...`);

    const db = await getDb();
    if (!db) {
        logger.error("Database connection failed");
        process.exit(1);
    }

    const user = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user[0]) {
        logger.error(`User not found: ${email}`);
        process.exit(1);
    }

    await db.update(users).set({ role: "owner", customRole: null }).where(eq(users.id, user[0].id));

    logger.info(`Success! User ${email} is now an OWNER.`);
    logger.info("Please refresh the application.");
    process.exit(0);
}

main().catch(console.error);
