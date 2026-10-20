import { describe, expect, it } from 'vitest';
import { recommend, recommendationText } from './recommend';
import { DEFAULT_METHODOLOGY, computeWell, emptyScores, type Methodology } from './scoring';
import { PARAM_KEYS, type Score, type Scores } from './types';

const M = DEFAULT_METHODOLOGY;

/** Every param set to `base`, then `overrides` applied on top. */
function scoresOf(base: Score | null, overrides: Partial<Scores> = {}): Scores {
  const s = emptyScores();
  for (const k of PARAM_KEYS) s[k] = base;
  return { ...s, ...overrides };
}

// The eight action strings and the warn string, as plain text from v2 index.html recommend().
const A_BARRIER =
  'Pressure-test surface casing vent + annular buildup (§ 8.1); if leak confirmed → squeeze cement or full re-abandonment (§ 8.2).';
const A_CEMENT =
  'Run CBL/VDL or ultrasonic imaging across caprock interval; top-up annular cement via perforate-and-squeeze if TOC is below caprock.';
const A_SCVF =
  'Active/unrepaired SCVF-GM: bubble test + vent-flow measurement per AER ID 2003-01; repair before injection start-up.';
const A_MONITOR =
  'Stage dedicated monitoring well + soil-gas + satellite CO₂ surveillance — well is inside high-consequence corridor.';
const A_USDW =
  'Confirm BGWP/USDW isolation: surface-casing records + cement returns; if open pathway confirmed, prioritize corrective action per 40 CFR 146.84(d).';
const A_ACCESS =
  'Engage Orphan Well Association / regulator (§ 9–10); if inaccessible, default to long-term flux + satellite monitoring (§ 8.3).';
const A_AGE =
  'Treat all pre-1976 tubulars as analog to API 5L pre-NACE; assume corrosion-prone carbon steel and de-rate barrier credit.';
const A_DATA =
  'Flag as "Undocumented / Unverified abandonment" (§ 6.6) and carry conservative analog assumptions until logged.';
const WARN =
  'Per CSA Z741 § 9 / EPA Class VI 40 CFR 146.84(d), high-risk wells inside AoR require corrective action plan before injection authorization.';

const ALL_ACTIONS = [A_BARRIER, A_CEMENT, A_SCVF, A_MONITOR, A_USDW, A_ACCESS, A_AGE, A_DATA];

const MODERATE_SUMMARY =
  'Moderate Tier. Add to MMV watchlist (§ 8.3). Recommended diagnostics: SCVF pressure test, annular surveillance, CBL across caprock if cement data is partial. Re-score on every MMV re-evaluation (3-year AER / 5-year EPA cadence). Drivers worth closing: data gaps only.';
const LOW_SUMMARY =
  'Low Tier. Well is adequately documented and unlikely to act as a migration pathway. Carry through as background population; re-evaluate on AoR refresh or if plume forecast shifts.';

describe('recommend: Low tier', () => {
  it('all-1 → title "No Further Action — Monitor at MMV Cycle", actions [], warn null', () => {
    const r = recommend(scoresOf(1), M);
    expect(r.tier).toBe('low');
    expect(r.title).toBe('No Further Action — Monitor at MMV Cycle');
    expect(r.summary).toBe(LOW_SUMMARY);
    expect(r.drivers).toEqual([]);
    expect(r.actions).toEqual([]);
    expect(r.warn).toBeNull();
  });
});

describe('recommend: Moderate tier', () => {
  it('all-3 → title "Targeted Diagnostics + Watchlist", 3-year AER / 5-year EPA cadence, drivers []', () => {
    const r = recommend(scoresOf(3), M);
    expect(r.tier).toBe('mod');
    expect(r.title).toBe('Targeted Diagnostics + Watchlist');
    expect(r.summary).toContain('3-year AER / 5-year EPA cadence');
    expect(r.summary).toBe(MODERATE_SUMMARY);
    expect(r.drivers).toEqual([]);
    expect(r.actions).toEqual([]);
    expect(r.warn).toBeNull();
  });

  it('lists the drivers worth closing when a Moderate well has a score of 4', () => {
    // Weights keep L and C at 3 after rounding, so the cell stays at 9 (Moderate).
    const r = recommend(scoresOf(3, { age: 4 }), M);
    expect(r.tier).toBe('mod');
    expect(r.drivers).toEqual(['Well Age & Regulatory Era']);
    expect(r.summary.endsWith('Drivers worth closing: Well Age & Regulatory Era.')).toBe(true);
    expect(r.actions).toEqual([]);
  });
});

