import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METHODOLOGY, emptyScores, type Assessment, type Well } from '@lwa/engine';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WellHeader } from '@/components/well/WellHeader';
import { assessmentState } from '@/lib/derived';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/wells/view',
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

const WELL: Well = {
  id: 'wel_1',
  projectId: 'prj_1',
  licence: '100/07-21-055-22W4/00',
  name: 'IMPERIAL FT SASK 7-21',
  operator: 'Imperial Oil Limited',
  lat: 53.764946,
  lon: -113.207628,
  spudYear: 1953,
  type: 'Strat Test',
  trajectory: 'Vertical',
  status: 'Abandoned (P&A)',
  classification: 'Type 3',
  td_m: 1463.3,
  notes: '',
  construction: null,
  createdAt: '2026-07-24T12:15:02.272Z',
  createdBy: 'Tahir Chisti',
  updatedAt: '2026-08-07T16:16:21.843Z',
  updatedBy: 'Tahir Chisti',
};

function assessment(overrides: Partial<Assessment>): Assessment {
  return {
    id: 'asm_1',
    wellId: WELL.id,
    methodologyRevision: '2.0.0',
    scores: emptyScores(),
    justifications: {},
    suggestions: {},
    computed: { L: 1.76, C: 2.6, Lr: 2, Cr: 3, cell: 6, riskIndex: 4.58, rank: 'Moderate' },
    recommendedAction: { auto: '', override: null },
    status: 'final',
    reviewerName: 'Tahir Chisti',
    assessedAt: '2026-08-07T16:16:21.843Z',
    supersedesId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: '2026-08-07T16:16:21.843Z',
    updatedAt: '2026-08-07T16:16:21.843Z',
    ...overrides,
  };
}

function renderHeader(args: { well?: Well; current: Assessment | null; draft?: Assessment | null; currentRevision: string }) {
  const well = args.well ?? WELL;
  const draft = args.draft ?? null;
  const state = assessmentState({ current: args.current, draft, well, currentRevision: args.currentRevision });
  render(
    <TooltipProvider>
      <WellHeader
        well={well}
        current={args.current}
        draft={draft}
        state={state}
        currentRevision={args.currentRevision}
        wellTypes={DEFAULT_METHODOLOGY.wellTypes}
        onEdit={() => {}}
      />
    </TooltipProvider>,
  );
}

const badge = (text: string) => {
  const el = screen.getByText(text).closest<HTMLElement>('[data-tone]');
  if (!el) throw new Error(`no badge around "${text}"`);
  return el;
};

describe('WellHeader state badges', () => {
  it('"Stale revision" is amber; "Record changed since assessment" and "Draft by …" stay neutral', () => {
    renderHeader({
      well: { ...WELL, updatedAt: '2026-10-20T10:00:00.000Z' },
      current: assessment({ methodologyRevision: '1.0.0' }),
      draft: assessment({ id: 'asm_d', status: 'draft', computed: null, assessedAt: null, reviewerName: 'T. Chisti' }),
      currentRevision: '2.0.0',
    });
    expect(badge('Stale revision').dataset.tone).toBe('warn');
    expect(badge('Record changed since assessment').dataset.tone).toBe('neutral');
    expect(badge('Draft by T. Chisti').dataset.tone).toBe('neutral');
  });

  it('a wording-only revision shows a neutral note and no stale badge', () => {
    renderHeader({ current: assessment({}), currentRevision: '2.0.1' });
    expect(badge('assessed under 2.0.0 (current 2.0.1, wording only)').dataset.tone).toBe('neutral');
    expect(screen.queryByText('Stale revision')).toBeNull();
  });

  it('a current assessment shows neither', () => {
    renderHeader({ current: assessment({}), currentRevision: '2.0.0' });
    expect(screen.queryByText('Stale revision')).toBeNull();
    expect(screen.queryByText(/wording only/)).toBeNull();
  });
});
