import { validateEnvironment } from "../_core/env-validation";

import { logger } from "../_core/logger";

const originalNodeEnv = process.env.NODE_ENV;

try {
  process.env.NODE_ENV = "production";
  validateEnvironment();
  logger.info("[ProdConfig] OK: production configuration validation passed");
} catch (error) {
  logger.error("[ProdConfig] FAILED: production configuration is invalid");
  throw error;
} finally {
  process.env.NODE_ENV = originalNodeEnv;
}
