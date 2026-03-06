import { defineConfig } from '@playwright/test';

const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 3000;
const E2E_HOST = '127.0.0.1';

export default defineConfig({
  testDir: './e2e/tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: `http://${E2E_HOST}:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `pnpm exec cross-env NODE_ENV=development PORT=${PORT} E2E_STRICT_PORT=1 ENABLE_TEST_ROUTES=1 MOCK_BAILEYS_QR=1 ALLOW_DEV_LOGIN=1 ENABLE_DEV_BYPASS=1 OWNER_OPEN_ID=e2e_owner ALLOW_MOCK_DB=1 USE_MOCK_DB=true JWT_SECRET=E2EJWTSECRETABCDEFGHIJKLMNOPQRSTUVWXYZ123456 DATA_ENCRYPTION_KEY=E2EDATAENCRYPTIONKEYABCDEFGHIJKLMNOPQRSTUVWXYZ123 COOKIE_SECRET=E2ECOOKIESECRETABCDEFGHIJKLMNOPQRSTUVWXYZ123456 DATABASE_URL=mysql://mock:mock@localhost:3306/mockdb tsx server/_core/index.ts`,
    url: `http://${E2E_HOST}:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
