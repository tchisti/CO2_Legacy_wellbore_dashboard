// The Wells register as data (spec §4.2): one row per well with its current assessment's numbers
// and derived state (§5.1), the filters (kept in the URL so a filtered view can be linked,
// reloaded and printed), and sorting. Pure: the page loads the records and renders the result.
import {
  CLASSIFICATIONS,
  PARAM_KEYS,
  STATUSES,
  type Assessment,
  type Well,
  type WellInput,
} from '@lwa/engine';
import { assessmentState, type AssessmentState } from '@/lib/derived';
import type { RouteQuery } from '@/lib/routes';

/* ---------- rows ---------- */

export type WellRow = {
  id: string;
  licence: string;
  name: string;
  operator: string;
  type: Well['type'];
  status: Well['status'];
  classification: Well['classification'];
  spudYear: number | null;
  /** From the current final, as stored (two decimals); null when the well has no final. */
  L: number | null;
  C: number | null;
  /** The matrix row (likelihood) and column (consequence) of the current final. */
  Lr: number | null;
  Cr: number | null;
  cell: number | null;
  /** The band label of the current final. Non-null exactly when the well has a current final. */
  rank: string | null;
  riskIndex: number | null;
  /** Parameters scored "unknown" in the current final; null when the well has no final. */
  unknownCount: number | null;
  state: AssessmentState;
  /** Who made the numbers shown: the current final's reviewer, else the draft's, else null. */
  reviewerName: string | null;
  /** The latest change to the record or to one of its current assessments (ISO-8601). */
  updatedAt: string;
};

const latest = (...isos: (string | null | undefined)[]): string =>
  isos.filter((t): t is string => !!t).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));

export function buildRows(
  wells: readonly Well[],
  currentByWell: ReadonlyMap<string, Assessment | null>,
  draftByWell: ReadonlyMap<string, Assessment | null>,
  currentRevision: string,
): WellRow[] {
  return wells.map((well) => {
    const current = currentByWell.get(well.id) ?? null;
    const draft = draftByWell.get(well.id) ?? null;
    const computed = current?.computed ?? null;
    return {
      id: well.id,
      licence: well.licence,
      name: well.name,
      operator: well.operator,
      type: well.type,
      status: well.status,
      classification: well.classification,
      spudYear: well.spudYear,
      L: computed?.L ?? null,
      C: computed?.C ?? null,
      Lr: computed?.Lr ?? null,
      Cr: computed?.Cr ?? null,
      cell: computed?.cell ?? null,
      rank: computed?.rank ?? null,
      riskIndex: computed?.riskIndex ?? null,
      unknownCount: current ? PARAM_KEYS.filter((k) => current.scores[k] === null).length : null,
      state: assessmentState({ current, draft, well, currentRevision }),
      reviewerName: current?.reviewerName ?? draft?.reviewerName ?? null,
      updatedAt: latest(well.updatedAt, current?.updatedAt, draft?.updatedAt),
    };
  });
}

/* ---------- filters ---------- */

export const ASSESSMENT_FILTER_STATES = ['unscored', 'draft', 'final', 'stale'] as const;
export type AssessmentFilterState = (typeof ASSESSMENT_FILTER_STATES)[number];

/** How the Assessment filter names each state (its chip menu, and a printed report's filter line). */
export const STATE_LABELS: Record<AssessmentFilterState, string> = {
  unscored: 'Unscored',
  draft: 'Draft',
  final: 'Final',
  stale: 'Stale revision',
};

export type Filters = {
  /** One case-insensitive substring of the licence, name or operator. */
  text: string;
  rank: string[];
  status: string[];
  classification: string[];
  /**
   * 'unscored' = no current final; 'draft' = a draft exists; 'final' = a current final that is not
   * stale; 'stale' = the current final is stale. A well can be in two (a draft beside a final).
   */
  state: AssessmentFilterState[];
  reviewer: string[];
  /** One cell of the 5×5 matrix (Portfolio links here). */
  cell?: { Lr: number; Cr: number };
  /** At least this many parameters scored "unknown" in the current final (spec §4.2 "unknown ≥ n"). */
  minUnknown?: number;
};

