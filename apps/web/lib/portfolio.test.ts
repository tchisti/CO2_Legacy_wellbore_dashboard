import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METHODOLOGY,
  ProjectExportSchema,
  emptyScores,
  type Assessment,
  type Methodology,
  type Scores,
  type Well,
} from '@lwa/engine';
import { ATTENTION_MAX, UNKNOWN_HEAVY_MIN, portfolioStats, wellsFilterHref } from '@/lib/portfolio';
import { buildRows } from '@/lib/wells-view';

/* ---------- the Fort Saskatchewan fixture (5 wells, all with current finals) ---------- */

const FIXTURE = ProjectExportSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8')),
);

/** The fixture as the Portfolio page reads it: rows plus each well's current final, under rev 2.0.0. */
function fixtureStats() {
  const m = FIXTURE.methodologies[0]!.methodology;
  const finals = FIXTURE.assessments.filter((a) => a.status === 'final');
  const current = new Map(FIXTURE.wells.map((w) => [w.id, finals.find((a) => a.wellId === w.id) ?? null]));
  const rows = buildRows(FIXTURE.wells, current, new Map(), m.revision);
  return portfolioStats(rows, finals, m);
}

describe('portfolioStats with the Fort Saskatchewan fixture', () => {
  it('byRank Low 4, Moderate 1, High 0, Very High 0; total 5; stale 1; unscored 0', () => {
    const s = fixtureStats();
    expect(s.byRank).toEqual({ Low: 4, Moderate: 1, High: 0, 'Very High': 0 });
    expect(s.total).toBe(5);
    expect(s.finals).toBe(5);
    expect(s.stale).toBe(1);
    expect(s.unscored).toBe(0);
    expect(s.draft).toBe(0);
    expect(s.unknownHeavy).toBe(0);
    expect(s.recordChanged).toBe(0);
  });

  it('matrix[1][2] (Lr 2, Cr 3) === 1 and the matrix sums to the number of finals', () => {
    const { matrix } = fixtureStats();
    expect(matrix).toHaveLength(5);
    for (const row of matrix) expect(row).toHaveLength(5);
    expect(matrix[1]![2]).toBe(1);
    expect(matrix[1]![1]).toBe(4);
    expect(matrix.flat().reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('drivers sorted by avgContribution desc; penetration first', () => {
    const { drivers } = fixtureStats();
    expect(drivers).toHaveLength(11);
    const values = drivers.map((d) => d.avgContribution);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    // penetration: weight 0.30 × mean(5, 3, 4, 1, 4) = 1.02
    expect(drivers[0]).toEqual({ key: 'penetration', name: 'Penetration vs Storage Complex', avgContribution: 1.02 });
    // plume: 0.25 × mean(1, 2, 3, 3, 1) = 0.50; scvf: 0.16 × mean(2, ?→3, 2, ?→3, 3) = 0.416
    expect(drivers[1]).toMatchObject({ key: 'plume', avgContribution: 0.5 });
    expect(drivers.find((d) => d.key === 'scvf')?.avgContribution).toBeCloseTo(0.416, 9);
  });

  it('attention lists the stale well with reason "Assessed under 1.0.0"', () => {
    const s = fixtureStats();
    expect(s.attention).toEqual([
      {
        wellId: 'wel_v2_W-LX242Q',
        licence: '100/13-05-056-22W4/00',
        name: 'SINOPEC REDWATER 13-5',
        kind: 'stale',
        reason: 'Assessed under 1.0.0',
      },
    ]);
    expect(s.attentionTotal).toBe(1);
  });
});

/* ---------- hand-built registers ---------- */

const T0 = '2026-01-01T00:00:00.000Z';
const ASSESSED = '2026-02-01T00:00:00.000Z';
const LATER = '2026-03-01T00:00:00.000Z';

function well(id: string, overrides: Partial<Well> = {}): Well {
  return {
    id,
    projectId: 'prj_1',
    licence: `100/${id}`,
    name: `WELL ${id.toUpperCase()}`,
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
    createdAt: T0,
    createdBy: 'seed',
    updatedAt: T0,
    updatedBy: 'seed',
    ...overrides,
  };
}

const ALL_THREES: Scores = {
  plugQuality: 3,
  cement: 3,
  barriers: 3,
  scvf: 3,
  age: 3,
  complexity: 3,
  data: 3,
  penetration: 3,
  plume: 3,
  usdw: 3,
  access: 3,
};

type Computed = NonNullable<Assessment['computed']>;
const LOW: Computed = { L: 1.5, C: 2, Lr: 2, Cr: 2, cell: 4, riskIndex: 3, rank: 'Low' };
const MODERATE: Computed = { L: 2, C: 3, Lr: 2, Cr: 3, cell: 6, riskIndex: 6, rank: 'Moderate' };
const HIGH: Computed = { L: 3, C: 4, Lr: 3, Cr: 4, cell: 12, riskIndex: 12, rank: 'High' };

function final(wellId: string, computed: Computed, overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: `asm_${wellId}`,
    wellId,
    methodologyRevision: '2.0.0',
    scores: ALL_THREES,
    justifications: {},
    suggestions: {},
    computed,
    recommendedAction: { auto: '', override: null },
    status: 'final',
    reviewerName: 'T. Chisti',
    assessedAt: ASSESSED,
    supersedesId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: ASSESSED,
    updatedAt: ASSESSED,
    ...overrides,
  };
}

function draft(wellId: string, reviewerName = 'A. Reviewer'): Assessment {
  return {
    ...final(wellId, LOW),
    id: `drf_${wellId}`,
    scores: emptyScores(),
    computed: null,
    status: 'draft',
    reviewerName,
    assessedAt: null,
  };
}

/** Four of the 11 parameters Unknown. */
const FOUR_UNKNOWN: Scores = { ...ALL_THREES, scvf: null, complexity: null, usdw: null, access: null };

/**
 * Builds rows and stats for wells with (optional) current finals and drafts, under `m`
 * (default: the shipped 2.0.0 methodology).
 */
function statsOf(
  entries: { well: Well; current?: Assessment; draft?: Assessment }[],
  m: Methodology = DEFAULT_METHODOLOGY,
) {
  const current = new Map(entries.map((e) => [e.well.id, e.current ?? null]));
  const drafts = new Map(entries.map((e) => [e.well.id, e.draft ?? null]));
  const rows = buildRows(
    entries.map((e) => e.well),
    current,
    drafts,
    m.revision,
  );
  const finals = entries.flatMap((e) => (e.current ? [e.current] : []));
  return portfolioStats(rows, finals, m);
}

describe('portfolioStats rules', () => {
  it('an empty project: zeros everywhere, all four rank labels present, no drivers, nothing needs attention', () => {
    const s = statsOf([]);
    expect(s).toEqual({
      total: 0,
      finals: 0,
      byRank: { Low: 0, Moderate: 0, High: 0, 'Very High': 0 },
      unscored: 0,
      draft: 0,
      stale: 0,
      unknownHeavy: 0,
      recordChanged: 0,
      matrix: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
      drivers: [],
      attention: [],
      attentionTotal: 0,
    });
  });

  it('no finals yet: KPIs count the unscored wells, the matrix is empty, attention lists them as "Not yet assessed"', () => {
    const s = statsOf([{ well: well('b') }, { well: well('a') }]);
    expect(s.total).toBe(2);
    expect(s.finals).toBe(0);
    expect(s.unscored).toBe(2);
    expect(s.byRank).toEqual({ Low: 0, Moderate: 0, High: 0, 'Very High': 0 });
    expect(s.matrix.flat().every((n) => n === 0)).toBe(true);
    expect(s.drivers).toEqual([]);
    expect(s.attention).toEqual([
      { wellId: 'a', licence: '100/a', name: 'WELL A', kind: 'unscored', reason: 'Not yet assessed' },
      { wellId: 'b', licence: '100/b', name: 'WELL B', kind: 'unscored', reason: 'Not yet assessed' },
    ]);
  });

  it('drafts and unscored wells stay out of the matrix and byRank; a draft beside a final counts once in each', () => {
    const s = statsOf([
      { well: well('a'), current: final('a', MODERATE) },
      { well: well('b'), current: final('b', HIGH), draft: draft('b') },
      { well: well('c'), draft: draft('c') },
      { well: well('d') },
    ]);
    expect(s.matrix[1]![2]).toBe(1);
    expect(s.matrix[2]![3]).toBe(1);
    expect(s.matrix.flat().reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.byRank).toEqual({ Low: 0, Moderate: 1, High: 1, 'Very High': 0 });
    expect(s.finals).toBe(2);
    expect(s.unscored).toBe(2); // c (draft only) and d
    expect(s.draft).toBe(2); // b and c
  });

  it('recordChanged counts current finals whose record was edited after they were assessed', () => {
    const s = statsOf([
      { well: well('a', { updatedAt: LATER }), current: final('a', LOW) },
      { well: well('b', { updatedAt: ASSESSED }), current: final('b', LOW) },
      { well: well('c', { updatedAt: LATER }) }, // no final: nothing to be out of date
    ]);
    expect(s.recordChanged).toBe(1);
    expect(s.attention.find((x) => x.wellId === 'a')).toMatchObject({
      kind: 'recordChanged',
      reason: 'Record changed since assessment',
    });
  });

  it(`unknown-heavy: current finals with at least ${UNKNOWN_HEAVY_MIN} Unknown scores, reason "<N> parameters Unknown"`, () => {
    const s = statsOf([
      { well: well('a'), current: final('a', LOW, { scores: FOUR_UNKNOWN }) },
      { well: well('b'), current: final('b', LOW, { scores: { ...FOUR_UNKNOWN, usdw: 3 } }) }, // 3 Unknown
      { well: well('c'), current: final('c', LOW, { scores: { ...FOUR_UNKNOWN, plume: null } }) },
    ]);
    expect(s.unknownHeavy).toBe(2);
    expect(s.attention.map((x) => [x.wellId, x.reason])).toEqual([
      ['a', '4 parameters Unknown'],
      ['c', '5 parameters Unknown'],
    ]);
  });

  it('attention order: stale, record changed, unknown-heavy, draft, unscored; each well once, under its first reason', () => {
    const s = statsOf([
      { well: well('unscored') },
      { well: well('draft'), draft: draft('draft', 'B. Second') },
      { well: well('unknown'), current: final('unknown', LOW, { scores: FOUR_UNKNOWN }) },
      { well: well('changed', { updatedAt: LATER }), current: final('changed', LOW) },
      // stale, record changed, unknown-heavy and with a draft: listed once, as stale
      {
        well: well('stale', { updatedAt: LATER }),
        current: final('stale', LOW, { methodologyRevision: '1.0.0', scores: FOUR_UNKNOWN }),
        draft: draft('stale'),
      },
      { well: well('fine'), current: final('fine', HIGH) },
    ]);
    expect(s.attention.map((x) => [x.wellId, x.kind, x.reason])).toEqual([
      ['stale', 'stale', 'Assessed under 1.0.0'],
      ['changed', 'recordChanged', 'Record changed since assessment'],
      ['unknown', 'unknownHeavy', '4 parameters Unknown'],
      ['draft', 'draft', 'Draft by B. Second'],
      ['unscored', 'unscored', 'Not yet assessed'],
    ]);
    expect(s.attentionTotal).toBe(5);
    // The KPIs still count every state a well is in.
    expect(s.stale).toBe(1);
    expect(s.recordChanged).toBe(2);
    expect(s.unknownHeavy).toBe(2);
    expect(s.draft).toBe(2);
  });

  it('a patch revision (wording only) is not stale and does not need attention', () => {
    const s = statsOf([{ well: well('a'), current: final('a', LOW, { methodologyRevision: '2.0.0' }) }], {
      ...DEFAULT_METHODOLOGY,
      revision: '2.0.1',
    });
    expect(s.stale).toBe(0);
    expect(s.attention).toEqual([]);
  });

  it('within a reason, riskiest first, then by licence', () => {
    const s = statsOf([
      { well: well('a', { licence: '100/B' }), current: final('a', LOW, { methodologyRevision: '1.0.0' }) },
      { well: well('b', { licence: '100/A' }), current: final('b', LOW, { methodologyRevision: '1.0.0' }) },
      { well: well('c', { licence: '100/C' }), current: final('c', HIGH, { methodologyRevision: '1.0.0' }) },
    ]);
    expect(s.attention.map((x) => x.licence)).toEqual(['100/C', '100/A', '100/B']);
  });

  it(`attention returns at most ${ATTENTION_MAX} wells; attentionTotal counts them all`, () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({ well: well(`w${String(i).padStart(2, '0')}`) }));
    const s = statsOf(entries);
    expect(ATTENTION_MAX).toBe(8);
    expect(s.attention).toHaveLength(8);
    expect(s.attentionTotal).toBe(11);
    expect(s.attention.map((x) => x.wellId)).toEqual(['w00', 'w01', 'w02', 'w03', 'w04', 'w05', 'w06', 'w07']);
  });

  it('drivers: mean of weight × score over current finals; Unknown counts at the unknown score; drafts ignored', () => {
    const s = statsOf([
      { well: well('a'), current: final('a', LOW, { scores: { ...ALL_THREES, penetration: 5 } }) },
      { well: well('b'), current: final('b', LOW, { scores: { ...ALL_THREES, penetration: null } }) }, // unknown → 5
      { well: well('c'), draft: { ...draft('c'), scores: { ...ALL_THREES, plugQuality: 5 } } },
    ]);
    expect(s.drivers).toHaveLength(11);
    expect(s.drivers[0]).toEqual({ key: 'penetration', name: 'Penetration vs Storage Complex', avgContribution: 1.5 });
    expect(s.drivers.find((d) => d.key === 'plugQuality')?.avgContribution).toBe(0.66); // 0.22 × 3, the draft's 5 unused
  });

  it('drivers use the current methodology, whatever revision a final was assessed under', () => {
    const m: Methodology = {
      ...DEFAULT_METHODOLOGY,
      revision: '3.0.0',
      params: DEFAULT_METHODOLOGY.params.map((p) => (p.key === 'access' ? { ...p, weight: 0.5, unknownScore: 4 } : p)),
    };
    const s = statsOf([{ well: well('a'), current: final('a', LOW, { scores: { ...ALL_THREES, access: null } }) }], m);
    expect(s.drivers[0]).toEqual({ key: 'access', name: 'Corrective-Action Accessibility', avgContribution: 2 });
  });

  it('drivers: equal contributions keep methodology order, even through floating-point noise', () => {
    // age, complexity and data (weight 0.1) at 3 give 0.1 × 3 = 0.30000000000000004; penetration
    // (weight 0.3) at 1 gives exactly 0.3. All four are equal at 0.3, so they keep methodology order.
    const scores: Scores = {
      plugQuality: 1, // 0.22
      cement: 1, // 0.20
      barriers: 1, // 0.12
      scvf: 1, // 0.16
      age: 3,
      complexity: 3,
      data: 3,
      penetration: 1,
      plume: 1, // 0.25
      usdw: 1, // 0.25
      access: 1, // 0.20
    };
    const s = statsOf([{ well: well('a'), current: final('a', LOW, { scores }) }]);
    expect(s.drivers.map((d) => d.key)).toEqual([
      'age',
      'complexity',
      'data',
      'penetration',
      'plume',
      'usdw',
      'plugQuality',
      'cement',
      'access',
      'scvf',
      'barriers',
    ]);
    expect(s.drivers[0]!.avgContribution).toBe(0.3);
  });

  it('finals of wells outside the rows are not counted', () => {
    const m = DEFAULT_METHODOLOGY;
    const rows = buildRows([well('a')], new Map([['a', final('a', LOW)]]), new Map(), m.revision);
    const stray = final('zz', HIGH, { scores: { ...ALL_THREES, penetration: 5 } });
    const s = portfolioStats(rows, [final('a', LOW), stray], m);
    expect(s.drivers.find((d) => d.key === 'penetration')?.avgContribution).toBe(0.9); // 0.3 × 3, a only
  });
});

describe('wellsFilterHref', () => {
  it('links into the Wells register with one filter set', () => {
    expect(wellsFilterHref({ cell: { Lr: 2, Cr: 3 } })).toBe('/wells?Cr=3&Lr=2');
    expect(wellsFilterHref({ state: ['stale'] })).toBe('/wells?state=stale');
    expect(wellsFilterHref({ rank: ['Very High'] })).toBe('/wells?rank=Very%20High');
    expect(wellsFilterHref({ minUnknown: UNKNOWN_HEAVY_MIN })).toBe('/wells?minUnknown=4');
    expect(wellsFilterHref({})).toBe('/wells');
  });
});
