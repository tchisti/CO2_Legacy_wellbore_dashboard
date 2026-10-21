// End-to-end tests (Playwright). The app runs with NEXT_PUBLIC_E2E=1, which exposes window.__lwa
// (lib/e2e-hooks.ts). Every test gets a fresh browser context, so IndexedDB starts empty.
//
// Two ways to serve the app on port 3100:
// - the static export (CI, or E2E_STATIC=1): `out/` as a host serves it, through a small static
//   server (`serve`, configured by serve.json: clean URLs, so /wells/view?id=… is wells/view.html;
//   no directory listings; 404.html for unknown paths). Build it first with `pnpm build:e2e`
//   (NEXT_PUBLIC_E2E=1); `pnpm e2e:static` builds and runs. This is what CI runs.
// - `next dev` (the local default), for speed while working: `pnpm e2e`.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const CI = !!process.env.CI;
const STATIC = CI || process.env.E2E_STATIC === '1';

/** Written by `pnpm build:e2e` next to the export; a plain `next build` replaces out/ without it. */
const E2E_BUILD_MARKER = path.join(__dirname, 'out', '.e2e-build');

if (STATIC && !existsSync(E2E_BUILD_MARKER)) {
  throw new Error(
    'The static e2e run needs the export built with the test hooks: run `pnpm --filter web build:e2e` first ' +
      '(or `pnpm --filter web e2e:static`, which builds and runs).',
  );
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // A retry in CI absorbs a runner hiccup; a test that needs one is still reported as flaky.
  retries: CI ? 2 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: STATIC
    ? {
        command: `serve out --listen ${PORT} --config ../serve.json --no-clipboard --no-port-switching`,
        url: BASE_URL,
        env: { NO_UPDATE_CHECK: '1' },
        reuseExistingServer: !CI,
        timeout: 30_000,
      }
    : {
        command: `pnpm dev --port ${PORT}`,
        url: BASE_URL,
        env: { NEXT_PUBLIC_E2E: '1' },
        reuseExistingServer: !CI,
        timeout: 120_000,
      },
});
