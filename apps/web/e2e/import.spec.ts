import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { FIXTURE_PROJECT_ID, PROFILE, seedEmptyProject, seedFixture } from './helpers';

// Wells → Import and Export (spec §4.2): CSV import with a column mapping step and a validation
// report before anything is written; JSON import of a project file or a bare v2 wells.json; CSV
// export of the current view or the selection.

const BAD_ROW_CSV = path.join(__dirname, 'fixtures', 'template-with-bad-row.csv');
const V2_WELLS_JSON = path.join(__dirname, 'fixtures', 'v2-wells.json');
const BAD_LICENCE = '100/06-12-046-25W4';
const TEMPLATE_LICENCES = ['100/04-20-046-25W4', '102/11-08-046-26W4'];
const FIRST = '100/07-21-055-22W4/00';

const bodyRows = (page: Page) => page.getByRole('table', { name: 'Wells' }).locator('tbody tr');
const rowFor = (page: Page, licence: string) => bodyRows(page).filter({ hasText: licence });

async function openImport(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import wells' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A CSV file made in the test. */
const csvFile = (name: string, lines: string[][]) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(lines.map((l) => l.join(',')).join('\r\n'), 'utf8'),
});

async function pick(dialog: Locator, file: string | ReturnType<typeof csvFile>) {
  await dialog.locator('input[type="file"]').setInputFiles(file);
}

/** Records of a CSV text (quoted fields may hold commas and line breaks); the BOM is dropped. */
function csvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      rows.push([...row, cur]);
      row = [];
      cur = '';
    } else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length > 0) rows.push([...row, cur]);
  return rows;
}

async function downloadText(download: Download): Promise<string> {
  return readFileSync(await download.path(), 'utf8');
}

async function storeWells(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const { store } = window.__lwa!;
    const wells = await store.wells.list(pid);
    return Promise.all(
      wells.map(async (w) => ({
        licence: w.licence,
        operator: w.operator,
        lat: w.lat,
        lon: w.lon,
        draft: (await store.assessments.draft(w.id))?.reviewerName ?? null,
      })),
    );
  }, projectId);
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

