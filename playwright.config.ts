import { defineConfig } from '@playwright/test';

const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3000;

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm dev`,
    env: {
      ...process.env,
      ENABLE_TEST_ROUTES: "1",
      MOCK_BAILEYS_QR: "1",
      ALLOW_DEV_LOGIN: "1",
      ENABLE_DEV_BYPASS: "1",
      OWNER_OPEN_ID: "e2e_owner",
      ALLOW_MOCK_DB: "1",
      USE_MOCK_DB: "true",
      JWT_SECRET: process.env.JWT_SECRET || "R4nd0m!Jwt#Secret$For%E2E&Testing(2026)",
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || "R4nd0m!Data#Encrypt$Key%For&E2E(2026)",
      COOKIE_SECRET: process.env.COOKIE_SECRET || "R4nd0m!Cookie#Secret$For%E2E&Testing(2026)",
      DATABASE_URL: process.env.DATABASE_URL || "mysql://mock:mock@localhost:3306/mockdb",
    },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
