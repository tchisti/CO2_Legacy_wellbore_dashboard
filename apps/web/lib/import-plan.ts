// The Wells page's Import (spec §4.2) between reading a file and writing to the store. A CSV is
// planned against the project as stored: which rows create or update a well, which are skipped for
// an error, and what becomes of each row's scores (always a DRAFT, never a final: a CSV carries no
// justifications). Nothing is written until runCsvImport. A JSON file is a project export, or a
// bare v2 wells.json that is migrated in the browser and put under the active project.
import {
  DEFAULT_METHODOLOGY,
  migrateV2Data,
  type Assessment,
  type ParityRow,
  type Project,
  type ProjectExport,
  type Scores,
  type Well,
  type WellInput,
} from '@lwa/engine';
import { isProjectFile, parseJsonText } from '@/lib/backup';
import { mapHeaders, parseCsv, rowsToWellInputs, type HeaderMap, type ReportRow } from '@/lib/csv';
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
 * What a row's scores become: a first `new` draft; a `reassessment` draft beside the current final;
 * `kept`: the well has a draft in progress, which is left alone (scores not imported); `same`: the
 * scores equal the current final's, so no draft. Null when the row carries no score value.
 */
export type DraftPlan = 'new' | 'reassessment' | 'kept' | 'same' | null;

export type PlannedRow = ReportRow & { draft: DraftPlan };

/** A draft to save, by licenceKey. */
export type PlannedDraft = { key: string; scores: Scores; reassessment: boolean };

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

const sameScores = (a: Scores, b: Scores): boolean => (Object.keys(a) as (keyof Scores)[]).every((k) => a[k] === b[k]);

/** Reads a CSV and plans its import against the stored project. Pure: writes nothing. */
export function planCsvImport(text: string, register: RegisterSnapshot, opts: { currentYear?: number } = {}): CsvPlanResult {
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, message: EMPTY_CSV_MESSAGE };
  const map = mapHeaders(table[0]!);
  if (!map.byKey.licence) return { ok: false, message: MISSING_LICENCE_MESSAGE };
  const read = rowsToWellInputs(table.slice(1), map, { wells: register.wells, currentYear: opts.currentYear });

  const wellByKey = new Map(register.wells.map((w) => [licenceKey(w.licence), w]));
  const outcome = new Map<string, DraftPlan>();
  const drafts: PlannedDraft[] = [];
  for (const [key, scores] of read.scoreDrafts) {
    const well = wellByKey.get(key);
    const draft = well ? (register.drafts.get(well.id) ?? null) : null;
    const current = well ? (register.current.get(well.id) ?? null) : null;
    if (draft) {
      outcome.set(key, 'kept');
    } else if (current && sameScores(current.scores, scores)) {
      outcome.set(key, 'same');
    } else {
      outcome.set(key, current ? 'reassessment' : 'new');
      drafts.push({ key, scores, reassessment: current !== null });
    }
  }

  const rows = read.report.map((r): PlannedRow => {
    const draft = r.status !== 'error' && r.scored > 0 ? (outcome.get(licenceKey(r.licence)) ?? null) : null;
    return { ...r, draft, warnings: draft === 'kept' ? [...r.warnings, DRAFT_KEPT_WARNING] : r.warnings };
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
};

/**
 * Writes a plan: the wells in one upsert, then each draft under the store's actor (the importing
 * reviewer). A well that gained a draft since the plan was made keeps it.
 */
export async function runCsvImport(
  store: Pick<Store, 'wells' | 'assessments'>,
  projectId: string,
  plan: CsvPlan,
): Promise<CsvImportOutcome> {
  const outcome: CsvImportOutcome = { created: 0, updated: 0, drafts: 0, skippedRows: plan.counts.errors, warnings: [] };
  if (plan.inputs.length === 0) return outcome;
  const { created, updated, ids } = await store.wells.upsertByLicence(projectId, plan.inputs);
  outcome.created = created;
  outcome.updated = updated;
  const byKey = new Map(plan.inputs.map((input, i) => [licenceKey(input.licence), { id: ids[i], licence: input.licence }]));
  for (const d of plan.drafts) {
    const well = byKey.get(d.key);
    if (!well?.id) continue;
    if (await store.assessments.draft(well.id)) {
      outcome.warnings.push(`${well.licence}: ${DRAFT_KEPT_WARNING}`);
      continue;
    }
    await store.assessments.saveDraft(well.id, { scores: d.scores, justifications: {}, override: null, suggestions: {} });
    outcome.drafts += 1;
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

/**
 * A bare v2 wells.json migrated in the browser (the v2 migration under the built-in methodology)
 * and put under the active project. Throws a readable Error when a record cannot be migrated.
 */
export function migrateV2Into(args: { wells: unknown[]; project: Project; now: string; actor: string }): V2Migration {
  const result = migrateV2Data({
    wells: args.wells,
    methodology: DEFAULT_METHODOLOGY,
    projectName: args.project.name,
    now: args.now,
    actor: args.actor,
  });
  return { ...result, export: retargetExport(result.export, args.project) };
}

/** A parity mismatch as one line: "100/…: v2 L 1.56 · C 2.40 · cell 4 Low; v3 L 1.60 · C 2.40 · cell 4 Low". */
export function parityText(row: ParityRow): string {
  const side = (m: ParityRow['v2']) =>
    m ? `L ${m.L} · C ${m.C} · cell ${m.cell} · index ${m.riskIndex} ${m.rank}` : 'none';
  return `${row.licence}: v2 ${side(row.v2)}; v3 ${side(row.v3)}${row.note ? ` (${row.note})` : ''}`;
}
