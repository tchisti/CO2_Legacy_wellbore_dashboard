import { expect, test, type Page } from '@playwright/test';
import type { WellInput } from '@lwa/engine';
import { seedEmptyProject } from './helpers';

// Performance smoke (spec §10: the Wells table with 500 wells scrolls; Portfolio renders quickly
// on a cold load). 500 synthetic wells, the same on every run, go in through the page's own store
// (upsertByLicence, as a CSV import does); 400 of them get a final assessment through one
// project-file import. The measured times are logged and attached to the test as annotations.

const WELLS = 500;
const PORTFOLIO_BUDGET_MS = 3_000;

const TYPES: WellInput['type'][] = ['Oil Producer', 'Gas Producer', 'Injection', 'Disposal', 'Strat Test', 'Observation', 'Unknown'];
const TRAJECTORIES: WellInput['trajectory'][] = ['Vertical', 'Deviated', 'Horizontal', 'Unknown'];
const STATUSES: WellInput['status'][] = ['Active', 'Suspended', 'Abandoned (P&A)', 'Orphaned', 'Unknown'];

/** A linear congruential generator (Numerical Recipes constants): deterministic, no Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The 500 wells: unique licences, coordinates around Fort Saskatchewan, every enum in use. */
function syntheticWells(): WellInput[] {
  const rand = lcg(20261021);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  return Array.from({ length: WELLS }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      licence: `1${n}/${String((i % 16) + 1).padStart(2, '0')}-${String((i % 36) + 1).padStart(2, '0')}-055-22W4/00`,
      name: `SYNTH ${n}`,
      operator: pick(['Prairie Oil Ltd.', 'Wabamun Energy', 'North Basin Resources', '']),
      lat: +(53.6 + rand() * 0.3).toFixed(6),
      lon: +(-113.4 + rand() * 0.4).toFixed(6),
      spudYear: 1940 + Math.floor(rand() * 80),
      type: pick(TYPES),
      trajectory: pick(TRAJECTORIES),
      status: pick(STATUSES),
      classification: `Type ${1 + Math.floor(rand() * 9)}` as WellInput['classification'],
      td_m: Math.round(600 + rand() * 1800),
    };
  });
}

// Four score patterns whose results are the engine's golden vectors (methodology 2.0.0), so the
// imported finals carry exactly what finalising them would compute.
const PATTERNS = [
  { fill: 1, computed: { L: 1, C: 1, Lr: 1, Cr: 1, cell: 1, riskIndex: 1, rank: 'Low' } },
  { fill: 3, computed: { L: 3, C: 3, Lr: 3, Cr: 3, cell: 9, riskIndex: 9, rank: 'Moderate' } },
  { fill: null, computed: { L: 4.24, C: 3.6, Lr: 4, Cr: 4, cell: 16, riskIndex: 15.26, rank: 'High' } },
  { fill: 5, computed: { L: 5, C: 5, Lr: 5, Cr: 5, cell: 25, riskIndex: 25, rank: 'Very High' } },
] as const;

/** Seeds the active project with the wells, then imports finals for the first 400 of them. */
async function seed500(page: Page, projectId: string): Promise<void> {
  const created = await page.evaluate(
    async ({ projectId, wells, patterns }) => {
      const { store, importProject } = window.__lwa!;
      const { ids } = await store.wells.upsertByLicence(projectId, wells);
      const file = await store.exportProject(projectId);
      const keys = ['plugQuality', 'cement', 'barriers', 'scvf', 'age', 'complexity', 'data', 'penetration', 'plume', 'usdw', 'access'];
      const at = file.exportedAt;
      ids.slice(0, 400).forEach((wellId, i) => {
        const p = patterns[i % patterns.length]!;
        file.assessments.push({
          id: `asm_perf_${i}`,
          wellId,
          methodologyRevision: '2.0.0',
          scores: Object.fromEntries(keys.map((k) => [k, p.fill])) as (typeof file.assessments)[number]['scores'],
          justifications: p.fill === null ? {} : Object.fromEntries(keys.map((k) => [k, 'Synthetic perf data'])),
          suggestions: {},
          computed: { ...p.computed },
          recommendedAction: { auto: '', override: null },
          status: 'final',
          reviewerName: 'Perf Seeder',
          assessedAt: at,
          supersedesId: null,
          approvedByName: null,
          approvedAt: null,
          createdAt: at,
          updatedAt: at,
        });
      });
      await importProject(file);
      return (await store.wells.list(projectId)).length;
    },
    { projectId, wells: syntheticWells(), patterns: PATTERNS },
  );
  expect(created).toBe(WELLS);
}

function record(label: string, ms: number): void {
  test.info().annotations.push({ type: 'perf', description: `${label}: ${ms} ms` });
  console.log(`[perf] ${label}: ${ms} ms`);
}

test.describe('500 wells', () => {
  test.slow(); // seeding 500 wells and 400 assessments takes a few seconds

  test.beforeEach(async ({ page }) => {
    const projectId = await seedEmptyProject(page, 'Perf AOR');
    const started = Date.now();
    await seed500(page, projectId);
    record('seed 500 wells + 400 finals', Date.now() - started);
  });

  test('/wells shows "500 wells" and the last row scrolls into view', async ({ page }) => {
    const started = Date.now();
    await page.goto('/wells');
    await expect(page.getByText(`${WELLS} wells`, { exact: true })).toBeVisible();
    record('/wells to "500 wells"', Date.now() - started);

    const rows = page.getByRole('table', { name: 'Wells' }).locator('tbody tr');
    await expect(rows).toHaveCount(WELLS);
    const scrollStarted = Date.now();
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    record('scroll the last row into view', Date.now() - scrollStarted);
  });

  test('/portfolio shows the "500 wells" KPI within 3 s of navigation', async ({ page }) => {
    const started = Date.now();
    await page.goto('/portfolio');
    const total = page.getByRole('group', { name: 'Portfolio counts' }).getByRole('link', { name: `${WELLS} wells`, exact: true });
    await expect(total).toBeVisible({ timeout: PORTFOLIO_BUDGET_MS });
    const elapsed = Date.now() - started;
    record('/portfolio to the "500 wells" KPI', elapsed);
    expect(elapsed).toBeLessThan(PORTFOLIO_BUDGET_MS);
    // the finals are on the matrix too: 100 wells in each of the four ranks, 100 unscored
    await expect(page.getByRole('group', { name: 'Portfolio counts' }).getByRole('link', { name: 'Unscored: 100 wells', exact: true })).toBeVisible();
  });
});
