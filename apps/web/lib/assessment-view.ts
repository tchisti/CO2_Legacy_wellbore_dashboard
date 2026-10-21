// The well page as data (spec §4.3): the score table of an assessment (parameter, score, anchor
// text, justification, weighted contribution, grouped L then C with axis subtotals), which
// methodology to show it under, the recommended action split into title, paragraphs and lists,
// earlier finals, and the well's history from the audit trail (a finalise that changed nothing
// reads "Re-confirmed", spec §5.1). Pure: the page loads the records.
import {
  PARAM_KEYS,
  anchorText,
  paramsOf,
  resolveScore,
  type Assessment,
  type AuditEvent,
  type Axis,
  type Methodology,
  type MethodologyRecord,
  type ParamKey,
  type RevisionDelta,
  type Score,
} from '@lwa/engine';
import { MISSING, fmtDate } from '@/lib/format';

/* ---------- score table ---------- */

export type ScoreRow = {
  key: ParamKey;
  name: string;
  axis: Axis;
  weight: number;
  /** As entered; null is "unknown". */
  score: Score | null;
  /** The methodology's anchor for the score, or "Unknown — scores as n". */
  anchor: string;
  /** The reviewer's justification, trimmed; '' when there is none. */
  justification: string;
  /** weight × the score used in the maths (the param's unknownScore when unknown). */
  contribution: number;
};

/** One row per parameter of `m`: every L parameter first, then every C parameter, each in methodology order. */
export function scoreRows(a: Pick<Assessment, 'scores' | 'justifications'>, m: Methodology): ScoreRow[] {
  return [...paramsOf(m, 'L'), ...paramsOf(m, 'C')].map((p) => {
    const score = a.scores[p.key] ?? null;
    return {
      key: p.key,
      name: p.name,
      axis: p.axis,
      weight: p.weight,
      score,
      anchor: anchorText(p, score),
      justification: a.justifications[p.key]?.trim() ?? '',
      contribution: p.weight * resolveScore(p, score),
    };
  });
}

/** The sum of the contributions on each axis: the assessment's L and C when shown under its own methodology. */
export function axisSubtotals(rows: readonly ScoreRow[]): { L: number; C: number } {
  const sum = (axis: Axis) => rows.filter((r) => r.axis === axis).reduce((total, r) => total + r.contribution, 0);
  return { L: sum('L'), C: sum('C') };
}

/** The methodology an assessment is shown under; `exact` is false when its own revision is not in the project. */
export type DisplayMethodology = { methodology: Methodology; exact: boolean };

/**
 * The published record of `revision` when the project has it; otherwise the current methodology
 * (an assessment migrated from v1 under 1.0.0 has no record), and the page says so.
 */
export function methodologyForRevision(
  records: readonly MethodologyRecord[],
  revision: string,
  current: Methodology,
): DisplayMethodology {
  const record = records.find((r) => r.revision === revision);
  return record ? { methodology: record.methodology, exact: true } : { methodology: current, exact: false };
}

/** "assessed under 2.0.0 by Tahir Chisti on 2026-08-07" (the date in UTC). */
export function attribution(a: Pick<Assessment, 'methodologyRevision' | 'reviewerName' | 'assessedAt'>): string {
  return `assessed under ${a.methodologyRevision} by ${a.reviewerName} on ${fmtDate(a.assessedAt)}`;
}

/**
 * The note for an assessment made under an earlier revision that differs only by a patch (wording
 * only, spec §5.1): "assessed under 2.0.0 (current 2.0.1, wording only)". Null otherwise: a minor
 * or major move is a stale revision, and the same revision needs no note.
 */
export function revisionNote(assessedRevision: string, currentRevision: string, delta: RevisionDelta): string | null {
  return delta === 'patch' ? `assessed under ${assessedRevision} (current ${currentRevision}, wording only)` : null;
}

/* ---------- recommended action ---------- */

export type ActionBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/**
 * The automatic recommendation as written by the engine (recommendationText): the first line is
 * the title, then paragraphs, with consecutive "- " lines gathered into one list. Blank lines are
 * dropped and every line is trimmed.
 */
export function actionText(text: string): { title: string; blocks: ActionBlock[] } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const [title = '', ...rest] = lines;
  const blocks: ActionBlock[] = [];
  for (const line of rest) {
    if (line.startsWith('- ')) {
      const item = line.slice(2).trim();
      const last = blocks.at(-1);
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else {
      blocks.push({ kind: 'paragraph', text: line });
    }
  }
  return { title, blocks };
}

/* ---------- prior assessments ---------- */

const assessedTime = (a: Assessment): number => (a.assessedAt ? Date.parse(a.assessedAt) : Number.NEGATIVE_INFINITY);

/** The well's other finals (the ones the current final superseded), newest first. */
export function priorFinals(assessments: readonly Assessment[], currentId: string | null): Assessment[] {
  return assessments
    .filter((a) => a.status === 'final' && a.id !== currentId)
    .sort((a, b) => assessedTime(b) - assessedTime(a));
}

/* ---------- history ---------- */

export type HistoryEntry = {
  id: string;
  /** ISO-8601 UTC. */
  at: string;
  /** "Created", "Updated", "Finalised", "Re-confirmed", "Deleted draft", "Imported", "Exported", … */
  action: string;
  /** "Well" or "Assessment". */
  entity: string;
  actor: string;
  /** The fields that changed ("operator, notes"), "initial record", or "removed". */
  summary: string;
};

