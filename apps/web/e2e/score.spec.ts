import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURE_PROJECT_ID, seedFixture } from './helpers';

// The score flow (spec §4.4, §5.1, §7): opened over the well page with `score=1`.

/** 100/07-21-055-22W4/00: Type 3, spud 1953, Vertical, has coordinates; final under 2.0.0 (penetration 4), no justifications. */
const FT_SASK = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' };

const PARAMS = [
  { key: 'plugQuality', name: 'Abandonment & Plug Quality' },
  { key: 'cement', name: 'Cement Coverage & Quality' },
  { key: 'barriers', name: 'Barriers Across Flow Zones' },
  { key: 'scvf', name: 'SCVF / Gas Migration History' },
  { key: 'age', name: 'Well Age & Regulatory Era' },
  { key: 'complexity', name: 'Wellbore Complexity & Condition' },
  { key: 'data', name: 'Data Confidence' },
  { key: 'penetration', name: 'Penetration vs Storage Complex' },
  { key: 'plume', name: 'Position vs Plume & Pressure Front' },
  { key: 'usdw', name: 'Groundwater (USDW/BGWP) Isolation' },
  { key: 'access', name: 'Corrective-Action Accessibility' },
] as const;

type ParamKey = (typeof PARAMS)[number]['key'];

const nameOf = (key: ParamKey): string => PARAMS.find((p) => p.key === key)!.name;

const summary = (page: Page) => page.getByRole('region', { name: 'Well summary' });
const verdict = (page: Page) => summary(page).getByRole('group', { name: 'Verdict' });
const sheetFor = (page: Page, licence: string) => page.getByRole('dialog', { name: `Score ${licence}` });
const row = (sheet: Locator, key: ParamKey) => sheet.locator(`[data-param="${key}"]`);
const radio = (sheet: Locator, key: ParamKey, value: '1' | '2' | '3' | '4' | '5' | 'Unknown') =>
  row(sheet, key).getByRole('radio', { name: value, exact: true });
const justification = (sheet: Locator, key: ParamKey) => sheet.getByLabel(`Justification for ${nameOf(key)}`, { exact: true });
const liveResult = (sheet: Locator) => sheet.locator('[data-live-result]');
const finaliseButton = (sheet: Locator) => sheet.getByRole('button', { name: 'Finalise assessment' });
const historyActions = (page: Page) =>
  page.getByRole('table', { name: 'History' }).locator('tbody tr td[data-column="action"]');

/** Adds a well to the fixture project through the page's store; returns its id. */
async function addWell(page: Page, input: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    async ({ projectId, well }) => (await window.__lwa!.store.wells.create(projectId, { licence: '', ...well })).id,
    { projectId: FIXTURE_PROJECT_ID, well: input },
  );
}

const NEW_WELL = {
  licence: '102/16-30-055-21W4/00',
  name: 'NEW 16-30',
  lat: 53.7801,
  lon: -113.2702,
  spudYear: 1972,
  trajectory: 'Deviated',
  classification: 'Type 5',
};

/** Opens the well page and the score flow from the header's primary button (Score / Re-assess / Continue draft). */
async function openScore(page: Page, id: string, licence: string, button: string): Promise<Locator> {
  await page.goto(`/wells/view?id=${id}`);
  await summary(page).getByRole('link', { name: button, exact: true }).click();
  const sheet = sheetFor(page, licence);
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/[?&]score=1(&|$)/);
  return sheet;
}

/** Finalises from the sheet and waits for it to close. */
async function finalise(page: Page, sheet: Locator): Promise<void> {
  await expect(finaliseButton(sheet)).toBeEnabled();
  await finaliseButton(sheet).click();
  await expect(page.getByText('Assessment finalised').first()).toBeVisible(); // an earlier toast may still show
  await expect(sheet).toBeHidden();
  await expect(page).not.toHaveURL(/score=1/);
}

