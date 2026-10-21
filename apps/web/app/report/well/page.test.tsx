import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyScores } from '@lwa/engine';
import WellReportPage from '@/app/report/well/page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/report/well',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8')) as unknown;
const FT_SASK = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' }; // final, Moderate, rev 2.0.0
const REDWATER = { id: 'wel_v2_W-LX242Q', licence: '100/13-05-056-22W4/00' }; // final under 1.0.0 (not in the project)
const PRINTED = new Date('2026-10-21T09:30:00.000Z');
const ATTRIBUTION = 'Assessed by Tahir Chisti on 2026-08-07 · Methodology rev 2.0.0 · Printed 2026-10-21';
const FOOTNOTE = 'Reviewer identity is recorded from a local profile and is not authenticated.';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PRINTED);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

/** The page's store, with the projects list failing to read (a blocked or corrupt database). */
function withFailingProjects(store: Store): Store {
  return { ...store, projects: { ...store.projects, list: () => Promise.reject(new Error('IndexedDB read failed')) } };
}

let dbCount = 0;
/** Seeds the Fort Saskatchewan fixture (plus `seed`), then renders the dossier of `id`. */
async function renderDossier(
  id: string,
  seed?: (s: Store) => Promise<string | void>,
  wrap: (s: Store) => Store = (s) => s,
) {
  dbCount += 1;
  const dbName = `lwa-well-report-test-${dbCount}`;
  const store = createLocalStore({ dbName, actor: () => 'J. Doe' });
  await store.importProject(FIXTURE, 'merge');
  const seeded = seed ? await seed(store) : undefined;
  nav.search = `id=${encodeURIComponent(typeof seeded === 'string' ? seeded : id)}`;
  const view = render(
    <StoreProvider createStore={(actor) => wrap(createLocalStore({ dbName, actor }))}>
      <ProjectProvider>
        <TooltipProvider>
          <WellReportPage />
        </TooltipProvider>
      </ProjectProvider>
    </StoreProvider>,
  );
  return view;
}

