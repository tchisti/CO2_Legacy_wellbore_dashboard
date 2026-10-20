import { describe, expect, it } from 'vitest';
import { emptyScores, type Assessment, type Well, type WellInput } from '@lwa/engine';
import { wellsHref } from '@/lib/routes';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  applyFilters,
  buildRows,
  filtersFromQuery,
  filtersToQuery,
  hasActiveFilters,
  nextSort,
  sortRows,
  wellRecordFields,
  type Filters,
  type WellRow,
} from '@/lib/wells-view';

/* ---------- fixtures ---------- */

function well(id: string, overrides: Partial<Well> = {}): Well {
  return {
    id,
    projectId: 'prj_1',
    licence: `100/${id}`,
    name: '',
    operator: '',
    lat: null,
    lon: null,
    spudYear: null,
    type: 'Unknown',
    trajectory: 'Unknown',
    status: 'Unknown',
    classification: 'Type 1',
    td_m: null,
    notes: '',
    construction: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'seed',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'seed',
    ...overrides,
  };
}

function final(wellId: string, computed: NonNullable<Assessment['computed']>, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: `asm_${wellId}`,
    wellId,
    methodologyRevision: '2.0.0',
    scores: { ...emptyScores(), plugQuality: 3, cement: 3, barriers: 2, scvf: 1, age: 4, complexity: 2, data: 3, penetration: 3, plume: 2, usdw: 2, access: 1 },
    justifications: {},
    suggestions: {},
    computed,
    recommendedAction: { auto: '', override: null },
    status: 'final',
    reviewerName: 'T. Chisti',
    assessedAt: '2026-02-01T00:00:00.000Z',
    supersedesId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function draft(wellId: string, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: `drf_${wellId}`,
    wellId,
    methodologyRevision: '2.0.0',
    scores: emptyScores(),
    justifications: {},
    suggestions: {},
    computed: null,
    recommendedAction: { auto: '', override: null },
    status: 'draft',
    reviewerName: 'A. Reviewer',
    assessedAt: null,
    supersedesId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-05T00:00:00.000Z',
    ...overrides,
  };
}

const MODERATE = { L: 1.76, C: 2.6, Lr: 2, Cr: 3, cell: 6, riskIndex: 4.58, rank: 'Moderate' };
const LOW = { L: 1.56, C: 2.4, Lr: 2, Cr: 2, cell: 4, riskIndex: 3.74, rank: 'Low' };

/** A register in every state: final (Moderate), final (Low), stale final, draft-only, final + draft, unscored. */
function register(): WellRow[] {
  const wells = [
    well('a', { licence: '100/07-21-055-22W4/00', name: 'IMPERIAL FT SASK 7-21', operator: 'Imperial Oil Limited', status: 'Abandoned (P&A)', classification: 'Type 3' }),
    well('b', { licence: '100/13-06-055-22W4/00', name: 'MANNING 13-6 WILDCAT', operator: 'Fred M. Manning Ltd.', status: 'Abandoned (P&A)', classification: 'Type 4' }),
    well('c', { licence: '100/13-05-056-22W4/00', name: 'SINOPEC REDWATER 13-5', operator: 'Sinopec Canada Energy Ltd.', status: 'Suspended', classification: 'Type 9' }),
    well('d', { licence: '100/03-17-056-22W4/00', name: 'PHOENIX REDWATER 3-17', operator: 'Phoenix Resources Company', status: 'Active', classification: 'Type 3' }),
    well('e', { licence: '100/08-19-055-22W4/00', name: 'ENBRIDGE 8-19', operator: 'Enbridge Wabamun Hub Ltd.', status: 'Abandoned (P&A)', classification: 'Type 7' }),
    well('f', { licence: '102/16-30-055-21W4/00', name: 'NO COORDS', operator: '', status: 'Unknown', classification: 'Type 1' }),
  ];
  const current = new Map<string, Assessment | null>([
    ['a', final('a', MODERATE)],
    ['b', final('b', LOW, { reviewerName: 'Tahir Chisti' })],
    ['c', final('c', { ...LOW, L: 1.52, C: 2, riskIndex: 3.04 }, { methodologyRevision: '1.0.0', scores: { ...emptyScores(), plugQuality: 2, cement: 2 } })],
    ['e', final('e', { ...LOW, L: 1.52, C: 1.85, riskIndex: 2.81 })],
  ]);
  const drafts = new Map<string, Assessment | null>([
    ['d', draft('d')],
    ['e', draft('e', { reviewerName: 'B. Second' })],
  ]);
  return buildRows(wells, current, drafts, '2.0.0');
}

