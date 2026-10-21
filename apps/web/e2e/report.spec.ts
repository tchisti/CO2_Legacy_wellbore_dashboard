import { expect, test, type Page } from '@playwright/test';
import type { WellInput } from '@lwa/engine';
import { seedFixture } from './helpers';

// The print reports (spec §4.2, §4.3, §7): the well dossier and the portfolio report, documents
// with no app chrome that print on letter pages in the light palette.

/** 100/07-21-055-22W4/00: final under 2.0.0, Moderate, cell 6, by Tahir Chisti on 2026-08-07; no construction. */
const FT_SASK = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' };

/** A construction record with a casing, a cement plug and a formation top. */
const CONSTRUCTION: WellInput['construction'] = {
  td: 1463.3,
  casings: [{ name: 'Surface Casing', od_mm: 219, top_m: 0, shoe_m: 186, toc_m: 0 }],
  plugs: [{ n: 1, kind: 'cement', top_m: 1448, bottom_m: 1463, sacks: 25 }],
  formations: [{ name: 'Nisku', top_m: 1100 }],
};

const DOSSIER_SECTIONS = ['header', 'summary', 'action', 'scores', 'construction', 'notes', 'methodology', 'footer'];
const FOOTNOTE = 'Reviewer identity is recorded from a local profile and is not authenticated.';

const report = (page: Page) => page.locator('[data-report-root]');
const toolbar = (page: Page) => page.getByRole('group', { name: 'Report actions' });
const registerRows = (page: Page) => page.getByRole('table', { name: 'Wells' }).locator('tbody tr');

async function storeConstruction(page: Page, id: string, construction: WellInput['construction']): Promise<void> {
  await page.evaluate(
    async ({ wellId, record }) => {
      await window.__lwa!.store.wells.update(wellId, { construction: record });
    },
    { wellId: id, record: construction },
  );
}

