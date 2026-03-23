/**
 * rotate-encryption-key.ts
 *
 * Safely re-encrypts all secrets in the DB from OLD_ENCRYPTION_KEY → NEW_ENCRYPTION_KEY.
 *
 * Usage:
 *   OLD_ENCRYPTION_KEY="<old key>" NEW_ENCRYPTION_KEY="<new key>" npx tsx server/scripts/rotate-encryption-key.ts
 *
 * What it migrates:
 *   - whatsapp_connections.accessToken
 *   - facebook_pages.accessToken
 *   - smtp_connections.password
 *   - app_settings.value  → nested fields: metaConfig.appSecret, metaConfig.verifyToken,
 *                            smtpConfig.pass, aiConfig.apiKey, storageConfig.accessKey,
 *                            storageConfig.secretKey
 */

import crypto from "node:crypto";
import mysql from "mysql2/promise";

const PREFIX = "enc:v1";

function parseKey(key: string): Buffer {
  const trimmed = (key ?? "").trim();
  if (!trimmed) throw new Error("Key is empty");

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length >= 43 && trimmed.length % 4 === 0) {
    try {
      const b = Buffer.from(trimmed, "base64");
      if (b.length === 32) return b;
    } catch { /* ignore */ }
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    try {
      const b = Buffer.from(trimmed, "hex");
      if (b.length === 32) return b;
    } catch { /* ignore */ }
  }

  // SHA-256 derivation (same fallback as production code)
  console.warn(`[rotate] Key "${trimmed.slice(0, 8)}..." is not a valid 32-byte key — using SHA-256 derivation`);
  return crypto.createHash("sha256").update(trimmed, "utf8").digest();
}

function decrypt(maybeEncrypted: string, key: Buffer): string | null {
  if (!maybeEncrypted?.trim().startsWith(PREFIX + ":")) return maybeEncrypted ?? null;
  const parts = maybeEncrypted.trim().split(":");
  if (parts.length !== 5) return null;
  const [, , ivB64, tagB64, dataB64] = parts;
  try {
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function reEncrypt(value: string | null | undefined, oldKey: Buffer, newKey: Buffer): { newValue: string; changed: boolean } | null {
  if (!value) return null;
  if (!value.startsWith(PREFIX + ":")) return { newValue: value, changed: false };
  const plain = decrypt(value, oldKey);
  if (plain === null) {
    console.error(`[rotate] ⚠️  Could not decrypt value starting with "${value.slice(0, 20)}..." — skipping`);
    return null;
  }
  return { newValue: encrypt(plain, newKey), changed: true };
}

async function main() {
  const OLD_KEY_STR = process.env.OLD_ENCRYPTION_KEY;
  const NEW_KEY_STR = process.env.NEW_ENCRYPTION_KEY;

  if (!OLD_KEY_STR || !NEW_KEY_STR) {
    console.error("Usage: OLD_ENCRYPTION_KEY=<old> NEW_ENCRYPTION_KEY=<new> npx tsx server/scripts/rotate-encryption-key.ts");
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const oldKey = parseKey(OLD_KEY_STR);
  const newKey = parseKey(NEW_KEY_STR);

  console.log(`[rotate] Old key fingerprint: ${crypto.createHash("sha256").update(oldKey).digest("hex").slice(0, 16)}...`);
  console.log(`[rotate] New key fingerprint: ${crypto.createHash("sha256").update(newKey).digest("hex").slice(0, 16)}...`);

  const conn = await mysql.createConnection(DATABASE_URL);
  let totalUpdated = 0;

  try {
    // ── 1. whatsapp_connections.accessToken ──
    console.log("\n[rotate] Migrating whatsapp_connections.accessToken...");
    const [wRows] = await conn.query("SELECT id, accessToken FROM whatsapp_connections") as any;
    for (const row of wRows) {
      const result = reEncrypt(row.accessToken, oldKey, newKey);
      if (result?.changed) {
        await conn.query("UPDATE whatsapp_connections SET accessToken = ? WHERE id = ?", [result.newValue, row.id]);
        console.log(`  ✅ whatsapp_connections id=${row.id} re-encrypted`);
        totalUpdated++;
      }
    }

    // ── 2. facebook_pages.accessToken ──
    console.log("\n[rotate] Migrating facebook_pages.accessToken...");
    const [fbRows] = await conn.query("SELECT id, accessToken FROM facebook_pages") as any;
    for (const row of fbRows) {
      const result = reEncrypt(row.accessToken, oldKey, newKey);
      if (result?.changed) {
        await conn.query("UPDATE facebook_pages SET accessToken = ? WHERE id = ?", [result.newValue, row.id]);
        console.log(`  ✅ facebook_pages id=${row.id} re-encrypted`);
        totalUpdated++;
      }
    }

    // ── 3. smtp_connections.password ──
    console.log("\n[rotate] Migrating smtp_connections.password...");
    const [smtpRows] = await conn.query("SELECT id, password FROM smtp_connections") as any;
    for (const row of smtpRows) {
      const result = reEncrypt(row.password, oldKey, newKey);
      if (result?.changed) {
        await conn.query("UPDATE smtp_connections SET password = ? WHERE id = ?", [result.newValue, row.id]);
        console.log(`  ✅ smtp_connections id=${row.id} re-encrypted`);
        totalUpdated++;
      }
    }

    // ── 4. app_settings.value (JSON — nested encrypted fields) ──
    console.log("\n[rotate] Migrating app_settings.value...");
    const ENCRYPTED_PATHS = [
      ["metaConfig", "appSecret"],
      ["metaConfig", "verifyToken"],
      ["smtpConfig", "pass"],
      ["aiConfig", "apiKey"],
      ["storageConfig", "accessKey"],
      ["storageConfig", "secretKey"],
    ] as const;

    const [settingsRows] = await conn.query("SELECT id, tenantId, value FROM app_settings") as any;
    for (const row of settingsRows) {
      let parsed: any;
      try {
        parsed = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
      } catch {
        console.warn(`  ⚠️  app_settings id=${row.id} — could not parse JSON, skipping`);
        continue;
      }

      let dirty = false;
      for (const [section, field] of ENCRYPTED_PATHS) {
        const current = parsed?.[section]?.[field];
        if (!current) continue;
        const result = reEncrypt(current, oldKey, newKey);
        if (result?.changed) {
          parsed[section][field] = result.newValue;
          dirty = true;
          console.log(`  ✅ app_settings id=${row.id} tenantId=${row.tenantId} → ${section}.${field} re-encrypted`);
          totalUpdated++;
        }
      }

      if (dirty) {
        await conn.query("UPDATE app_settings SET value = ? WHERE id = ?", [JSON.stringify(parsed), row.id]);
      }
    }

    console.log(`\n✅ Done. Total values re-encrypted: ${totalUpdated}`);
    console.log("⚠️  Now update DATA_ENCRYPTION_KEY in EasyPanel to the NEW key and Rebuild.");

  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("[rotate] Fatal error:", err);
  process.exit(1);
});
