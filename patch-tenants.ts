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

    const tables = Object.entries(schema).filter(([name, val]) => {
        return typeof val === 'object' && val !== null && 'tenantId' in (val as any);
    });

    console.log(`Found ${tables.length} tables in schema that should have tenantId.`);

    for (const [name, table] of tables) {
        const tableName = (table as any)._?.name || name;
        if (!tableName) continue;

        try {
            // Check if column exists
            const [columns]: any = await db.execute(sql.raw(`SHOW COLUMNS FROM \`${tableName}\` LIKE 'tenantId'`));

            if (columns.length === 0) {
                console.log(`Table ${tableName} is missing tenantId. Patching...`);
                await db.execute(sql.raw(`ALTER TABLE \`${tableName}\` ADD COLUMN tenantId INT NOT NULL AFTER id`));
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
