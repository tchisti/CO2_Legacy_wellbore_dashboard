// The Wells page's Import (spec §4.2) between reading a file and writing to the store. A CSV is
// planned against the project as stored: which rows create or update a well, which are skipped for
// an error, and what becomes of each row's scores (always a DRAFT, never a final). Nothing is
// written until runCsvImport. A JSON file is a project export, or a bare v2 wells.json that is
// migrated in the browser and put under the active project.
//
// CSV scores and the current final. A CSV carries no justifications, so:
// - a well without a final gets a first-assessment draft of the score values given (every other
//   parameter null); "?" cells alone make no draft;
// - a well with a current final gets a re-assessment draft built FROM THE FINAL: a 1–5 cell
//   replaces the final's score, an explicit "?" makes it Unknown, an empty cell or an absent column
//   keeps it. Every parameter whose score is unchanged keeps the final's justification, and the
//   final's override is kept. When the result equals the final, no draft is made;
// - a well with a draft in progress keeps it: the file's scores are not imported.
import {
  DEFAULT_METHODOLOGY,
  PARAM_KEYS,
  migrateV2Data,
  type Assessment,
  type ParityRow,
  type Project,
  type ProjectExport,
  type Score,
  type Scores,
  type Well,
  type WellInput,
} from '@lwa/engine';
import { isProjectFile, parseJsonText } from '@/lib/backup';
import {
  SCORE_SHORT_LABELS,
  mapHeaders,
  parseCsv,
  rowsToWellInputs,
  type HeaderMap,
  type ReportRow,
  type ScoreCells,
} from '@/lib/csv';
import { licenceKey, type Store } from '@/lib/store/store';

/* ---------- CSV ---------- */

/** v2's message for a file without the licence column; the whole file is refused. */
export const MISSING_LICENCE_MESSAGE =
  'CSV is missing required header "Well ID / Licence". Please download the CSV Template and edit it.';
export const EMPTY_CSV_MESSAGE = 'CSV appears empty. Please use the CSV Template.';
export const DRAFT_KEPT_WARNING = 'has a draft in progress; scores not imported';

/** The project as stored: its wells with each one's draft and current final (lib/use-register.ts). */
export type RegisterSnapshot = {
  wells: readonly Well[];
  drafts: ReadonlyMap<string, Assessment | null>;
  current: ReadonlyMap<string, Assessment | null>;
};

/**
 * What a row's scores become: a first `new` draft; a `reassessment` draft built from the current
 * final; `kept`: the well has a draft in progress, which is left alone (scores not imported);
 * `same`: the scores come out equal to the current final's, so no draft. Null when the row gives
 * no score cell, or only "?" cells for a well without a final.
 */
export type DraftPlan = 'new' | 'reassessment' | 'kept' | 'same' | null;

export type PlannedRow = ReportRow & {
  draft: DraftPlan;
  /**
   * For a well with a current final: the scores this row changes, against the final as the rows
   * before it leave it ("Plug quality 1→5", "Cement 2→?").
   */
  scoreChanges: string[];
};

/** A draft to save, by licenceKey. */
export type PlannedDraft = {
  key: string;
  scores: Scores;
  /** Carried from the final for every unchanged parameter; empty for a first assessment. */
  justifications: Assessment['justifications'];
  /** The final's override, carried; null for a first assessment. */
  override: string | null;
  reassessment: boolean;
};

export type CsvPlan = {
  map: HeaderMap;
  rows: PlannedRow[];
  inputs: WellInput[];
  drafts: PlannedDraft[];
  /** Rows by status, and drafts to save. */
  counts: { create: number; update: number; errors: number; drafts: number };
  /** The file has a Reviewer column, which is not imported. */
  reviewerColumn: boolean;
  v1Detected: boolean;
};

export type CsvPlanResult = { ok: true; plan: CsvPlan } | { ok: false; message: string };

const sameScores = (a: Scores, b: Scores): boolean => PARAM_KEYS.every((k) => a[k] === b[k]);

