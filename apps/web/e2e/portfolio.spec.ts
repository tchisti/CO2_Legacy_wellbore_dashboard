import { expect, test, type Page } from '@playwright/test';
import { seedEmptyProject, seedFixture } from './helpers';

/** The register's body rows (the header row is in <thead>). */
const wellRows = (page: Page) => page.getByRole('table', { name: 'Wells' }).locator('tbody tr');
const counts = (page: Page) => page.getByRole('group', { name: 'Portfolio counts' });
const matrix = (page: Page) => page.getByRole('region', { name: 'Risk matrix' });
const attention = (page: Page) => page.getByRole('region', { name: 'Needs attention' });
const drivers = (page: Page) => page.getByRole('region', { name: 'Driver contribution' });

const CELL_2_3 = 'L 2 × C 3, cell 6, Moderate: 1 well';

test.describe('with the Fort Saskatchewan fixture', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedFixture(page);
    await page.goto('/portfolio');
    await expect(counts(page).getByRole('link', { name: '5 wells', exact: true })).toBeVisible();
  });

  test('portfolio fits without vertical scroll at 1440×900 and shows KPI "5 wells"', async ({ page }) => {
    await expect(counts(page).getByRole('link', { name: 'Low: 4 wells', exact: true })).toBeVisible();
    await expect(counts(page).getByRole('link', { name: 'Moderate: 1 well', exact: true })).toBeVisible();
    await expect(counts(page).getByRole('link', { name: 'High: 0 wells', exact: true })).toBeVisible();
    await expect(counts(page).getByRole('link', { name: 'Very High: 0 wells', exact: true })).toBeVisible();
    await expect(counts(page).getByRole('link', { name: 'Unscored: 0 wells', exact: true })).toBeVisible();
    await expect(matrix(page).getByRole('link', { name: CELL_2_3, exact: true })).toBeVisible();
    await expect(attention(page).getByRole('link', { name: /100\/13-05-056-22W4\/00/ })).toContainText('Assessed under 1.0.0');
    await expect(drivers(page).locator('[data-driver]').first()).toHaveAttribute('data-driver', 'penetration');
    // Everything, down to the last driver bar, is on the one screen.
    await expect(drivers(page).locator('[data-driver]').last()).toBeInViewport({ ratio: 1 });
    const { scrollHeight, innerHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));
    expect(scrollHeight).toBeLessThanOrEqual(innerHeight);
  });

  test('clicking matrix cell (2,3) opens Wells filtered to 1 row', async ({ page }) => {
    await matrix(page).getByRole('link', { name: CELL_2_3, exact: true }).click();
    await expect(page).toHaveURL(/\/wells\?Cr=3&Lr=2$/);
    await expect(wellRows(page)).toHaveCount(1);
    await expect(wellRows(page).first()).toContainText('100/07-21-055-22W4/00');
  });

  test('KPI Stale revision links to Wells filtered to 1 row', async ({ page }) => {
    const stale = counts(page).getByRole('link', { name: 'Stale revision: 1 well', exact: true });
    await expect(stale).toHaveAttribute('data-tone', 'warn');
    await stale.click();
    await expect(page).toHaveURL(/\/wells\?state=stale$/);
    await expect(wellRows(page)).toHaveCount(1);
    await expect(wellRows(page).first()).toContainText('100/13-05-056-22W4/00');
  });

  test('matrix cell is reachable by keyboard (Tab to it, Enter opens filtered Wells)', async ({ page }) => {
    const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = (await focusedLabel()) === CELL_2_3;
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/wells\?Cr=3&Lr=2$/);
    await expect(wellRows(page)).toHaveCount(1);
  });

  test('a Needs attention row opens the well', async ({ page }) => {
    await attention(page).getByRole('link', { name: /100\/13-05-056-22W4\/00/ }).click();
    await expect(page).toHaveURL(/\/wells\/view\?id=wel_v2_W-LX242Q$/);
    await expect(page.getByRole('heading', { level: 1, name: /100\/13-05-056-22W4\/00/ })).toBeVisible();
  });
});

test('no-finals project shows the calm matrix message', async ({ page }) => {
  const projectId = await seedEmptyProject(page, 'Unscored AOR');
  await page.evaluate(async (id) => {
    const { store } = window.__lwa!;
    await store.wells.create(id, { licence: '100/01-01-001-01W5/00', name: 'FIRST 1-1' });
    await store.wells.create(id, { licence: '100/02-01-001-01W5/00', name: 'SECOND 2-1' });
  }, projectId);
  await page.goto('/portfolio');

  await expect(counts(page).getByRole('link', { name: '2 wells', exact: true })).toBeVisible();
  await expect(counts(page).getByRole('link', { name: 'Unscored: 2 wells', exact: true })).toBeVisible();
  await expect(counts(page).getByRole('link', { name: 'Low: 0 wells', exact: true })).toBeVisible();
  await expect(matrix(page).getByText('No current assessments yet')).toBeVisible();
  await expect(matrix(page).getByRole('link')).toHaveCount(0);
  await expect(drivers(page).getByText('No current assessments yet')).toBeVisible();
  const rows = attention(page).getByRole('link');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('100/01-01-001-01W5/00');
  await expect(rows.first()).toContainText('Not yet assessed');
});

test('an empty project offers New well and Import', async ({ page }) => {
  await seedEmptyProject(page, 'Empty AOR');
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'No wells in this project yet' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Portfolio counts' })).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'New well', exact: true }).click();
  await expect(page).toHaveURL(/\/wells\/new$/);
});
