import { expect, test, type Locator, type Page } from '@playwright/test';
import { SWEEP_ROUTES, seedFixture } from './helpers';

// Spec §7 "desktop first; tablet (1024 px) fully usable; phone read-only": no page scrolls sideways
// on a 390 px phone, at 1024 px the Wells register shows Rank and Assessment without scrolling the
// table, and long unbroken text (a pasted URL) wraps instead of overflowing.

/** 100/07-21-055-22W4/00 (IMPERIAL FT SASK 7-21). */
const FT_SASK = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' };

/** How far the page is wider than the window (0 when nothing scrolls sideways). */
const sidewaysOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('390 × 844 (phone)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of SWEEP_ROUTES) {
    test(`${route.name}: the page does not scroll sideways`, async ({ page }) => {
      if (route.seed) await seedFixture(page);
      await page.goto(route.path);
      await expect(route.ready(page)).toBeVisible();
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('the top bar keeps the project switcher and the profile menu on screen', async ({ page }) => {
    await seedFixture(page);
    await page.goto('/wells');
    const banner = page.getByRole('banner');
    const switcher = banner.getByRole('button', { name: /Fort Saskatchewan/ });
    const profile = banner.getByRole('button', { name: /TC/ });
    await expect(switcher).toBeInViewport({ ratio: 1 });
    await expect(profile).toBeInViewport({ ratio: 1 });
  });
});

test.describe('1024 × 768 (tablet)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('Wells: the Rank and Assessment columns are on screen without scrolling the table', async ({ page }) => {
    await seedFixture(page);
    await page.goto('/wells');
    const table = page.getByRole('table', { name: 'Wells' });
    await expect(table.locator('tbody tr')).toHaveCount(5);
    await expect(table.getByRole('columnheader', { name: 'Rank' })).toBeInViewport({ ratio: 1 });
    await expect(table.getByRole('columnheader', { name: 'Assessment' })).toBeInViewport({ ratio: 1 });
    // The table's own scroller has nothing to scroll.
    const container = page.locator('[data-slot="table-container"]').filter({ has: table });
    expect(await container.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });
});

/** 120 characters with no break opportunity: a pasted URL or document number. */
const TOKEN = `https://records.example/${'A1B2C3D4E5'.repeat(9)}${'X'.repeat(6)}`;

/** Finalises a re-assessment of FT SASK whose override and one justification are TOKEN, and puts TOKEN in the notes. */
async function storeLongText(page: Page): Promise<void> {
  await page.evaluate(
    async ({ wellId, token }) => {
      const { store } = window.__lwa!;
      const nulls = { plugQuality: null, cement: null, barriers: null, scvf: null, age: null, complexity: null };
      const draft = await store.assessments.saveDraft(wellId, {
        scores: { ...nulls, plugQuality: 3, data: 2, penetration: null, plume: null, usdw: null, access: null },
        justifications: { plugQuality: token, data: 'Logs on file.' },
        override: `Re-enter and log. See ${token}`,
        suggestions: {},
      });
      await store.assessments.finalise(draft.id);
      await store.wells.update(wellId, { notes: token });
    },
    { wellId: FT_SASK.id, token: TOKEN },
  );
}

/** Whether the element's content is wider than its box (it would be cut off or spill over). */
const spills = (locator: Locator) => locator.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
]) {
  test.describe(`long unbroken text at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('an override, a justification and the notes wrap instead of overflowing', async ({ page }) => {
      await seedFixture(page);
      await storeLongText(page);

      await page.goto(`/wells/view?id=${FT_SASK.id}`);
      const override = page.locator('[data-override]');
      await expect(override).toContainText(TOKEN);
      expect(await spills(override)).toBe(false);
      const justification = page.getByRole('table', { name: /Scores/ }).first().locator('tr[data-param="plugQuality"] td[data-column="justification"]');
      await expect(justification).toHaveText(TOKEN);
      expect(await spills(justification)).toBe(false);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

      await page.goto(`/report/well?id=${FT_SASK.id}`);
      await expect(page.locator('[data-override]')).toContainText(TOKEN);
      expect(await spills(page.locator('[data-override]'))).toBe(false);
      const printed = page.getByRole('table', { name: 'Scores' }).locator('tr[data-param="plugQuality"] td[data-column="justification"]');
      await expect(printed).toHaveText(TOKEN);
      expect(await spills(printed)).toBe(false);
      await expect(page.locator('[data-notes]')).toHaveText(TOKEN);
      expect(await spills(page.locator('[data-notes]'))).toBe(false);
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}