test('import the v2 template with one bad row: report shows 1 error and 2 ok; 2 wells appear, each with a draft assessment', async ({
  page,
}) => {
  const projectId = await seedEmptyProject(page, 'CSV Import AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  await pick(dialog, BAD_ROW_CSV);

  // Columns: every template header is recognised.
  const mapping = dialog.getByRole('table', { name: 'Column mapping' });
  await expect(mapping).toBeVisible();
  await expect(mapping.locator('tbody tr')).toHaveCount(22);
  await expect(mapping.locator('tbody tr').filter({ hasText: 'Latitude' })).toContainText('Latitude');
  await expect(mapping.locator('tbody tr').filter({ hasText: 'Reviewer' })).toContainText('Not imported');
  await dialog.getByRole('button', { name: 'Review rows' }).click();

  // Review: two rows to create, the bad one skipped with its reason.
  await expect(dialog.getByText('2 to create · 0 to update · 1 with errors (skipped)')).toBeVisible();
  const report = dialog.getByRole('table', { name: 'Validation report' });
  await expect(report.locator('tbody tr')).toHaveCount(3);
  const bad = report.locator('tbody tr').filter({ hasText: BAD_LICENCE });
  await expect(bad).toContainText('Error');
  await expect(bad).toContainText('Latitude out of range'); // the report's "latitude out of range", capitalised
  for (const licence of TEMPLATE_LICENCES) {
    await expect(report.locator('tbody tr').filter({ hasText: licence })).toContainText('Create');
  }
  await expect(dialog.getByText(`The Reviewer column is not imported`)).toBeVisible();

  await dialog.getByRole('button', { name: 'Import 2 wells' }).click();
  const result = dialog.getByRole('region', { name: 'Import result' });
  await expect(result).toContainText('2 created, 0 updated');
  await expect(result).toContainText('2 drafts saved');
  await expect(result).toContainText('1 row with errors skipped');
  await expect(page.getByText('2 wells imported')).toBeVisible(); // toast
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(bodyRows(page)).toHaveCount(2);
  for (const licence of TEMPLATE_LICENCES) {
    await expect(rowFor(page, licence).locator('td[data-column="state"]')).toHaveText(`Draft by ${PROFILE.name}`);
  }
  const wells = await storeWells(page, projectId);
  expect(wells.map((w) => [w.licence, w.draft]).sort()).toEqual(TEMPLATE_LICENCES.map((l) => [l, PROFILE.name]));
});

test('rows with errors are skipped and nothing is written before Import is clicked', async ({ page }) => {
  const projectId = await seedEmptyProject(page, 'Nothing Yet AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  await pick(dialog, BAD_ROW_CSV);
  await expect(dialog.getByRole('table', { name: 'Column mapping' })).toBeVisible();
  expect(await storeWells(page, projectId)).toEqual([]);

  await dialog.getByRole('button', { name: 'Review rows' }).click();
  await expect(dialog.getByRole('table', { name: 'Validation report' })).toBeVisible();
  expect(await storeWells(page, projectId)).toEqual([]);

  // Back out and come back: still nothing written.
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog.getByRole('table', { name: 'Column mapping' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Review rows' }).click();
  expect(await storeWells(page, projectId)).toEqual([]);

  await dialog.getByRole('button', { name: 'Import 2 wells' }).click();
  await expect(dialog.getByRole('region', { name: 'Import result' })).toBeVisible();
  const licences = (await storeWells(page, projectId)).map((w) => w.licence);
  expect(licences.sort()).toEqual(TEMPLATE_LICENCES);
  expect(licences).not.toContain(BAD_LICENCE);
});

test('cancelling the dialog writes nothing', async ({ page }) => {
  const projectId = await seedEmptyProject(page, 'Cancel AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  await pick(dialog, BAD_ROW_CSV);
  await dialog.getByRole('button', { name: 'Review rows' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await storeWells(page, projectId)).toEqual([]);
});

test('the dialog offers the CSV template: the header and two sample rows', async ({ page }) => {
  await seedEmptyProject(page, 'Template AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download CSV template' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('legacy_wells_template.csv');
  const rows = csvRecords(await downloadText(download));
  expect(rows).toHaveLength(3);
  expect(rows[0]![0]).toBe('Well ID / Licence');
  expect(rows.slice(1).map((r) => r[0])).toEqual(TEMPLATE_LICENCES);
  // Same header and sample rows as the e2e fixture.
  expect(rows).toEqual(csvRecords(readFileSync(BAD_ROW_CSV, 'utf8')).slice(0, 3));
});

test('a CSV without the licence column is refused as a whole', async ({ page }) => {
  await seedEmptyProject(page, 'Refused AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  await pick(dialog, csvFile('no-licence.csv', [['Operator', 'Latitude'], ['Cenovus', '53.4']]));
  await expect(dialog.getByRole('alert')).toContainText(
    'CSV is missing required header "Well ID / Licence". Please download the CSV Template and edit it.',
  );
  await expect(dialog.getByRole('table', { name: 'Column mapping' })).toHaveCount(0);
});

test.describe('with the Fort Saskatchewan fixture', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
    await page.goto('/wells');
    await expect(bodyRows(page)).toHaveCount(5);
  });

  test('upsert: existing licence → "updated", not duplicated', async ({ page }) => {
    const dialog = await openImport(page);
    await pick(
      dialog,
      csvFile('one-well.csv', [
        ['Well ID / Licence', 'Operator', 'Legal Status'],
        [FIRST, 'Imperial Oil Resources', 'Abandoned (P&A)'],
      ]),
    );
    await dialog.getByRole('button', { name: 'Review rows' }).click();
    await expect(dialog.getByText('0 to create · 1 to update · 0 with errors (skipped)')).toBeVisible();
    const line = dialog.getByRole('table', { name: 'Validation report' }).locator('tbody tr');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('Update');
    await expect(line).toContainText('Changes: Operator');
    await dialog.getByRole('button', { name: 'Import 1 well' }).click();
    await expect(dialog.getByRole('region', { name: 'Import result' })).toContainText('0 created, 1 updated');
    await dialog.getByRole('button', { name: 'Done' }).click();

    await expect(bodyRows(page)).toHaveCount(5);
    await expect(rowFor(page, FIRST)).toContainText('Imperial Oil Resources');
    const wells = await storeWells(page, FIXTURE_PROJECT_ID);
    expect(wells.filter((w) => w.licence === FIRST)).toHaveLength(1);
  });

  test('partial CSV (licence + operator only) updates operator and leaves coordinates', async ({ page }) => {
    const before = (await storeWells(page, FIXTURE_PROJECT_ID)).find((w) => w.licence === FIRST)!;
    const dialog = await openImport(page);
    await pick(dialog, csvFile('operators.csv', [['Well ID / Licence', 'Operator'], [FIRST, 'Imperial (renamed)']]));
    const mapping = dialog.getByRole('table', { name: 'Column mapping' });
    await expect(mapping.locator('tbody tr')).toHaveCount(2);
    await expect(dialog.getByText(/Not in this file/)).toContainText('Latitude');
    await dialog.getByRole('button', { name: 'Review rows' }).click();
    await dialog.getByRole('button', { name: 'Import 1 well' }).click();
    await expect(dialog.getByRole('region', { name: 'Import result' })).toBeVisible();

    const after = (await storeWells(page, FIXTURE_PROJECT_ID)).find((w) => w.licence === FIRST)!;
    expect(after).toEqual({ ...before, operator: 'Imperial (renamed)' });
  });

  test('Export CSV downloads legacy_wells_<date>.csv with 5 data rows', async ({ page }) => {
    await page.getByRole('button', { name: 'Export' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export CSV (current view)' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`legacy_wells_${todayUtc()}.csv`);
    const text = await downloadText(download);
    expect(text.startsWith('﻿')).toBe(true);
    const rows = csvRecords(text);
    expect(rows).toHaveLength(6);
    expect(rows[0]!.slice(0, 2)).toEqual(['Well ID / Licence', 'Operator']);
    expect(rows[0]!.slice(-7)).toEqual(['L', 'C', 'Cell', 'Rank', 'Risk Index', 'Assessment', 'Methodology rev']);
    // In the view's order: riskiest first.
    expect(rows[1]![0]).toBe(FIRST);
    expect(rows[1]![3]).toBe('-113.207628'); // a negative longitude stays a number
  });

  test('Export follows the filters: the current view only', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search wells' }).fill('Sinopec');
    await expect(bodyRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Export' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export CSV (current view)' }).click();
    const rows = csvRecords(await downloadText(await downloading));
    expect(rows.slice(1).map((r) => r[0])).toEqual(['100/13-05-056-22W4/00']);
  });

  test('Export selected (2) writes 2 data rows', async ({ page }) => {
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('menuitem', { name: /Export selected/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByRole('checkbox', { name: 'Select 100/13-06-055-22W4/00' }).check();
    await page.getByRole('checkbox', { name: 'Select 100/03-17-056-22W4/00' }).check();
    await page.getByRole('button', { name: 'Export' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export selected (2)' }).click();
    const rows = csvRecords(await downloadText(await downloading));
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['100/13-06-055-22W4/00', '100/03-17-056-22W4/00']);
  });

  test('a partial score CSV on a finalised well: the re-assessment draft changes only that score and carries the rest', async ({
    page,
  }) => {
    const dialog = await openImport(page);
    await pick(dialog, csvFile('plug.csv', [['Well ID / Licence', 'Abandonment & Plug Quality (1-5 or ?)'], [FIRST, '5']]));
    await dialog.getByRole('button', { name: 'Review rows' }).click();
    const line = dialog.getByRole('table', { name: 'Validation report' }).locator('tbody tr');
    await expect(line).toContainText('Re-assessment draft');
    await expect(line).toContainText('Scores: Plug quality 1→5');
    await dialog.getByRole('button', { name: 'Import 1 well' }).click();
    await expect(dialog.getByRole('region', { name: 'Import result' })).toContainText('1 draft saved');
    await dialog.getByRole('button', { name: 'Done' }).click();

    // Open the draft: plug quality is the file's 5, every other row is the final's score.
    await page.goto('/wells/view?id=wel_v2_W-4A62O7');
    await page.getByRole('region', { name: 'Well summary' }).getByRole('link', { name: 'Continue draft', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: `Score ${FIRST}` });
    await expect(sheet).toContainText('Continuing the re-assessment draft');
    const expected = {
      plugQuality: '5',
      cement: '1',
      barriers: '1',
      scvf: '2',
      age: '4',
      complexity: '4',
      data: '1',
      penetration: '4',
      plume: '3',
      usdw: '1',
      access: '2',
    } as const;
    for (const [key, value] of Object.entries(expected)) {
      await expect(sheet.locator(`[data-param="${key}"]`).getByRole('radio', { name: value, exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }
  });

  test('re-importing an exported CSV (plus one new row) changes nothing else and makes no drafts', async ({ page }) => {
    await page.getByRole('button', { name: 'Export' }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export CSV (current view)' }).click();
    const download = await downloading;
    // Five unchanged wells, then a new one: the unchanged matches must not end the write early.
    const text = `${readFileSync(await download.path(), 'utf8')}\r\n102/16-30-055-21W4/00,New Operator Ltd.`;

    const dialog = await openImport(page);
    await pick(dialog, { name: download.suggestedFilename(), mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
    await expect(dialog.getByText(/Not recognised/)).toContainText('Risk Index');
    await dialog.getByRole('button', { name: 'Review rows' }).click();
    await expect(dialog.getByText('1 to create · 5 to update · 0 with errors (skipped)')).toBeVisible();
    await expect(dialog.getByRole('table', { name: 'Validation report' }).getByText('No changes')).toHaveCount(5);
    await dialog.getByRole('button', { name: 'Import 6 wells' }).click();
    const result = dialog.getByRole('region', { name: 'Import result' });
    await expect(result).toContainText('1 created, 5 updated');
    await expect(result).toContainText('0 drafts saved');
    const wells = await storeWells(page, FIXTURE_PROJECT_ID);
    expect(wells).toHaveLength(6);
    expect(wells.every((w) => w.draft === null)).toBe(true);
  });
});

test('import a v2 wells.json array into the active project → wells appear under that project with "Legacy v2 format — migrated"', async ({
  page,
}) => {
  const projectId = await seedEmptyProject(page, 'V2 Target AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  await pick(dialog, V2_WELLS_JSON);
  await expect(dialog.getByText('Legacy v2 format — migrated')).toBeVisible();
  await expect(dialog).toContainText('V2 Target AOR');
  await dialog.getByRole('button', { name: 'Import 2 wells' }).click();
  const result = dialog.getByRole('region', { name: 'Import result' });
  await expect(result).toContainText('2 created, 0 updated');
  await expect(result).toContainText('Legacy v2 format — migrated');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(bodyRows(page)).toHaveCount(2);
  const licences = (await storeWells(page, projectId)).map((w) => w.licence).sort();
  expect(licences).toEqual(['100/10-14-054-23W4/00', '102/03-22-054-23W4/00']);
  const projects = await page.evaluate(() => window.__lwa!.store.projects.list());
  expect(projects.map((p) => p.name)).toEqual(['V2 Target AOR']);
});

test('a v2 wells.json keeps the name and TD of a well the project already has, even when the v2 record is newer', async ({
  page,
}) => {
  const projectId = await seedEmptyProject(page, 'Cutover AOR');
  const licence = '100/10-14-054-23W4/00';
  await page.evaluate(
    async ({ pid, lic }) => {
      await window.__lwa!.store.wells.create(pid, { licence: lic, name: 'NAMED IN V3', td_m: 1234.5, operator: 'v3 operator' });
    },
    { pid: projectId, lic: licence },
  );
  await page.goto('/wells');
  const v2 = JSON.parse(readFileSync(V2_WELLS_JSON, 'utf8')) as Record<string, unknown>[];
  v2[0] = { ...v2[0], updatedAt: '2030-01-01T00:00:00.000Z' };
  const dialog = await openImport(page);
  await pick(dialog, { name: 'wells.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v2)) });
  await dialog.getByRole('button', { name: 'Import 2 wells' }).click();
  await expect(dialog.getByRole('region', { name: 'Import result' })).toContainText('1 created, 1 updated');

  const well = await page.evaluate(
    async ({ pid, lic }) => (await window.__lwa!.store.wells.list(pid)).find((w) => w.licence === lic) ?? null,
    { pid: projectId, lic: licence },
  );
  // The newer v2 record wins where it has a value; what only v3 knows is kept.
  expect(well).toMatchObject({ name: 'NAMED IN V3', td_m: 1234.5, operator: 'Legacy Oil Co.' });
});

test('a project file of another project imports as that project, which becomes active', async ({ page }) => {
  await seedEmptyProject(page, 'Starting AOR');
  await page.goto('/wells');
  const dialog = await openImport(page);
  await pick(dialog, path.join(__dirname, 'fixtures', 'fort-sask.project.json'));
  await expect(dialog).toContainText('This file holds another project: Fort Saskatchewan / Wabamun Hub AOR');
  await dialog.getByRole('button', { name: 'Import 5 wells' }).click();
  await expect(dialog.getByRole('region', { name: 'Import result' })).toContainText(
    'Fort Saskatchewan / Wabamun Hub AOR is now the active project.',
  );
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(bodyRows(page)).toHaveCount(5);
});