test.describe('with the Fort Saskatchewan fixture', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('well dossier route renders all sections in order and the schematic SVG; print media hides the app shell', async ({
    page,
  }) => {
    await storeConstruction(page, FT_SASK.id, CONSTRUCTION);
    await page.goto(`/report/well?id=${FT_SASK.id}`);
    await expect(page.getByRole('heading', { level: 1, name: FT_SASK.licence })).toBeVisible();

    const sections = await page.locator('[data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    expect(sections).toEqual(DOSSIER_SECTIONS);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);

    const schematic = page.getByRole('figure', { name: 'Wellbore schematic' }).locator('svg');
    await expect(schematic).toBeVisible();
    await expect(schematic.locator('[data-kind="plug"]')).toHaveCount(1);
    await expect(schematic.locator('[data-kind="casing"]')).toHaveCount(1);
    await expect(page.locator('[data-attribution]')).toHaveText(
      /^Assessed by Tahir Chisti on 2026-08-07 · Methodology rev 2\.0\.0 · Printed \d{4}-\d{2}-\d{2}$/,
    );
    await expect(page.locator('[data-footnote]')).toHaveText(FOOTNOTE);
    await expect(page.getByRole('table', { name: 'Scores' }).locator('tr[data-param]')).toHaveCount(11);

    await expect(toolbar(page)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(toolbar(page)).toBeHidden();
    await expect(page.locator('nav[aria-label="Sections"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: FT_SASK.licence })).toBeVisible();
    await expect(schematic).toBeVisible();
  });

  test('portfolio report shows KPIs, matrix and the register table with 5 rows', async ({ page }) => {
    await page.goto('/report/portfolio');
    await expect(page.getByRole('heading', { level: 1, name: 'Portfolio report' })).toBeVisible();
    await expect(page.locator('[data-filter]')).toHaveText('All wells');
    const counts = page.locator('[data-section="counts"]');
    await expect(counts.locator('[data-kpi="total"] [data-kpi-count]')).toHaveText('5');
    await expect(counts.locator('[data-kpi="total"]')).not.toContainText('of 5 wells'); // unfiltered: just "5 wells"
    await expect(counts.locator('[data-kpi="rank:Low"] [data-kpi-count]')).toHaveText('4');
    await expect(counts.locator('[data-kpi="rank:Moderate"] [data-kpi-count]')).toHaveText('1');
    await expect(counts.getByRole('link')).toHaveCount(0);
    const matrix = page.locator('[data-section="matrix"] svg');
    await expect(matrix.locator('[data-cell="2-3"]')).toHaveAttribute('data-count', '1');
    await expect(matrix.locator('[data-cell="2-2"]')).toHaveAttribute('data-count', '4');
    await expect(matrix.locator('a')).toHaveCount(0);
    await expect(registerRows(page)).toHaveCount(5);
    await expect(registerRows(page).first()).toContainText(FT_SASK.licence); // riskiest first
    await expect(page.locator('[data-footnote]')).toHaveText(FOOTNOTE);
  });

  test('Print button calls window.print', async ({ page }) => {
    let printed = 0;
    await page.exposeFunction('__reportPrinted', () => {
      printed += 1;
    });
    await page.goto(`/report/well?id=${FT_SASK.id}`);
    await expect(page.getByRole('heading', { level: 1, name: FT_SASK.licence })).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { __reportPrinted: () => void };
      window.print = () => w.__reportPrinted();
    });
    await toolbar(page).getByRole('button', { name: 'Print / Save as PDF' }).click();
    await expect.poll(() => printed).toBe(1);
  });

  test('dark theme user still gets the light report', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('lwa.theme', 'dark'));
    await page.goto('/portfolio');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkBody = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBody).toBe('rgb(15, 17, 20)'); // the dark --bg, so the theme is really on

    await page.goto(`/report/well?id=${FT_SASK.id}`);
    await expect(page.getByRole('heading', { level: 1, name: FT_SASK.licence })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // the user's choice is left alone
    const colours = await report(page).evaluate((root) => {
      const sheet = root.querySelector('article')!;
      return {
        root: getComputedStyle(root).backgroundColor,
        sheet: getComputedStyle(sheet).backgroundColor,
        ink: getComputedStyle(root).color,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      };
    });
    expect(colours).toEqual({
      root: 'rgb(247, 248, 249)', // the light --bg
      sheet: 'rgb(255, 255, 255)', // the light --surface
      ink: 'rgb(21, 25, 30)', // the light --ink
      scheme: 'light',
    });
  });

  test('Wells Report button opens the portfolio report with the current filter', async ({ page }) => {
    await page.goto('/wells?rank=Low');
    await expect(page.getByRole('table', { name: 'Wells' }).locator('tbody tr')).toHaveCount(4);
    const button = page.getByRole('link', { name: 'Report', exact: true });
    await expect(button).toHaveAttribute('href', '/report/portfolio?rank=Low');
    await button.click();
    await expect(page).toHaveURL(/\/report\/portfolio\?rank=Low$/);
    await expect(page.locator('[data-filter]')).toHaveText('Filter: Rank Low');
    await expect(registerRows(page)).toHaveCount(4);
    // The counts are of the filter's wells, and say how many of the area's wells that is.
    const total = page.locator('[data-section="counts"] [data-kpi="total"]');
    await expect(total.locator('[data-kpi-count]')).toHaveText('4');
    await expect(total).toContainText('of 5 wells');
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
    await expect(toolbar(page).getByRole('link', { name: 'Back to Wells' })).toHaveAttribute('href', '/wells?rank=Low');
  });

  test('an unknown well id is "Well not found" with a link back to Wells', async ({ page }) => {
    await page.goto('/report/well?id=wel_missing');
    await expect(page.getByRole('heading', { name: 'Well not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Wells' }).click();
    await expect(page).toHaveURL(/\/wells$/);
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });
});
