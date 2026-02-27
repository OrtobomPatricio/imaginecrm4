import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "path";
import { fileURLToPath } from "url";

import { logger } from "../_core/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        logger.error("DATABASE_URL is not defined");
        process.exit(1);
    }

    logger.info("[Migration] Connecting to database...");

    const connection = await mysql.createConnection({
        uri: connectionString,
        multipleStatements: true,
    });

    const db = drizzle(connection);

    logger.info("[Migration] Running migrations from ./drizzle folder...");

    try {
        await migrate(db, {
            migrationsFolder: path.resolve(process.cwd(), "drizzle")
        });
        logger.info("[Migration] Success! Database is up to date.");
    } catch (error) {
        logger.error("[Migration] Failed:", error);
        // Do not exit process if imported, let caller handle it? 
        // Or throw.
        throw error;
    } finally {
        await connection.end();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMigrations().catch((err) => {
        logger.error("[Migration] Unhandled error:", err);
        process.exit(1);
    });
}