/** The scores with the cells applied over them. */
const applyCells = (scores: Scores, cells: ScoreCells): Scores => {
  const out = { ...scores };
  for (const k of PARAM_KEYS) {
    const v = cells[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
};

const scoreText = (v: Score | null): string => (v === null ? '?' : String(v));

/** The parameters whose score `cells` changes, as "Plug quality 1→5". */
function scoreChangesOf(base: Scores, cells: ScoreCells): string[] {
  return PARAM_KEYS.flatMap((k) => {
    const v = cells[k];
    return v === undefined || v === base[k] ? [] : [`${SCORE_SHORT_LABELS[k]} ${scoreText(base[k])}→${scoreText(v)}`];
  });
}

/** The re-assessment draft from a final and what the file says. */
function reassessmentDraft(key: string, final: Assessment, cells: ScoreCells): PlannedDraft {
  const scores = applyCells(final.scores, cells);
  const justifications = Object.fromEntries(
    PARAM_KEYS.flatMap((k) => {
      const text = final.justifications[k];
      return scores[k] === final.scores[k] && text !== undefined ? [[k, text]] : [];
    }),
  );
  return { key, scores, justifications, override: final.recommendedAction.override, reassessment: true };
}

/** Reads a CSV and plans its import against the stored project. Pure: writes nothing. */
export function planCsvImport(text: string, register: RegisterSnapshot, opts: { currentYear?: number } = {}): CsvPlanResult {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, message: EMPTY_CSV_MESSAGE };
  const map = mapHeaders(table[0]!);
  if (!map.byKey.licence) return { ok: false, message: MISSING_LICENCE_MESSAGE };
  const read = rowsToWellInputs(table.slice(1), map, { wells: register.wells, currentYear: opts.currentYear });

  const wellByKey = new Map(register.wells.map((w) => [licenceKey(w.licence), w]));
  const stateOf = (key: string) => {
    const well = wellByKey.get(key);
    return {
      draft: well ? (register.drafts.get(well.id) ?? null) : null,
      final: well ? (register.current.get(well.id) ?? null) : null,
    };
  };

  const outcome = new Map<string, DraftPlan>();
  const drafts: PlannedDraft[] = [];
  for (const [key, cells] of read.scoreCells) {
    const { draft, final } = stateOf(key);
    if (draft) {
      outcome.set(key, 'kept');
    } else if (final) {
      const planned = reassessmentDraft(key, final, cells);
      if (sameScores(planned.scores, final.scores)) {
        outcome.set(key, 'same');
      } else {
        outcome.set(key, 'reassessment');
        drafts.push(planned);
      }
    } else {
      const scores = read.scoreDrafts.get(key);
      if (!scores) continue; // only "?" cells: nothing to draft for a first assessment
      outcome.set(key, 'new');
      drafts.push({ key, scores, justifications: {}, override: null, reassessment: false });
    }
  }

  // Per row, against the final as the rows before it leave it.
  const running = new Map<string, Scores>();
  const rows = read.report.map((r): PlannedRow => {
    const key = licenceKey(r.licence);
    const given = r.status !== 'error' && Object.keys(r.scores).length > 0;
    const draft = given ? (outcome.get(key) ?? null) : null;
    let scoreChanges: string[] = [];
    const { final } = stateOf(key);
    if (given && final && (draft === 'reassessment' || draft === 'same')) {
      const base = running.get(key) ?? final.scores;
      scoreChanges = scoreChangesOf(base, r.scores);
      running.set(key, applyCells(base, r.scores));
    }
    return { ...r, draft, scoreChanges, warnings: draft === 'kept' ? [...r.warnings, DRAFT_KEPT_WARNING] : r.warnings };
  });
  const count = (status: ReportRow['status']) => rows.filter((r) => r.status === status).length;
  return {
    ok: true,
    plan: {
      map,
      rows,
      inputs: read.inputs,
      drafts,
      counts: { create: count('created'), update: count('updated'), errors: count('error'), drafts: drafts.length },
      reviewerColumn: map.byKey.reviewer !== undefined,
      v1Detected: map.v1Detected,
    },
  };
}

export type CsvImportOutcome = {
  created: number;
  updated: number;
  /** Drafts saved. */
  drafts: number;
  /** Rows left out for an error. */
  skippedRows: number;
  warnings: string[];
  /** Drafts that could not be saved, with why; their wells are written all the same. */
  failedDrafts: { licence: string; message: string }[];
};

/**
 * Writes a plan: the wells in one upsert (all or nothing: when it fails nothing is written and it
 * throws), then each draft under the store's actor (the importing reviewer). A draft that fails is
 * reported in `failedDrafts` and the others are still saved. A well that gained a draft since the
 * plan was made keeps it.
 */
export async function runCsvImport(
  store: Pick<Store, 'wells' | 'assessments'>,
  projectId: string,
  plan: CsvPlan,
): Promise<CsvImportOutcome> {
  const outcome: CsvImportOutcome = {
    created: 0,
    updated: 0,
    drafts: 0,
    skippedRows: plan.counts.errors,
    warnings: [],
    failedDrafts: [],
  };
  if (plan.inputs.length === 0) return outcome;
  const { created, updated, ids } = await store.wells.upsertByLicence(projectId, plan.inputs);
  outcome.created = created;
  outcome.updated = updated;
  const byKey = new Map(plan.inputs.map((input, i) => [licenceKey(input.licence), { id: ids[i], licence: input.licence }]));
  for (const d of plan.drafts) {
    const well = byKey.get(d.key);
    if (!well?.id) continue;
    try {
      if (await store.assessments.draft(well.id)) {
        outcome.warnings.push(`${well.licence}: ${DRAFT_KEPT_WARNING}`);
        continue;
      }
      await store.assessments.saveDraft(well.id, {
        scores: d.scores,
        justifications: d.justifications,
        override: d.override,
        suggestions: {},
      });
      outcome.drafts += 1;
    } catch (err) {
      outcome.failedDrafts.push({ licence: well.licence, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcome;
}

/* ---------- JSON ---------- */

export type JsonImportFile = { kind: 'project'; data: unknown } | { kind: 'v2'; wells: unknown[] };

export const UNRECOGNISED_JSON_MESSAGE =
  'This JSON file is neither a project file exported from this app nor a v2 wells.json (an array of wells).';

/** A picked JSON file's text as a project export or a bare v2 wells array; anything else throws a readable Error. */
export function readImportJson(text: string): JsonImportFile {
  const data = parseJsonText(text);
  if (Array.isArray(data)) return { kind: 'v2', wells: data };
  if (isProjectFile(data)) return { kind: 'project', data };
  throw new Error(UNRECOGNISED_JSON_MESSAGE);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The export put under a stored project: its project record replaced by `project`, and every well
 * and audit event (with a well snapshot it carries) given that project's id. Pure.
 */
export function retargetExport(exp: ProjectExport, project: Project): ProjectExport {
  const from = exp.project.id;
  const to = project.id;
  const move = <T,>(side: T): T => (isRecord(side) && side.projectId === from ? ({ ...side, projectId: to } as T) : side);
  return {
    ...exp,
    project: { ...project },
    wells: exp.wells.map((w) => ({ ...w, projectId: to })),
    auditEvents: exp.auditEvents.map((e) => ({
      ...e,
      projectId: to,
      entityId: e.entity === 'project' && e.entityId === from ? to : e.entityId,
      diff: { before: move(e.diff.before), after: move(e.diff.after) },
    })),
  };
}

export type V2Migration = { export: ProjectExport; parity: ParityRow[]; mismatches: ParityRow[]; warnings: string[] };

/** Projects the v2 migration makes (scripts/migrate-v2.ts, or the Project settings import of its file). */
const V2_PROJECT_ID = /^prj_v2_/;

/**
 * The export's assessment and audit-event ids made specific to `projectId`, deterministically:
 * `asm_v2_<suffix>_<ms>` → `asm_v2_<projectId>_<suffix>_<ms>` (likewise aud_, and the 3D ids).
 * The store adds an assessment or event only when its id is new in the browser, so the same v2
 * file then imports into a second project in full, and again into the same one as a no-op.
 */
function namespaceIds(exp: ProjectExport, projectId: string): ProjectExport {
  const ns = (id: string): string => {
    const m = /^(asm|aud)_(v2|3d)_(.+)$/.exec(id);
    return m ? `${m[1]}_${m[2]}_${projectId}_${m[3]}` : `${id}_${projectId}`;
  };
  return {
    ...exp,
    assessments: exp.assessments.map((a) => ({
      ...a,
      id: ns(a.id),
      supersedesId: a.supersedesId === null ? null : ns(a.supersedesId),
    })),
    auditEvents: exp.auditEvents.map((e) => ({
      ...e,
      id: ns(e.id),
      entityId: e.entity === 'assessment' ? ns(e.entityId) : e.entityId,
    })),
  };
}

/**
 * A bare v2 wells.json migrated in the browser (the v2 migration under the built-in methodology)
 * and put under the active project. Throws a readable Error when a record cannot be migrated.
 *
 * Assessment and audit-event ids are namespaced by the active project (namespaceIds), except in a
 * project the v2 migration itself made (`prj_v2_…`, including the migration's own id for this
 * name): that project already holds these records under the migration's ids, so they must match
 * for a re-import to be a no-op rather than a second copy of every final. (A project renamed since
 * it was migrated keeps its `prj_v2_` id, which is why the prefix and not the name decides.)
 */
export function migrateV2Into(args: { wells: unknown[]; project: Project; now: string; actor: string }): V2Migration {
  const result = migrateV2Data({
    wells: args.wells,
    methodology: DEFAULT_METHODOLOGY,
    projectName: args.project.name,
    now: args.now,
    actor: args.actor,
  });
  const ownId = result.export.project.id;
  const retargeted = retargetExport(result.export, args.project);
  const keepIds = args.project.id === ownId || V2_PROJECT_ID.test(args.project.id);
  return { ...result, export: keepIds ? retargeted : namespaceIds(retargeted, args.project.id) };
}

/**
 * The export's wells with what only v3 knows kept from the matching stored wells (by licenceKey):
 * a v2 record has no name, TD or construction (the in-browser migration has no site file), so where
 * the migrated well has '' / null / none and the stored well has a value, the stored one is used.
 * Otherwise a newer v2 record would blank them on import. Import events carry the same well. Pure.
 */
export function carryStoredFields(exp: ProjectExport, stored: readonly Well[]): ProjectExport {
  const byKey = new Map(stored.map((w) => [licenceKey(w.licence), w]));
  const carried = new Map<string, Well>();
  const wells = exp.wells.map((w) => {
    const match = byKey.get(licenceKey(w.licence));
    if (!match) return w;
    const well: Well = {
      ...w,
      name: w.name === '' ? match.name : w.name,
      td_m: w.td_m ?? match.td_m,
      construction: w.construction ?? match.construction,
      legacyV1: w.legacyV1 ?? match.legacyV1 ?? null,
    };
    carried.set(w.id, well);
    return well;
  });
  const follow = <T,>(side: T): T =>
    isRecord(side) && typeof side.id === 'string' && carried.has(side.id) ? (carried.get(side.id) as T) : side;
  return {
    ...exp,
    wells,
    auditEvents: exp.auditEvents.map((e) =>
      e.entity === 'well' ? { ...e, diff: { before: e.diff.before, after: follow(e.diff.after) } } : e,
    ),
  };
}

/** A parity mismatch as one line: "100/…: v2 L 1.56 · C 2.40 · cell 4 Low; v3 L 1.60 · C 2.40 · cell 4 Low". */
export function parityText(row: ParityRow): string {
  const side = (m: ParityRow['v2']) =>
    m ? `L ${m.L} · C ${m.C} · cell ${m.cell} · index ${m.riskIndex} ${m.rank}` : 'none';
  return `${row.licence}: v2 ${side(row.v2)}; v3 ${side(row.v3)}${row.note ? ` (${row.note})` : ''}`;
}