test.describe('score flow', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('score an unscored well: Unknown by default; clicking 3 on every row shows live "L 3.0 × C 3.0 → cell 9 · Moderate"; Finalise is blocked with "11 justifications missing"; after filling them Finalise succeeds and the header shows Moderate, assessed by T. Chisti', async ({
    page,
  }) => {
    const id = await addWell(page, NEW_WELL);
    const sheet = await openScore(page, id, NEW_WELL.licence, 'Score');

    await expect(sheet).toContainText('rev 2.0.0');
    await expect(sheet.locator('[data-param]')).toHaveCount(11);
    const axes = await sheet.locator('[data-param]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-axis')));
    expect(axes).toEqual(['L', 'L', 'L', 'L', 'L', 'L', 'L', 'C', 'C', 'C', 'C']);
    await expect(sheet.getByRole('heading', { name: /^(Likelihood|Consequence)/ })).toHaveText([/^Likelihood/, /^Consequence/]);
    for (const p of PARAMS) {
      await expect(row(sheet, p.key).getByRole('radiogroup', { name: `Score for ${p.name}` })).toBeVisible();
      await expect(radio(sheet, p.key, 'Unknown')).toHaveAttribute('aria-checked', 'true');
      await expect(row(sheet, p.key).getByRole('radio', { checked: true })).toHaveCount(1);
    }
    await expect(row(sheet, 'plugQuality').locator('[data-anchor]')).toHaveText('Unknown — scores as 5');
    await expect(row(sheet, 'scvf').locator('[data-anchor]')).toHaveText('Unknown — scores as 3');
    await expect(liveResult(sheet)).toHaveText('L 4.2 × C 3.6 → cell 16 · High');
    // Unknown needs no justification: nothing is missing yet, but nothing has been chosen either.
    await expect(sheet.getByText(/justifications? missing/)).toHaveCount(0);

    for (const p of PARAMS) await radio(sheet, p.key, '3').click();
    await expect(liveResult(sheet)).toHaveText('L 3.0 × C 3.0 → cell 9 · Moderate');
    await expect(row(sheet, 'plugQuality').locator('[data-anchor]')).toContainText(
      'Era-standard abandonment; plugs present but unverified (no tag/log)',
    );
    await expect(sheet.getByText('Recommended action (automatic): Targeted Diagnostics + Watchlist')).toBeVisible();

    await expect(finaliseButton(sheet)).toBeDisabled();
    await expect(sheet.getByText('11 justifications missing', { exact: true })).toBeVisible();
    await finaliseButton(sheet).click({ force: true }); // blocked: nothing happens
    await expect(sheet).toBeVisible();

    for (const p of PARAMS.slice(0, 10)) await justification(sheet, p.key).fill(`Reviewed ${p.name} against the file.`);
    await expect(sheet.getByText('1 justification missing', { exact: true })).toBeVisible();
    await justification(sheet, 'access').fill('Lease road open year-round.');
    await expect(sheet.getByText(/justifications? missing/)).toHaveCount(0);

    await finalise(page, sheet);
    await expect(verdict(page).locator('[data-rank="Moderate"]')).toBeVisible();
    await expect(verdict(page).getByText('L 3.0 × C 3.0', { exact: true })).toBeVisible();
    await expect(verdict(page)).toContainText(/assessed under 2\.0\.0 by T\. Chisti on \d{4}-\d{2}-\d{2}/);
    await expect(summary(page).getByRole('link', { name: 'Re-assess' })).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'Scores', exact: true }).locator('tr[data-param="access"]'),
    ).toContainText('Lease road open year-round.');
  });

  test('suggestion chip "Suggested 5 · from Type 3" appears on Penetration for a Type 3 well; one click applies it and prefills the justification', async ({
    page,
  }) => {
    const sheet = await openScore(page, FT_SASK.id, FT_SASK.licence, 'Re-assess');
    const penetration = row(sheet, 'penetration');
    await expect(radio(sheet, 'penetration', '4')).toHaveAttribute('aria-checked', 'true');
    const chip = penetration.getByRole('button', { name: 'Suggested 5 · from Type 3', exact: true });
    await expect(chip).toBeVisible();
    // Shown, never applied by itself.
    await expect(justification(sheet, 'penetration')).toHaveValue('');
    await expect(row(sheet, 'age').getByRole('button', { name: 'Suggested 5 · from spud year 1953' })).toBeVisible();
    await expect(row(sheet, 'complexity').getByRole('button', { name: 'Suggested 1 · from trajectory Vertical' })).toBeVisible();
    // Plume: the suggestion (3) equals the carried score, so no chip; the nearest injector is still shown.
    await expect(row(sheet, 'plume').getByRole('button', { name: /^Suggested/ })).toHaveCount(0);
    await expect(row(sheet, 'plume')).toContainText('Nearest injector: Oak (proposed) · 2.9 km (inside the AoR)');

    await chip.click();
    await expect(radio(sheet, 'penetration', '5')).toHaveAttribute('aria-checked', 'true');
    await expect(justification(sheet, 'penetration')).toHaveValue('Suggested: from Type 3');
    await expect(chip).toHaveCount(0);
    await expect(penetration.getByText(/carried from/)).toHaveCount(0);
    await expect(penetration.locator('[data-anchor]')).toContainText('Intersects storage reservoir (Types 1–3)');
  });

  test('suggestion chip disappears once its score is selected', async ({ page }) => {
    const sheet = await openScore(page, FT_SASK.id, FT_SASK.licence, 'Re-assess');
    const chip = row(sheet, 'age').getByRole('button', { name: 'Suggested 5 · from spud year 1953' });
    await expect(chip).toBeVisible();
    await radio(sheet, 'age', '5').click();
    await expect(chip).toHaveCount(0);
    await expect(justification(sheet, 'age')).toHaveValue(''); // chosen by hand: nothing prefilled
    await radio(sheet, 'age', 'Unknown').click();
    await expect(chip).toBeVisible(); // differs again (Unknown ≠ 5)
  });

  test('re-assess a final well: rows marked "carried from <date>"; finalising unchanged creates a second final; History shows two finalise events', async ({
    page,
  }) => {
    const id = await addWell(page, NEW_WELL);
    let sheet = await openScore(page, id, NEW_WELL.licence, 'Score');
    await radio(sheet, 'plugQuality', '2').click();
    await justification(sheet, 'plugQuality').fill('Two cement plugs, one tagged.');
    await radio(sheet, 'usdw', '4').click();
    await justification(sheet, 'usdw').fill('Surface casing short of the BGWP base.');
    await finalise(page, sheet);

    const assessedOn = await page.evaluate(async (wellId) => {
      const current = await window.__lwa!.store.assessments.current(wellId);
      return current!.assessedAt!.slice(0, 10);
    }, id);

    sheet = await openScore(page, id, NEW_WELL.licence, 'Re-assess');
    await expect(sheet.getByText(`carried from ${assessedOn}`, { exact: true })).toHaveCount(11);
    await expect(radio(sheet, 'plugQuality', '2')).toHaveAttribute('aria-checked', 'true');
    await expect(justification(sheet, 'plugQuality')).toHaveValue('Two cement plugs, one tagged.');
    await expect(radio(sheet, 'usdw', '4')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(sheet, 'cement', 'Unknown')).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.getByText(/justifications? missing/)).toHaveCount(0);

    // Changing a row drops its "carried" mark; changing it back keeps the row as the reviewer's own.
    await radio(sheet, 'cement', '3').click();
    await expect(row(sheet, 'cement').getByText(/carried from/)).toHaveCount(0);
    await radio(sheet, 'cement', 'Unknown').click();
    await expect(sheet.getByText(`carried from ${assessedOn}`, { exact: true })).toHaveCount(10);

    await finalise(page, sheet);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(historyActions(page).filter({ hasText: /^Finalised$/ })).toHaveCount(2);
    await page.getByRole('tab', { name: 'Assessment' }).click();
    await expect(page.getByRole('button', { name: /Prior assessments \(1\)/ })).toBeVisible();
  });

  test('re-assessing a migrated final requires justifications before finalise', async ({ page }) => {
    const sheet = await openScore(page, FT_SASK.id, FT_SASK.licence, 'Re-assess');
    await expect(sheet.getByText('carried from 2026-08-07', { exact: true })).toHaveCount(11);
    await expect(liveResult(sheet)).toHaveText('L 1.8 × C 2.6 → cell 6 · Moderate');
    await expect(finaliseButton(sheet)).toBeDisabled();
    await expect(sheet.getByText('11 justifications missing', { exact: true })).toBeVisible();

    // The reason is reachable by keyboard: the blocked button stays focusable and describes itself.
    await finaliseButton(sheet).focus();
    await expect(page.getByRole('tooltip')).toContainText('Abandonment & Plug Quality');
    await expect(page.getByRole('tooltip')).toContainText('Corrective-Action Accessibility');

    await radio(sheet, 'scvf', 'Unknown').click(); // Unknown needs no justification
    await expect(sheet.getByText('10 justifications missing', { exact: true })).toBeVisible();
    for (const p of PARAMS.filter((q) => q.key !== 'scvf')) {
      await justification(sheet, p.key).fill(`Confirmed from the 2026 file review (${p.key}).`);
    }
    await finalise(page, sheet);
    await expect(verdict(page)).toContainText(/assessed under 2\.0\.0 by T\. Chisti on \d{4}-\d{2}-\d{2}/);
    const scvf = page.getByRole('table', { name: 'Scores', exact: true }).locator('tr[data-param="scvf"]');
    await expect(scvf.locator('td[data-column="score"]')).toHaveText('?');
  });

  test('reviewer override: typing an override shows "Reviewer override" on the well page; clearing restores Automatic', async ({
    page,
  }) => {
    const id = await addWell(page, NEW_WELL);
    let sheet = await openScore(page, id, NEW_WELL.licence, 'Score');
    await expect(sheet.getByText('Recommended action (automatic): Re-entry + Mitigation Required')).toBeVisible();
    await sheet.getByRole('button', { name: 'Override', exact: true }).click();
    await sheet.getByLabel('Reviewer override').fill('Re-enter and re-plug before injection start-up.');
    await finalise(page, sheet);

    const action = page.getByRole('region', { name: 'Recommended action' });
    await expect(action.locator('[data-source]')).toHaveText('Reviewer override');
    await expect(action).toContainText('Re-enter and re-plug before injection start-up.');

    sheet = await openScore(page, id, NEW_WELL.licence, 'Re-assess');
    await expect(sheet.getByLabel('Reviewer override')).toHaveValue('Re-enter and re-plug before injection start-up.');
    await sheet.getByLabel('Reviewer override').fill('   ');
    await finalise(page, sheet);
    await expect(action.locator('[data-source]')).toHaveText('Automatic');
    await expect(action.getByRole('heading', { name: 'Re-entry + Mitigation Required' })).toBeVisible();
  });

  test('score flow works for a well without coordinates', async ({ page }) => {
    const licence = '100/01-02-055-22W4/00';
    const id = await addWell(page, { licence, classification: 'Type 3', spudYear: 1958 });
    const sheet = await openScore(page, id, licence, 'Score');
    const plume = row(sheet, 'plume');
    await expect(plume).toContainText('Nearest injector: —');
    await expect(plume.getByRole('button', { name: /^Suggested/ })).toHaveCount(0);
    await expect(row(sheet, 'penetration').getByRole('button', { name: 'Suggested 5 · from Type 3' })).toBeVisible();

    await radio(sheet, 'plume', '3').click();
    await justification(sheet, 'plume').fill('No coordinates on file; corridor position unknown, scored mid.');
    await finalise(page, sheet);
    await expect(verdict(page).locator('[data-rank]')).toBeVisible();
    await expect(verdict(page)).toContainText('by T. Chisti');
  });

  test('draft survives reload: set two scores, close, reload, "Continue draft" restores them', async ({ page }) => {
    const id = await addWell(page, NEW_WELL);
    let sheet = await openScore(page, id, NEW_WELL.licence, 'Score');
    await radio(sheet, 'plugQuality', '2').click();
    await radio(sheet, 'cement', '4').click();
    await justification(sheet, 'cement').fill('No CBL on file.');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/score=1/);
    await expect(summary(page).getByText('Draft by T. Chisti')).toBeVisible();

    await page.reload();
    await summary(page).getByRole('link', { name: 'Continue draft' }).click();
    sheet = sheetFor(page, NEW_WELL.licence);
    await expect(sheet).toBeVisible();
    await expect(radio(sheet, 'plugQuality', '2')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(sheet, 'cement', '4')).toHaveAttribute('aria-checked', 'true');
    await expect(justification(sheet, 'cement')).toHaveValue('No CBL on file.');
    await expect(radio(sheet, 'barriers', 'Unknown')).toHaveAttribute('aria-checked', 'true');
    await expect(sheet.getByText(/carried from/)).toHaveCount(0);

    // Closing with nothing changed saves nothing.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    const events = await page.evaluate(
      async (projectId) => (await window.__lwa!.store.audit.list({ projectId })).filter((e) => e.entity === 'assessment').length,
      FIXTURE_PROJECT_ID,
    );
    expect(events).toBe(1); // the one draft created on the first close
  });

  test("leaving with the browser's Back button still saves unsaved changes as the draft", async ({ page }) => {
    const id = await addWell(page, NEW_WELL);
    const sheet = await openScore(page, id, NEW_WELL.licence, 'Score');
    await radio(sheet, 'scvf', '5').click();
    await page.goBack();
    await expect(page).not.toHaveURL(/score=1/);
    await expect(sheet).toBeHidden();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(summary(page).getByText('Draft by T. Chisti')).toBeVisible();
    const scvf = await page.evaluate(async (wellId) => (await window.__lwa!.store.assessments.draft(wellId))?.scores.scvf, id);
    expect(scvf).toBe(5);
  });

  test('keyboard: focus a row, press 4 sets 4, press ? sets Unknown', async ({ page }) => {
    const id = await addWell(page, NEW_WELL);
    const sheet = await openScore(page, id, NEW_WELL.licence, 'Score');
    const unknown = radio(sheet, 'plugQuality', 'Unknown');
    await unknown.focus();
    await page.keyboard.press('4');
    await expect(radio(sheet, 'plugQuality', '4')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(sheet, 'plugQuality', '4')).toBeFocused();
    await expect(unknown).toHaveAttribute('aria-checked', 'false');
    await expect(row(sheet, 'plugQuality').locator('[data-anchor]')).toContainText('Judgment call between the 3 and 5 anchors');
    await expect(sheet.getByText('1 justification missing', { exact: true })).toBeVisible();

    await page.keyboard.press('?');
    await expect(unknown).toHaveAttribute('aria-checked', 'true');
    await expect(unknown).toBeFocused();
    await expect(row(sheet, 'plugQuality').locator('[data-anchor]')).toHaveText('Unknown — scores as 5');

    // Arrow keys move through the options (and choose, as radios do); one tab stop per group.
    await page.keyboard.press('ArrowRight');
    await expect(radio(sheet, 'plugQuality', '1')).toHaveAttribute('aria-checked', 'true');
    await expect(radio(sheet, 'plugQuality', '1')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(unknown).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // wraps to the last option
    await expect(radio(sheet, 'plugQuality', '5')).toBeFocused();
    await page.keyboard.press('2');
    await expect(radio(sheet, 'plugQuality', '2')).toHaveAttribute('aria-checked', 'true');

    // Tab goes to the justification.
    await page.keyboard.press('Tab');
    await expect(justification(sheet, 'plugQuality')).toBeFocused();
    await page.keyboard.type('Two plugs, tagged.');
    // Digits typed into a justification are text, not scores.
    await page.keyboard.type(' 1953');
    await expect(radio(sheet, 'plugQuality', '2')).toHaveAttribute('aria-checked', 'true');
    await expect(justification(sheet, 'plugQuality')).toHaveValue('Two plugs, tagged. 1953');
    await expect(sheet.getByText(/justifications? missing/)).toHaveCount(0);
  });
});