const ACTION_LABEL: Record<AuditEvent['action'], string> = {
  create: 'Created',
  update: 'Updated',
  finalise: 'Finalised',
  delete: 'Deleted',
  import: 'Imported',
  export: 'Exported',
};

const ENTITY_LABEL: Record<AuditEvent['entity'], string> = {
  project: 'Project',
  well: 'Well',
  assessment: 'Assessment',
  methodology: 'Methodology',
};

/** Stamps every write changes; listing them would say nothing about the edit. */
const STAMP_KEYS: ReadonlySet<string> = new Set(['createdAt', 'createdBy', 'updatedAt', 'updatedBy']);

/** Readable names for coded fields; every other field is shown by its key. */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  spudYear: 'spud year',
  td_m: 'TD',
  lat: 'latitude',
  lon: 'longitude',
  legacyV1: 'v1 scores',
  methodologyRevision: 'revision',
  recommendedAction: 'recommended action',
  computed: 'results',
  reviewerName: 'reviewer',
  assessedAt: 'assessed at',
  supersedesId: 'superseded assessment',
  approvedByName: 'approved by',
  approvedAt: 'approved at',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A short account of one audit diff: "initial record" when there was nothing before, "removed"
 * when nothing is left, otherwise the top-level fields whose values differ (stamps left out).
 */
export function diffSummary(before: unknown, after: unknown): string {
  if (before === null && after === null) return '';
  if (before === null) return 'initial record';
  if (after === null) return 'removed';
  if (!isRecord(before) || !isRecord(after)) return 'changed';
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changed = keys.filter(
    (k) => !STAMP_KEYS.has(k) && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null),
  );
  return changed.length === 0 ? 'no field changes' : changed.map((k) => FIELD_LABEL[k] ?? k).join(', ');
}

/**
 * Whether a final re-confirms the final it supersedes (spec §5.1: "the reviewer may finalise
 * without changes, logged as a re-confirmation"): the same scores, justifications and override.
 * Blank and missing justifications count as the same, as do surrounding spaces; a blank override
 * is no override. The automatic text and the revision are the engine's, not the reviewer's, so
 * they are not compared.
 */
export function isReconfirmation(
  final: Pick<Assessment, 'scores' | 'justifications' | 'recommendedAction'>,
  previous: Pick<Assessment, 'scores' | 'justifications' | 'recommendedAction'> | null | undefined,
): boolean {
  if (!previous) return false;
  const text = (j: Assessment['justifications'], k: (typeof PARAM_KEYS)[number]) => j[k]?.trim() ?? '';
  const override = (a: Pick<Assessment, 'recommendedAction'>) => a.recommendedAction.override?.trim() || null;
  return (
    PARAM_KEYS.every((k) => (final.scores[k] ?? null) === (previous.scores[k] ?? null)) &&
    PARAM_KEYS.every((k) => text(final.justifications, k) === text(previous.justifications, k)) &&
    override(final) === override(previous)
  );
}

const wellIdOf = (side: unknown): string | null =>
  isRecord(side) && typeof side.wellId === 'string' ? side.wellId : null;

/** Whether an audit event is about this well or one of its assessments (a discarded draft included). */
function isAboutWell(e: AuditEvent, wellId: string, assessmentIds: ReadonlySet<string>): boolean {
  if (e.entity === 'well') return e.entityId === wellId;
  if (e.entity !== 'assessment') return false;
  return assessmentIds.has(e.entityId) || wellIdOf(e.diff.before) === wellId || wellIdOf(e.diff.after) === wellId;
}

/** The label of an event: a discarded draft and a re-confirming finalise get their own. */
function actionLabel(e: AuditEvent, byId: ReadonlyMap<string, Assessment>): string {
  if (e.entity !== 'assessment') return ACTION_LABEL[e.action];
  if (e.action === 'delete') return 'Deleted draft';
  if (e.action === 'finalise') {
    const final = byId.get(e.entityId);
    const previous = final?.supersedesId ? byId.get(final.supersedesId) : undefined;
    if (final && isReconfirmation(final, previous)) return 'Re-confirmed';
  }
  return ACTION_LABEL[e.action];
}

/**
 * The well's audit trail, newest first: its own events and those of its assessments (`assessments`
 * are the well's, as the store lists them). An assessment that no longer exists (a discarded
 * draft) is recognised by the well id in its diff. A finalise that changed nothing against the
 * final it supersedes reads "Re-confirmed".
 */
export function wellHistory(
  events: readonly AuditEvent[],
  wellId: string,
  assessments: readonly Assessment[],
): HistoryEntry[] {
  const byId = new Map(assessments.map((a) => [a.id, a]));
  const ids: ReadonlySet<string> = new Set(byId.keys());
  return events
    .filter((e) => isAboutWell(e, wellId, ids))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((e) => ({
      id: e.id,
      at: e.at,
      action: actionLabel(e, byId),
      entity: ENTITY_LABEL[e.entity],
      actor: e.actorName.trim() || MISSING,
      summary: diffSummary(e.diff.before, e.diff.after),
    }));
}
