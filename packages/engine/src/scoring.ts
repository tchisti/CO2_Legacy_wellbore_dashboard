/* scoring.ts — TypeScript port of the v2 risk engine (scoring.js).
   Numbers are frozen: same weights, rounding, band lookup and golden vectors as v2.
   Normative methodology: docs/superpowers/specs/2026-07-28-unified-risk-methodology-design.md §2.
   Not ported here: deriveScoresFromReviewer (replaced by a later task) and loadMethodology
   (v3 has a single source, methodology.default.json, so there is no inline fallback copy). */
import { z } from 'zod';
import defaultMethodologyJson from './methodology.default.json';
import {
  PARAM_KEYS,
  type Band,
  type Computed,
  type ComputedBlock,
  type GoldenVector,
  type LooseScores,
  type MigratedWell,
  type ParamKey,
  type Score,
  type Scores,
  type SelfTestResult,
  type V1Tier,
  type V2WellLike,
  type ValidationResult,
} from './types';

export { PARAM_KEYS } from './types';
export type {
  Axis,
  Band,
  Computed,
  ComputedBlock,
  GoldenVector,
  GoldenWant,
  LooseScores,
  MigratedWell,
  ParamKey,
  Score,
  Scores,
  SelfTestResult,
  V1Tier,
  V2WellLike,
  ValidationResult,
} from './types';

export const CURRENT_SCHEMA = 2;
export const V1_REVISION = '1.0.0';

/* ---------- methodology schema ---------- */

const ScoreSchema = z.literal([1, 2, 3, 4, 5]);

// z.record(z.enum(...)) would be exhaustive in Zod 4; anchors are an object with 1/3/5 required
// and the in-between 2/4 optional.
const AnchorsSchema = z.object({
  '1': z.string(),
  '2': z.string().optional(),
  '3': z.string(),
  '4': z.string().optional(),
  '5': z.string(),
});

const ParamSchema = z.object({
  key: z.enum(PARAM_KEYS),
  name: z.string(),
  axis: z.enum(['L', 'C']),
  weight: z.number(),
  desc: z.string(),
  anchors: AnchorsSchema,
  unknownScore: ScoreSchema,
  refs: z.array(z.string()),
});

// Band bounds are cell numbers on the 1..25 matrix, so they must be whole numbers.
// Deliberate deviation from v2: v2's coverage loop (for v = min; v <= max; v++) accepted some
// fractional bounds by accident (e.g. a min within float rounding of an integer such as 1e-17,
// where 1e-17 + 1 === 1) and rejected others. v3 rejects every non-integer bound with one stable
// message. computeWell and the golden vectors are unaffected: bandFor only sees the shipped bands.
const BandSchema = z.object({
  min: z.number().int(),
  max: z.number().int(),
  label: z.string(),
  cls: z.string(),
  color: z.string(),
});

const WellTypeSchema = z.object({
  short: z.string(),
  desc: z.string(),
  prot: z.string(),
});

export const MethodologySchema = z.object({
  revision: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  params: z.array(ParamSchema),
  matrix: z.object({ bands: z.array(BandSchema) }),
  wellTypes: z.record(z.string(), WellTypeSchema),
});

export type Methodology = z.infer<typeof MethodologySchema>;
export type Param = Methodology['params'][number];

/** The shipped rulebook: methodology.default.json parsed through MethodologySchema. */
export const DEFAULT_METHODOLOGY: Methodology = MethodologySchema.parse(defaultMethodologyJson);

/* ---------- v1 tiers ---------- */

const V1_TIERS: readonly [V1Tier, ...V1Tier[]] = [
  { min: 9, max: 18, label: 'Low', cls: 'low' },
  { min: 19, max: 30, label: 'Moderate', cls: 'mod' },
  { min: 31, max: 40, label: 'High', cls: 'high' },
  { min: 41, max: 45, label: 'Very High', cls: 'crit' },
];

export function v1TierFor(total: number): V1Tier {
  return V1_TIERS.find((t) => total >= t.min && total <= t.max) ?? V1_TIERS[0];
}

/* ---------- methodology helpers ---------- */

