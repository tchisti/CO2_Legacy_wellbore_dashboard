import { appendFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SWEEP_ROUTES, seedFixture } from './helpers';

// Accessibility sweep (spec §10 "axe clean on all routes"): every route, in the light and the dark
// theme, scanned by axe-core with its default rule set (WCAG 2.x A/AA plus best practices). A
// serious or critical violation fails the test; so does any moderate or minor one that is not in
// ACCEPTED below with its reason. Set A11Y_DUMP=<file> to append every violation found (all
// impacts) to that file as JSON lines, one per scan.

/** Moderate or minor axe rules that are accepted on a route, with the reason. None today. */
const ACCEPTED: Record<string, { rule: string; reason: string }[]> = {};

/** Waits until no CSS animation or transition is running (dialogs fade and slide in). */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    for (const route of SWEEP_ROUTES) {
      test(`${route.name}: axe finds no violations`, async ({ page }) => {
        if (theme === 'dark') {
          await page.addInitScript(() => {
            localStorage.setItem('lwa.theme', 'dark');
          });
        }
        if (route.seed) await seedFixture(page);
        await page.goto(route.path);
        await expect(route.ready(page)).toBeVisible();
        if (theme === 'dark') await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        else await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
        await settle(page);

        const results = await new AxeBuilder({ page }).analyze();
        const found = results.violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary })),
        }));
        if (process.env.A11Y_DUMP) {
          // "Incomplete" is axe's needs-review list (it could not decide, e.g. text over a gradient).
          const incomplete = results.incomplete.map((v) => ({
            rule: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({ target: n.target.join(' '), why: [...n.any, ...n.all].map((c) => c.message) })),
          }));
          const line = { theme, route: route.name, passes: results.passes.length, violations: found, incomplete };
          appendFileSync(process.env.A11Y_DUMP, `${JSON.stringify(line)}\n`);
        }
        const accepted = new Set((ACCEPTED[route.name] ?? []).map((a) => a.rule));
        const failing = found.filter((v) => v.impact === 'serious' || v.impact === 'critical' || !accepted.has(v.rule));
        expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
      });
    }
  });
}
