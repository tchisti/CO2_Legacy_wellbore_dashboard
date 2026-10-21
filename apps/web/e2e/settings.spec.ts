import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { FIXTURE_PATH, FIXTURE_PROJECT_ID, PROFILE, seedEmptyProject, seedFixture } from './helpers';

// Project settings (spec §4.7, §6.1, §9): the project's details, injectors, formation column,
// reviewer profile, backup (export/import) and danger zone.

const FIXTURE_NAME = 'Fort Saskatchewan / Wabamun Hub AOR';
const FILE_NAME = /^fort-saskatchewan-wabamun-hub-aor-\d{4}-\d{2}-\d{2}\.lwa\.json$/;

const section = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const injectors = (page: Page) => section(page, 'Injectors');
const formations = (page: Page) => section(page, 'Formation column');
const backup = (page: Page) => section(page, 'Backup');
const danger = (page: Page) => section(page, 'Danger zone');
const importButton = (page: Page) => backup(page).getByRole('button', { name: 'Import', exact: true });
const importResult = (page: Page) => backup(page).getByRole('region', { name: 'Import result' });

/** The formation names, top to bottom, as the editor shows them. */
const formationNames = (page: Page) =>
  formations(page)
    .locator('input[data-field="name"]')
    .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value));

/** Clicks Export project and returns the download. */
async function exportProject(page: Page): Promise<Download> {
  const downloading = page.waitForEvent('download');
  await backup(page).getByRole('button', { name: 'Export project' }).click();
  return downloading;
}

/** The download as a file to hand to an input (with its own name, not the temporary path's). */
async function asUpload(download: Download) {
  return {
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: readFileSync(await download.path()),
  };
}