const sections = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'));
const section = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-section="${name}"]`)!;

describe('well dossier', () => {
  it('prints its sections in order: header, summary, action, scores, construction, notes, methodology, footer', async () => {
    const { container } = await renderDossier(FT_SASK.id);
    expect(await screen.findByRole('heading', { level: 1, name: FT_SASK.licence })).toBeTruthy();
    expect(sections(container)).toEqual([
      'header',
      'summary',
      'action',
      'scores',
      'construction',
      'notes',
      'methodology',
      'footer',
    ]);
  });

  it('heads with project, licence, name, operator, rank badge with cell, L × C, cell, index, revision, reviewer, dates', async () => {
    const { container } = await renderDossier(FT_SASK.id);
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    const header = section(container, 'header');
    expect(header.textContent).toContain('Fort Saskatchewan / Wabamun Hub AOR');
    expect(header.textContent).toContain('Well dossier');
    expect(header.textContent).toContain('IMPERIAL FT SASK 7-21');
    expect(header.textContent).toContain('Imperial Oil Limited');
    expect(header.querySelector('[data-rank="Moderate"]')?.textContent).toMatch(/^Moderate.*6$/);
    for (const text of ['L 1.8 × C 2.6', 'Cell 6', 'Index 4.6']) expect(within(header).getByText(text)).toBeTruthy();
    const meta = (label: string) => header.querySelector(`[data-meta="${label}"]`)?.textContent;
    expect(meta('revision')).toBe('Methodology rev2.0.0');
    expect(meta('reviewer')).toBe('ReviewerTahir Chisti');
    expect(meta('assessed')).toBe('Assessed2026-08-07');
    expect(meta('printed')).toBe('Printed2026-10-21');
    // The record, as on the well page.
    expect(header.textContent).toContain('Abandoned (P&A)');
    expect(header.textContent).toContain('Type 3');
    expect(header.textContent).toContain('1463.3 m');
    expect(header.textContent).toContain('53.764946, -113.207628');
  });

  it('prints the date it is printed on: a report left open is re-dated just before printing', async () => {
    const { container } = await renderDossier(FT_SASK.id);
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    vi.setSystemTime(new Date('2026-10-23T08:00:00.000Z'));
    act(() => {
      window.dispatchEvent(new Event('beforeprint'));
    });
    expect(section(container, 'header').querySelector('[data-meta="printed"]')?.textContent).toBe('Printed2026-10-23');
    expect(section(container, 'footer').querySelector('[data-attribution]')?.textContent).toBe(
      'Assessed by Tahir Chisti on 2026-08-07 · Methodology rev 2.0.0 · Printed 2026-10-23',
    );
  });

  it('ends with the attribution line and the identity footnote, exactly, and no phase wording anywhere', async () => {
    const { container } = await renderDossier(FT_SASK.id);
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    const footer = section(container, 'footer');
    expect(footer.querySelector('[data-attribution]')?.textContent).toBe(ATTRIBUTION);
    expect(footer.querySelector('[data-footnote]')?.textContent).toBe(FOOTNOTE);
    expect(container.textContent).not.toMatch(/phase/i);
  });

  it('summarises the verdict and the parameters scored 4 or higher; the action is labelled Automatic', async () => {
    const { container } = await renderDossier(FT_SASK.id);
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    expect(section(container, 'summary').textContent).toContain('Ranked Moderate: cell 6 of the 5 × 5 matrix');
    expect(section(container, 'summary').textContent).toContain('Penetration vs Storage Complex (4)');
    const action = section(container, 'action');
    expect(action.querySelector('[data-source]')?.textContent).toBe('Automatic');
    expect(action.textContent).toContain('Targeted Diagnostics + Watchlist');
    const scores = within(section(container, 'scores')).getByRole('table', { name: 'Scores' });
    expect(scores.querySelectorAll('tr[data-param]')).toHaveLength(11);
    expect(scores.querySelector('tr[data-subtotal="C"] td[data-column="contribution"]')?.textContent).toBe('2.60');
  });

  it('prints a reviewer override labelled as such, with the automatic recommendation beneath it, not folded away', async () => {
    const { container } = await renderDossier(FT_SASK.id, async (s) => {
      const draft = await s.assessments.saveDraft(FT_SASK.id, {
        scores: emptyScores(),
        justifications: {},
        override: 'Run a CBL before injection starts.',
        suggestions: {},
      });
      await s.assessments.finalise(draft.id);
    });
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    const action = section(container, 'action');
    expect(action.querySelector('[data-source]')?.textContent).toBe('Reviewer override');
    expect(action.textContent).toContain('Run a CBL before injection starts.');
    expect(action.textContent).toContain('Automatic recommendation');
    expect(action.querySelector('details')).toBeNull();
    expect(section(container, 'footer').querySelector('[data-attribution]')?.textContent).toBe(
      'Assessed by J. Doe on 2026-10-21 · Methodology rev 2.0.0 · Printed 2026-10-21',
    );
  });

  it('draws the stored construction in the light export palette, with its statistics in metres', async () => {
    const { container } = await renderDossier(FT_SASK.id, async (s) => {
      await s.wells.update(FT_SASK.id, {
        construction: {
          td: 1463.3,
          casings: [{ name: 'Surface Casing', od_mm: 219, top_m: 0, shoe_m: 186, toc_m: 0 }],
          plugs: [{ n: 1, kind: 'cement', top_m: 1448, bottom_m: 1463, sacks: 25 }],
        },
      });
    });
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    const construction = section(container, 'construction');
    const svg = construction.querySelector('svg')!;
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll('[data-kind="plug"]')).toHaveLength(1);
    expect(svg.outerHTML).not.toContain('var(--');
    expect(construction.querySelector('[data-stat="td"]')?.textContent).toBe('1463.3 m');
    expect(construction.textContent).not.toContain('Construction rows not drawn');
  });

  it('lists construction rows with depth errors under "Construction rows not drawn", with the reason, and leaves them out of the drawing', async () => {
    const { container } = await renderDossier(FT_SASK.id, async (s) => {
      await s.wells.update(FT_SASK.id, {
        construction: {
          td: 1500,
          plugs: [
            { n: 1, kind: 'cement', top_m: 1400, bottom_m: 1450 },
            { n: 2, kind: 'cement', top_m: 1463, bottom_m: 1448, source: 'extractor', verbatim: 'Plug 2: 1463/1448 m' },
          ],
        },
      });
    });
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    const construction = section(container, 'construction');
    expect(construction.querySelector('svg')?.querySelectorAll('[data-kind="plug"]')).toHaveLength(1);
    const notDrawn = within(construction).getByRole('region', { name: 'Construction rows not drawn' });
    const items = notDrawn.querySelectorAll('li');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Plug 2');
    expect(items[0]!.textContent).toContain('Top (m) is deeper than Bottom (m).');
    expect(items[0]!.textContent).toContain('Top (m) 1463, Bottom (m) 1448');
    expect(items[0]!.textContent).toContain('Plug 2: 1463/1448 m');
    // Stored after the assessment, so the summary says the record changed.
    expect(section(container, 'summary').textContent).toContain('The well record was changed on 2026-10-21, after this assessment.');
  });

  it('says "No construction records" when the well has none', async () => {
    const { container } = await renderDossier(FT_SASK.id);
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    expect(section(container, 'construction').textContent).toContain('No construction records');
    expect(section(container, 'construction').querySelector('svg')).toBeNull();
  });

  it('prints the well notes, or a dash when there are none', async () => {
    const { container, unmount } = await renderDossier(FT_SASK.id);
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    expect(section(container, 'notes').textContent).toContain('1953 D&A, Fort Saskatchewan field.');
    unmount();
    const second = await renderDossier(FT_SASK.id, async (s) => {
      await s.wells.update(FT_SASK.id, { notes: '' });
    });
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    expect(section(second.container, 'notes').querySelector('[data-notes]')?.textContent).toBe('—');
  });

  it('a draft in progress is not printed: the final is, with one line about the draft', async () => {
    const { container } = await renderDossier(FT_SASK.id, async (s) => {
      await s.assessments.saveDraft(FT_SASK.id, { scores: emptyScores(), justifications: {}, override: null, suggestions: {} });
    });
    await screen.findByRole('heading', { level: 1, name: FT_SASK.licence });
    expect(section(container, 'summary').textContent).toContain(
      'A draft re-assessment by J. Doe is in progress and not included.',
    );
    // The final's scores, not the draft's (every draft score is Unknown).
    const scores = within(section(container, 'scores')).getByRole('table', { name: 'Scores' });
    expect(scores.querySelector('tr[data-param="penetration"] td[data-column="score"]')?.textContent).toBe('4');
    expect(section(container, 'footer').querySelector('[data-attribution]')?.textContent).toBe(ATTRIBUTION);
  });

  it('an unscored well prints its record and construction with "Not yet assessed" in place of the assessment', async () => {
    const { container } = await renderDossier('', async (s) => {
      const well = await s.wells.create('prj_v2_fort-saskatchewan-wabamun-hub-aor', {
        licence: '102/16-30-055-21W4/00',
        name: 'NO SCORE 16-30',
        td_m: 900,
      });
      await s.wells.update(well.id, { construction: { plugs: [{ n: 1, kind: 'cement', top_m: 800, bottom_m: 850 }] } });
      return well.id;
    });
    await screen.findByRole('heading', { level: 1, name: '102/16-30-055-21W4/00' });
    expect(sections(container)).toEqual(['header', 'assessment', 'construction', 'notes', 'footer']);
    expect(section(container, 'header').textContent).toContain('Not yet assessed');
    expect(section(container, 'assessment').textContent).toContain('Not yet assessed');
    expect(screen.queryByRole('table', { name: 'Scores' })).toBeNull();
    expect(section(container, 'construction').querySelector('svg [data-kind="plug"]')).toBeTruthy();
    expect(section(container, 'footer').querySelector('[data-attribution]')?.textContent).toBe(
      'Not yet assessed · Printed 2026-10-21',
    );
    expect(section(container, 'footer').querySelector('[data-footnote]')?.textContent).toBe(FOOTNOTE);
  });

  it('shows anchors from the current revision, and says so, when the assessment’s revision is not in the project', async () => {
    const { container } = await renderDossier(REDWATER.id);
    await screen.findByRole('heading', { level: 1, name: REDWATER.licence });
    const note = 'Anchors and weights shown from rev 2.0.0; rev 1.0.0 is not available in this project.';
    expect(within(section(container, 'scores')).getByText(note)).toBeTruthy();
    expect(within(section(container, 'methodology')).getByText(note)).toBeTruthy();
    expect(within(section(container, 'methodology')).getByRole('table', { name: /Scoring parameters/ })).toBeTruthy();
    expect(within(section(container, 'methodology')).getByRole('table', { name: /Rank bands/ })).toBeTruthy();
    expect(section(container, 'summary').textContent).toContain('so this assessment is stale');
  });

  it('a failed projects read is an error with the detail and a way back, never an endless loading state', async () => {
    await renderDossier(FT_SASK.id, undefined, withFailingProjects);
    expect(await screen.findByRole('heading', { level: 1, name: 'The project could not be read' })).toBeTruthy();
    expect(screen.getByText(/IndexedDB read failed/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Wells' }).getAttribute('href')).toBe('/wells');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('an unknown id is "Well not found" with a link back to Wells', async () => {
    await renderDossier('wel_missing');
    expect(await screen.findByRole('heading', { name: 'Well not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Wells' }).getAttribute('href')).toBe('/wells');
  });

  it('a well of another project than the active one is "Well not found"', async () => {
    await renderDossier('', async (s) => {
      const other = await s.projects.create({ name: 'Other AOR' });
      const well = await s.wells.create(other.id, { licence: '100/01-01-001-01W5/00' });
      localStorage.setItem('lwa.activeProject', 'prj_v2_fort-saskatchewan-wabamun-hub-aor');
      return well.id;
    });
    expect(await screen.findByRole('heading', { name: 'Well not found' })).toBeTruthy();
    expect(screen.getByText(/belongs to another project/)).toBeTruthy();
  });
});
