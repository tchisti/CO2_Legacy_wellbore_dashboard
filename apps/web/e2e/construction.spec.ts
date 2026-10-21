import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { WellInput } from '@lwa/engine';
import { FIXTURE_PROJECT_ID, seedFixture } from './helpers';

// The Construction tab (spec §4.3; schematic spec 2026-08-07 §5–§8): the wellbore schematic with
// its toolbar and statistics beside the rows editor, a pasted report parsed into rows, and the
// working copy saved or discarded as a whole.

/** 100/07-21-055-22W4/00: no construction record, td_m 1463.3. */
const FT_SASK = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' };
const PLUG_REPORT = 'Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2';

/** A stored record with one of each common row, for the save/discard tests. */
const STORED: WellInput['construction'] = {
  td: 1500,
  kbElev: 800,
  casings: [{ name: 'Surface Casing', od_mm: 219, grade: 'J55', top_m: 0, shoe_m: 186, toc_m: 0, source: 'manual' }],
  plugs: [{ n: 1, kind: 'cement', top_m: 1400, bottom_m: 1450, sacks: 25, source: 'parsed', verbatim: '1400–1450 m' }],
  formations: [{ name: 'Nisku', top_m: 1100 }],
};

const schematic = (page: Page) => page.getByRole('group', { name: 'Wellbore schematic' });
const svg = (page: Page) => schematic(page).locator('svg');
const stats = (page: Page) => page.getByRole('region', { name: 'Statistics' });
const stat = (page: Page, key: string) => stats(page).locator(`[data-stat="${key}"]`);
const section = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true });
const dataRows = (page: Page, title: string) => section(page, title).locator('tbody[data-row]');
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save construction' });
const unsaved = (page: Page) => page.getByText('Unsaved changes', { exact: true });
const historyRows = (page: Page) => page.getByRole('table', { name: 'History' }).locator('tbody tr');

async function openConstruction(page: Page, id: string): Promise<void> {
  await page.goto(`/wells/view?id=${id}&tab=construction`);
  await expect(page.getByRole('tab', { name: 'Construction' })).toHaveAttribute('aria-selected', 'true');
}

async function pasteReport(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'Paste report' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Paste a report' });
  await dialog.getByLabel('Abandonment or casing report').fill(text);
  await dialog.getByRole('button', { name: 'Parse into rows' }).click();
  await expect(dialog).toBeHidden();
}

/** Stores a construction record on a well through the page's store. */
async function storeConstruction(page: Page, id: string, construction: WellInput['construction']): Promise<void> {
  await page.evaluate(
    async ({ wellId, record }) => {
      await window.__lwa!.store.wells.update(wellId, { construction: record });
    },
    { wellId: id, record: construction },
  );
}

async function addWell(page: Page, input: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    async ({ projectId, well }) => (await window.__lwa!.store.wells.create(projectId, { licence: '', ...well })).id,
    { projectId: FIXTURE_PROJECT_ID, well: input },
  );
}

const CONFLICT = 'The saved record changed after these edits were made. Saving replaces it.';
const sectionsNav = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const discardDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Discard unsaved construction changes?' });

async function viewBox(locator: Locator): Promise<string | null> {
  return locator.getAttribute('viewBox');
}

