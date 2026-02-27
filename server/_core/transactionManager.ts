import { getDb } from "../db";
import { logger, safeError } from "./logger";

/**
 * Helper de Élite para garantizar transacciones atómicas con Rollback seguro.
 * Envuelve las operaciones de base de datos en un bloque transaccional
 * que falla seguro (fail-safe) previendo race conditions.
 */
export async function withTransaction<T>(
  callback: (tx: any) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) {
    logger.error("Transaction failed: DB instance is null");
    throw new Error("Database unavailable for transaction");
  }

  return await db.transaction(async (tx) => {
    try {
      return await callback(tx);
    } catch (error) {
      // Registrar falla transaccional antes del rollback de Drizzle
      logger.error({ err: safeError(error) }, "[TRANSACTION] Rollback triggered due to error");
      throw error;
    }
  });
}
