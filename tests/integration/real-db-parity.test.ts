import { describe, expect, it } from "vitest";
import mysql from "mysql2/promise";

const shouldRun = process.env.RUN_REAL_DB_PARITY === "1";
const databaseUrl = process.env.DATABASE_URL;

describe("real mysql parity", () => {
  it.skipIf(!shouldRun || !databaseUrl)("validates schema, constraints and critical query paths", async () => {
    const connection = await mysql.createConnection(databaseUrl!);

    try {
      const [pingRows] = await connection.query("SELECT 1 AS ok");
      expect((pingRows as Array<{ ok: number }>)[0]?.ok).toBe(1);

      const [tableRows] = await connection.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE()
         AND table_name IN ('tenants','users','app_settings','leads','conversations','whatsapp_numbers')`
      );
      expect((tableRows as Array<{ table_name: string }>).length).toBeGreaterThanOrEqual(6);

      const [tenantFkRows] = await connection.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME = 'tenantId'
           AND REFERENCED_TABLE_NAME = 'tenants'`
      );
      expect((tenantFkRows as Array<{ CONSTRAINT_NAME: string }>).length).toBeGreaterThanOrEqual(1);

      const [tenantRows] = await connection.query("SELECT id FROM tenants LIMIT 1");
      let tenantId = (tenantRows as Array<{ id: number }>)[0]?.id;
      if (!tenantId) {
        const [ins] = await connection.query("INSERT INTO tenants(name, slug, plan, status, createdAt, updatedAt) VALUES('Parity Tenant', CONCAT('parity-', FLOOR(RAND()*1000000)), 'free', 'active', NOW(), NOW())");
        tenantId = (ins as mysql.ResultSetHeader).insertId;
      }
      expect(tenantId).toBeGreaterThan(0);

      const [statsRows] = await connection.query(
        "SELECT COUNT(*) AS usersCount FROM users WHERE tenantId = ?",
        [tenantId]
      );
      expect(Number((statsRows as Array<{ usersCount: number }>)[0]?.usersCount ?? 0)).toBeGreaterThanOrEqual(0);

      const [appSettingsRows] = await connection.query(
        "SELECT COUNT(*) AS settingsCount FROM app_settings WHERE tenantId = ?",
        [tenantId]
      );
      expect(Number((appSettingsRows as Array<{ settingsCount: number }>)[0]?.settingsCount ?? 0)).toBeGreaterThanOrEqual(0);
    } finally {
      await connection.end();
    }
  });
});