export const EMPTY_FILTERS: Filters = { text: '', rank: [], status: [], classification: [], state: [], reviewer: [] };

const hasFinal = (r: WellRow): boolean => r.rank !== null;

const STATE_TEST: Record<AssessmentFilterState, (r: WellRow) => boolean> = {
  unscored: (r) => !hasFinal(r),
  draft: (r) => r.state.kind === 'draft',
  final: (r) => hasFinal(r) && !r.state.stale.stale,
  stale: (r) => hasFinal(r) && r.state.stale.stale,
};

/** Values within one filter are alternatives; every filter that is set must match. Keeps row order. */
export function applyFilters(rows: readonly WellRow[], f: Filters): WellRow[] {
  const text = f.text.trim().toLowerCase();
  const oneOf = (values: readonly string[], v: string | null) => values.length === 0 || (v !== null && values.includes(v));
  return rows.filter(
    (r) =>
      (text === '' || [r.licence, r.name, r.operator].some((s) => s.toLowerCase().includes(text))) &&
      oneOf(f.rank, r.rank) &&
      oneOf(f.status, r.status) &&
      oneOf(f.classification, r.classification) &&
      oneOf(f.reviewer, r.reviewerName) &&
      (f.state.length === 0 || f.state.some((s) => STATE_TEST[s](r))) &&
      (!f.cell || (r.Lr === f.cell.Lr && r.Cr === f.cell.Cr)) &&
      (f.minUnknown === undefined || (r.unknownCount !== null && r.unknownCount >= f.minUnknown)),
  );
}

export function hasActiveFilters(f: Filters): boolean {
  return (
    f.text.trim() !== '' ||
    f.rank.length + f.status.length + f.classification.length + f.state.length + f.reviewer.length > 0 ||
    f.cell !== undefined ||
    f.minUnknown !== undefined
  );
}

/* ---------- filters in the URL ---------- */

/** Matrix ratings run 1..5 on both axes. */
const RATING_MAX = 5;

const nonEmpty = (a: string[]): string[] | undefined => (a.length > 0 ? a : undefined);

/** The query keys: q, rank, status, class, state, reviewer, Lr, Cr, minUnknown (arrays as repeated keys). */
export function filtersToQuery(f: Filters): RouteQuery {
  return {
    q: f.text || undefined,
    rank: nonEmpty(f.rank),
    status: nonEmpty(f.status),
    class: nonEmpty(f.classification),
    state: nonEmpty(f.state),
    reviewer: nonEmpty(f.reviewer),
    Lr: f.cell ? String(f.cell.Lr) : undefined,
    Cr: f.cell ? String(f.cell.Cr) : undefined,
    minUnknown: f.minUnknown !== undefined ? String(f.minUnknown) : undefined,
  };
}

/** The distinct values of a repeated key that pass `valid`, in order. */
function values<T extends string>(params: URLSearchParams, key: string, valid: (v: string) => v is T): T[] {
  return [...new Set(params.getAll(key))].filter(valid);
}

const isNonEmpty = (v: string): v is string => v !== '';
const isOneOf =
  <T extends string>(allowed: readonly T[]) =>
  (v: string): v is T =>
    (allowed as readonly string[]).includes(v);

