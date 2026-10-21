// Shared e2e seeding. Every test gets a fresh browser context (empty IndexedDB), so a test seeds
// through the page's own store (window.__lwa, exposed only when NEXT_PUBLIC_E2E=1; lib/e2e-hooks.ts).
// Seeding also sets the reviewer profile: without one the required profile dialog covers the page
// and hides it from the accessibility tree.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'fort-sask.project.json');
export const FIXTURE_PROJECT_ID = 'prj_v2_fort-saskatchewan-wabamun-hub-aor';
export const PROFILE = { name: 'T. Chisti', initials: 'TC' } as const;

const ACTIVE_PROJECT_KEY = 'lwa.activeProject';

async function openStore(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__lwa !== undefined);
}

/** Reloads the page and waits until the app shell (not the first-run screen) is up. */
async function reloadIntoShell(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
}

/**
 * Imports the Fort Saskatchewan fixture (5 wells, current finals), sets the profile T. Chisti (TC),
 * makes the fixture project active, and reloads into the shell. Tests then `page.goto` their page.
 */
export async function seedFixture(page: Page): Promise<void> {
  const fixture: unknown = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  await openStore(page);
  await page.evaluate(
    async ({ data, profile, projectId, key }) => {
      const hooks = window.__lwa!;
      await hooks.importProject(data);
      await hooks.store.profile.set(profile);
      localStorage.setItem(key, projectId);
    },
    { data: fixture, profile: PROFILE, projectId: FIXTURE_PROJECT_ID, key: ACTIVE_PROJECT_KEY },
  );
  await reloadIntoShell(page);
}

/** Creates an empty project named `name`, sets the profile, makes the project active and reloads. Returns its id. */
export async function seedEmptyProject(page: Page, name: string): Promise<string> {
  await openStore(page);
  const projectId = await page.evaluate(
    async ({ projectName, profile, key }) => {
      const { store } = window.__lwa!;
      const project = await store.projects.create({ name: projectName });
      await store.profile.set(profile);
      localStorage.setItem(key, project.id);
      return project.id;
    },
    { projectName: name, profile: PROFILE, key: ACTIVE_PROJECT_KEY },
  );
  await reloadIntoShell(page);
  return projectId;
}

/** 100/07-21-055-22W4/00 (IMPERIAL FT SASK 7-21): final under 2.0.0, Moderate, cell 6. */
const FT_SASK_ID = 'wel_v2_W-4A62O7';
const FT_SASK_LICENCE = '100/07-21-055-22W4/00';

/** A route of the accessibility and responsive sweeps (spec §10 "all routes"). */
export type SweepRoute = {
  name: string;
  path: string;
  /** Seed the Fort Saskatchewan fixture first (every route but the first-run screen). */
  seed: boolean;
  /** What is on screen once the page has its data. */
  ready: (page: Page) => Locator;
};

/** Every route, each well tab, the score sheet open, and both print reports. */
export const SWEEP_ROUTES: readonly SweepRoute[] = [
  { name: 'first run', path: '/', seed: false, ready: (p) => p.getByRole('heading', { name: 'Create your first project' }) },
  { name: 'portfolio', path: '/portfolio', seed: true, ready: (p) => p.getByRole('heading', { name: 'Needs attention' }) },
  { name: 'wells', path: '/wells', seed: true, ready: (p) => p.getByRole('table', { name: 'Wells' }).locator('tbody tr').first() },
  { name: 'new well', path: '/wells/new', seed: true, ready: (p) => p.getByLabel('Licence / UWI') },
  {
    name: 'well page, Assessment tab',
    path: `/wells/view?id=${FT_SASK_ID}`,
    seed: true,
    ready: (p) => p.getByRole('tabpanel', { name: 'Assessment' }),
  },
  {
    name: 'well page, Construction tab',
    path: `/wells/view?id=${FT_SASK_ID}&tab=construction`,
    seed: true,
    ready: (p) => p.getByRole('tabpanel', { name: 'Construction' }),
  },
  {
    name: 'well page, History tab',
    path: `/wells/view?id=${FT_SASK_ID}&tab=history`,
    seed: true,
    ready: (p) => p.getByRole('table', { name: 'History' }),
  },
  {
    name: 'score sheet',
    path: `/wells/view?id=${FT_SASK_ID}&score=1`,
    seed: true,
    ready: (p) => p.getByRole('dialog', { name: `Score ${FT_SASK_LICENCE}` }),
  },
  { name: 'methodology', path: '/methodology', seed: true, ready: (p) => p.getByRole('heading', { name: 'Scoring parameters' }) },
  { name: 'settings', path: '/settings', seed: true, ready: (p) => p.getByRole('heading', { name: 'Backup' }) },
  {
    name: 'well dossier',
    path: `/report/well?id=${FT_SASK_ID}`,
    seed: true,
    ready: (p) => p.getByRole('article', { name: `Well dossier ${FT_SASK_LICENCE}` }),
  },
  {
    name: 'portfolio report',
    path: '/report/portfolio',
    seed: true,
    ready: (p) => p.getByRole('article', { name: 'Portfolio report' }),
  },
];
