import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_PROJECT_ID, seedFixture } from './helpers';

// Fixture wells (e2e/fixtures/fort-sask.project.json).
const FT_SASK = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' }; // final under 2.0.0, Moderate, cell 6
const REDWATER = { id: 'wel_v2_W-LX242Q', licence: '100/13-05-056-22W4/00' }; // final under 1.0.0 → stale

const summary = (page: Page) => page.getByRole('region', { name: 'Well summary' });
const verdict = (page: Page) => summary(page).getByRole('group', { name: 'Verdict' });
const scoreTable = (page: Page) => page.getByRole('table', { name: 'Scores', exact: true });
const historyRows = (page: Page) => page.getByRole('table', { name: 'History' }).locator('tbody tr');

/** Every parameter unknown: a draft that can be finalised without justifications. */
const ALL_UNKNOWN = {
  plugQuality: null,
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
};

/** Adds an unscored well to the fixture project through the page's store; returns its id. */
async function addUnscoredWell(page: Page): Promise<string> {
  return page.evaluate(async (projectId) => {
    const well = await window.__lwa!.store.wells.create(projectId, {
      licence: '102/16-30-055-21W4/00',
      name: 'NO COORDS 16-30',
    });
    return well.id;
  }, FIXTURE_PROJECT_ID);
}

