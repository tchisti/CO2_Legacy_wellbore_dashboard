import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PortfolioReportPage from '@/app/report/portfolio/page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/report/portfolio',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8')) as unknown;
const FOOTNOTE = 'Reviewer identity is recorded from a local profile and is not authenticated.';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-21T09:30:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let dbCount = 0;
async function renderReport(search: string) {
  dbCount += 1;
  const dbName = `lwa-portfolio-report-test-${dbCount}`;
  await createLocalStore({ dbName, actor: () => 'seed' }).importProject(FIXTURE, 'merge');
  nav.search = search;
  const view = render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <ProjectProvider>
        <TooltipProvider>
          <PortfolioReportPage />
        </TooltipProvider>
      </ProjectProvider>
    </StoreProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Portfolio report' });
  return view;
}

const sections = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'));
const registerRows = () => screen.getByRole('table', { name: 'Wells' }).querySelectorAll('tbody tr');

describe('portfolio report', () => {
  it('prints header, counts, matrix, drivers, the register, the bands and the footnote, in that order', async () => {
    const { container } = await renderReport('');
    expect(sections(container)).toEqual(['header', 'counts', 'matrix', 'drivers', 'register', 'bands', 'footer']);
    const header = container.querySelector<HTMLElement>('[data-section="header"]')!;
    expect(header.textContent).toContain('Fort Saskatchewan / Wabamun Hub AOR');
    expect(header.querySelector('[data-meta="revision"]')?.textContent).toBe('Methodology rev2.0.0');
    expect(header.querySelector('[data-meta="printed"]')?.textContent).toBe('Printed2026-10-21');
    expect(header.querySelector('[data-filter]')?.textContent).toBe('All wells');
    expect(container.querySelector('[data-footnote]')?.textContent).toBe(FOOTNOTE);
    expect(container.textContent).not.toMatch(/phase/i);
  });

  it('lists every well, riskiest first, with licence, name, operator, class, L × C, cell, rank, state, reviewer and date', async () => {
    await renderReport('');
    const rows = registerRows();
    expect(rows).toHaveLength(5);
    const first = rows[0]!;
    const field = (name: string) => first.querySelector(`[data-field="${name}"]`)?.textContent;
    expect(field('licence')).toBe('100/07-21-055-22W4/00');
    expect(field('name')).toBe('IMPERIAL FT SASK 7-21');
    expect(field('operator')).toBe('Imperial Oil Limited');
    expect(field('class')).toBe('Type 3');
    expect(field('lxc')).toBe('1.8 × 2.6');
    expect(field('cell')).toBe('6');
    expect(first.querySelector('[data-field="rank"] [data-rank="Moderate"]')).toBeTruthy();
    expect(field('state')).toBe('Final');
    expect(field('reviewer')).toBe('Tahir Chisti');
    expect(field('assessed')).toBe('2026-08-07');
    // Ten facts in eight columns, so the table fits a letter page: name over operator, reviewer over date.
    const headers = [...screen.getByRole('table', { name: 'Wells' }).querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual(['Licence', 'Name / operator', 'Class', 'L × C', 'Cell', 'Rank', 'Assessment', 'Reviewer / assessed']);
    const stale = [...rows].find((r) => r.textContent?.includes('100/13-05-056-22W4/00'))!;
    expect(stale.querySelector('[data-field="state"]')?.textContent).toBe('Stale revision');
  });

  it('?rank=Low prints the four Low wells, says so in the header, and counts only them', async () => {
    const { container } = await renderReport('rank=Low');
    expect(container.querySelector('[data-filter]')?.textContent).toBe('Filter: Rank Low');
    expect(registerRows()).toHaveLength(4);
    for (const row of registerRows()) expect(row.querySelector('[data-rank="Low"]')).toBeTruthy();
    const counts = container.querySelector<HTMLElement>('[data-section="counts"]')!;
    expect(counts.querySelector('[data-kpi="total"] [data-kpi-count]')?.textContent).toBe('4');
    expect(counts.querySelector('[data-kpi="rank:Moderate"] [data-kpi-count]')?.textContent).toBe('0');
  });

  it('nothing in the report is a link: counts and matrix cells are not interactive', async () => {
    const { container } = await renderReport('state=stale');
    expect(container.querySelector('[data-filter]')?.textContent).toBe('Filter: Assessment Stale revision');
    expect(registerRows()).toHaveLength(1);
    const report = container.querySelector<HTMLElement>('article')!;
    expect(within(report).queryAllByRole('link')).toHaveLength(0);
    expect(report.querySelector('[data-section="matrix"] svg [data-cell="2-2"]')?.getAttribute('data-count')).toBe('1');
  });

  it('says so when no well matches the filter', async () => {
    await renderReport('rank=High');
    expect(screen.getByText('No wells match this filter.')).toBeTruthy();
    expect(screen.getByText('No current assessments in this selection.')).toBeTruthy();
  });
});