/** A whole number in min..max written plainly ("3", not "3.0" or " 3"), else undefined. */
function wholeNumber(text: string | null, min: number, max: number): number | undefined {
  if (text === null || !/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  return n >= min && n <= max ? n : undefined;
}

/** Reads filters back from a query; unknown or malformed values are ignored, repeats dropped. */
export function filtersFromQuery(params: URLSearchParams): Filters {
  const Lr = wholeNumber(params.get('Lr'), 1, RATING_MAX);
  const Cr = wholeNumber(params.get('Cr'), 1, RATING_MAX);
  const minUnknown = wholeNumber(params.get('minUnknown'), 1, PARAM_KEYS.length);
  return {
    text: params.get('q') ?? '',
    rank: values(params, 'rank', isNonEmpty),
    status: values(params, 'status', isOneOf(STATUSES)),
    classification: values(params, 'class', isOneOf(CLASSIFICATIONS)),
    state: values(params, 'state', isOneOf(ASSESSMENT_FILTER_STATES)),
    reviewer: values(params, 'reviewer', isNonEmpty),
    ...(Lr !== undefined && Cr !== undefined ? { cell: { Lr, Cr } } : {}),
    ...(minUnknown !== undefined ? { minUnknown } : {}),
  };
}

/* ---------- sorting ---------- */

export type SortKey =
  | 'licence'
  | 'name'
  | 'operator'
  | 'type'
  | 'status'
  | 'classification'
  | 'spudYear'
  | 'riskIndex'
  | 'cell'
  | 'rank'
  | 'state'
  | 'reviewer'
  | 'updatedAt';

export type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Riskiest first: Risk Index descending, unscored wells last, ties by licence. */
export const DEFAULT_SORT: Sort = { key: 'riskIndex', dir: 'desc' };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** A row's value for a sort key; null and '' (missing) always sort last. */
type SortValue = string | number | null;

const SORT_VALUE: Record<SortKey, (r: WellRow) => SortValue | [SortValue, SortValue]> = {
  licence: (r) => r.licence,
  name: (r) => r.name,
  operator: (r) => r.operator,
  type: (r) => r.type,
  status: (r) => r.status,
  classification: (r) => r.classification,
  spudYear: (r) => r.spudYear,
  riskIndex: (r) => r.riskIndex,
  cell: (r) => r.cell,
  rank: (r) => [r.cell, r.riskIndex], // severity: the band follows the cell
  state: (r) => r.state.label,
  reviewer: (r) => r.reviewerName,
  updatedAt: (r) => Date.parse(r.updatedAt),
};

const isMissing = (v: SortValue): boolean => v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));

/** Compares two present values of one key in ascending order. */
function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Sorted copy. Missing values go last in either direction; ties keep licence order (ascending). */
export function sortRows(rows: readonly WellRow[], sort: Sort): WellRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const read = SORT_VALUE[sort.key];
  const parts = (r: WellRow): SortValue[] => {
    const v = read(r);
    return Array.isArray(v) ? v : [v];
  };
  return [...rows].sort((x, y) => {
    const a = parts(x);
    const b = parts(y);
    for (let i = 0; i < a.length; i += 1) {
      const ma = isMissing(a[i]);
      const mb = isMissing(b[i]);
      if (ma !== mb) return ma ? 1 : -1;
      if (!ma) {
        const c = compareValues(a[i], b[i]);
        if (c !== 0) return sign * c;
      }
    }
    return collator.compare(x.licence, y.licence);
  });
}

/** Keys whose first click sorts high to low: the risk numbers and the most recent date. */
const DESC_FIRST: ReadonlySet<SortKey> = new Set<SortKey>(['riskIndex', 'cell', 'rank', 'updatedAt']);

/** The sort after clicking `key`'s header: the same column flips, a new one starts in its natural direction. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: DESC_FIRST.has(key) ? 'desc' : 'asc' };
}

/* ---------- the well record form ---------- */

/** The fields of a well's record that the record form edits (no construction, no legacy block). */
export const WELL_RECORD_FIELDS = [
  'licence',
  'name',
  'operator',
  'lat',
  'lon',
  'spudYear',
  'type',
  'trajectory',
  'status',
  'classification',
  'td_m',
  'notes',
] as const;

export type WellRecordFields = Pick<WellInput, (typeof WELL_RECORD_FIELDS)[number]>;

/**
 * Only the record fields of a parsed form. WellInputSchema fills `construction` with its default
 * (null); passing that to wells.update would wipe the well's construction, so it is never passed.
 */
export function wellRecordFields(input: WellInput): WellRecordFields {
  return Object.fromEntries(WELL_RECORD_FIELDS.map((k) => [k, input[k]])) as WellRecordFields;
}
