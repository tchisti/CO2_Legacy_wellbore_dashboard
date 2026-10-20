// Test hooks for Playwright. Only when the app is built or served with NEXT_PUBLIC_E2E=1 (the e2e
// web server sets it; it is unset in normal builds, so nothing is exposed) does the page expose
// its store, so a test can seed data, e.g. `await page.evaluate((json) => window.__lwa.importProject(json), fixture)`
// or set the reviewer profile with `window.__lwa.store.profile.set(...)`.
import type { ImportResult, Store } from '@/lib/store/store';

export type E2EHooks = {
  store: Store;
  /** Imports a project export in merge mode. */
  importProject: (json: unknown) => Promise<ImportResult>;
};

declare global {
  interface Window {
    __lwa?: E2EHooks;
  }
}

export function installE2EHooks(store: Store): void {
  if (process.env.NEXT_PUBLIC_E2E !== '1') return;
  window.__lwa = { store, importProject: (json) => store.importProject(json, 'merge') };
}