/** Opens the well page and the score flow from the header's Score button. */
async function openScore(page: Page, id: string, licence: string): Promise<Locator> {
  await page.goto(`/wells/view?id=${id}`);
  await page.getByRole('region', { name: 'Well summary' }).getByRole('link', { name: 'Score', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: `Score ${licence}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The store's counts for a project, read through the page's own store. */
async function storeCounts(page: Page, projectId: string) {
  return page.evaluate(async (pid) => {
    const { store } = window.__lwa!;
    const wells = await store.wells.list(pid);
    const assessments = (await Promise.all(wells.map((w) => store.assessments.listForWell(w.id)))).flat();
    const events = await store.audit.list({ projectId: pid });
    return { wells: wells.length, assessments: assessments.length, events: events.length };
  }, projectId);
}

test('add an injector and a formation; the Score flow plume chip now appears for a well of the project', async ({
  page,
}) => {
  // The fixture project already has injectors, so this starts from a fresh project.
  const projectId = await seedEmptyProject(page, 'Plume Test AOR');
  const licence = '100/08-19-055-22W4/00';
  const wellId = await page.evaluate(
    async ({ pid, lic }) =>
      (await window.__lwa!.store.wells.create(pid, { licence: lic, lat: 53.76, lon: -113.25, classification: 'Type 3' })).id,
    { pid: projectId, lic: licence },
  );

  let sheet = await openScore(page, wellId, licence);
  let plume = sheet.locator('[data-param="plume"]');
  await expect(plume).toContainText('Nearest injector: —');
  await expect(plume.getByRole('button', { name: /^Suggested/ })).toHaveCount(0);

  await page.goto('/settings');
  await expect(injectors(page)).toContainText('No injectors yet');
  await injectors(page).getByRole('button', { name: 'Add injector' }).click();
  await expect(injectors(page).getByLabel('Injector 1 name')).toBeFocused();
  await injectors(page).getByLabel('Injector 1 name').fill('Birch (proposed)');
  await injectors(page).getByLabel('Injector 1 latitude').fill('53.7637');
  await injectors(page).getByLabel('Injector 1 longitude').fill('-113.2491');
  await expect(injectors(page).getByLabel('Injector 1 AoR radius (m)')).toHaveValue('5000');
  await injectors(page).getByRole('button', { name: 'Save injectors' }).click();
  await expect(page.getByText('Injectors saved')).toBeVisible();

  await formations(page).getByRole('button', { name: 'Add formation' }).click();
  await formations(page).getByLabel('Formation 1 name').fill('Nisku');
  await formations(page).getByLabel('Formation 1 top (m)').fill('1080');
  await formations(page).getByLabel('Formation 1 base (m)').fill('1160');
  await formations(page).getByRole('combobox', { name: 'Formation 1 role' }).click();
  await page.getByRole('option', { name: 'Reservoir' }).click();
  await formations(page).getByRole('button', { name: 'Save formation column' }).click();
  await expect(page.getByText('Formation column saved')).toBeVisible();

  const project = await page.evaluate((pid) => window.__lwa!.store.projects.get(pid), projectId);
  expect(project?.injectors).toEqual([
    { id: expect.stringMatching(/^inj_/), name: 'Birch (proposed)', lat: 53.7637, lon: -113.2491, aorRadius_m: 5000 },
  ]);
  expect(project?.formations).toEqual([
    { id: expect.stringMatching(/^fm_/), name: 'Nisku', top_m: 1080, base_m: 1160, role: 'reservoir', order: 0 },
  ]);

  sheet = await openScore(page, wellId, licence);
  plume = sheet.locator('[data-param="plume"]');
  await expect(plume).toContainText('Nearest injector: Birch (proposed) · 0.4 km (inside the AoR)');
  await expect(
    plume.getByRole('button', { name: 'Suggested 5 · from 0.4 km to Birch (proposed), inside the AoR', exact: true }),
  ).toBeVisible();
});

test.describe('with the Fort Saskatchewan fixture', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Project settings' })).toBeVisible();
  });

  test('the page shows the project details, injectors, formations, reviewer profile, backup and danger zone', async ({
    page,
  }) => {
    for (const name of ['Project', 'Injectors', 'Formation column', 'Reviewer profile', 'Backup', 'Danger zone']) {
      await expect(section(page, name)).toBeVisible();
    }
    await expect(section(page, 'Project').getByLabel('Project name')).toHaveValue(FIXTURE_NAME);
    await expect(section(page, 'Project').getByRole('combobox', { name: 'Jurisdiction' })).toHaveText('AER');
    await expect(injectors(page).getByLabel('Injector 2 name')).toHaveValue('Oak (proposed)');
    await expect(injectors(page).getByLabel('Injector 2 latitude')).toHaveValue('53.774499');
    await expect(formationNames(page)).resolves.toHaveLength(9);
    await expect(section(page, 'Reviewer profile')).toContainText(PROFILE.name);
    await expect(section(page, 'Reviewer profile')).toContainText(PROFILE.initials);
    // The in-page links reach every section.
    await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Danger zone' }).click();
    await expect(page).toHaveURL(/#danger-zone$/);
  });

  test('project details: rename and change the jurisdiction', async ({ page }) => {
    const details = section(page, 'Project');
    await details.getByLabel('Project name').fill('   ');
    await details.getByRole('button', { name: 'Save project details' }).click();
    await expect(details.getByText('Enter a project name.')).toBeVisible();

    await details.getByLabel('Project name').fill('Fort Sask AOR');
    await details.getByRole('combobox', { name: 'Jurisdiction' }).click();
    await page.getByRole('option', { name: 'AER + EPA' }).click();
    await details.getByLabel('Description').fill('Wabamun hub, phase 1 review.');
    await details.getByRole('button', { name: 'Save project details' }).click();
    await expect(page.getByText('Project details saved')).toBeVisible();
    await expect(page.getByRole('button', { name: /Fort Sask AOR/ })).toBeVisible(); // the project switcher

    const project = await page.evaluate((pid) => window.__lwa!.store.projects.get(pid), FIXTURE_PROJECT_ID);
    expect(project).toMatchObject({ name: 'Fort Sask AOR', jurisdiction: 'both', description: 'Wabamun hub, phase 1 review.' });
  });

  test('reviewer profile: Edit profile changes the name shown', async ({ page }) => {
    const profile = section(page, 'Reviewer profile');
    await profile.getByRole('button', { name: 'Edit profile' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit profile' });
    await dialog.getByLabel('Your name').fill('Tahir Chisti');
    await dialog.getByRole('button', { name: 'Save profile' }).click();
    await expect(dialog).toBeHidden();
    await expect(profile).toContainText('Tahir Chisti');
  });

  test('invalid injector latitude shows an inline error and Save is blocked', async ({ page }) => {
    const before = await page.evaluate((pid) => window.__lwa!.store.projects.get(pid), FIXTURE_PROJECT_ID);
    const lat = injectors(page).getByLabel('Injector 1 latitude');
    await expect(lat).toHaveValue('53.788997');

    await lat.fill('91');
    await expect(injectors(page).getByText('Latitude must be from −90 to 90.')).toBeVisible();
    await expect(lat).toHaveAttribute('aria-invalid', 'true');
    await lat.fill('0x35');
    await expect(injectors(page).getByText(/with a point \(\.\) as the decimal separator/)).toBeVisible();

    await injectors(page).getByRole('button', { name: 'Save injectors' }).click();
    await expect(injectors(page).getByRole('alert')).toHaveText('Fix the highlighted field before saving.');
    await expect(lat).toBeFocused();
    await expect(page.getByText('Injectors saved')).toHaveCount(0);
    const after = await page.evaluate((pid) => window.__lwa!.store.projects.get(pid), FIXTURE_PROJECT_ID);
    expect(after).toEqual(before);

    await injectors(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(lat).toHaveValue('53.788997');
    await expect(injectors(page).getByRole('alert')).toHaveCount(0);
  });

  test('remove an injector and save', async ({ page }) => {
    await injectors(page).getByRole('button', { name: 'Remove Cedar (proposed)' }).click();
    await injectors(page).getByRole('button', { name: 'Save injectors' }).click();
    await expect(page.getByText('Injectors saved')).toBeVisible();
    const project = await page.evaluate((pid) => window.__lwa!.store.projects.get(pid), FIXTURE_PROJECT_ID);
    expect(project?.injectors.map((i) => i.id)).toEqual(['INJ-PINE', 'INJ-OAK']);
  });

  test('formation Move up reorders and persists', async ({ page }) => {
    await expect(formations(page).getByRole('button', { name: 'Move Lea Park up' })).toBeDisabled();
    await expect(formations(page).getByRole('button', { name: 'Move Cooking Lake down' })).toBeDisabled();

    await formations(page).getByRole('button', { name: 'Move Calmar (seal) up' }).click();
    expect((await formationNames(page)).slice(3, 7)).toEqual(['Mannville Grp', 'Calmar (seal)', 'Wabamun', 'Nisku (reservoir)']);
    // Focus follows the row, so the button can be pressed again.
    await expect(formations(page).getByRole('button', { name: 'Move Calmar (seal) up' })).toBeFocused();

    await formations(page).getByRole('button', { name: 'Save formation column' }).click();
    await expect(page.getByText('Formation column saved')).toBeVisible();

    await page.reload();
    await expect(formations(page).getByLabel('Formation 5 name')).toHaveValue('Calmar (seal)');
    expect((await formationNames(page)).slice(3, 7)).toEqual(['Mannville Grp', 'Calmar (seal)', 'Wabamun', 'Nisku (reservoir)']);
    const project = await page.evaluate((pid) => window.__lwa!.store.projects.get(pid), FIXTURE_PROJECT_ID);
    const order = Object.fromEntries((project?.formations ?? []).map((f) => [f.id, f.order]));
    expect(order).toMatchObject({ 'fm-mannville': 3, 'fm-calmar': 4, 'fm-wabamun': 5, 'fm-nisku': 6 });

    // Moved to the top, its Move up is disabled, so focus goes to its Move down.
    await formations(page).getByRole('button', { name: 'Move Colorado Grp up' }).click();
    expect((await formationNames(page)).slice(0, 2)).toEqual(['Colorado Grp', 'Lea Park']);
    await expect(formations(page).getByRole('button', { name: 'Move Colorado Grp up' })).toBeDisabled();
    await expect(formations(page).getByRole('button', { name: 'Move Colorado Grp down' })).toBeFocused();
  });

  test('a formation whose base is above its top shows an inline error', async ({ page }) => {
    await formations(page).getByLabel('Formation 1 base (m)').fill('100');
    await expect(formations(page).getByText('The base must be as deep as the top or deeper.')).toBeVisible();
    await formations(page).getByRole('button', { name: 'Save formation column' }).click();
    await expect(formations(page).getByRole('alert')).toHaveText('Fix the highlighted field before saving.');
  });

  test('export downloads a .lwa.json; import it in merge mode → "0 created, 5 updated"', async ({ page }) => {
    const download = await exportProject(page);
    expect(download.suggestedFilename()).toMatch(FILE_NAME);
    const data = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
      format: string;
      exportedAt: string;
      wells: unknown[];
    };
    expect(data.format).toBe('lwa-project');
    expect(data.wells).toHaveLength(5);
    expect(download.suggestedFilename()).toContain(data.exportedAt.slice(0, 10));

    await backup(page).getByLabel('Import project file').setInputFiles(await asUpload(download));
    await expect(backup(page)).toContainText(download.suggestedFilename());
    await expect(backup(page).getByRole('radio', { name: /^Merge/ })).toBeChecked();
    await expect(backup(page)).not.toContainText('This file holds another project');
    await importButton(page).click();

    await expect(importResult(page)).toContainText('0 created, 5 updated');
    await expect(importResult(page)).toContainText('0 assessments and 0 history events added');
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: '0 created, 5 updated' })).toBeVisible();
  });

  test('replace mode requires typing the project name', async ({ page }) => {
    // A well the file does not have: Replace deletes it.
    await page.evaluate(
      (pid) => window.__lwa!.store.wells.create(pid, { licence: '102/16-30-055-21W4/00' }),
      FIXTURE_PROJECT_ID,
    );
    await backup(page).getByLabel('Import project file').setInputFiles(FIXTURE_PATH);
    await expect(importButton(page)).toBeEnabled(); // merge needs no confirmation

    await backup(page).getByRole('radio', { name: /^Replace/ }).check();
    await expect(backup(page).locator('[data-replace-preview]')).toHaveText('1 well will be deleted.');
    await expect(importButton(page)).toBeDisabled();
    const typed = backup(page).getByLabel('Type the project name to confirm');
    await typed.fill('Fort Saskatchewan');
    await expect(importButton(page)).toBeDisabled();
    await typed.fill(FIXTURE_NAME.toLowerCase());
    await expect(importButton(page)).toBeDisabled();
    await typed.fill(FIXTURE_NAME);
    await expect(importButton(page)).toBeEnabled();

    // Back to merge and to replace again: the confirmation starts over.
    await backup(page).getByRole('radio', { name: /^Merge/ }).check();
    await expect(typed).toBeHidden();
    await backup(page).getByRole('radio', { name: /^Replace/ }).check();
    await expect(importButton(page)).toBeDisabled();
    await typed.fill(FIXTURE_NAME);
    await importButton(page).click();

    await expect(importResult(page)).toContainText('0 created, 5 updated, 1 deleted');
    await expect(importResult(page)).toContainText('0 assessments and 0 history events added, 0 assessments deleted');
    expect((await storeCounts(page, FIXTURE_PROJECT_ID)).wells).toBe(5);
  });

  test('replace discloses a final assessment it deletes: one finalised after the export, before and after Import', async ({
    page,
  }) => {
    // This browser received the fixture's export, then finalised a re-assessment of one well.
    const WELL_ID = 'wel_v2_W-4A62O7';
    const reassessed = await page.evaluate(async (id) => {
      const { store } = window.__lwa!;
      const draft = await store.assessments.saveDraft(id, {
        scores: {
          plugQuality: 3,
          cement: null,
          barriers: null,
          scvf: null,
          age: null,
          complexity: null,
          data: null,
          penetration: null,
          plume: null,
          usdw: null,
          access: null,
        },
        justifications: { plugQuality: 'Re-assessed after the export.' },
        override: null,
        suggestions: {},
      });
      return (await store.assessments.finalise(draft.id)).id;
    }, WELL_ID);
    const before = await storeCounts(page, FIXTURE_PROJECT_ID);
    expect(before.assessments).toBe(6);

    // Restoring the older file with Replace: the preview names the final before Import is enabled.
    await backup(page).getByLabel('Import project file').setInputFiles(FIXTURE_PATH);
    await backup(page).getByRole('radio', { name: /^Replace/ }).check();
    await expect(backup(page).locator('[data-replace-preview]')).toHaveText(
      '1 assessment (including 1 final assessment) will be deleted.',
    );
    await expect(importButton(page)).toBeDisabled();
    await backup(page).getByLabel('Type the project name to confirm').fill(FIXTURE_NAME);
    await importButton(page).click();

    await expect(importResult(page)).toContainText('0 created, 5 updated, 0 deleted');
    await expect(importResult(page)).toContainText('0 assessments and 0 history events added, 1 assessment deleted');
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: '0 assessments and 0 history events added, 1 assessment deleted' }),
    ).toBeVisible();
    const after = await storeCounts(page, FIXTURE_PROJECT_ID);
    expect(after.assessments).toBe(5);
    const ids = await page.evaluate(
      async (id) => (await window.__lwa!.store.assessments.listForWell(id)).map((a) => a.id),
      WELL_ID,
    );
    expect(ids).not.toContain(reassessed);
  });

  test('replace with a file that holds everything says nothing will be deleted', async ({ page }) => {
    await backup(page).getByLabel('Import project file').setInputFiles(FIXTURE_PATH);
    await backup(page).getByRole('radio', { name: /^Replace/ }).check();
    await expect(backup(page).locator('[data-replace-preview]')).toHaveText('Nothing will be deleted.');
  });

  test('an import file with a broken reference shows the problem list and changes nothing', async ({ page }) => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as { assessments: { id: string; wellId: string }[] };
    const broken = fixture.assessments[0]!;
    broken.wellId = 'wel_missing';
    const before = await storeCounts(page, FIXTURE_PROJECT_ID);

    await backup(page)
      .getByLabel('Import project file')
      .setInputFiles({ name: 'broken.lwa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await importButton(page).click();

    const alert = backup(page).getByRole('alert');
    await expect(alert).toContainText('This file was not imported. Nothing was changed.');
    await expect(alert).toContainText(`assessment ${broken.id} points to well wel_missing, which is not in the file`);
    await expect(importResult(page)).toHaveCount(0);
    expect(await storeCounts(page, FIXTURE_PROJECT_ID)).toEqual(before);
  });

  test('a file that is not a project export is refused before anything else', async ({ page }) => {
    await backup(page)
      .getByLabel('Import project file')
      .setInputFiles({ name: 'wells.json', mimeType: 'application/json', buffer: Buffer.from('[{"licence":"0001"}]') });
    await expect(backup(page).getByRole('alert')).toContainText('Not a Legacy Well Assessment export');
    await expect(importButton(page)).toHaveCount(0);
  });

  test('a file of another project says so, and the import switches to that project', async ({ page }) => {
    const other = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as {
      project: { id: string; name: string };
      wells: { projectId: string }[];
      auditEvents: { projectId: string; id: string }[];
    };
    other.project.id = 'prj_other';
    other.project.name = 'Other AOR';
    for (const w of other.wells) w.projectId = 'prj_other';
    for (const e of other.auditEvents) {
      e.projectId = 'prj_other';
      e.id = `${e.id}_other`;
    }
    await backup(page)
      .getByLabel('Import project file')
      .setInputFiles({ name: 'other.lwa.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) });
    await expect(backup(page)).toContainText('This file holds another project: Other AOR. Importing adds or updates that project.');
    await importButton(page).click();
    await expect(importResult(page)).toContainText('5 created, 0 updated');
    await expect(page.getByRole('button', { name: /Other AOR/ })).toBeVisible(); // now the active project
    await expect(section(page, 'Project').getByLabel('Project name')).toHaveValue('Other AOR');
  });

  test('danger zone delete requires typing the project name and returns to first run', async ({ page }) => {
    await danger(page).getByRole('button', { name: 'Delete project…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete project?' });
    await expect(dialog).toContainText('5 wells');
    const confirm = dialog.getByRole('button', { name: 'Delete project', exact: true });
    await expect(confirm).toBeDisabled();
    const typed = dialog.getByLabel('Type the project name to confirm');
    await typed.fill(FIXTURE_NAME.toLowerCase());
    await expect(confirm).toBeDisabled();
    await typed.fill(`${FIXTURE_NAME} `);
    await expect(confirm).toBeDisabled();
    await typed.fill(FIXTURE_NAME);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByRole('heading', { name: 'Create your first project' })).toBeVisible();
    expect(await page.evaluate(async () => (await window.__lwa!.store.projects.list()).length)).toBe(0);
  });

  test('deleting one of two projects switches to the one that remains', async ({ page }) => {
    await page.evaluate(() => window.__lwa!.store.projects.create({ name: 'Second AOR' }));
    await danger(page).getByRole('button', { name: 'Delete project…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete project?' });
    await dialog.getByLabel('Type the project name to confirm').fill(FIXTURE_NAME);
    await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio/);
    await expect(page.getByRole('button', { name: /Second AOR/ })).toBeVisible();
  });
});

test('export then import into a fresh browser context reproduces wells, assessments and history', async ({
  page,
  browser,
}, testInfo) => {
  const WELL = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' };
  await seedFixture(page);
  // History beyond the fixture's: a record edit and a finalised re-assessment of one well.
  await page.evaluate(async (id) => {
    const { store } = window.__lwa!;
    await store.wells.update(id, { operator: 'Settings Test Operator' });
    const scores = {
      plugQuality: 3,
      cement: null,
      barriers: null,
      scvf: null,
      age: null,
      complexity: null,
      data: null,
      penetration: null,
      plume: null,
      usdw: null,
      access: null,
    } as const;
    const draft = await store.assessments.saveDraft(id, {
      scores,
      justifications: { plugQuality: 'Re-assessed for the backup round trip.' },
      override: null,
      suggestions: {},
    });
    await store.assessments.finalise(draft.id);
  }, WELL.id);

  /** Everything the round trip must keep, read through the page's store. */
  const snapshot = (p: Page) =>
    p.evaluate(async (pid) => {
      const { store } = window.__lwa!;
      const wells = await store.wells.list(pid);
      const assessments = (await Promise.all(wells.map((w) => store.assessments.listForWell(w.id)))).flat();
      const events = await store.audit.list({ projectId: pid });
      return {
        wells: wells.map((w) => JSON.stringify(w)).sort(),
        assessments: assessments.map((a) => JSON.stringify(a)).sort(),
        events: events.map((e) => JSON.stringify(e)),
      };
    }, FIXTURE_PROJECT_ID);

  /** The well's verdict and its History rows, as a reader sees them. */
  const wellView = async (p: Page) => {
    await p.goto(`/wells/view?id=${WELL.id}`);
    const verdict = await p.getByRole('region', { name: 'Well summary' }).getByRole('group', { name: 'Verdict' }).innerText();
    await p.goto(`/wells/view?id=${WELL.id}&tab=history`);
    const rows = p.getByRole('table', { name: 'History' }).locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    return { verdict, history: await rows.allInnerTexts() };
  };

  const before = await snapshot(page);
  const viewBefore = await wellView(page);
  expect(viewBefore.history.length).toBeGreaterThanOrEqual(3);

  await page.goto('/settings');
  const download = await exportProject(page);
  const upload = await asUpload(download);

  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    const other = await context.newPage();
    await other.goto('/');
    await expect(other.getByRole('heading', { name: 'Create your first project' })).toBeVisible();
    await other.getByLabel('Import project file').setInputFiles(upload);
    await expect(other.getByText('5 wells imported')).toBeVisible();
    await other.getByLabel('Your name').fill(PROFILE.name);
    await other.getByLabel('Initials').fill(PROFILE.initials);
    await other.getByRole('button', { name: 'Save profile' }).click();
    await expect(other).toHaveURL(/\/portfolio/);

    const after = await snapshot(other);
    expect(after.wells).toEqual(before.wells);
    expect(after.assessments).toEqual(before.assessments);
    expect(after.assessments).toHaveLength(6);
    // Every event the file carried is there unchanged, plus the import itself.
    expect(after.events.length).toBe(before.events.length + 1);
    for (const event of before.events) expect(after.events).toContain(event);

    expect(await wellView(other)).toEqual(viewBefore);
  } finally {
    await context.close();
  }
});
