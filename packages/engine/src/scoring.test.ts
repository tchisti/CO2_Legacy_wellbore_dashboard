// Port of tools/scoring.test.js (the v2 harness) to Vitest. The numbers here are the v2 golden
// vectors and must never change without a methodology revision bump.
import { describe, expect, it } from 'vitest';
import rawMethodology from './methodology.default.json';
import {
  DEFAULT_METHODOLOGY,
  GOLDEN_VECTORS,
  MethodologySchema,
  anchorText,
  axisScore,
  bandFor,
  bumpRevision,
  computeWell,
  emptyScores,
  isV1Well,
  migrateV1,
  normalizeWell,
  paramsOf,
  resolveScore,
  runSelfTest,
  scoreLabelToValue,
  v1TierFor,
  validateMethodology,
} from './scoring';
import { PARAM_KEYS, type Score, type Scores, type V2WellLike } from './types';

const M = DEFAULT_METHODOLOGY;

/** Deep copy via JSON (the engine package has no DOM or Node typings, so no structuredClone). */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Every param set to the same value (a number 1-5, or null for "unknown"). */
function filled(v: Score | null): Scores {
  const s = emptyScores();
  for (const k of PARAM_KEYS) s[k] = v;
  return s;
}

/** Loosely typed deep copy of the shipped JSON so tests can break it in ways the types forbid. */
interface MutableMethodology {
  revision: string;
  params: Array<{
    key: string;
    weight: number;
    unknownScore: number;
    anchors: Record<string, string>;
  }>;
  matrix: { bands: Array<{ min: number; max: number }> };
}
const mutable = (): MutableMethodology => clone(rawMethodology) as MutableMethodology;
const param = (m: MutableMethodology, i: number) => {
  const p = m.params[i];
  if (!p) throw new Error(`no param at index ${i}`);
  return p;
};

const v1Well: V2WellLike = {
  id: 'W-TEST',
  licence: '100/13-06-055-22W4/00',
  klass: 'Type 1',
  scores: { plug: 5, barriers: 3, cement: 5, prox: 1, depthR: 5, depthC: 5, age: 5, access: 1, data: 5 },
  total: 35,
};