test.describe('with the Fort Saskatchewan fixture', () => {
  test.beforeEach(async ({ page }) => {
    await seedFixture(page);
  });

  test('header shows licence, operator, Moderate badge, "L 1.8 × C 2.6", cell 6, index 4.6, "assessed under 2.0.0 by Tahir Chisti"', async ({
    page,
  }) => {
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await expect(summary(page).getByRole('heading', { level: 1 })).toHaveText(FT_SASK.licence);
    await expect(summary(page)).toContainText('IMPERIAL FT SASK 7-21');
    await expect(summary(page)).toContainText('Imperial Oil Limited');
    await expect(summary(page)).toContainText('Abandoned (P&A)');
    await expect(summary(page)).toContainText('Strat Test');
    await expect(summary(page)).toContainText('Type 3');
    await expect(summary(page)).toContainText('Thru seal + reservoir — groundwater only');
    await expect(summary(page)).toContainText('1953');
    await expect(summary(page)).toContainText('53.764946, -113.207628');

    await expect(verdict(page).locator('[data-rank="Moderate"]')).toContainText('Moderate');
    await expect(verdict(page).getByText('L 1.8 × C 2.6', { exact: true })).toBeVisible();
    await expect(verdict(page).getByText('Cell 6', { exact: true })).toBeVisible();
    await expect(verdict(page).getByText('Index 4.6', { exact: true })).toBeVisible();
    await expect(verdict(page).getByText('assessed under 2.0.0 by Tahir Chisti on 2026-08-07', { exact: true })).toBeVisible();
    await expect(summary(page).getByText('Stale revision')).toHaveCount(0);

    await expect(summary(page).getByRole('link', { name: 'Re-assess' })).toHaveAttribute(
      'href',
      `/wells/view?id=${FT_SASK.id}&score=1`,
    );
    await expect(summary(page).getByRole('link', { name: 'Report' })).toHaveAttribute(
      'href',
      `/report/well?id=${FT_SASK.id}`,
    );
    await expect(summary(page).getByRole('button', { name: 'Edit record' })).toBeVisible();
  });

  test('Assessment tab lists 11 rows grouped L then C with anchor text, and the recommended action "Targeted Diagnostics + Watchlist"', async ({
    page,
  }) => {
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await expect(page.getByRole('tab', { name: 'Assessment' })).toHaveAttribute('aria-selected', 'true');

    const action = page.getByRole('region', { name: 'Recommended action' });
    await expect(action.getByRole('heading', { name: 'Targeted Diagnostics + Watchlist' })).toBeVisible();
    await expect(action).toContainText('Automatic');
    await expect(action).toContainText('Moderate Tier. Add to MMV watchlist');

    const rows = scoreTable(page).locator('tbody tr[data-param]');
    await expect(rows).toHaveCount(11);
    const axes = await rows.evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-axis')));
    expect(axes).toEqual(['L', 'L', 'L', 'L', 'L', 'L', 'L', 'C', 'C', 'C', 'C']);
    await expect(scoreTable(page).getByRole('rowheader', { name: /^(Likelihood|Consequence)/ })).toHaveText([
      /^Likelihood/,
      /^Consequence/,
    ]);

    const plug = rows.first();
    await expect(plug).toContainText('Abandonment & Plug Quality');
    await expect(plug).toContainText('0.22');
    await expect(plug).toContainText('Abandoned to current D020 / Class VI standard; verified plugs across storage complex');
    await expect(plug.locator('td[data-column="contribution"]')).toHaveText('0.22');

    const penetration = rows.nth(7);
    await expect(penetration).toContainText('Penetration vs Storage Complex');
    await expect(penetration.locator('td[data-column="score"]')).toHaveText('4');
    await expect(penetration).toContainText('Judgment call between the 3 and 5 anchors');
    await expect(penetration.locator('td[data-column="contribution"]')).toHaveText('1.20');

    await expect(scoreTable(page).locator('tr[data-subtotal="L"] td[data-column="contribution"]')).toHaveText('1.76');
    await expect(scoreTable(page).locator('tr[data-subtotal="C"] td[data-column="contribution"]')).toHaveText('2.60');
    await expect(page.getByText(/Anchors and weights shown from rev/)).toHaveCount(0);
    await expect(page.getByText('Prior assessments (0)')).toBeVisible();
  });

  test('well 100/13-05-056-22W4/00 shows Stale revision badge (assessed under 1.0.0)', async ({ page }) => {
    await page.goto(`/wells/view?id=${REDWATER.id}`);
    await expect(summary(page).getByRole('heading', { level: 1 })).toHaveText(REDWATER.licence);
    await expect(verdict(page)).toContainText('assessed under 1.0.0 by Tahir Chisti on 2026-07-24');
    const badge = summary(page).getByText('Stale revision', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-tone', 'warn');
    await badge.focus();
    await expect(badge).toHaveAccessibleDescription('Assessed under 1.0.0; current 2.0.0');
  });

  test('a wording-only revision (2.0.1) shows "assessed under 2.0.0 (current 2.0.1, wording only)" and no stale badge', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const { store } = window.__lwa!;
      const m = await store.methodology.current();
      const params = m.params.map((p, i) => (i === 0 ? { ...p, anchors: { ...p.anchors, '1': `${p.anchors['1']} (reworded)` } } : p));
      await store.methodology.publish({ ...m, revision: '2.0.1', params }, 'Wording only');
    });
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    const note = summary(page).getByText('assessed under 2.0.0 (current 2.0.1, wording only)', { exact: true });
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('data-tone', 'neutral');
    await expect(summary(page).getByText('Stale revision')).toHaveCount(0);
    // Still shown under its own revision, whose record the project has: the old wording.
    await expect(scoreTable(page).locator('tr[data-param="plugQuality"]')).not.toContainText('(reworded)');

    // A major move is still stale, and amber.
    await page.goto(`/wells/view?id=${REDWATER.id}`);
    await expect(summary(page).getByText('Stale revision', { exact: true })).toHaveAttribute('data-tone', 'warn');
    await expect(summary(page).getByText(/wording only/)).toHaveCount(0);
  });

  test('a stale well shows the rev note when its revision has no record', async ({ page }) => {
    await page.goto(`/wells/view?id=${REDWATER.id}`);
    await expect(
      page.getByText('Anchors and weights shown from rev 2.0.0; rev 1.0.0 is not available in this project.'),
    ).toBeVisible();
    await expect(scoreTable(page).locator('tbody tr[data-param]')).toHaveCount(11);
    const scvf = scoreTable(page).locator('tr[data-param="scvf"]');
    await expect(scvf.locator('td[data-column="score"]')).toHaveText('?');
    await expect(scvf).toContainText('Unknown — scores as 3');
    await expect(scoreTable(page).locator('tr[data-subtotal="C"] td[data-column="contribution"]')).toHaveText('2.00');
  });

  test('History tab lists the import audit event with actor and timestamp', async ({ page }) => {
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(historyRows(page)).toHaveCount(1);
    const row = historyRows(page).first();
    await expect(row.locator('td[data-column="action"]')).toHaveText('Imported');
    await expect(row.locator('td[data-column="entity"]')).toHaveText('Well');
    await expect(row.locator('td[data-column="actor"]')).toHaveText('v2 migration');
    await expect(row.locator('td[data-column="at"]')).toHaveText('2026-08-07 16:16 UTC');
    await expect(row.locator('td[data-column="summary"]')).toHaveText('initial record');
  });

  test('tab state survives reload (?tab=history)', async ({ page }) => {
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page).toHaveURL(/[?&]tab=history(&|$)/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await expect(historyRows(page)).toHaveCount(1);

    await page.getByRole('tab', { name: 'Construction' }).click();
    await expect(page).toHaveURL(/[?&]tab=construction(&|$)/);
    await expect(page.getByRole('heading', { name: 'Construction records' })).toBeVisible();

    await page.getByRole('tab', { name: 'Assessment' }).click();
    await expect(page).toHaveURL(new RegExp(`/wells/view\\?id=${FT_SASK.id}$`));
    await expect(scoreTable(page)).toBeVisible();
  });

  test("Edit record from the header updates the operator and History shows an Updated event with 'operator'", async ({
    page,
  }) => {
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await expect(summary(page).getByText('Record changed since assessment')).toHaveCount(0);
    await summary(page).getByRole('button', { name: 'Edit record' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit well record' });
    await expect(dialog.getByLabel('Operator')).toHaveValue('Imperial Oil Limited');
    await dialog.getByLabel('Operator').fill('Redwater Holdings Ltd.');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();

    await expect(summary(page)).toContainText('Redwater Holdings Ltd.');
    await expect(summary(page).getByText('Record changed since assessment')).toBeVisible();

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(historyRows(page)).toHaveCount(2);
    const latest = historyRows(page).first();
    await expect(latest.locator('td[data-column="action"]')).toHaveText('Updated');
    await expect(latest.locator('td[data-column="actor"]')).toHaveText('T. Chisti');
    await expect(latest.locator('td[data-column="summary"]')).toHaveText('operator');
    await expect(historyRows(page).nth(1).locator('td[data-column="action"]')).toHaveText('Imported');
  });

  test('unscored well shows "Not yet assessed" and a Score button', async ({ page }) => {
    const id = await addUnscoredWell(page);
    await page.goto(`/wells/view?id=${id}`);
    await expect(summary(page).getByRole('heading', { level: 1 })).toHaveText('102/16-30-055-21W4/00');
    await expect(summary(page).getByText('Not yet assessed')).toBeVisible();
    await expect(summary(page).getByText(/^L .* × C /)).toHaveCount(0);
    await expect(summary(page).getByRole('link', { name: 'Score', exact: true })).toHaveAttribute(
      'href',
      `/wells/view?id=${id}&score=1`,
    );

    const panel = page.getByRole('tabpanel', { name: 'Assessment' });
    await expect(panel.getByRole('heading', { name: 'Not yet assessed' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Score', exact: true })).toBeVisible();
    await expect(scoreTable(page)).toHaveCount(0);
  });

  test('a draft-only well shows "Draft in progress by …" and Continue draft, without a score table', async ({ page }) => {
    const id = await addUnscoredWell(page);
    await page.evaluate(
      async ({ wellId, scores }) => {
        await window.__lwa!.store.assessments.saveDraft(wellId, { scores, justifications: {}, override: null, suggestions: {} });
      },
      { wellId: id, scores: ALL_UNKNOWN },
    );
    await page.goto(`/wells/view?id=${id}`);
    await expect(summary(page).getByText('Draft by T. Chisti')).toBeVisible();
    await expect(summary(page).getByRole('link', { name: 'Continue draft' })).toHaveAttribute(
      'href',
      `/wells/view?id=${id}&score=1`,
    );
    await expect(page.getByRole('tabpanel', { name: 'Assessment' })).toContainText('Draft in progress by T. Chisti');
    await expect(scoreTable(page)).toHaveCount(0);
  });

  test('a re-assessed well lists the earlier final under Prior assessments, and History shows the finalise', async ({
    page,
  }) => {
    await page.evaluate(
      async ({ wellId, scores }) => {
        const { store } = window.__lwa!;
        const draft = await store.assessments.saveDraft(wellId, { scores, justifications: {}, override: null, suggestions: {} });
        await store.assessments.finalise(draft.id);
      },
      { wellId: FT_SASK.id, scores: ALL_UNKNOWN },
    );
    await page.goto(`/wells/view?id=${FT_SASK.id}`);
    await expect(verdict(page)).toContainText(/assessed under 2\.0\.0 by T\. Chisti on \d{4}-\d{2}-\d{2}/);
    await expect(scoreTable(page).locator('tr[data-param="plugQuality"] td[data-column="score"]')).toHaveText('?');

    const prior = page.getByRole('button', { name: /Prior assessments \(1\)/ });
    await expect(prior).toBeVisible();
    await prior.click();
    const earlier = page.getByRole('list', { name: 'Prior assessments' }).getByRole('listitem');
    await expect(earlier).toHaveCount(1);
    await expect(earlier.first()).toContainText('2026-08-07');
    await expect(earlier.first()).toContainText('Tahir Chisti');
    await expect(earlier.first()).toContainText('2.0.0');
    await expect(earlier.first().locator('[data-rank="Moderate"]')).toBeVisible();
    await earlier.first().getByRole('button').click();
    const earlierTable = earlier.first().getByRole('table');
    await expect(earlierTable.locator('tbody tr[data-param]')).toHaveCount(11);
    await expect(earlierTable.locator('tr[data-subtotal="L"] td[data-column="contribution"]')).toHaveText('1.76');

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(historyRows(page)).toHaveCount(3);
    await expect(historyRows(page).locator('td[data-column="action"]')).toHaveText(['Finalised', 'Created', 'Imported']);
    await expect(historyRows(page).locator('td[data-column="entity"]')).toHaveText(['Assessment', 'Assessment', 'Well']);
  });

  test('unknown id shows Well not found', async ({ page }) => {
    await page.goto('/wells/view?id=wel_missing');
    await expect(page.getByRole('heading', { name: 'Well not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Wells' }).click();
    await expect(page).toHaveURL(/\/wells$/);
  });

  test('a well of another project is not found in this one', async ({ page }) => {
    const id = await page.evaluate(async () => {
      const { store } = window.__lwa!;
      const other = await store.projects.create({ name: 'Other AOR' });
      return (await store.wells.create(other.id, { licence: '100/01-01-001-01W5/00' })).id;
    });
    await page.goto(`/wells/view?id=${id}`);
    await expect(page.getByRole('heading', { name: 'Well not found' })).toBeVisible();
    await expect(page.getByText('This well belongs to another project.', { exact: false })).toBeVisible();
  });
});
