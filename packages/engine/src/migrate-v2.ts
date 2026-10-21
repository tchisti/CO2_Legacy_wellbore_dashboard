// v2 → v3 migration (spec §8): turns the v2 register (wells.json + methodology.json), an optional
// site file and any browser exports into one v3 project export. Pure: no file system, clock or
// randomness, so the web app can run it in the browser to import a bare v2 wells.json, and
// scripts/migrate-v2.ts wraps it as a CLI.
//
// Safe to run repeatedly (spec §8.1). Every id is derived from its source record, so the same
// inputs give the same records, and the store's import (wells upserted by licence, assessments and
// audit events added only when their id is new, methodology merged by revision) leaves an
// unchanged register unchanged. A v2 well edited since the last run gets a new updatedAt, hence a
// new assessment id, and its new final assessment is added alongside the earlier one.
import { z } from 'zod';
import {
  CLASSIFICATIONS,
  ProjectExportSchema,
  ProjectSchema,
  STATUSES,
  TRAJECTORIES,
  WELL_TYPES,
  type Assessment,
  type AuditEvent,
  type MethodologyRecord,
  type Project,
  type ProjectExport,
  type Well,
} from './domain';
import { recommend, recommendationText } from './recommend';
import {
  MethodologySchema,
  computeWell,
  emptyScores,
  normalizeWell,
  validateMethodology,
  type Methodology,
} from './scoring';
import { PARAM_KEYS, type ParamKey, type Score, type Scores } from './types';
import { WellboreSchema, wellboreFrom3D, type Wellbore } from './wellbore';

/** Spec §8.2: the project name unless the caller chooses one. */
export const V2_DEFAULT_PROJECT_NAME = 'Fort Saskatchewan / Wabamun Hub AOR';

/* ---------- public types ---------- */

/**
 * What a site file supplies (e.g. scripts/fixtures/enbridge-site.json): the project's injectors and
 * formation column, and each well's name and TD keyed by UWI. `name` and `source` are informational.
 */
export const SiteConfigSchema = z.object({
  name: z.string().optional(),
  source: z.string().optional(),
  injectors: ProjectSchema.shape.injectors,
  formations: ProjectSchema.shape.formations,
  wellsByUwi: z.record(z.string(), z.object({ name: z.string(), td_m: z.number().min(0).nullable() })),
});

export type SiteConfig = z.output<typeof SiteConfigSchema>;

/** The numbers the parity check compares. */
export type ParityMetrics = { L: number; C: number; cell: number; riskIndex: number; rank: string };

export type ParityStatus =
  | 'ok'
  | 'mismatch'
  | 'browser-only'
  | 'browser-only (3D, draft)'
  | '3d-skipped (register wins)'
  | '3d-skipped (scenario)'
  | 'needs-review (draft)'
  | 'unscored';

/** One line of the parity table: the stored v2 computed block against the v3 recompute. */
export type ParityRow = {
  licence: string;
  status: ParityStatus;
  v2: ParityMetrics | null;
  v3: ParityMetrics | null;
  note?: string;
};

export type MigrateV2Args = {
  /** The v2 wells.json: an array of v2 (or v1) well records. */
  wells: unknown;
  /** The v2 methodology.json the register was scored under. */
  methodology: unknown;
  site?: SiteConfig | null;
  /** v2 register "Export JSON" files (arrays) and 3D reviewer exports ({ schemaVersion: 1, wells }). */
  browserExports?: unknown[];
  projectName?: string;
  /** ISO timestamp for exportedAt, the only output that depends on when the migration runs. */
  now: string;
  /** Who runs the migration: exportedBy, project createdBy/updatedBy, audit actorName. */
  actor: string;
};

export type MigrateV2Result = {
  export: ProjectExport;
  parity: ParityRow[];
  mismatches: ParityRow[];
  warnings: string[];
};

/* ---------- small helpers ---------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const trimmed = (v: unknown): string => text(v).trim();

/** The store's licence match rule (licenceKey in apps/web): trimmed, upper-cased, no whitespace. */
const licenceKey = (licence: string): string => licence.trim().toUpperCase().replace(/\s+/g, '');