describe('methodology', () => {
  it('DEFAULT_METHODOLOGY validates, rev 2.0.0, 11 params, weights sum to 1 per axis', () => {
    expect(validateMethodology(M)).toEqual({ ok: true, errors: [] });
    expect(M.revision).toBe('2.0.0');
    expect(M.params).toHaveLength(11);
    expect(+paramsOf(M, 'L').reduce((a, p) => a + p.weight, 0).toFixed(3)).toBe(1);
    expect(+paramsOf(M, 'C').reduce((a, p) => a + p.weight, 0).toFixed(3)).toBe(1);
  });

  it('DEFAULT_METHODOLOGY is exactly the shipped JSON (the schema strips nothing)', () => {
    expect(M).toEqual(rawMethodology);
    expect(MethodologySchema.parse(rawMethodology)).toEqual(rawMethodology);
  });

  it('params follow PARAM_KEYS order, split 7 Likelihood and 4 Consequence', () => {
    expect(M.params.map((p) => p.key)).toEqual([...PARAM_KEYS]);
    expect(paramsOf(M)).toHaveLength(11);
    expect(paramsOf(M, 'L')).toHaveLength(7);
    expect(paramsOf(M, 'C').map((p) => p.key)).toEqual(['penetration', 'plume', 'usdw', 'access']);
  });

  it('rejects a weight change that breaks the sum and a band gap', () => {
    const badWeights = mutable();
    param(badWeights, 0).weight = 0.5;
    expect(validateMethodology(badWeights).ok).toBe(false);

    const badBands = mutable();
    const firstBand = badBands.matrix.bands[0];
    if (!firstBand) throw new Error('no bands');
    firstBand.max = 3;
    expect(validateMethodology(badBands).ok).toBe(false);
  });

  it('keeps the v2 error strings for the semantic checks', () => {
    const weights = mutable();
    param(weights, 0).weight = 0.5;
    expect(validateMethodology(weights).errors).toEqual(['L weights sum to 1.280 — must be 1.00']);

    const semver = mutable();
    semver.revision = 'two';
    expect(validateMethodology(semver).errors).toEqual(['revision must be semver (e.g. 2.0.0)']);

    const missing = mutable();
    missing.params.pop();
    expect(validateMethodology(missing).errors).toEqual([
      'missing param: access',
      'C weights sum to 0.800 — must be 1.00',
    ]);

    const blankAnchor = mutable();
    param(blankAnchor, 0).anchors['3'] = '';
    expect(validateMethodology(blankAnchor).errors).toEqual(['plugQuality: anchors for 1/3/5 are required']);

    const gap = mutable();
    const band = gap.matrix.bands[0];
    if (!band) throw new Error('no bands');
    band.max = 3;
    expect(validateMethodology(gap).errors).toEqual([
      'matrix bands must cover 1–25 exactly once (value 4 covered 0×)',
    ]);

    const overlap = mutable();
    const second = overlap.matrix.bands[1];
    if (!second) throw new Error('no bands');
    second.min = 4;
    expect(validateMethodology(overlap).errors).toEqual([
      'matrix bands must cover 1–25 exactly once (value 4 covered 2×)',
    ]);
  });

  it('reports anchors and unknownScore problems with v2 wording, never throwing', () => {
    const noAnchor = mutable();
    delete param(noAnchor, 0).anchors['5'];
    expect(validateMethodology(noAnchor).errors).toEqual(['plugQuality: anchors for 1/3/5 are required']);

    const badUnknown = mutable();
    param(badUnknown, 1).unknownScore = 7;
    expect(validateMethodology(badUnknown).errors).toEqual(['cement: unknownScore must be 1–5']);
  });

  it('validateMethodology bounds the band-coverage loop: a huge band max returns promptly with the v2 coverage error', () => {
    const huge = mutable();
    const first = huge.matrix.bands[0];
    const last = huge.matrix.bands[3];
    if (!first || !last) throw new Error('no bands');
    first.max = 3; // leaves a gap at 4
    last.max = 1e12;
    const started = Date.now();
    const result = validateMethodology(huge);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ ok: false, errors: ['matrix bands must cover 1–25 exactly once (value 4 covered 0×)'] });
  });

  it('validateMethodology accepts a valid methodology whose outer bands overshoot 1..25', () => {
    const wide = mutable();
    const first = wide.matrix.bands[0];
    const last = wide.matrix.bands[3];
    if (!first || !last) throw new Error('no bands');
    first.min = -1e12;
    last.max = 1e12;
    expect(validateMethodology(wide)).toEqual({ ok: true, errors: [] });
  });

  it('validateMethodology does not count band values below 1 (min -5) and still reports coverage correctly', () => {
    const below = mutable();
    const first = below.matrix.bands[0];
    if (!first) throw new Error('no bands');
    first.min = -5;
    first.max = 3; // -5..3 covers 1..3 only; 4 is uncovered
    expect(validateMethodology(below).errors).toEqual([
      'matrix bands must cover 1–25 exactly once (value 4 covered 0×)',
    ]);
    first.max = 4; // back to a complete cover: only 1..4 count
    expect(validateMethodology(below)).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'methodology'],
    ['an empty object', {}],
    ['params that is not an array', { params: 'nope' }],
    ['empty param entries', { ...rawMethodology, params: [{}] }],
    ['a param with an unknown key', { ...rawMethodology, params: [{ ...rawMethodology.params[0], key: 'bogus' }] }],
    ['a missing matrix', { ...rawMethodology, matrix: undefined }],
  ])('returns ok:false with errors instead of throwing for %s', (_name, input) => {
    const result = validateMethodology(input);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('computeWell golden vectors', () => {
  it.each([
    ['best-case', 1, { L: 1, C: 1, Lr: 1, Cr: 1, cell: 1, riskIndex: 1, rank: 'Low', riskScore: 0, integrity: 100 }],
    ['worst-case', 5, { L: 5, C: 5, Lr: 5, Cr: 5, cell: 25, riskIndex: 25, rank: 'Very High', riskScore: 100, integrity: 0 }],
    ['unknown-heavy', null, { L: 4.24, C: 3.6, Lr: 4, Cr: 4, cell: 16, riskIndex: 15.26, rank: 'High', riskScore: 59, integrity: 41 }],
    ['band-boundary', 3, { L: 3, C: 3, Lr: 3, Cr: 3, cell: 9, riskIndex: 9, rank: 'Moderate', riskScore: 33, integrity: 67 }],
  ] as const)('golden %s', (_name, fill, want) => {
    const c = computeWell(filled(fill), M);
    expect({
      L: c.L, C: c.C, Lr: c.Lr, Cr: c.Cr, cell: c.cell, riskIndex: c.riskIndex,
      rank: c.rank.label, riskScore: c.riskScore, integrity: c.integrity,
    }).toEqual(want);
  });

  it('returns the band object from the methodology as rank', () => {
    const c = computeWell(filled(5), M);
    expect(c.rank).toBe(M.matrix.bands[3]);
    expect(c.rank).toEqual({ min: 17, max: 25, label: 'Very High', cls: 'crit', color: '#a8324a' });
  });

  it('tolerates missing, null and out-of-range scores exactly like v2 (all resolve to unknownScore)', () => {
    const allNull = computeWell(filled(null), M);
    expect(computeWell({} as Scores, M)).toEqual(allNull);
    expect(computeWell({ plugQuality: 9, cement: 0, barriers: -1 } as unknown as Scores, M)).toEqual(allNull);
  });

  it('uses unrounded axis scores for riskIndex and rounded ones for the matrix cell', () => {
    // plugQuality 1, everything else unknown: L = 4.24 - 0.22*5 + 0.22*1 = 3.36, C = 3.6
    const scores = emptyScores();
    scores.plugQuality = 1;
    const c = computeWell(scores, M);
    expect({ L: c.L, C: c.C, Lr: c.Lr, Cr: c.Cr, cell: c.cell }).toEqual({ L: 3.36, C: 3.6, Lr: 3, Cr: 4, cell: 12 });
    // 3.36 x 3.6 = 12.096 -> 12.1; the rounded 3 x 4 = 12 is only the matrix cell
    expect(c.riskIndex).toBe(12.1);
    expect(c.riskScore).toBe(Math.round(((12.1 - 1) / 24) * 100));
  });

  it('axisScore sums weight x resolved score per axis and tolerates a missing scores object', () => {
    expect(axisScore(filled(1), M, 'L')).toBeCloseTo(1, 10);
    expect(axisScore(filled(5), M, 'C')).toBeCloseTo(5, 10);
    expect(axisScore(null, M, 'L')).toBeCloseTo(4.24, 10);
    expect(axisScore(undefined, M, 'C')).toBeCloseTo(3.6, 10);
  });

  it('resolveScore keeps in-range numbers and falls back to unknownScore otherwise', () => {
    const plug = paramOf('plugQuality'); // unknownScore 5
    const barriers = paramOf('barriers'); // unknownScore 3
    expect([1, 2, 3, 4, 5].map((v) => resolveScore(plug, v))).toEqual([1, 2, 3, 4, 5]);
    expect([null, undefined, 0, 6, '3', Number.NaN].map((v) => resolveScore(plug, v))).toEqual([5, 5, 5, 5, 5, 5]);
    expect(resolveScore(barriers, null)).toBe(3);
  });

  it('bandFor maps cells to bands and falls back to the last band', () => {
    const label = (cell: number) => bandFor(cell, M).label;
    expect([1, 4].map(label)).toEqual(['Low', 'Low']);
    expect([5, 9].map(label)).toEqual(['Moderate', 'Moderate']);
    expect([10, 16].map(label)).toEqual(['High', 'High']);
    expect([17, 25].map(label)).toEqual(['Very High', 'Very High']);
    expect(label(99)).toBe('Very High');
    expect(label(0)).toBe('Very High');
  });
});

describe('v1 migration', () => {
  it('migrateV1 of W-W8QB2S v1 scores', () => {
    const mig = migrateV1(v1Well, M);
    expect(mig.scores).toEqual({
      plugQuality: 5, cement: 5, barriers: 3, scvf: null, age: 5, complexity: null, data: 5,
      penetration: 5, plume: 1, usdw: null, access: 1,
    });
    expect({
      L: mig.computed.L, C: mig.computed.C, cell: mig.computed.cell,
      riskIndex: mig.computed.riskIndex, rank: mig.computed.rankLabel, integrity: mig.computed.integrity,
    }).toEqual({ L: 4.24, C: 2.7, cell: 12, riskIndex: 11.45, rank: 'High', integrity: 56 });
    expect({
      schema: mig.schema, scoredUnder: mig.scoredUnder, needsReview: mig.needsReview,
      legacyTotal: mig.legacy.total, totalGone: !('total' in mig),
    }).toEqual({ schema: 2, scoredUnder: '1.0.0', needsReview: true, legacyTotal: 35, totalGone: true });
  });

  it('migrateV1 keeps the other well fields, snapshots the legacy scores and does not mutate its input', () => {
    const before = clone(v1Well);
    const mig = migrateV1(v1Well, M);
    expect(mig.id).toBe('W-TEST');
    expect(mig.licence).toBe('100/13-06-055-22W4/00');
    expect(mig.klass).toBe('Type 1');
    expect(mig.legacy.scores).toEqual(before.scores);
    expect(mig.legacy.scores).not.toBe(v1Well.scores);
    expect(v1Well).toEqual(before);
  });

  it('migrateV1 penetration is max(depthR, depthC), a missing side counts as 1, both missing stays unknown', () => {
    const pen = (scores: Record<string, unknown>) => migrateV1({ scores: { plug: 1, ...scores } }, M).scores.penetration;
    expect(pen({ depthR: 2, depthC: 4 })).toBe(4);
    expect(pen({ depthR: 5, depthC: 3 })).toBe(5);
    expect(pen({ depthR: 3 })).toBe(3);
    expect(pen({ depthC: 2 })).toBe(2);
    expect(pen({})).toBeNull();
  });

  it('migrateV1 maps prox to plume and migrates non-numeric and out-of-range legacy values as unknown', () => {
    const mig = migrateV1({ scores: { plug: '5', prox: 2, cement: 9, age: 4 } }, M);
    expect(mig.scores.plume).toBe(2);
    expect(mig.scores.plugQuality).toBeNull();
    expect(mig.scores.cement).toBeNull();
    expect(mig.scores.age).toBe(4);
  });

  // Deliberate deviation from v2 (see the migrateV1 doc comment): v2 would have scored the in-range
  // fractions 2.5 / 4.5 as given (L 3.59, C 2.85, riskIndex 10.23, integrity 62 for this well); v3
  // migrates any legacy value that is not an integer 1..5 as Unknown and keeps the raw value in
  // legacy.scores.
  it('migrateV1 migrates fractional in-range legacy values (2.5, 4.5) as unknown and keeps them verbatim in legacy.scores', () => {
    const fractional: V2WellLike = { id: 'W-FRAC', scores: { plug: 2.5, cement: 4.5, depthR: 2.5 }, total: 20 };
    const mig = migrateV1(fractional, M);
    expect(mig.scores.plugQuality).toBeNull();
    expect(mig.scores.cement).toBeNull();
    expect(mig.scores).toEqual(emptyScores());
    // everything unknown, so the computed block is the unknown-heavy golden vector
    expect({ L: mig.computed.L, C: mig.computed.C, riskIndex: mig.computed.riskIndex, integrity: mig.computed.integrity })
      .toEqual({ L: 4.24, C: 3.6, riskIndex: 15.26, integrity: 41 });
    expect(mig.legacy.scores).toEqual({ plug: 2.5, cement: 4.5, depthR: 2.5 });
    expect(mig.legacy.total).toBe(20);
  });

  it('migrateV1 penetration is unknown when max(depthR, depthC) is fractional, and the max when it is an integer', () => {
    const pen = (scores: Record<string, unknown>) => migrateV1({ scores: { plug: 1, ...scores } }, M).scores.penetration;
    expect(pen({ depthR: 2.5 })).toBeNull(); // max(2.5, 1) = 2.5, not an integer 1..5
    expect(pen({ depthR: 2.5, depthC: 4 })).toBe(4); // max(2.5, 4) = 4, an integer 1..5
    expect(pen({ depthR: 2.5, depthC: 2.5 })).toBeNull();
  });

  it('isV1Well is true only for a scores object carrying the v1 "plug" key', () => {
    expect(isV1Well(v1Well)).toBe(true);
    expect(isV1Well(migrateV1(v1Well, M))).toBe(false);
    expect(isV1Well({ scores: { plugQuality: 1 } })).toBe(false);
    expect(isV1Well({})).toBe(false);
    expect(isV1Well(null)).toBe(false);
    expect(isV1Well(undefined)).toBe(false);
  });

  it('v1TierFor(35) is High', () => {
    expect(v1TierFor(35).label).toBe('High');
  });

  it('v1TierFor covers the tier boundaries and falls back to the first tier', () => {
    const tier = (t: number) => v1TierFor(t).label;
    expect([9, 18].map(tier)).toEqual(['Low', 'Low']);
    expect([19, 30].map(tier)).toEqual(['Moderate', 'Moderate']);
    expect([31, 40].map(tier)).toEqual(['High', 'High']);
    expect([41, 45].map(tier)).toEqual(['Very High', 'Very High']);
    expect([0, 46, 99].map(tier)).toEqual(['Low', 'Low', 'Low']);
    expect(v1TierFor(35)).toEqual({ min: 31, max: 40, label: 'High', cls: 'high' });
  });
});

describe('normalizeWell', () => {
  it('passes v2 through and recomputes riskIndex 11.45', () => {
    const mig = migrateV1(v1Well, M);
    const norm = normalizeWell(mig, M);
    expect(norm.scoredUnder).toBe('1.0.0');
    expect(norm.computed?.riskIndex).toBe(11.45);
  });

  it('recomputes a stale computed block for a v2 well', () => {
    const stale = { ...migrateV1(v1Well, M), computed: { ...migrateV1(v1Well, M).computed, riskIndex: 1 } };
    expect(normalizeWell(stale, M).computed?.riskIndex).toBe(11.45);
  });

  it('migrates a v1 well and leaves a well without scores untouched', () => {
    expect(normalizeWell(v1Well, M).scoredUnder).toBe('1.0.0');
    const bare: V2WellLike = { id: 'W-BARE' };
    expect(normalizeWell(bare, M)).toBe(bare);
    expect(normalizeWell(null as unknown as V2WellLike, M)).toBeNull();
  });
});

describe('anchors and labels', () => {
  it('anchorText(p,2) is "Judgment call between the 1 and 3 anchors"; anchorText(p,null) starts "Unknown — scores as"', () => {
    const plug = paramOf('plugQuality');
    expect(anchorText(plug, 2)).toBe('Judgment call between the 1 and 3 anchors');
    expect(anchorText(plug, null)).toBe('Unknown — scores as 5');
    expect(anchorText(plug, null).startsWith('Unknown — scores as')).toBe(true);
  });

  it('anchorText returns the wording for 1/3/5, the 3-5 judgment text for 4, and the per-param unknown score', () => {
    const plug = paramOf('plugQuality');
    expect(anchorText(plug, 1)).toBe(plug.anchors['1']);
    expect(anchorText(plug, 3)).toBe(plug.anchors['3']);
    expect(anchorText(plug, 5)).toBe(plug.anchors['5']);
    expect(anchorText(plug, 4)).toBe('Judgment call between the 3 and 5 anchors');
    expect(anchorText(paramOf('barriers'), null)).toBe('Unknown — scores as 3');
    expect(anchorText(plug, undefined)).toBe('Unknown — scores as 5');
  });

  it('labels (v2 CSV parsing case)', () => {
    expect(['low', 'Medium', 'HIGH', '2', '4', '?', '', undefined].map(scoreLabelToValue)).toEqual([
      1, 3, 5, 2, 4, null, null, null,
    ]);
  });

  it('scoreLabelToValue: "?"→null, "Low"→1, "Medium"→3, "High"→5, "4"→4, "junk"→null', () => {
    expect(scoreLabelToValue('?')).toBeNull();
    expect(scoreLabelToValue('Low')).toBe(1);
    expect(scoreLabelToValue('Medium')).toBe(3);
    expect(scoreLabelToValue('High')).toBe(5);
    expect(scoreLabelToValue('4')).toBe(4);
    expect(scoreLabelToValue('junk')).toBeNull();
  });

  it('scoreLabelToValue accepts aliases, padding and numbers, and rejects null', () => {
    expect(scoreLabelToValue(null)).toBeNull();
    expect(scoreLabelToValue('  high ')).toBe(5);
    expect(scoreLabelToValue('Moderate')).toBe(3);
    expect(scoreLabelToValue('critical')).toBe(5);
    expect(scoreLabelToValue('med')).toBe(3);
    expect(scoreLabelToValue('unknown')).toBeNull();
    expect(scoreLabelToValue('u')).toBeNull();
    expect(scoreLabelToValue('3 - medium')).toBe(3);
    expect(scoreLabelToValue(2)).toBe(2);
  });
});

describe('bumpRevision', () => {
  it('weight change → 2.1.0; anchor wording change → 2.0.1', () => {
    const weight = clone(M);
    weight.params[0]!.weight = 0.24;
    weight.params[1]!.weight = 0.18;
    expect(bumpRevision(M, weight)).toBe('2.1.0');

    const text = clone(M);
    text.params[0]!.anchors['3'] = 'reworded';
    expect(bumpRevision(M, text)).toBe('2.0.1');
  });

  it('unknownScore and band edge changes are minor bumps; builds on the old revision', () => {
    const unknown = clone(M);
    unknown.params[2]!.unknownScore = 4;
    expect(bumpRevision(M, unknown)).toBe('2.1.0');

    const edge = clone(M);
    edge.matrix.bands[0]!.max = 5;
    edge.matrix.bands[1]!.min = 6;
    expect(bumpRevision(M, edge)).toBe('2.1.0');

    const later = { ...clone(M), revision: '2.3.4' };
    const reworded = clone(later);
    reworded.params[0]!.name = 'Renamed';
    expect(bumpRevision(later, reworded)).toBe('2.3.5');
    const reweighted = clone(later);
    reweighted.params[0]!.weight = 0.3;
    expect(bumpRevision(later, reweighted)).toBe('2.4.0');
  });
});

describe('self test and helpers', () => {
  it('runSelfTest passes against DEFAULT_METHODOLOGY', () => {
    const result = runSelfTest();
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.summary).toBe('all 5 golden vectors pass (rev 2.0.0)');
    expect(runSelfTest(M).pass).toBe(true);
  });

  it('runSelfTest fails when the weights drift from the golden numbers', () => {
    const drifted = clone(M);
    drifted.params[0]!.weight = 0.3; // plugQuality (unknownScore 5)
    drifted.params[2]!.weight = 0.04; // barriers (unknownScore 3); L still sums to 1, so only the vectors catch it
    expect(validateMethodology(drifted).ok).toBe(true);
    const result = runSelfTest(drifted);
    expect(result.pass).toBe(false);
    expect(result.failures.some((f) => f.startsWith('unknown-heavy:'))).toBe(true);
    expect(result.summary).toMatch(/golden-vector failure\(s\)$/);
  });

  it('GOLDEN_VECTORS are the five v2 vectors', () => {
    expect(GOLDEN_VECTORS.map((v) => v.name)).toEqual([
      'best-case', 'worst-case', 'unknown-heavy', 'band-boundary', 'migrated-legacy',
    ]);
  });

  it('emptyScores has 11 null keys', () => {
    const s = emptyScores();
    expect(Object.keys(s)).toEqual([...PARAM_KEYS]);
    expect(Object.keys(s)).toHaveLength(11);
    expect(Object.values(s).every((v) => v === null)).toBe(true);
    expect(emptyScores()).not.toBe(s);
  });
});

function paramOf(key: (typeof PARAM_KEYS)[number]) {
  const p = M.params.find((x) => x.key === key);
  if (!p) throw new Error(`no param ${key}`);
  return p;
}