describe('recommend: High tier', () => {
  it('all-null → tier "high", unknowns score 5, with the matching actions and warn', () => {
    const r = recommend(scoresOf(null), M);
    expect(computeWell(scoresOf(null), M).cell).toBe(16);
    expect(r.tier).toBe('high');
    expect(r.title).toBe('Re-entry + Mitigation Required');
    expect(r.drivers).toEqual([
      'Abandonment & Plug Quality',
      'Cement Coverage & Quality',
      'Well Age & Regulatory Era',
      'Data Confidence',
      'Penetration vs Storage Complex',
    ]);
    expect(r.summary).toBe(
      'Tier High — re-entry diagnostics + mitigation candidate. Key drivers: Abandonment & Plug Quality, Cement Coverage & Quality, Well Age & Regulatory Era, Data Confidence, Penetration vs Storage Complex.',
    );
    expect(r.actions).toEqual([A_BARRIER, A_CEMENT, A_MONITOR, A_AGE, A_DATA]);
    expect(r.warn).toBe(WARN);
    expect(r.warn?.startsWith('Per CSA Z741 § 9')).toBe(true);
  });

  it('only the actions whose driver ≥4 appear: all-3 except cement:5 and penetration:5 → exactly the CBL/VDL and monitoring-well actions', () => {
    const scores = scoresOf(3, { cement: 5, penetration: 5 });
    expect(computeWell(scores, M).cell).toBe(12);
    const r = recommend(scores, M);
    expect(r.tier).toBe('high');
    expect(r.drivers).toEqual(['Cement Coverage & Quality', 'Penetration vs Storage Complex']);
    expect(r.actions).toEqual([A_CEMENT, A_MONITOR]);
    expect(r.warn).toBe(WARN);
  });

  it('with no driver ≥4 there is no action, even at a Moderate cell', () => {
    expect(recommend(scoresOf(3), M).actions).toEqual([]);
  });

  it('a High well with no key drivers says "none flagged"', () => {
    // A custom rulebook that puts cell 9 in the High band, so no param needs to score 4+.
    const custom: Methodology = {
      ...M,
      matrix: {
        bands: M.matrix.bands.map((b) =>
          b.cls === 'high' ? { ...b, min: 9 } : b.cls === 'mod' ? { ...b, max: 8 } : b,
        ),
      },
    };
    const r = recommend(scoresOf(3), custom);
    expect(r.tier).toBe('high');
    expect(r.summary).toBe('Tier High — re-entry diagnostics + mitigation candidate. Key drivers: none flagged.');
    expect(r.actions).toEqual([]);
    expect(r.warn).toBe(WARN);
  });
});

describe('recommend: Very High (crit) tier', () => {
  it('all-5 → tier "crit", every driver, all eight actions in v2 order', () => {
    const r = recommend(scoresOf(5), M);
    expect(r.tier).toBe('crit');
    expect(r.title).toBe('Re-entry + Mitigation Required');
    expect(r.drivers).toEqual(M.params.map((p) => p.name));
    expect(r.summary.startsWith('Tier Very High — re-entry diagnostics + mitigation candidate. Key drivers: ')).toBe(true);
    expect(r.actions).toEqual(ALL_ACTIONS);
    expect(r.warn).toBe(WARN);
  });
});

describe('recommend: each action is gated on its own driver', () => {
  // Start from all-5 (every action present) and drop the named params to 1; the tier stays High+.
  it.each([
    ['plugQuality + barriers', { plugQuality: 1, barriers: 1 }, A_BARRIER],
    ['cement', { cement: 1 }, A_CEMENT],
    ['scvf', { scvf: 1 }, A_SCVF],
    ['plume + penetration', { plume: 1, penetration: 1 }, A_MONITOR],
    ['usdw', { usdw: 1 }, A_USDW],
    ['access', { access: 1 }, A_ACCESS],
    ['age', { age: 1 }, A_AGE],
    ['data', { data: 1 }, A_DATA],
  ] as const)('dropping %s removes exactly its action', (_label, overrides, removed) => {
    const r = recommend(scoresOf(5, overrides), M);
    expect(['high', 'crit']).toContain(r.tier);
    expect(r.actions).toEqual(ALL_ACTIONS.filter((a) => a !== removed));
  });

  it.each([
    ['plugQuality alone', { plugQuality: 1 }],
    ['barriers alone', { barriers: 1 }],
    ['plume alone', { plume: 1 }],
    ['penetration alone', { penetration: 1 }],
  ] as const)('dropping %s keeps the either/or action', (_label, overrides) => {
    expect(recommend(scoresOf(5, overrides), M).actions).toEqual(ALL_ACTIONS);
  });
});

describe('recommendationText', () => {
  it('Moderate: title line, then the summary line', () => {
    const text = recommendationText(recommend(scoresOf(3), M));
    expect(text.startsWith('Targeted Diagnostics + Watchlist\nModerate Tier. Add to MMV watchlist (§ 8.3). ')).toBe(true);
    expect(text).toBe(`Targeted Diagnostics + Watchlist\n${MODERATE_SUMMARY}`);
  });

  it('Low: title line, then the summary line', () => {
    expect(recommendationText(recommend(scoresOf(1), M))).toBe(
      `No Further Action — Monitor at MMV Cycle\n${LOW_SUMMARY}`,
    );
  });

  it('High: title, summary, one "- action" line per action, then the warn line', () => {
    const r = recommend(scoresOf(3, { cement: 5, penetration: 5 }), M);
    expect(recommendationText(r)).toBe(
      [
        'Re-entry + Mitigation Required',
        'Tier High — re-entry diagnostics + mitigation candidate. Key drivers: Cement Coverage & Quality, Penetration vs Storage Complex.',
        `- ${A_CEMENT}`,
        `- ${A_MONITOR}`,
        WARN,
      ].join('\n'),
    );
  });

  it('omits the warn line when warn is null and the action lines when there are none', () => {
    expect(
      recommendationText({ tier: 'low', title: 'T', summary: 'S', drivers: [], actions: [], warn: null }),
    ).toBe('T\nS');
  });
});
