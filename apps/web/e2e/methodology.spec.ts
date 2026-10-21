import { expect, test, type Page } from '@playwright/test';
import { seedFixture } from './helpers';

const FIGURE_NAME = 'Legacy well classification types, adapted after Arbad et al. 2024';

const params = (page: Page) => page.getByRole('table', { name: 'Scoring parameters' });
const bands = (page: Page) => page.getByRole('table', { name: 'Rank bands' });
const types = (page: Page) => page.getByRole('table', { name: 'Legacy well classification' });

test.describe('Methodology page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedFixture(page);
    await page.goto('/methodology');
    await expect(page.getByRole('heading', { level: 1, name: 'Methodology' })).toBeVisible();
  });

  test('methodology page shows rev 2.0.0, 11 parameters with weights, anchors 1/3/5, unknown score and refs; bands table; Types 1–9 table; figure with aria-label', async ({
    page,
  }) => {
    // Header: revision, who and when, and the scoring rule in words.
    await expect(page.locator('[data-header-rev]')).toHaveText('2.0.0');
    await expect(page.getByText('updated 2026-07-28 by Tahir Chisti')).toBeVisible();
    await expect(page.getByText(/weighted sums/)).toContainText('round(L) × round(C)');

    // 11 parameters, Likelihood (7) then Consequence (4), each group closing with its weight sum 1.00.
    await expect(params(page).locator('tr[data-param]')).toHaveCount(11);
    await expect(params(page).locator('tbody[data-axis="L"] tr[data-param]')).toHaveCount(7);
    await expect(params(page).locator('tbody[data-axis="C"] tr[data-param]')).toHaveCount(4);
    await expect(params(page).locator('tr[data-sum="L"] [data-column="weight"]')).toHaveText('1.00');
    await expect(params(page).locator('tr[data-sum="C"] [data-column="weight"]')).toHaveText('1.00');
    const plug = params(page).locator('tr[data-param="plugQuality"]');
    await expect(plug).toContainText('Abandonment & Plug Quality');
    await expect(plug.locator('[data-column="weight"]')).toHaveText('0.22');
    await expect(plug.locator('[data-column="anchor1"]')).toContainText('Abandoned to current D020 / Class VI standard');
    await expect(plug.locator('[data-column="anchor3"]')).toContainText('Era-standard abandonment');
    await expect(plug.locator('[data-column="anchor5"]')).toContainText('Improper abandonment');
    await expect(plug.locator('[data-column="unknown"]')).toHaveText('5');
    await expect(plug.locator('[data-column="refs"]')).toContainText('AER D020 §3; 40 CFR 146.84(c); Arbad et al. 2024');
    await expect(params(page).locator('tr[data-param="barriers"] [data-column="unknown"]')).toHaveText('3');

    // The four rank bands with their cell ranges, and the cell rule.
    await expect(bands(page).locator('tbody tr')).toHaveCount(4);
    for (const [label, range] of [
      ['Low', '1–4'],
      ['Moderate', '5–9'],
      ['High', '10–16'],
      ['Very High', '17–25'],
    ] as const) {
      const row = bands(page).locator('tbody tr').filter({ has: page.locator(`[data-rank="${label}"]`) });
      await expect(row.locator('[data-column="cells"]')).toHaveText(range);
    }

    // Types 1 to 9 and the adapted Figure A-4.
    await expect(types(page).locator('tbody tr')).toHaveCount(9);
    await expect(types(page).locator('tbody tr').first()).toContainText('Type 1');
    await expect(types(page).locator('tbody tr').last()).toContainText('Type 9');
    await expect(page.getByRole('img', { name: FIGURE_NAME })).toBeVisible();

    // Sources, with the DOI opening in a new tab.
    const doi = page.getByRole('link', { name: 'doi:10.1016/j.ijggc.2024.104106' });
    await expect(doi).toHaveAttribute('href', 'https://doi.org/10.1016/j.ijggc.2024.104106');
    await expect(doi).toHaveAttribute('target', '_blank');
    await expect(page.getByText('Built on Enbridge NET')).toBeVisible();
    await expect(page.getByText('3D Reviewer')).toHaveCount(0);
  });

  test('revision list shows 2.0.0', async ({ page }) => {
    const revisions = page.getByRole('table', { name: 'Revisions in this project' });
    await expect(revisions.locator('tbody tr')).toHaveCount(1);
    const row = revisions.locator('tbody tr').first();
    await expect(row.locator('[data-column="revision"]')).toContainText('2.0.0');
    // The built-in rulebook the store seeds: it is what the fixture's own 2.0.0 record is read against.
    await expect(row).toContainText('(current)');
    await expect(row).toContainText('built-in default');
    await expect(row).toContainText('2026-07-28');
    await expect(row).toContainText('system');
  });

  test('no Edit button in Phase 1 (admin editor is Phase 2)', async ({ page }) => {
    await expect(params(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /edit/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /edit/i })).toHaveCount(0);
  });

  test('the Methodology tab is the current section', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Methodology' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

test.describe('Methodology page on a phone', () => {
  test('the content does not scroll sideways; the wide tables and the figure scroll inside their own frames', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedFixture(page);
    await page.goto('/methodology');
    await expect(params(page)).toBeVisible();
    // The page content (<main>), not the top bar, which is the shell's and has its own width.
    const overflow = await page.evaluate(() => {
      const main = document.getElementById('main')!;
      return main.scrollWidth - main.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    // Each wide table sits in a frame that scrolls.
    for (const name of ['Scoring parameters', 'Legacy well classification']) {
      const frame = page.getByRole('table', { name }).locator('xpath=..');
      expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }

    const figure = page.getByRole('img', { name: FIGURE_NAME });
    const scroller = figure.locator('xpath=..');
    await expect(scroller).toHaveAttribute('tabindex', '0');
    const scrolls = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrolls).toBe(true);
    await scroller.focus();
    await expect(scroller).toBeFocused();
  });
});
