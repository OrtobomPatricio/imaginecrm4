import { getDb } from "./server/db";
import * as schema from "./drizzle/schema";
import { sql } from "drizzle-orm";
import "dotenv/config";

async function run() {
    const db = await getDb();
    if (!db) {
        console.error("DB not available");
        return;
    }

    // Get all tables currently in the database
    const [dbTables]: any = await db.execute(sql.raw("SHOW TABLES"));
    const tableNames = dbTables.map((t: any) => Object.values(t)[0] as string);

    console.log(`Found ${tableNames.length} tables in database.`);

    for (const tableName of tableNames) {
        if (tableName === 'tenants' || tableName === '__drizzle_migrations') continue;

        try {
            // Check if column exists
            const [columns]: any = await db.execute(sql.raw(`SHOW COLUMNS FROM \`${tableName}\` LIKE 'tenantId'`));

            if (columns.length === 0) {
                console.log(`Table ${tableName} is missing tenantId. Patching...`);
                // Add column
                await db.execute(sql.raw(`ALTER TABLE \`${tableName}\` ADD COLUMN tenantId INT NOT NULL AFTER id`));
                // Add foreign key
                await db.execute(sql.raw(`ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`fk_${tableName}_tenant\` FOREIGN KEY (tenantId) REFERENCES tenants(id) ON DELETE CASCADE`));
                console.log(`Table ${tableName} patched successfully.`);
            } else {
                console.log(`Table ${tableName} already has tenantId.`);
            }
        } catch (e: any) {
            console.error(`Error processing table ${tableName}:`, e.message);
        }
    }

    process.exit(0);
}

run();
