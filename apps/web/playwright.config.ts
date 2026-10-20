// End-to-end tests (Playwright). Runs the dev server on port 3100 with NEXT_PUBLIC_E2E=1, which
// exposes window.__lwa (lib/e2e-hooks.ts). Every test gets a fresh browser context, so IndexedDB
// starts empty. Run with `pnpm --filter web e2e`.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    env: { NEXT_PUBLIC_E2E: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