/** Lower-case; every run of non-alphanumerics becomes one '-'; no leading or trailing '-'. */
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A finite number (or numeric string) within [min, max], else null. */
function numberIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function wholeNumberIn(v: unknown, min: number, max: number): number | null {
  const n = numberIn(v, min, max);
  return n !== null && Number.isInteger(n) ? n : null;
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;
}

const scoreOf = (v: unknown): Score | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? (v as Score) : null;

/**
 * All 11 params, each an integer 1..5 or null (unknown). `dropped` lists the params that had a
 * value which is not a whole score (e.g. 2.5 or "3"); they migrate as unknown.
 */
function scoresFrom(read: (key: ParamKey) => unknown): { scores: Scores; dropped: ParamKey[] } {
  const scores = emptyScores();
  const dropped: ParamKey[] = [];
  for (const key of PARAM_KEYS) {
    const value = read(key);
    scores[key] = scoreOf(value);
    if (scores[key] === null && value !== undefined && value !== null && value !== '') dropped.push(key);
  }
  return { scores, dropped };
}

const IsoUtcSchema = z.iso.datetime();

/** An ISO-8601 UTC timestamp: kept verbatim when it already is one, otherwise normalised. Epoch ms accepted. */
function timestamp(v: unknown): string | null {
  if (typeof v === 'string') {
    if (IsoUtcSchema.safeParse(v).success) return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  return null;
}

const describeIssues = (error: z.ZodError): string =>
  error.issues.map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`).join('; ');

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dup.add(v);
    else seen.add(v);
  }
  return [...dup];
}

/* ---------- input validation ---------- */

function parseMethodology(input: unknown): Methodology {
  const check = validateMethodology(input);
  if (!check.ok) throw new Error(`methodology: not a valid v2 methodology: ${check.errors.join('; ')}`);
  return MethodologySchema.parse(input);
}

/** Validates a site file. Throws a readable Error; ids must be unique so the export re-imports. */
export function parseSiteConfig(input: unknown): SiteConfig {
  const parsed = SiteConfigSchema.safeParse(input);
  if (!parsed.success) throw new Error(`site: ${describeIssues(parsed.error)}`);
  const dup = [
    ...duplicates(parsed.data.injectors.map((i) => i.id)).map((id) => `injector ${id}`),
    ...duplicates(parsed.data.formations.map((f) => f.id)).map((id) => `formation ${id}`),
  ];
  if (dup.length > 0) throw new Error(`site: duplicate ids: ${dup.join(', ')}`);
  return parsed.data;
}

/* ---------- source records, one per licence ---------- */

type SourceEntry = {
  key: string;
  licence: string;
  raw: Record<string, unknown>;
  updatedAt: string;
  /** Which input it came from, for messages: 'wells.json' or 'browser export N'. */
  from: string;
};

type V2Entry = SourceEntry & { origin: 'register' | 'browser'; note?: string };

function sourceEntry(item: unknown, index: number, from: string, licenceField: 'licence' | 'uwi'): SourceEntry {
  const where = `${from}, well ${index + 1}`;
  if (!isRecord(item)) throw new Error(`${where}: not a well record`);
  const licence = trimmed(item[licenceField]);
  if (!licence) throw new Error(`${where}: no ${licenceField}`);
  const updatedAt = timestamp(item.updatedAt) ?? timestamp(item.createdAt);
  if (updatedAt === null) throw new Error(`${where} (${licence}): no valid updatedAt or createdAt`);
  return { key: licenceKey(licence), licence, raw: item, updatedAt, from };
}

/** Keeps one entry per licence: the newest updatedAt wins, the earlier one on a tie. */
function keepNewest<E extends SourceEntry>(
  into: Map<string, E>,
  entry: E,
  warnings: string[],
  replace: (held: E, newer: E) => E = (_held, newer) => newer,
): void {
  const held = into.get(entry.key);
  if (!held) {
    into.set(entry.key, entry);
    return;
  }
  if (held.from === entry.from) {
    warnings.push(`${entry.from}: licence ${entry.licence} appears more than once; the newest copy is used`);
  }
  if (Date.parse(entry.updatedAt) > Date.parse(held.updatedAt)) into.set(entry.key, replace(held, entry));
}

function mergeV2(
  into: Map<string, V2Entry>,
  items: readonly unknown[],
  from: string,
  origin: V2Entry['origin'],
  warnings: string[],
): void {
  items.forEach((item, i) => {
    const entry: V2Entry = { ...sourceEntry(item, i, from, 'licence'), origin };
    // A newer copy from another file replaces the fields, but a register well stays a register well.
    keepNewest(into, entry, warnings, (held, newer) => ({
      ...newer,
      origin: held.origin,
      ...(newer.from === held.from ? {} : { note: `newer copy from ${newer.from}` }),
    }));
  });
}

/* ---------- shared record builders ---------- */

type Context = {
  methodology: Methodology;
  projectId: string;
  siteWells: ReadonlyMap<string, { name: string; td_m: number | null }>;
  warnings: string[];
  usedSuffixes: Set<string>;
};

/** The id suffix shared by a well, its assessment and its audit event; unique within the export. */
function uniqueSuffix(ctx: Context, preferred: string, licence: string): string {
  const base = preferred || slug(licence) || 'well';
  let suffix = base;
  if (ctx.usedSuffixes.has(suffix)) {
    ctx.warnings.push(`${licence}: id ${base} is already used by another well; its ids get the licence appended`);
    suffix = `${base}_${slug(licence)}`;
  }
  for (let n = 2, root = suffix; ctx.usedSuffixes.has(suffix); n++) suffix = `${root}_${n}`;
  ctx.usedSuffixes.add(suffix);
  return suffix;
}

function warnDropped(ctx: Context, licence: string, dropped: readonly ParamKey[]): void {
  if (dropped.length > 0) {
    ctx.warnings.push(`${licence}: ${dropped.join(', ')} not a whole score 1-5; migrated as unknown`);
  }
}

/** A construction record that fails the schema is dropped with a warning, never an abort. */
function constructionOf(value: unknown, licence: string, ctx: Context): Wellbore | null {
  if (value === undefined || value === null) return null;
  const parsed = WellboreSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  ctx.warnings.push(
    `${licence}: wellbore construction does not fit the v3 schema (${describeIssues(parsed.error)}); ` +
      'construction left empty',
  );
  return null;
}

/** The v2 `legacy` block ({ scores, total } of the v1 record), kept as legacyV1 for traceability. */
function legacyOf(value: unknown, licence: string, ctx: Context): Well['legacyV1'] {
  if (value === undefined || value === null) return null;
  if (isRecord(value) && isRecord(value.scores) && typeof value.total === 'number' && Number.isFinite(value.total)) {
    const entries = Object.entries(value.scores);
    const numeric = entries.filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]));
    if (numeric.length < entries.length) {
      ctx.warnings.push(`${licence}: non-numeric v1 legacy scores were dropped from legacyV1`);
    }
    return { scores: Object.fromEntries(numeric), total: value.total };
  }
  ctx.warnings.push(`${licence}: the v1 legacy block is not { scores, total }; legacyV1 left empty`);
  return null;
}

function importEvent(well: Well, suffix: string, kind: 'v2' | '3d', actor: string): AuditEvent {
  return {
    id: `aud_${kind}_${suffix}_${Date.parse(well.updatedAt)}`,
    at: well.updatedAt,
    actorName: actor,
    projectId: well.projectId,
    entity: 'well',
    entityId: well.id,
    action: 'import',
    diff: { before: null, after: well },
  };
}

type Migrated = { well: Well; assessment: Assessment | null; event: AuditEvent; parity: ParityRow };

/* ---------- v2 wells ---------- */

/** The stored v2 computed block for parity: 'none' when the well has none, 'incomplete' when unreadable. */
function storedMetrics(block: unknown): ParityMetrics | 'none' | 'incomplete' {
  if (block === undefined || block === null) return 'none';
  if (!isRecord(block)) return 'incomplete';
  const { L, C, cell, riskIndex, rankLabel } = block;
  return typeof L === 'number' &&
    typeof C === 'number' &&
    typeof cell === 'number' &&
    typeof riskIndex === 'number' &&
    typeof rankLabel === 'string'
    ? { L, C, cell, riskIndex, rank: rankLabel }
    : 'incomplete';
}

const sameMetrics = (a: ParityMetrics, b: ParityMetrics): boolean =>
  a.L === b.L && a.C === b.C && a.cell === b.cell && a.riskIndex === b.riskIndex && a.rank === b.rank;

/** How a v2 needsReview flag was carried over, for the parity row. */
type ReviewFlag = { asDraft: boolean; note: string } | null;

function v2ParityRow(entry: V2Entry, stored: unknown, v3: ParityMetrics | null, review: ReviewFlag): ParityRow {
  const notes: string[] = [];
  if (entry.origin === 'browser') notes.push(`only in ${entry.from}`);
  if (entry.note) notes.push(entry.note);
  if (review) notes.push(review.note);
  let status: ParityStatus = entry.origin === 'browser' ? 'browser-only' : 'ok';
  if (review?.asDraft) status = 'needs-review (draft)'; // a browser-only origin stays in the note
  let v2: ParityMetrics | null = null;
  if (v3 === null) {
    if (entry.origin === 'register') status = 'unscored';
    else notes.push('no scores');
  } else {
    const m = storedMetrics(stored);
    if (m === 'none') notes.push('no stored v2 computed block to compare');
    else if (m === 'incomplete') {
      status = 'mismatch';
      notes.push('the stored v2 computed block is incomplete');
    } else {
      v2 = m;
      if (!sameMetrics(m, v3)) status = 'mismatch';
    }
  }
  return { licence: entry.licence, status, v2, v3, ...(notes.length > 0 ? { note: notes.join('; ') } : {}) };
}

function migrateV2Well(entry: V2Entry, ctx: Context, actor: string): Migrated {
  const { raw, licence, updatedAt } = entry;
  const m = ctx.methodology;
  // v1-shaped records become v2 (scores mapped, scoredUnder 1.0.0, legacy kept) exactly as v2 did on load.
  const n = normalizeWell(raw, m);
  const suffix = uniqueSuffix(ctx, trimmed(raw.id), licence);
  const site = ctx.siteWells.get(entry.key);
  const editor = trimmed(raw.updatedBy) || trimmed(raw.reviewer) || 'v2 import';

  const fallback = <T extends string>(field: string, value: unknown, list: readonly T[], to: T): T => {
    const hit = oneOf(list, value);
    if (hit !== null) return hit;
    if (value !== undefined && value !== null && value !== '') {
      ctx.warnings.push(`${licence}: ${field} ${JSON.stringify(value)} is not a v3 value; set to "${to}"`);
    }
    return to;
  };
  let classification = oneOf(CLASSIFICATIONS, raw.klass);
  if (classification === null) {
    classification = 'Type 1';
    ctx.warnings.push(
      `${licence}: classification ${JSON.stringify(raw.klass ?? null)} is not Type 1..9; ` +
        'set to "Type 1", review it before scoring',
    );
  }

  const well: Well = {
    id: `wel_v2_${suffix}`,
    projectId: ctx.projectId,
    licence,
    name: site?.name ?? '',
    operator: text(raw.operator),
    lat: numberIn(raw.lat, -90, 90),
    lon: numberIn(raw.lon, -180, 180),
    spudYear: wholeNumberIn(raw.year, 1850, 2100),
    type: fallback('type', raw.type, WELL_TYPES, 'Unknown'),
    trajectory: fallback('trajectory', raw.traj, TRAJECTORIES, 'Unknown'),
    status: fallback('status', raw.status, STATUSES, 'Unknown'),
    classification,
    td_m: site?.td_m ?? null,
    notes: text(raw.notes),
    construction: constructionOf(raw.wellbore, licence, ctx),
    legacyV1: legacyOf(n.legacy, licence, ctx),
    createdAt: timestamp(raw.createdAt) ?? updatedAt,
    createdBy: editor,
    updatedAt,
    updatedBy: editor,
  };

  let assessment: Assessment | null = null;
  let v3: ParityMetrics | null = null;
  let review: ReviewFlag = null;
  const v2Scores = n.scores;
  if (isRecord(v2Scores)) {
    const { scores, dropped } = scoresFrom((key) => v2Scores[key]);
    warnDropped(ctx, licence, dropped);
    const c = computeWell(scores, m);
    v3 = { L: c.L, C: c.C, cell: c.cell, riskIndex: c.riskIndex, rank: c.rank.label };
    const scoredUnder = trimmed(n.scoredUnder) || m.revision;
    // needsReview under the current revision means v2 may have derived the scores itself (a 3D
    // push through deriveScoresFromReviewer): a draft for a reviewer to finalise, never a final.
    // Under an older revision it is a human-scored v1 well; it stays final and shows as stale in v3.
    if (n.needsReview === true) {
      const asDraft = scoredUnder === m.revision;
      review = asDraft
        ? { asDraft, note: 'flagged for re-review in v2; imported as a draft' }
        : { asDraft, note: `flagged for re-review in v2; scored under ${scoredUnder} — v3 shows it as stale` };
      if (asDraft) {
        ctx.warnings.push(
          `${licence}: needsReview in v2 (its scores may be derived, not reviewed); ` +
            'imported as a draft assessment to review and finalise in v3',
        );
      }
    }
    const override = trimmed(raw.recActionOverride) || null;
    const common = {
      id: `asm_v2_${suffix}_${Date.parse(updatedAt)}`,
      wellId: well.id,
      scores,
      justifications: {},
      suggestions: {},
      reviewerName: trimmed(raw.reviewer) || 'Unknown (v2)',
      supersedesId: null,
      approvedByName: null,
      approvedAt: null,
      createdAt: updatedAt,
      updatedAt,
    };
    assessment = review?.asDraft
      ? {
          ...common,
          methodologyRevision: m.revision,
          computed: null,
          recommendedAction: { auto: '', override },
          status: 'draft',
          assessedAt: null,
        }
      : {
          ...common,
          methodologyRevision: scoredUnder,
          computed: { L: c.L, C: c.C, Lr: c.Lr, Cr: c.Cr, cell: c.cell, riskIndex: c.riskIndex, rank: c.rank.label },
          recommendedAction: { auto: recommendationText(recommend(scores, m)), override },
          status: 'final',
          assessedAt: updatedAt,
        };
  }
  return {
    well,
    assessment,
    event: importEvent(well, suffix, 'v2', actor),
    // Against the block v2 stored, not the one normalizeWell just recomputed.
    parity: v2ParityRow(entry, raw.computed, v3, review),
  };
}

/* ---------- 3D reviewer exports ---------- */

const TYPE_FROM_3D: ReadonlyMap<string, Well['type']> = new Map([
  ['oil', 'Oil Producer'],
  ['gas', 'Gas Producer'],
  ['injector', 'Injection'],
  ['water disposal', 'Disposal'],
  ['observation', 'Observation'],
]);

function statusFrom3D(value: unknown): Well['status'] {
  const s = text(value);
  if (/orphan/i.test(s)) return 'Orphaned';
  if (/suspend/i.test(s)) return 'Suspended';
  if (/abandon/i.test(s)) return 'Abandoned (P&A)';
  if (/active|producing/i.test(s)) return 'Active';
  return 'Unknown';
}

/** A well only the 3D viewer has: its explicit subscores (if any) become a draft, never a final. */
function migrate3DWell(entry: SourceEntry, ctx: Context, actor: string): Migrated {
  const { raw: r, licence, updatedAt } = entry;
  const suffix = uniqueSuffix(ctx, slug(licence), licence);
  const editor = trimmed(r.reviewer) || '3D import';
  ctx.warnings.push(
    `${licence} (${entry.from}): a 3D export has no classification; set to "Type 1", review it before scoring`,
  );

  const well: Well = {
    id: `wel_3d_${suffix}`,
    projectId: ctx.projectId,
    licence,
    name: text(r.wellName),
    operator: text(r.operator),
    lat: numberIn(r.surfaceLat, -90, 90),
    lon: numberIn(r.surfaceLon, -180, 180),
    spudYear: wholeNumberIn(r.drillingYear, 1850, 2100),
    type: TYPE_FROM_3D.get(trimmed(r.wellType).toLowerCase()) ?? 'Unknown',
    trajectory: oneOf(TRAJECTORIES, r.orientation) ?? 'Unknown',
    status: statusFrom3D(r.status),
    classification: 'Type 1', // never derived: suggest() would turn a guessed type into a penetration score
    td_m: numberIn(r.td, 0, Number.MAX_VALUE),
    notes: text(r.notes),
    construction: constructionOf(wellboreFrom3D(r), licence, ctx),
    legacyV1: null,
    createdAt: timestamp(r.createdAt) ?? updatedAt,
    createdBy: editor,
    updatedAt,
    updatedBy: editor,
  };

  const { scores, dropped } = scoresFrom((key) => r[`s_${key}`]);
  warnDropped(ctx, licence, dropped);
  const explicit = PARAM_KEYS.filter((key) => scores[key] !== null).length;
  const assessment: Assessment | null =
    explicit === 0
      ? null
      : {
          id: `asm_3d_${suffix}_${Date.parse(updatedAt)}`,
          wellId: well.id,
          methodologyRevision: ctx.methodology.revision,
          scores,
          justifications: {},
          suggestions: {},
          computed: null,
          recommendedAction: { auto: '', override: trimmed(r.recommendedAction) || null },
          status: 'draft',
          reviewerName: 'Unknown (3D)',
          assessedAt: null,
          supersedesId: null,
          approvedByName: null,
          approvedAt: null,
          createdAt: updatedAt,
          updatedAt,
        };
  const parity: ParityRow = {
    licence,
    status: assessment ? 'browser-only (3D, draft)' : 'unscored',
    v2: null,
    v3: null,
    note: assessment
      ? `only in ${entry.from}; draft with ${explicit} explicit score(s)`
      : `only in ${entry.from} (3D); no explicit scores, so no draft`,
  };
  return { well, assessment, event: importEvent(well, suffix, '3d', actor), parity };
}

/* ---------- the migration ---------- */

export function migrateV2Data(args: MigrateV2Args): MigrateV2Result {
  const warnings: string[] = [];
  const exportedAt = timestamp(args.now);
  if (exportedAt === null) throw new Error(`now: ${JSON.stringify(args.now)} is not a timestamp`);
  const methodology = parseMethodology(args.methodology);
  const publishedAt = timestamp(methodology.updatedAt);
  if (publishedAt === null) {
    throw new Error(`methodology: updatedAt ${JSON.stringify(methodology.updatedAt)} is not a timestamp`);
  }
  const site = args.site === undefined || args.site === null ? null : parseSiteConfig(args.site);
  const projectName = (args.projectName ?? V2_DEFAULT_PROJECT_NAME).trim();
  if (!projectName) throw new Error('projectName: must not be empty');
  const projectId = `prj_v2_${slug(projectName) || 'project'}`;
  if (!Array.isArray(args.wells)) throw new Error('wells: expected the v2 wells.json array of well records');

  // v2 records, one per licence: wells.json, then each v2 browser export (newest updatedAt wins).
  // 3D records are gathered separately: the register (with its v2 browser exports) always wins.
  const register = new Map<string, V2Entry>();
  mergeV2(register, args.wells, 'wells.json', 'register', warnings);
  const threeD = new Map<string, SourceEntry>();
  const scenarios: ParityRow[] = [];
  (args.browserExports ?? []).forEach((file, i) => {
    const from = `browser export ${i + 1}`;
    if (Array.isArray(file)) {
      mergeV2(register, file, from, 'browser', warnings);
    } else if (isRecord(file) && file.schemaVersion === 1 && Array.isArray(file.wells)) {
      file.wells.forEach((item, j) => {
        // A scenario is a what-if well (the viewer's own Push to Register leaves them out). Skipped
        // before the newest-wins merge, so a newer what-if copy cannot displace the real record.
        if (isRecord(item) && item.isScenario === true) {
          const uwi = trimmed(item.uwi) || `(no UWI, well ${j + 1})`;
          warnings.push(`${uwi} (${from}): a 3D scenario (what-if) well; not imported`);
          scenarios.push({ licence: uwi, status: '3d-skipped (scenario)', v2: null, v3: null, note: `in ${from}` });
          return;
        }
        keepNewest(threeD, sourceEntry(item, j, from, 'uwi'), warnings);
      });
    } else {
      throw new Error(
        `${from}: format not recognised. Expected a v2 register "Export JSON" (an array of wells) ` +
          'or a 3D reviewer export ({ "schemaVersion": 1, "wells": [...] }).',
      );
    }
  });

  const ctx: Context = {
    methodology,
    projectId,
    siteWells: new Map(Object.entries(site?.wellsByUwi ?? {}).map(([uwi, w]) => [licenceKey(uwi), w])),
    warnings,
    usedSuffixes: new Set(),
  };
  const migrated: Migrated[] = [];
  const parity: ParityRow[] = [];
  const add = (x: Migrated): void => {
    migrated.push(x);
    parity.push(x.parity);
  };
  for (const entry of register.values()) add(migrateV2Well(entry, ctx, args.actor));
  for (const entry of threeD.values()) {
    if (register.has(entry.key)) {
      const note = `in ${entry.from}`;
      parity.push({ licence: entry.licence, status: '3d-skipped (register wins)', v2: null, v3: null, note });
    } else {
      add(migrate3DWell(entry, ctx, args.actor));
    }
  }
  parity.push(...scenarios);
  const wells = migrated.map((x) => x.well);

  // Project timestamps come from the data, not the clock, so re-runs give the same project. The
  // store applies an imported project only when it is at least as new as the stored one, so a
  // project edited in v3 after the first import keeps its edits on the next one.
  const byTime = (a: string, b: string): number => Date.parse(a) - Date.parse(b);
  const firstCreated = wells.map((w) => w.createdAt).sort(byTime)[0] ?? publishedAt;
  const project: Project = {
    id: projectId,
    name: projectName,
    jurisdiction: 'AER',
    description: '',
    injectors: site?.injectors ?? [],
    formations: site?.formations ?? [],
    requireApproval: false,
    createdAt: firstCreated,
    createdBy: args.actor,
    updatedAt: firstCreated,
    updatedBy: args.actor,
  };
  const record: MethodologyRecord = {
    revision: methodology.revision,
    methodology,
    note: 'migrated from v2',
    publishedAt,
    publishedBy: methodology.updatedBy,
  };

  const parsed = ProjectExportSchema.safeParse({
    format: 'lwa-project',
    version: 1,
    exportedAt,
    exportedBy: args.actor,
    project,
    wells,
    assessments: migrated.flatMap((x) => (x.assessment ? [x.assessment] : [])),
    methodologies: [record],
    auditEvents: migrated.map((x) => x.event),
  });
  if (!parsed.success) {
    throw new Error(`the migration built an invalid project export: ${describeIssues(parsed.error)}`);
  }
  // The JSON form, exactly as the export file carries it.
  const exp = JSON.parse(JSON.stringify(parsed.data)) as ProjectExport;
  return { export: exp, parity, mismatches: parity.filter((p) => p.status === 'mismatch'), warnings };
}