export function paramsOf(m: Methodology, axis?: 'L' | 'C'): Param[] {
  return m.params.filter((p) => !axis || p.axis === axis);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Label for params[idx] in an error message: its key when the input has one, else its position. */
function paramLabel(params: readonly unknown[], idx: number): string {
  const p = params[idx];
  return isRecord(p) && typeof p.key === 'string' ? p.key : `params[${idx}]`;
}

const BAND_BOUNDS_MESSAGE = 'matrix band bounds must be whole numbers';

/** Turn a structural Zod issue into one error line, using v2's wording where v2 had a check. */
function describeIssue(issue: z.ZodError['issues'][number], params: readonly unknown[]): string {
  const [root, idx, field, sub] = issue.path;
  if (root === 'params' && typeof idx === 'number') {
    const label = paramLabel(params, idx);
    if (field === 'unknownScore') return `${label}: unknownScore must be 1–5`;
    if (field === 'anchors' && (sub === undefined || sub === '1' || sub === '3' || sub === '5')) {
      return `${label}: anchors for 1/3/5 are required`;
    }
  }
  // path is matrix.bands.<i>.min|max; the same text for every band, so it appears once per methodology
  if (root === 'matrix' && idx === 'bands' && typeof field === 'number' && (sub === 'min' || sub === 'max')) {
    return BAND_BOUNDS_MESSAGE;
  }
  const where = issue.path.map(String).join('.') || 'methodology';
  return `${where}: ${issue.message}`;
}

/**
 * Structure is checked with MethodologySchema first (invalid shapes come back as errors, never a
 * throw); the v2 semantic checks (semver, required params, weight sums, bands) then run on the
 * parsed value with v2's exact error strings.
 */
export function validateMethodology(m: unknown): ValidationResult {
  if (!isRecord(m) || !Array.isArray(m.params)) {
    return { ok: false, errors: ['methodology is not a valid object'] };
  }
  const params: readonly unknown[] = m.params;
  const parsed = MethodologySchema.safeParse(m);
  if (!parsed.success) {
    const errors = [...new Set(parsed.error.issues.map((issue) => describeIssue(issue, params)))];
    return { ok: false, errors };
  }
  const meth = parsed.data;
  const errors: string[] = [];
  if (!/^\d+\.\d+\.\d+$/.test(meth.revision)) errors.push('revision must be semver (e.g. 2.0.0)');
  const haveKeys = meth.params.map((p) => p.key);
  for (const k of PARAM_KEYS) if (!haveKeys.includes(k)) errors.push('missing param: ' + k);
  for (const axis of ['L', 'C'] as const) {
    const sum = paramsOf(meth, axis).reduce((a, p) => a + p.weight, 0);
    if (Math.abs(sum - 1) > 0.001) errors.push(axis + ' weights sum to ' + sum.toFixed(3) + ' — must be 1.00');
  }
  for (const p of meth.params) {
    if (!(p.anchors['1'] && p.anchors['3'] && p.anchors['5'])) errors.push(p.key + ': anchors for 1/3/5 are required');
  }
  // Bounds are whole numbers (BandSchema), so counting, for each cell 1..25, the bands that hold it
  // gives exactly the counts v2's per-band loop did. Only the 25 cells are visited: a structurally
  // valid band such as max: 1e12 (imported from a user file) must not make validation spin.
  for (let v = 1; v <= 25; v++) {
    const covered = meth.matrix.bands.filter((b) => b.min <= v && v <= b.max).length;
    if (covered !== 1) {
      errors.push('matrix bands must cover 1–25 exactly once (value ' + v + ' covered ' + covered + '×)');
      break;
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ---------- scoring ---------- */

/** A score in 1..5 is used as given (v2 does not require an integer); anything else is "unknown". */
export function resolveScore(p: Pick<Param, 'unknownScore'>, v: unknown): number {
  return typeof v === 'number' && v >= 1 && v <= 5 ? v : p.unknownScore;
}

export function axisScore(scores: LooseScores, m: Methodology, axis: 'L' | 'C'): number {
  return paramsOf(m, axis).reduce((a, p) => a + p.weight * resolveScore(p, scores ? scores[p.key] : null), 0);
}

export function bandFor(cell: number, m: Methodology): Band {
  const bands = m.matrix.bands;
  const band = bands.find((b) => cell >= b.min && cell <= b.max) ?? bands[bands.length - 1];
  if (!band) throw new Error('methodology has no matrix bands');
  return band;
}

/** The shared maths. computeWell is the typed entry point; this accepts loosely shaped scores. */
function scoreWell(scores: LooseScores, m: Methodology): Computed {
  const rawL = axisScore(scores, m, 'L');
  const rawC = axisScore(scores, m, 'C');
  const Lr = Math.round(rawL);
  const Cr = Math.round(rawC);
  const cell = Lr * Cr;
  const riskIndex = +(rawL * rawC).toFixed(2);
  const rank = bandFor(cell, m);
  const riskScore = Math.round(((riskIndex - 1) / 24) * 100);
  return { L: +rawL.toFixed(2), C: +rawC.toFixed(2), Lr, Cr, cell, riskIndex, rank, riskScore, integrity: 100 - riskScore };
}

export function computeWell(scores: Scores, m: Methodology): Computed {
  return scoreWell(scores, m);
}

export function anchorText(p: Param, v: Score | null | undefined): string {
  if (v === null || v === undefined) return 'Unknown — scores as ' + p.unknownScore;
  const text = p.anchors[v];
  if (text) return text;
  return v === 2 ? 'Judgment call between the 1 and 3 anchors' : 'Judgment call between the 3 and 5 anchors';
}

export function scoreLabelToValue(s: unknown): Score | null {
  if (s === null || s === undefined) return null;
  // As v2, any value is read through String(): a CSV cell is already text, and 3 reads as "3".
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const v = String(s).trim().toLowerCase();
  if (!v || v === '?' || v === 'unknown' || v === 'u') return null;
  if (v === '1' || v === 'low' || v === 'l' || v.startsWith('1')) return 1;
  if (v === '2' || v.startsWith('2')) return 2;
  if (v === '3' || v === 'med' || v === 'medium' || v === 'moderate' || v === 'm' || v.startsWith('3')) return 3;
  if (v === '4' || v.startsWith('4')) return 4;
  if (v === '5' || v === 'high' || v === 'h' || v === 'critical' || v.startsWith('5')) return 5;
  return null;
}

export function emptyScores(): Scores {
  return {
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
}

/* ---------- v1 → v2 migration (spec §6) ---------- */

const V1_MAP: Readonly<Record<string, ParamKey>> = {
  plug: 'plugQuality',
  cement: 'cement',
  barriers: 'barriers',
  age: 'age',
  data: 'data',
  access: 'access',
  prox: 'plume',
};

const isScore = (v: unknown): v is Score => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

export function isV1Well(w: V2WellLike | null | undefined): boolean {
  return !!(w && w.scores && Object.prototype.hasOwnProperty.call(w.scores, 'plug'));
}

function computedBlock(scores: LooseScores, m: Methodology): ComputedBlock {
  const c = scoreWell(scores, m);
  return {
    L: c.L,
    C: c.C,
    Lr: c.Lr,
    Cr: c.Cr,
    cell: c.cell,
    riskIndex: c.riskIndex,
    rankLabel: c.rank.label,
    integrity: c.integrity,
  };
}

/**
 * v1 → v2: new params start unknown (the engine applies unknownScore).
 *
 * Deliberate deviation from v2: v2 copied any legacy number through, and resolveScore then used it
 * if it fell in 1..5, so a fractional legacy score such as 2.5 was scored as 2.5. Here a legacy
 * value that is not an integer 1..5 (fractional or out of range) migrates as Unknown (null), so it
 * scores at the param's unknownScore. Scores are typed 1|2|3|4|5|null and v1 used a 1/3/5 scale, so
 * an in-between fraction is treated conservatively as unknown rather than trusted. The raw value
 * is never lost: it is kept verbatim in legacy.scores. Integer 1..5 data migrates exactly as v2.
 */
export function migrateV1(w: V2WellLike, m: Methodology = DEFAULT_METHODOLOGY): MigratedWell {
  const s = w.scores ?? {};
  const scores = emptyScores();
  for (const [oldKey, newKey] of Object.entries(V1_MAP)) {
    const v = s[oldKey];
    if (isScore(v)) scores[newKey] = v; // non-integer or out-of-range → stays null (see above)
  }
  const dr = typeof s.depthR === 'number' ? s.depthR : null;
  const dc = typeof s.depthC === 'number' ? s.depthC : null;
  if (dr !== null || dc !== null) {
    const penetration = Math.max(dr ?? 1, dc ?? 1);
    if (isScore(penetration)) scores.penetration = penetration;
  }
  const out: MigratedWell = {
    ...w,
    schema: CURRENT_SCHEMA,
    scores,
    computed: computedBlock(scores, m),
    scoredUnder: V1_REVISION,
    needsReview: true,
    legacy: { scores: { ...s }, total: w.total },
  };
  delete out.total;
  return out;
}

export function normalizeWell(w: V2WellLike, m: Methodology = DEFAULT_METHODOLOGY): V2WellLike {
  if (isV1Well(w)) return migrateV1(w, m);
  if (w && w.scores) return { ...w, schema: CURRENT_SCHEMA, computed: computedBlock(w.scores, m) };
  return w;
}

/* ---------- admin revision bump: weights/bands/unknownScore → minor, text → patch ---------- */

export function bumpRevision(oldM: Methodology, newM: Methodology): string {
  const sig = (m: Methodology) =>
    JSON.stringify(m.params.map((p) => [p.key, p.weight, p.unknownScore])) +
    JSON.stringify(m.matrix.bands.map((b) => [b.min, b.max]));
  const [major = 0, minor = 0, patch = 0] = String(oldM.revision || '2.0.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  return sig(oldM) !== sig(newM) ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

/* ---------- golden vectors + self test (spec §9) ---------- */

export const GOLDEN_VECTORS: readonly GoldenVector[] = [
  { name: 'best-case', scores: 'all-1', want: { L: 1, C: 1, cell: 1, riskIndex: 1, rank: 'Low', integrity: 100 } },
  { name: 'worst-case', scores: 'all-5', want: { L: 5, C: 5, cell: 25, riskIndex: 25, rank: 'Very High', integrity: 0 } },
  { name: 'unknown-heavy', scores: 'all-null', want: { L: 4.24, C: 3.6, cell: 16, riskIndex: 15.26, rank: 'High', integrity: 41 } },
  { name: 'band-boundary', scores: 'all-3', want: { L: 3, C: 3, cell: 9, riskIndex: 9, rank: 'Moderate', integrity: 67 } },
  {
    name: 'migrated-legacy',
    v1: { scores: { plug: 5, barriers: 3, cement: 5, prox: 1, depthR: 5, depthC: 5, age: 5, access: 1, data: 5 }, total: 35 },
    want: { L: 4.24, C: 2.7, cell: 12, riskIndex: 11.45, rank: 'High', integrity: 56 },
  },
];

const FILL = { 'all-1': 1, 'all-3': 3, 'all-5': 5, 'all-null': null } as const;

export function runSelfTest(m: Methodology = DEFAULT_METHODOLOGY): SelfTestResult {
  const failures: string[] = [];
  const val = validateMethodology(m);
  if (!val.ok) failures.push('methodology invalid: ' + val.errors.join('; '));
  for (const v of GOLDEN_VECTORS) {
    let c: ComputedBlock;
    if (v.v1) {
      c = migrateV1({ ...v.v1 }, m).computed;
    } else {
      const fill = FILL[v.scores];
      const scores: Partial<Record<ParamKey, number | null>> = {};
      for (const k of PARAM_KEYS) scores[k] = fill;
      c = computedBlock(scores, m);
    }
    const got = { L: c.L, C: c.C, cell: c.cell, riskIndex: c.riskIndex, rank: c.rankLabel, integrity: c.integrity };
    if (JSON.stringify(got) !== JSON.stringify(v.want)) {
      failures.push(v.name + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(v.want));
    }
  }
  return {
    pass: failures.length === 0,
    failures,
    summary: failures.length
      ? failures.length + ' golden-vector failure(s)'
      : 'all ' + GOLDEN_VECTORS.length + ' golden vectors pass (rev ' + m.revision + ')',
  };
}