const byId = (rows: WellRow[], id: string): WellRow => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};
const ids = (rows: WellRow[]) => rows.map((r) => r.id);
const filters = (f: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...f });

/* ---------- buildRows ---------- */

describe('buildRows', () => {
  it('buildRows: unscored well has null L/C/cell and state.kind "unscored"', () => {
    const row = byId(register(), 'f');
    expect(row).toMatchObject({
      L: null,
      C: null,
      Lr: null,
      Cr: null,
      cell: null,
      rank: null,
      riskIndex: null,
      unknownCount: null,
      reviewerName: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(row.state.kind).toBe('unscored');
    expect(row.state.label).toBe('Unscored');
  });

  it('buildRows: final assessment yields L/C at 2 decimals as stored and rank label', () => {
    const row = byId(register(), 'a');
    expect(row).toMatchObject({
      id: 'a',
      licence: '100/07-21-055-22W4/00',
      name: 'IMPERIAL FT SASK 7-21',
      operator: 'Imperial Oil Limited',
      type: 'Unknown',
      status: 'Abandoned (P&A)',
      classification: 'Type 3',
      spudYear: null,
      L: 1.76,
      C: 2.6,
      Lr: 2,
      Cr: 3,
      cell: 6,
      riskIndex: 4.58,
      rank: 'Moderate',
      reviewerName: 'T. Chisti',
    });
    expect(row.state).toMatchObject({ kind: 'final', label: 'Final' });
  });

  it('buildRows: unknownCount counts the null scores of the current final', () => {
    const rows = register();
    expect(byId(rows, 'a').unknownCount).toBe(0);
    expect(byId(rows, 'c').unknownCount).toBe(9); // only plugQuality and cement scored
  });

  it('buildRows: a final under an older minor revision is stale', () => {
    expect(byId(register(), 'c').state).toMatchObject({ kind: 'final', stale: { stale: true }, label: 'Stale revision' });
  });

  it('buildRows: a draft-only well is a draft by its reviewer, with no rank; updatedAt is its latest change', () => {
    const row = byId(register(), 'd');
    expect(row).toMatchObject({ rank: null, L: null, unknownCount: null, reviewerName: 'A. Reviewer', updatedAt: '2026-03-05T00:00:00.000Z' });
    expect(row.state).toMatchObject({ kind: 'draft', label: 'Draft by A. Reviewer' });
  });

  it('buildRows: a well with a final and a draft keeps the final’s numbers and reviewer, and shows the draft', () => {
    const row = byId(register(), 'e');
    expect(row).toMatchObject({ rank: 'Low', riskIndex: 2.81, reviewerName: 'T. Chisti', updatedAt: '2026-03-05T00:00:00.000Z' });
    expect(row.state.label).toBe('Draft by B. Second');
  });

  it('buildRows: updatedAt is the record’s own when it changed after its assessments', () => {
    const w = well('x', { updatedAt: '2026-06-01T00:00:00.000Z' });
    const [row] = buildRows([w], new Map([['x', final('x', LOW)]]), new Map(), '2.0.0');
    expect(row.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

/* ---------- applyFilters ---------- */

describe('applyFilters', () => {
  it('empty filters keep every row', () => {
    expect(applyFilters(register(), EMPTY_FILTERS)).toHaveLength(6);
  });

  it('applyFilters text matches licence, name, operator case-insensitively', () => {
    const rows = register();
    expect(ids(applyFilters(rows, filters({ text: 'sinopec' })))).toEqual(['c']); // operator and name
    expect(ids(applyFilters(rows, filters({ text: 'REDWATER' })))).toEqual(['c', 'd']); // name
    expect(ids(applyFilters(rows, filters({ text: '07-21-055' })))).toEqual(['a']); // licence
    expect(ids(applyFilters(rows, filters({ text: 'manning wildcat' })))).toEqual([]); // one substring, not words
    expect(ids(applyFilters(rows, filters({ text: '  fred m. MANNING  ' })))).toEqual(['b']); // trimmed
  });

  it('applyFilters state "stale" keeps only stale finals', () => {
    expect(ids(applyFilters(register(), filters({ state: ['stale'] })))).toEqual(['c']);
  });

  it('state "final" keeps current finals that are not stale; "unscored" is every well without a final; "draft" every well with a draft', () => {
    const rows = register();
    expect(ids(applyFilters(rows, filters({ state: ['final'] })))).toEqual(['a', 'b', 'e']);
    expect(ids(applyFilters(rows, filters({ state: ['unscored'] })))).toEqual(['d', 'f']);
    expect(ids(applyFilters(rows, filters({ state: ['draft'] })))).toEqual(['d', 'e']);
    expect(ids(applyFilters(rows, filters({ state: ['stale', 'unscored'] })))).toEqual(['c', 'd', 'f']);
  });

  it('values within one filter are alternatives; different filters must all match', () => {
    const rows = register();
    expect(ids(applyFilters(rows, filters({ rank: ['Low'] })))).toEqual(['b', 'c', 'e']);
    expect(ids(applyFilters(rows, filters({ rank: ['Low', 'Moderate'] })))).toEqual(['a', 'b', 'c', 'e']);
    expect(ids(applyFilters(rows, filters({ status: ['Active', 'Suspended'] })))).toEqual(['c', 'd']);
    expect(ids(applyFilters(rows, filters({ classification: ['Type 3'] })))).toEqual(['a', 'd']);
    expect(ids(applyFilters(rows, filters({ reviewer: ['Tahir Chisti', 'A. Reviewer'] })))).toEqual(['b', 'd']);
    expect(ids(applyFilters(rows, filters({ rank: ['Low'], status: ['Abandoned (P&A)'] })))).toEqual(['b', 'e']);
    expect(ids(applyFilters(rows, filters({ rank: ['Low'], text: 'redwater' })))).toEqual(['c']);
  });

  it('cell keeps the wells in that matrix cell (likelihood row Lr, consequence column Cr)', () => {
    const rows = register();
    expect(ids(applyFilters(rows, filters({ cell: { Lr: 2, Cr: 3 } })))).toEqual(['a']);
    expect(ids(applyFilters(rows, filters({ cell: { Lr: 2, Cr: 2 } })))).toEqual(['b', 'c', 'e']);
    expect(ids(applyFilters(rows, filters({ cell: { Lr: 3, Cr: 2 } })))).toEqual([]);
  });

  it('minUnknown keeps scored wells with at least that many unknown scores', () => {
    const rows = register();
    expect(ids(applyFilters(rows, filters({ minUnknown: 1 })))).toEqual(['c']);
    expect(ids(applyFilters(rows, filters({ minUnknown: 9 })))).toEqual(['c']);
    expect(ids(applyFilters(rows, filters({ minUnknown: 10 })))).toEqual([]);
  });

  it('hasActiveFilters is false only for the empty filters', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ text: '   ' }))).toBe(false);
    expect(hasActiveFilters(filters({ text: 'x' }))).toBe(true);
    expect(hasActiveFilters(filters({ reviewer: ['T. Chisti'] }))).toBe(true);
    expect(hasActiveFilters(filters({ cell: { Lr: 1, Cr: 1 } }))).toBe(true);
    expect(hasActiveFilters(filters({ minUnknown: 2 }))).toBe(true);
  });
});

/* ---------- sorting ---------- */

describe('sortRows', () => {
  it('default sort is riskIndex desc with unscored last', () => {
    // a 4.58, b 3.74, c 3.04, e 2.81; d and f unscored, by licence.
    expect(ids(sortRows(register(), DEFAULT_SORT))).toEqual(['a', 'b', 'c', 'e', 'd', 'f']);
  });

  it('breaks ties by licence, ascending', () => {
    const wells = [well('z', { licence: '100/09' }), well('y', { licence: '100/02' }), well('x', { licence: '100/10' })];
    const current = new Map(wells.map((w) => [w.id, final(w.id, LOW)]));
    expect(ids(sortRows(buildRows(wells, current, new Map(), '2.0.0'), DEFAULT_SORT))).toEqual(['y', 'z', 'x']);
  });

  it('sorts a text column either way, with blanks last both ways', () => {
    const rows = register();
    expect(ids(sortRows(rows, { key: 'operator', dir: 'asc' }))).toEqual(['e', 'b', 'a', 'd', 'c', 'f']);
    expect(ids(sortRows(rows, { key: 'operator', dir: 'desc' }))).toEqual(['c', 'd', 'a', 'b', 'e', 'f']);
  });

  it('sorts numbers either way, with missing values last both ways', () => {
    const rows = register();
    expect(ids(sortRows(rows, { key: 'riskIndex', dir: 'asc' }))).toEqual(['e', 'c', 'b', 'a', 'd', 'f']);
    expect(ids(sortRows(rows, { key: 'cell', dir: 'desc' }))).toEqual(['a', 'e', 'c', 'b', 'd', 'f']); // cell ties by licence
    // updatedAt: f 01-01; a, b, c 02-01 (by licence: a, c, b); d, e 03-05.
    expect(ids(sortRows(rows, { key: 'updatedAt', dir: 'asc' }))).toEqual(['f', 'a', 'c', 'b', 'd', 'e']);
  });

  it('sorts rank by severity (cell, then Risk Index)', () => {
    expect(ids(sortRows(register(), { key: 'rank', dir: 'desc' }))).toEqual(['a', 'b', 'c', 'e', 'd', 'f']);
    expect(ids(sortRows(register(), { key: 'rank', dir: 'asc' }))).toEqual(['e', 'c', 'b', 'a', 'd', 'f']);
  });

  it('does not change the rows it is given', () => {
    const rows = register();
    const before = ids(rows);
    sortRows(rows, { key: 'licence', dir: 'desc' });
    expect(ids(rows)).toEqual(before);
  });

  it('nextSort: a new column starts in its natural direction; the same column flips', () => {
    expect(nextSort(DEFAULT_SORT, 'licence')).toEqual({ key: 'licence', dir: 'asc' });
    expect(nextSort({ key: 'licence', dir: 'asc' }, 'licence')).toEqual({ key: 'licence', dir: 'desc' });
    expect(nextSort({ key: 'licence', dir: 'asc' }, 'cell')).toEqual({ key: 'cell', dir: 'desc' });
    expect(nextSort(DEFAULT_SORT, 'riskIndex')).toEqual({ key: 'riskIndex', dir: 'asc' });
  });
});

/* ---------- URL query ---------- */

/** The query string a filter set becomes, read back the way the page reads it. */
const roundTrip = (f: Filters): Filters => {
  const href = wellsHref(filtersToQuery(f));
  return filtersFromQuery(new URLSearchParams(href.split('?')[1] ?? ''));
};

describe('filtersToQuery / filtersFromQuery', () => {
  it('empty filters make the bare Wells URL, and an empty query reads as empty filters', () => {
    expect(wellsHref(filtersToQuery(EMPTY_FILTERS))).toBe('/wells');
    expect(filtersFromQuery(new URLSearchParams())).toEqual(EMPTY_FILTERS);
  });

  it('writes the agreed keys, arrays as repeated keys', () => {
    const f = filters({
      text: 'Sinopec',
      rank: ['Low', 'High'],
      status: ['Abandoned (P&A)'],
      classification: ['Type 3', 'Type 9'],
      state: ['stale'],
      reviewer: ['T. Chisti'],
      cell: { Lr: 2, Cr: 3 },
      minUnknown: 2,
    });
    expect(wellsHref(filtersToQuery(f))).toBe(
      '/wells?Cr=3&Lr=2&class=Type%203&class=Type%209&minUnknown=2&q=Sinopec&rank=Low&rank=High&reviewer=T.%20Chisti&state=stale&status=Abandoned%20(P%26A)',
    );
  });

  it('round-trips every filter', () => {
    const f = filters({
      text: '100/07-21 & co',
      rank: ['Very High', 'Low'],
      status: ['Abandoned (P&A)', 'Unknown'],
      classification: ['Type 1'],
      state: ['unscored', 'draft', 'final', 'stale'],
      reviewer: ['Unknown (v2)', 'T. Chisti'],
      cell: { Lr: 5, Cr: 1 },
      minUnknown: 11,
    });
    expect(roundTrip(f)).toEqual(f);
    expect(roundTrip(filters({ text: 'x' }))).toEqual(filters({ text: 'x' }));
    expect(roundTrip(filters({ minUnknown: 1 }))).toEqual(filters({ minUnknown: 1 }));
  });

  it('ignores values it does not know, and drops repeats', () => {
    const params = new URLSearchParams(
      'status=Active&status=Sideways&status=Active&class=Type%2010&class=Type%202&state=archived&state=draft&rank=&rank=Low&rank=Low&reviewer=&Lr=2&Cr=9&minUnknown=0&q=',
    );
    expect(filtersFromQuery(params)).toEqual(
      filters({ status: ['Active'], classification: ['Type 2'], state: ['draft'], rank: ['Low'] }),
    );
  });

  it('needs both halves of a matrix cell, as whole numbers from 1 to 5', () => {
    expect(filtersFromQuery(new URLSearchParams('Lr=2')).cell).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('Lr=2&Cr=2.5')).cell).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('Lr=0&Cr=2')).cell).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('Lr=1&Cr=5')).cell).toEqual({ Lr: 1, Cr: 5 });
  });

  it('takes minUnknown as a whole number from 1 to the number of parameters', () => {
    expect(filtersFromQuery(new URLSearchParams('minUnknown=12')).minUnknown).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('minUnknown=two')).minUnknown).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('minUnknown=1.5')).minUnknown).toBeUndefined();
    expect(filtersFromQuery(new URLSearchParams('minUnknown=3')).minUnknown).toBe(3);
  });
});

/* ---------- well record form ---------- */

describe('wellRecordFields', () => {
  it('keeps only the record fields the form edits, so a save never touches construction or the v1 legacy block', () => {
    const parsed = {
      licence: '100/01',
      name: 'N',
      operator: 'O',
      lat: null,
      lon: 1,
      spudYear: 1950,
      type: 'Unknown',
      trajectory: 'Vertical',
      status: 'Active',
      classification: 'Type 2',
      td_m: 1000,
      notes: '',
      construction: null,
      legacyV1: { scores: {}, total: 0 },
    } satisfies WellInput;
    expect(wellRecordFields(parsed)).toEqual({
      licence: '100/01',
      name: 'N',
      operator: 'O',
      lat: null,
      lon: 1,
      spudYear: 1950,
      type: 'Unknown',
      trajectory: 'Vertical',
      status: 'Active',
      classification: 'Type 2',
      td_m: 1000,
      notes: '',
    });
  });
});