test.describe('construction tab', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('empty state: "No construction records" with Paste report and Add rows actions', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await expect(page.getByRole('heading', { name: 'No construction records' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paste report' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add rows' })).toBeVisible();
    await expect(schematic(page)).toHaveCount(0);

    // Add rows opens the empty editor; with nothing entered there is nothing to save.
    await page.getByRole('button', { name: 'Add rows' }).click();
    await expect(page.getByLabel('TD (m)')).toHaveValue('');
    await expect(page.getByLabel('TD (m)')).toHaveAttribute('placeholder', '1463.3');
    await expect(saveButton(page)).toBeDisabled();
    await expect(unsaved(page)).toHaveCount(0);
  });

  test('paste the three-line Plug #1 report → 1 plug row, warning count shown, schematic renders a plug (data-kind="plug")', async ({
    page,
  }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);

    const result = page.getByRole('status', { name: 'Parse result' });
    await expect(result).toContainText('1 row added · 0 lines not understood');
    await expect(result.getByText('Parser messages (4)')).toBeVisible(); // nothing hidden: every message is listed

    await expect(dataRows(page, 'Plugs')).toHaveCount(1);
    const plug = dataRows(page, 'Plugs').first();
    await expect(plug.getByLabel('Plug #1 (row 1): Plug number')).toHaveValue('1');
    await expect(plug.getByLabel('Plug #1 (row 1): Top (m)')).toHaveValue('1448');
    await expect(plug.getByLabel('Plug #1 (row 1): Bottom (m)')).toHaveValue('1463');
    await expect(plug.getByLabel('Plug #1 (row 1): Sacks')).toHaveValue('25');
    await expect(plug.getByLabel('Plug #1 (row 1): Additives')).toHaveValue('2% CaCl2');
    await expect(plug.locator('[data-source]')).toHaveText('Parsed');
    await expect(plug.locator('[data-verbatim]')).toContainText('1463–1448 m');
    await expect(page.getByLabel('TD (m)')).toHaveValue('1463.3'); // from the well record

    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(1);
    await expect(unsaved(page)).toBeVisible(); // parsed into the working copy, not saved
    await expect(saveButton(page)).toBeEnabled();

    // A report with lines nobody could read lists them, so they can be added by hand.
    await pasteReport(page, 'garbled unparseable text\nPlug #2 set with 30 sacks');
    await expect(result).toContainText('1 row added · 2 lines not understood');
    await expect(result.getByRole('listitem')).toHaveText(['garbled unparseable text', 'Plug #2 set with 30 sacks']);
    await expect(dataRows(page, 'Plugs')).toHaveCount(1); // the first paste's plug is kept
    await expect(dataRows(page, 'Notes')).toHaveCount(1); // the unreadable line is kept as a note
  });

  test('unit toggle ft relabels axis "Depth (ft)" without changing the viewBox', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);
    await expect(svg(page)).toContainText('Depth (m)');
    const metres = await viewBox(svg(page));
    expect(metres).toMatch(/^0 0 \d+ \d+$/);

    const unit = page.getByRole('group', { name: 'Depth unit' });
    await unit.getByRole('button', { name: 'ft', exact: true }).click();
    await expect(unit.getByRole('button', { name: 'ft', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(svg(page)).toContainText('Depth (ft)');
    expect(await viewBox(svg(page))).toBe(metres);
    await expect(stat(page, 'td')).toHaveText('4800.9 ft');
    await expect(page.getByLabel('Plug #1 (row 1): Top (m)')).toHaveValue('1448'); // the rows stay in metres
  });

  test('hovering a plug row highlights it in the SVG (stroke-width 2.5)', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);
    const shape = svg(page).locator('[data-id="plug:0"]');
    await expect(shape).not.toHaveAttribute('stroke-width', '2.5');

    await dataRows(page, 'Plugs').first().hover();
    await expect(shape).toHaveAttribute('stroke-width', '2.5');
    await expect(schematic(page).locator('[data-caption]')).toContainText('Plug P1 (cement)');

    // …and the other way: hovering the shape marks its row.
    await page.getByRole('heading', { name: 'Statistics' }).hover();
    await expect(shape).not.toHaveAttribute('stroke-width', '2.5');
    await shape.hover();
    await expect(dataRows(page, 'Plugs').first()).toHaveAttribute('data-highlighted', 'true');

    // Focus does the same from the keyboard.
    await page.getByRole('heading', { name: 'Statistics' }).hover();
    await page.getByLabel('Plug #1 (row 1): Sacks').focus();
    await expect(shape).toHaveAttribute('stroke-width', '2.5');
  });

  test('Export SVG downloads a file named <licence>-schematic.svg', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('100_07-21-055-22W4_00-schematic.svg');
    const text = readFileSync(await download.path(), 'utf8');
    expect(text).toMatch(/^<svg /);
    expect(text).toContain('data-kind="plug"');
    expect(text).not.toContain('var(--');

    await expect(page.getByRole('link', { name: 'Print' })).toHaveAttribute('href', `/report/well?id=${FT_SASK.id}`);
  });

  test('stats card shows TD, plug count, plug coverage %', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);
    await expect(stat(page, 'td')).toHaveText('1463.3 m');
    await expect(stat(page, 'plugs')).toHaveText('1');
    await expect(stat(page, 'coverage')).toHaveText('1.0 %');
    await expect(stat(page, 'deepest')).toHaveText('1463.0 m');
    await expect(stat(page, 'casings')).toHaveText('0');
    await expect(stat(page, 'openHole')).toHaveText('—');
  });

  test('save construction persists after reload and History shows an Updated event', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);
    await saveButton(page).click();
    await expect(page.getByText('Construction saved')).toBeVisible();
    await expect(unsaved(page)).toHaveCount(0);
    await expect(saveButton(page)).toBeDisabled();

    await page.reload();
    await expect(dataRows(page, 'Plugs')).toHaveCount(1);
    await expect(page.getByLabel('Plug #1 (row 1): Top (m)')).toHaveValue('1448');
    await expect(dataRows(page, 'Plugs').first().locator('[data-verbatim]')).toContainText('1463–1448 m');
    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(1);
    const stored = await page.evaluate(async (id) => (await window.__lwa!.store.wells.get(id))!.construction, FT_SASK.id);
    expect(stored).toMatchObject({ td: 1463.3, sourceText: PLUG_REPORT, plugs: [{ n: 1, top_m: 1448, bottom_m: 1463, sacks: 25, source: 'parsed' }] });

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(historyRows(page)).toHaveCount(2);
    const latest = historyRows(page).first();
    await expect(latest.locator('td[data-column="action"]')).toHaveText('Updated');
    await expect(latest.locator('td[data-column="actor"]')).toHaveText('T. Chisti');
    await expect(latest.locator('td[data-column="summary"]')).toHaveText('construction');
  });

  test('discard restores the stored copy', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, STORED);
    await openConstruction(page, FT_SASK.id);
    const top = page.getByLabel('Plug #1 (row 1): Top (m)');
    await expect(top).toHaveValue('1400');
    await expect(unsaved(page)).toHaveCount(0);

    await top.fill('1390');
    await page.getByLabel('Casing 1: Grade').fill('K55');
    await page.getByRole('button', { name: 'Remove formation top 1' }).click();
    await expect(unsaved(page)).toBeVisible();
    await expect(dataRows(page, 'Formation tops')).toHaveCount(0);

    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(top).toHaveValue('1400');
    await expect(page.getByLabel('Casing 1: Grade')).toHaveValue('J55');
    await expect(dataRows(page, 'Formation tops')).toHaveCount(1);
    await expect(unsaved(page)).toHaveCount(0);
    const events = await page.evaluate(
      async (projectId) => (await window.__lwa!.store.audit.list({ projectId })).filter((e) => e.action === 'update').length,
      FIXTURE_PROJECT_ID,
    );
    expect(events).toBe(1); // only the seeding update: discard writes nothing
  });

  test('editing a parsed row marks it Manual and keeps its verbatim', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, STORED);
    await openConstruction(page, FT_SASK.id);
    const plug = dataRows(page, 'Plugs').first();
    await expect(plug.locator('[data-source]')).toHaveText('Parsed');
    await plug.getByLabel('Plug #1 (row 1): Bottom (m)').fill('1455');
    await expect(plug.locator('[data-source]')).toHaveText('Manual');
    await expect(plug.locator('[data-verbatim]')).toContainText('1400–1450 m');

    // A row added by hand is Manual too.
    await section(page, 'Packers').getByRole('button', { name: 'Add row to Packers' }).click();
    const packer = dataRows(page, 'Packers').first();
    await expect(packer.getByLabel('Packer 1: Depth (m)')).toBeFocused();
    await page.keyboard.type('1000');
    await expect(packer.locator('[data-source]')).toHaveText('Manual');
    await expect(svg(page).locator('[data-kind="packer"]')).toHaveCount(1);

    await saveButton(page).click();
    await expect(page.getByText('Construction saved')).toBeVisible();
    const stored = await page.evaluate(async (id) => (await window.__lwa!.store.wells.get(id))!.construction, FT_SASK.id);
    expect(stored!.plugs[0]).toMatchObject({ bottom_m: 1455, source: 'manual', verbatim: '1400–1450 m' });
    expect(stored!.packers).toEqual([{ depth_m: 1000, source: 'manual' }]);
  });

  test('a value that is not a plain decimal is refused on the field and blocks saving', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, STORED);
    await openConstruction(page, FT_SASK.id);
    const top = page.getByLabel('Plug #1 (row 1): Top (m)');
    await top.fill('1400,5');
    await expect(top).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Use digits only, with a point as the decimal separator (for example 1463.5).')).toBeVisible();
    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(0); // not drawn until it reads
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByText('Fix 1 value before saving')).toBeVisible();

    await top.fill('1400.5');
    await expect(top).not.toHaveAttribute('aria-invalid', 'true');
    await expect(saveButton(page)).toBeEnabled();
  });

  test('no TD anywhere shows the add-TD message', async ({ page }) => {
    const id = await addWell(page, { licence: '102/16-30-055-21W4/00', name: 'NO TD 16-30' });
    await openConstruction(page, id);
    await page.getByRole('button', { name: 'Add rows' }).click();
    await expect(page.getByText('Add a total depth to draw the schematic')).toBeVisible();
    await expect(svg(page)).toHaveCount(0);

    await page.getByLabel('TD (m)').fill('900');
    await expect(page.getByText('Add a total depth to draw the schematic')).toHaveCount(0);
    await expect(svg(page)).toBeVisible();
    await expect(stat(page, 'td')).toHaveText('900.0 m');
  });

  test('leaving with unsaved changes asks first: another tab, a reload', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);

    await page.getByRole('tab', { name: 'History' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Discard unsaved construction changes?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Construction' })).toHaveAttribute('aria-selected', 'true');
    await expect(dataRows(page, 'Plugs')).toHaveCount(1);

    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toEqual(['beforeunload']);
    expect(page.isClosed()).toBe(false);

    await page.getByRole('tab', { name: 'History' }).click();
    await confirm.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Construction' }).click();
    await expect(page.getByRole('heading', { name: 'No construction records' })).toBeVisible(); // nothing was saved
  });

  test('Show schematic in the score sheet renders the saved construction', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, STORED);
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await page.getByRole('region', { name: 'Well summary' }).getByRole('link', { name: 'Re-assess', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: `Score ${FT_SASK.licence}` });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Wellbore schematic' })).toHaveCount(0);

    const toggle = sheet.getByRole('button', { name: 'Show schematic' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const drawn = sheet.getByRole('group', { name: 'Wellbore schematic' }).locator('svg');
    await expect(drawn.locator('[data-kind="plug"]')).toHaveCount(1);
    await expect(drawn.locator('[data-kind="casing"]')).toHaveCount(1);
    await expect(drawn).toContainText('Depth (m)');
    await expect(sheet.locator('[data-param]')).toHaveCount(11); // the scoring rows are still there
    const box = await sheet.boundingBox();
    expect(box!.width).toBe(page.viewportSize()!.width); // the full viewport

    await toggle.click();
    await expect(sheet.getByRole('group', { name: 'Wellbore schematic' })).toHaveCount(0);
  });

  test('a well with no construction and no TD offers no schematic in the score sheet', async ({ page }) => {
    const id = await addWell(page, { licence: '102/16-30-055-21W4/00', name: 'NO TD 16-30' });
    await page.goto(`/wells/view?id=${id}&score=1`);
    const sheet = page.getByRole('dialog', { name: 'Score 102/16-30-055-21W4/00' });
    const toggle = sheet.getByRole('button', { name: 'Show schematic' });
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await toggle.focus();
    await expect(page.getByRole('tooltip')).toHaveText('No construction records yet');
    await toggle.click({ force: true });
    await expect(sheet.getByRole('group', { name: 'Wellbore schematic' })).toHaveCount(0);
  });
  test('the header Re-assess link keeps the Construction tab and its unsaved rows', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);
    await page.getByRole('region', { name: 'Well summary' }).getByRole('link', { name: 'Re-assess', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: `Score ${FT_SASK.licence}` });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/[?&]tab=construction(&|$)/);
    await expect(discardDialog(page)).toHaveCount(0); // staying on the tab is not leaving it
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Construction' })).toHaveAttribute('aria-selected', 'true');
    await expect(dataRows(page, 'Plugs')).toHaveCount(1);
    await expect(unsaved(page)).toBeVisible();
  });

  test('a link out of the page with unsaved changes asks first: Keep editing stays, Discard changes goes', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await pasteReport(page, PLUG_REPORT);

    await sectionsNav(page).getByRole('link', { name: 'Wells' }).click();
    await expect(discardDialog(page)).toBeVisible();
    await discardDialog(page).getByRole('button', { name: 'Keep editing' }).click();
    await expect(discardDialog(page)).toBeHidden();
    await expect(page).toHaveURL(/[?&]tab=construction(&|$)/);
    await expect(dataRows(page, 'Plugs')).toHaveCount(1);
    await expect(unsaved(page)).toBeVisible();

    await page.getByRole('link', { name: 'Wells' }).first().click(); // "← Wells" or the nav: both are guarded
    await discardDialog(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page).toHaveURL(/\/wells$/);

    // Discarded means gone: nothing is offered back on the next visit.
    await openConstruction(page, FT_SASK.id);
    await expect(page.getByRole('heading', { name: 'No construction records' })).toBeVisible();
    await expect(page.getByText('Unsaved construction changes were restored')).toHaveCount(0);
  });

  test('with nothing unsaved, links leave without asking', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, STORED);
    await openConstruction(page, FT_SASK.id);
    await expect(dataRows(page, 'Plugs')).toHaveCount(1);
    await sectionsNav(page).getByRole('link', { name: 'Wells' }).click();
    await expect(page).toHaveURL(/\/wells$/);
    await expect(discardDialog(page)).toHaveCount(0);
  });

  test('leaving by the browser Back button keeps the working copy: Forward offers it back, restored and unsaved', async ({ page }) => {
    await page.goto('/wells');
    await page.locator('tbody tr').filter({ hasText: FT_SASK.licence }).locator('td[data-column="name"]').click();
    await expect(page).toHaveURL(new RegExp(`/wells/view\\?id=${FT_SASK.id}$`));
    await page.getByRole('tab', { name: 'Construction' }).click();
    await expect(page).toHaveURL(/[?&]tab=construction(&|$)/);
    await pasteReport(page, PLUG_REPORT);
    await page.getByLabel('Plug #1 (row 1): Sacks').fill('30');

    await page.goBack();
    await expect(page).toHaveURL(/\/wells$/);
    await page.goForward();
    await expect(page.getByText('Unsaved construction changes were restored')).toBeVisible();
    await expect(page.getByText(CONFLICT)).toHaveCount(0); // made from the record still saved: no warning
    await expect(page.getByRole('button', { name: 'Save anyway' })).toHaveCount(0);
    await expect(page.getByLabel('Plug #1 (row 1): Sacks')).toHaveValue('30');
    await expect(dataRows(page, 'Plugs').first().locator('[data-verbatim]')).toContainText('1463–1448 m');
    await expect(unsaved(page)).toBeVisible();
    const stored = await page.evaluate(async (id) => (await window.__lwa!.store.wells.get(id))!.construction, FT_SASK.id);
    expect(stored).toBeNull(); // never written into the record

    // The banner's Save saves it and the banner goes.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Construction saved')).toBeVisible();
    await expect(page.getByText('Unsaved construction changes were restored')).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Plug #1 (row 1): Sacks')).toHaveValue('30');
    await expect(page.getByText('Unsaved construction changes were restored')).toHaveCount(0);
  });

  test('a restored copy can be discarded from its banner', async ({ page }) => {
    await page.goto('/wells');
    await page.locator('tbody tr').filter({ hasText: FT_SASK.licence }).locator('td[data-column="name"]').click();
    await page.getByRole('tab', { name: 'Construction' }).click();
    await expect(page).toHaveURL(/[?&]tab=construction(&|$)/); // the tab's URL write lands before Back
    await pasteReport(page, PLUG_REPORT);
    await page.goBack();
    await expect(page).toHaveURL(/\/wells$/);
    await page.goForward();
    await expect(page.getByText('Unsaved construction changes were restored')).toBeVisible();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No construction records' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'No construction records' })).toBeVisible();
  });

  test('an inverted interval is refused until swapped; a depth below TD is only a warning', async ({ page }) => {
    await openConstruction(page, FT_SASK.id);
    await page.getByRole('button', { name: 'Add rows' }).click();
    await section(page, 'Plugs').getByRole('button', { name: 'Add row to Plugs' }).click();
    // A row added by hand has no plug number yet: its fields are named by its row alone.
    await page.getByLabel('Plug (row 1): Top (m)').fill('1463');
    await page.getByLabel('Plug (row 1): Bottom (m)').fill('1448');
    await expect(page.getByText('Top (m) is deeper than Bottom (m).')).toBeVisible();
    await expect(page.getByLabel('Plug (row 1): Top (m)')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Plug (row 1): Bottom (m)')).toHaveAttribute('aria-invalid', 'true');
    await expect(saveButton(page)).toBeDisabled();
    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(0);
    await expect(stat(page, 'longest')).toHaveText('—'); // never a negative length

    await dataRows(page, 'Plugs').first().getByRole('button', { name: 'Swap top and bottom' }).click();
    await expect(page.getByLabel('Plug (row 1): Top (m)')).toHaveValue('1448');
    await expect(page.getByLabel('Plug (row 1): Bottom (m)')).toHaveValue('1463');
    await expect(page.getByText('Top (m) is deeper than Bottom (m).')).toHaveCount(0);
    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(1);

    await page.getByLabel('Plug (row 1): Bottom (m)').fill('1500');
    await expect(dataRows(page, 'Plugs').first()).toContainText('Bottom (m) is below TD (1463.3 m).');
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();
    await expect(page.getByText('Construction saved')).toBeVisible();
    const stored = await page.evaluate(async (id) => (await window.__lwa!.store.wells.get(id))!.construction, FT_SASK.id);
    expect(stored!.plugs).toEqual([{ top_m: 1448, bottom_m: 1500, source: 'manual' }]);
  });

  test('dark theme: packers are drawn in the ink colour, and Export SVG still uses the light palette', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, { ...STORED, packers: [{ depth_m: 1000 }] });
    await page.evaluate(() => localStorage.setItem('lwa.theme', 'dark'));
    await openConstruction(page, FT_SASK.id);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    const fills = await svg(page)
      .locator('[data-kind="packer"] polygon')
      .first()
      .evaluate((el) => ({
        packer: getComputedStyle(el).fill,
        surface: getComputedStyle(document.body).getPropertyValue('--surface').trim(),
      }));
    expect(fills.packer).toBe('rgb(229, 232, 236)'); // --ink in the dark theme
    expect(fills.surface).toBe('#16191d');

    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export SVG' }).click();
    const text = readFileSync(await (await downloading).path(), 'utf8');
    expect(text).toMatch(/^<svg [^>]*><rect width="100%" height="100%" fill="#ffffff"\/>/);
    expect(text).toContain('fill="#15191e"');
    expect(text).not.toContain('#16191d');
    expect(text).not.toContain('var(--');
  });
  test('a restored copy made from an older saved record warns before replacing the newer one', async ({ page }) => {
    await page.goto('/wells');
    await page.locator('tbody tr').filter({ hasText: FT_SASK.licence }).locator('td[data-column="name"]').click();
    await page.getByRole('tab', { name: 'Construction' }).click();
    await expect(page).toHaveURL(/[?&]tab=construction(&|$)/);
    await pasteReport(page, PLUG_REPORT);
    await page.goBack();
    await expect(page).toHaveURL(/\/wells$/);
    // Meanwhile the saved record changes (as an import or another tab would).
    await storeConstruction(page, FT_SASK.id, STORED);

    await page.goForward();
    await expect(page.getByText(CONFLICT)).toBeVisible();
    await expect(page.locator('[data-restored="conflict"]')).toBeVisible();
    await expect(page.getByLabel('Plug #1 (row 1): Top (m)')).toHaveValue('1448'); // the copy, not the newer record
    await expect(dataRows(page, 'Casings')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save anyway' })).not.toBeFocused();

    await page.getByRole('button', { name: 'Save anyway' }).click();
    await expect(page.getByText('Construction saved')).toBeVisible();
    await expect(page.getByText(CONFLICT)).toHaveCount(0);
    const stored = await page.evaluate(async (id) => (await window.__lwa!.store.wells.get(id))!.construction, FT_SASK.id);
    expect(stored).toMatchObject({ td: 1463.3, sourceText: PLUG_REPORT, plugs: [{ n: 1, top_m: 1448, bottom_m: 1463, sacks: 25 }] });
    expect(stored!.casings).toEqual([]);
  });

  test('a stored inverted plug opens without unsaved changes, blocks Save, and is fixed by Swap', async ({ page }) => {
    await storeConstruction(page, FT_SASK.id, {
      td: 1500,
      plugs: [{ n: 1, kind: 'cement', top_m: 1463, bottom_m: 1448, source: 'extractor', verbatim: 'Plug #1 (row 1): 1463/1448 m' }],
    });
    await openConstruction(page, FT_SASK.id);
    await expect(page.getByText('Top (m) is deeper than Bottom (m).')).toBeVisible();
    await expect(unsaved(page)).toHaveCount(0);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(0);

    await dataRows(page, 'Plugs').first().getByRole('button', { name: 'Swap top and bottom' }).click();
    await expect(unsaved(page)).toBeVisible();
    await expect(saveButton(page)).toBeEnabled();
    await expect(dataRows(page, 'Plugs').first().locator('[data-source]')).toHaveText('Manual');
    await expect(svg(page).locator('[data-kind="plug"]')).toHaveCount(1);
    await saveButton(page).click();
    await expect(page.getByText('Construction saved')).toBeVisible();
    const stored = await page.evaluate(async (id) => (await window.__lwa!.store.wells.get(id))!.construction, FT_SASK.id);
    expect(stored!.plugs[0]).toMatchObject({ top_m: 1448, bottom_m: 1463, source: 'manual', verbatim: 'Plug #1 (row 1): 1463/1448 m' });
  });
});
