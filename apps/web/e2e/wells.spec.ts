import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_PROJECT_ID, seedEmptyProject, seedFixture } from './helpers';

/** The register's body rows (the header row is in <thead>). */
const bodyRows = (page: Page) => page.getByRole('table', { name: 'Wells' }).locator('tbody tr');
const rowFor = (page: Page, licence: string) => bodyRows(page).filter({ hasText: licence });
/** Asserts (with retries) the licences of the rows shown, in order. */
const expectLicences = (page: Page, expected: string[]) =>
  expect(bodyRows(page).locator('td[data-column="licence"]')).toHaveText(expected);

async function openRowMenu(page: Page, licence: string, item: 'Edit record' | 'Delete…') {
  await rowFor(page, licence).getByRole('button', { name: `Actions for ${licence}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** A filter chip (scoped to the filter bar: the table's sortable headers are buttons too). */
const chip = (page: Page, name: string | RegExp) =>
  page.getByRole('search', { name: 'Filter wells' }).getByRole('button', { name });

async function pickFilter(page: Page, name: string, option: RegExp) {
  await chip(page, name).click();
  await page.getByRole('menuitemcheckbox', { name: option }).click();
  await page.keyboard.press('Escape');
}

test.describe('with the Fort Saskatchewan fixture', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
    await page.goto('/wells');
    await expect(bodyRows(page)).toHaveCount(5);
  });

  test('table lists 5 wells sorted by Risk Index, first is 100/07-21-055-22W4/00 with Moderate badge', async ({ page }) => {
    await expectLicences(page, [
      '100/07-21-055-22W4/00', // 4.58
      '100/13-06-055-22W4/00', // 3.74
      '100/03-17-056-22W4/00', // 3.27
      '100/13-05-056-22W4/00', // 3.04, stale revision
      '100/08-19-055-22W4/00', // 2.81
    ]);
    const first = bodyRows(page).first();
    await expect(first.locator('[data-rank="Moderate"]')).toHaveText('Moderate');
    await expect(first.locator('td[data-column="cell"]')).toHaveText('6');
    await expect(first.locator('td[data-column="lc"]')).toHaveText('1.8 × 2.6');
    await expect(page.getByRole('columnheader', { name: /L × C/ })).toHaveAttribute('aria-sort', 'descending');
    await expect(rowFor(page, '100/13-05-056-22W4/00').locator('td[data-column="state"]')).toHaveText('Stale revision');
    // Stale is the amber state badge (spec §5.1); every other state stays neutral.
    await expect(rowFor(page, '100/13-05-056-22W4/00').locator('td[data-column="state"] [data-tone]')).toHaveAttribute(
      'data-tone',
      'warn',
    );
    await expect(first.locator('td[data-column="state"] [data-tone]')).toHaveAttribute('data-tone', 'neutral');
    await expect(page.getByText('5 wells', { exact: true })).toBeVisible();
  });

  test('filter chip Rank=Low leaves 4 rows; text "Sinopec" leaves 1', async ({ page }) => {
    await pickFilter(page, 'Rank', /^Low/);
    await expect(bodyRows(page)).toHaveCount(4);
    await expect(page.getByText('4 of 5 wells')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search wells' }).fill('Sinopec');
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('100/13-05-056-22W4/00');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(bodyRows(page)).toHaveCount(5);
    await expect(page.getByRole('searchbox', { name: 'Search wells' })).toHaveValue('');
  });

  test('filtered to nothing, the table says so and offers to clear the filters', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search wells' }).fill('no such well');
    await expect(page.getByText('No wells match these filters')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Wells' })).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: 'Clear filters' }).last().click();
    await expect(bodyRows(page)).toHaveCount(5);
  });

  test('clicking a column header sorts by it', async ({ page }) => {
    const licenceHeader = page.getByRole('columnheader', { name: /Licence/ });
    await licenceHeader.getByRole('button').click();
    await expect(licenceHeader).toHaveAttribute('aria-sort', 'ascending');
    await expectLicences(page, [
      '100/03-17-056-22W4/00',
      '100/07-21-055-22W4/00',
      '100/08-19-055-22W4/00',
      '100/13-05-056-22W4/00',
      '100/13-06-055-22W4/00',
    ]);
    await licenceHeader.getByRole('button').click();
    await expect(licenceHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(bodyRows(page).first().locator('td[data-column="licence"]')).toHaveText('100/13-06-055-22W4/00');
  });

  test('new well: required licence; saves with defaults; appears Unscored', async ({ page }) => {
    await page.getByRole('link', { name: 'New well' }).click();
    await expect(page).toHaveURL(/\/wells\/new$/);
    await expect(page.getByRole('heading', { level: 1, name: 'New well' })).toBeVisible();

    await page.getByRole('button', { name: 'Create well' }).click();
    await expect(page.getByText('Enter the licence or UWI.')).toBeVisible();
    await expect(page.getByLabel('Licence / UWI')).toHaveAttribute('aria-invalid', 'true');

    await page.getByLabel('Licence / UWI').fill('100/01-01-001-01W5/00');
    await page.getByRole('button', { name: 'Create well' }).click();

    await expect(page).toHaveURL(/\/wells$/);
    await expect(page.getByText('Well created')).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(6);
    const row = rowFor(page, '100/01-01-001-01W5/00');
    await expect(row.locator('td[data-column="state"]')).toHaveText('Unscored');
    await expect(row.locator('[data-rank="unscored"]')).toBeVisible();
    await expect(row.locator('td[data-column="type"]')).toHaveText('Unknown');
    await expect(row.locator('td[data-column="status"]')).toHaveText('Unknown');
    await expect(row.locator('td[data-column="classification"]')).toHaveText('Type 1');
    await expect(bodyRows(page).last()).toContainText('100/01-01-001-01W5/00'); // unscored sort last
  });

  test('new well: a licence the project already has is refused on the field', async ({ page }) => {
    await page.goto('/wells/new');
    await page.getByLabel('Licence / UWI').fill(' 100/07-21-055-22w4/00 ');
    await page.getByRole('button', { name: 'Create well' }).click();
    await expect(page.getByText('A well with this licence already exists in this project.')).toBeVisible();
    await expect(page).toHaveURL(/\/wells\/new$/);
  });

  test('edit record: change operator → table updates', async ({ page }) => {
    await openRowMenu(page, '100/13-05-056-22W4/00', 'Edit record');
    const dialog = page.getByRole('dialog', { name: 'Edit well record' });
    await expect(dialog.getByLabel('Operator')).toHaveValue('Sinopec Canada Energy Ltd.');
    await dialog.getByLabel('Operator').fill('Redwater Holdings Ltd.');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Well updated')).toBeVisible();
    await expect(rowFor(page, '100/13-05-056-22W4/00').locator('td[data-column="operator"]')).toHaveText(
      'Redwater Holdings Ltd.',
    );
    await expect(page).toHaveURL(/\/wells$/); // the menu did not open the well
  });

  test('delete well requires typed licence', async ({ page }) => {
    await openRowMenu(page, '100/08-19-055-22W4/00', 'Delete…');
    const dialog = page.getByRole('alertdialog', { name: 'Delete well?' });
    await expect(dialog).toContainText('its 1 assessment');
    const confirm = dialog.getByRole('button', { name: 'Delete well' });
    const typed = dialog.getByLabel(/Type the licence/);
    await expect(confirm).toBeDisabled();
    await typed.fill('100/08-19-055-22W4');
    await expect(confirm).toBeDisabled();
    await typed.fill('100/08-19-055-22W4/00');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Well 100/08-19-055-22W4/00 deleted')).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(4);
    await expect(rowFor(page, '100/08-19-055-22W4/00')).toHaveCount(0);
  });

  test('bulk delete requires typing the count', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Select 100/13-06-055-22W4/00' }).check();
    await page.getByRole('checkbox', { name: 'Select 100/03-17-056-22W4/00' }).check();
    await expect(page).toHaveURL(/\/wells$/); // checking a row does not open it
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.getByRole('button', { name: 'Delete…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete 2 wells?' });
    const confirm = dialog.getByRole('button', { name: 'Delete 2 wells' });
    const typed = dialog.getByLabel('Type 2 to confirm');
    await expect(dialog).toContainText('2 assessments');
    await expect(confirm).toBeDisabled();
    await typed.fill('3');
    await expect(confirm).toBeDisabled();
    await typed.fill('2');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText('2 wells deleted')).toBeVisible();
    await expect(bodyRows(page)).toHaveCount(3);
    await expect(page.getByText('2 selected')).toHaveCount(0);
  });

  test('the header checkbox selects the visible rows only', async ({ page }) => {
    await pickFilter(page, 'Rank', /^Moderate/);
    await expect(bodyRows(page)).toHaveCount(1);
    await page.getByRole('checkbox', { name: 'Select all shown wells' }).check();
    await expect(page.getByText('1 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await expect(page.getByText('1 selected')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Select 100/07-21-055-22W4/00' })).not.toBeChecked();
  });

  test('keyboard: Enter on a focused row opens the well', async ({ page }) => {
    await bodyRows(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(bodyRows(page).nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(bodyRows(page).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/wells\/view\?id=wel_v2_W-4A62O7$/);
    await expect(page.getByRole('heading', { level: 1, name: '100/07-21-055-22W4/00' })).toBeVisible();
  });

  test('clicking a row opens the well; an unknown id says the well was not found', async ({ page }) => {
    await rowFor(page, '100/13-06-055-22W4/00').locator('td[data-column="name"]').click();
    await expect(page).toHaveURL(/\/wells\/view\?id=wel_v2_W-W8QB2S$/);
    await expect(page.getByRole('heading', { level: 1, name: '100/13-06-055-22W4/00' })).toBeVisible();

    await page.goto('/wells/view?id=wel_missing');
    await expect(page.getByText('Well not found')).toBeVisible();
    await page.getByRole('link', { name: 'Back to Wells' }).click();
    await expect(page).toHaveURL(/\/wells$/);
  });

  test('the licence is a link to the well: it opens in a new tab, and a click opens the well once', async ({ page, context }) => {
    const link = rowFor(page, '100/13-06-055-22W4/00').getByRole('link', { name: '100/13-06-055-22W4/00' });
    await expect(link).toHaveAttribute('href', '/wells/view?id=wel_v2_W-W8QB2S');
    // Out of the tab order: the row is the keyboard stop (Enter opens it).
    await expect(link).toHaveAttribute('tabindex', '-1');

    // A modifier click opens a new tab and leaves this page where it is.
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] }),
    ]);
    await expect(popup).toHaveURL(/\/wells\/view(?:\.html)?\?id=wel_v2_W-W8QB2S$/);
    await popup.close();
    await expect(page).toHaveURL(/\/wells$/);

    await link.click();
    await expect(page).toHaveURL(/\/wells\/view\?id=wel_v2_W-W8QB2S$/);
    await expect(page.getByRole('heading', { level: 1, name: '100/13-06-055-22W4/00' })).toBeVisible();
    // One navigation, not the link's and the row's: Back returns to the register.
    await page.goBack();
    await expect(page).toHaveURL(/\/wells$/);
  });

  test('filter state survives reload', async ({ page }) => {
    await pickFilter(page, 'Rank', /^Low/);
    await page.getByRole('searchbox', { name: 'Search wells' }).fill('Redwater');
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page).toHaveURL(/[?&]q=Redwater(&|$)/);
    await expect(page).toHaveURL(/[?&]rank=Low(&|$)/);

    await page.reload();
    await expect(bodyRows(page)).toHaveCount(2);
    await expect(page.getByRole('searchbox', { name: 'Search wells' })).toHaveValue('Redwater');
    await expect(chip(page, /Rank/)).toContainText('Low');
  });

  test('a link can carry a matrix cell, unknown ≥ n or an assessment state', async ({ page }) => {
    await page.goto('/wells?Lr=2&Cr=3');
    await expect(bodyRows(page)).toHaveCount(1);
    await expect(bodyRows(page).first()).toContainText('100/07-21-055-22W4/00');
    await page.getByRole('button', { name: 'Remove filter: matrix cell L2 × C3' }).click();
    await expect(bodyRows(page)).toHaveCount(5);
    await expect(page).toHaveURL(/\/wells$/);

    await page.goto('/wells?minUnknown=2');
    await expectLicences(page, ['100/13-05-056-22W4/00', '100/08-19-055-22W4/00']);

    await page.goto('/wells?state=stale');
    await expectLicences(page, ['100/13-05-056-22W4/00']);
  });

  test('a well without coordinates appears and can be edited', async ({ page }) => {
    await page.evaluate(async (projectId) => {
      await window.__lwa!.store.wells.create(projectId, { licence: '102/16-30-055-21W4/00', name: 'NO COORDS 16-30' });
    }, FIXTURE_PROJECT_ID);
    const row = rowFor(page, '102/16-30-055-21W4/00');
    await expect(row.locator('td[data-column="state"]')).toHaveText('Unscored');

    await openRowMenu(page, '102/16-30-055-21W4/00', 'Edit record');
    const dialog = page.getByRole('dialog', { name: 'Edit well record' });
    await expect(dialog.getByLabel('Latitude')).toHaveValue('');
    await dialog.getByLabel('Name').fill('NO COORDS 16-30 (re-entered)');
    await dialog.getByLabel('Latitude').fill('north');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByText('Latitude must be a number from −90 to 90.')).toBeVisible();

    await dialog.getByLabel('Latitude').fill('');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(row.locator('td[data-column="name"]')).toHaveText('NO COORDS 16-30 (re-entered)');

    await openRowMenu(page, '102/16-30-055-21W4/00', 'Edit record');
    await dialog.getByLabel('Latitude').fill('53.79');
    await dialog.getByLabel('Longitude').fill('-113.21');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    const saved = await page.evaluate(async (projectId) => {
      const wells = await window.__lwa!.store.wells.list(projectId);
      const w = wells.find((x) => x.licence === '102/16-30-055-21W4/00');
      return w ? { lat: w.lat, lon: w.lon, name: w.name } : null;
    }, FIXTURE_PROJECT_ID);
    expect(saved).toEqual({ lat: 53.79, lon: -113.21, name: 'NO COORDS 16-30 (re-entered)' });
  });

  test('Import opens the import dialog and Export opens its menu, from the keyboard', async ({ page }) => {
    await page.getByRole('button', { name: 'Import', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Import wells' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Export' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Export CSV (current view)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page).toHaveURL(/\/wells$/);
  });
});

test('an empty project shows the empty register with a way to add the first well', async ({ page }) => {
  await seedEmptyProject(page, 'Empty AOR');
  await page.goto('/wells');
  await expect(page.getByText('No wells in this project yet')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'New well' }).last().click();
  await expect(page).toHaveURL(/\/wells\/new$/);
});
