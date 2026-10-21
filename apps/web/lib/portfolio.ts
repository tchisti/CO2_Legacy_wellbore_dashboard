// The Portfolio as data (spec §4.1): what state the area of review is in and what needs attention.
// Counts by rank and by derived state (§5.1), the 5×5 matrix of current finals, which parameters
// carry the risk, and the wells to look at next. Pure: the page loads the register and renders this.
import { paramsOf, resolveScore, type Assessment, type Methodology, type ParamKey } from '@lwa/engine';
import { wellsHref } from '@/lib/routes';
import { DEFAULT_SORT, EMPTY_FILTERS, filtersToQuery, sortRows, type Filters, type WellRow } from '@/lib/wells-view';

/** A current final with at least this many parameters scored Unknown is "unknown-heavy". */
export const UNKNOWN_HEAVY_MIN = 4;

/** How many wells the Needs attention list shows; `attentionTotal` says how many there are. */
export const ATTENTION_MAX = 8;

/** The matrix is 5 × 5: likelihood rating 1..5 by consequence rating 1..5. */
export const MATRIX_SIZE = 5;

/** Why a well needs attention, in priority order: a well is listed once, under the first that applies. */
export const ATTENTION_KINDS = ['stale', 'recordChanged', 'unknownHeavy', 'draft', 'unscored'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export type AttentionItem = { wellId: string; licence: string; name: string; kind: AttentionKind; reason: string };

export type Driver = { key: ParamKey; name: string; avgContribution: number };

export type PortfolioStats = {
  /** Every well of the project. */
  total: number;
  /** Wells with a current final. */
  finals: number;
  /** Current finals by band label: every band of the methodology, in its order, zeros included. */
  byRank: Record<string, number>;
  /** These follow the Wells register's filters exactly, so each count is the length of its filtered view. */
  unscored: number;
  draft: number;
  stale: number;
  unknownHeavy: number;
  /**
   * Current finals whose record was edited after they were assessed. Not a KPI (spec §5.1: an info
   * badge on the Well page); such wells are listed under Needs attention.
   */
  recordChanged: number;
  /** Current finals per cell: `matrix[Lr - 1][Cr - 1]`. Drafts and unscored wells are not in it. */
  matrix: number[][];
  /** Each parameter's average weighted contribution over current finals, largest first; [] with no finals. */
  drivers: Driver[];
  /** At most ATTENTION_MAX wells, by reason priority, then riskiest first, then licence. */
  attention: AttentionItem[];
  attentionTotal: number;
};

const hasFinal = (r: WellRow): boolean => r.rank !== null;
const isRating = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= MATRIX_SIZE;

/** Rounded to 1e-9, so sums that differ only by floating-point noise (0.1 × 3 and 0.3 × 1) compare equal. */
const clean = (n: number): number => Math.round(n * 1e9) / 1e9;

/**
 * Mean over `finals` of weight × resolved score, per parameter of the current methodology (an
 * Unknown counts at the parameter's unknownScore, as the engine scores it). Sorted largest first;
 * equal contributions keep methodology order (the sort is stable).
 */
function driversOf(finals: readonly Assessment[], m: Methodology): Driver[] {
  if (finals.length === 0) return [];
  return paramsOf(m)
    .map((p) => {
      const sum = finals.reduce((a, f) => a + p.weight * resolveScore(p, f.scores[p.key]), 0);
      return { key: p.key, name: p.name, avgContribution: clean(sum / finals.length) };
    })
    .sort((a, b) => b.avgContribution - a.avgContribution);
}

/** The reason a row needs attention for `kind`, or null when that kind does not apply to it. */
function reasonFor(kind: AttentionKind, r: WellRow, finalOf: ReadonlyMap<string, Assessment>): string | null {
  switch (kind) {
    case 'stale':
      return hasFinal(r) && r.state.stale.stale
        ? `Assessed under ${finalOf.get(r.id)?.methodologyRevision ?? 'an earlier revision'}`
        : null;
    case 'recordChanged':
      return hasFinal(r) && r.state.recordChanged ? 'Record changed since assessment' : null;
    case 'unknownHeavy':
      return r.unknownCount !== null && r.unknownCount >= UNKNOWN_HEAVY_MIN ? `${r.unknownCount} parameters Unknown` : null;
    case 'draft':
      return r.state.kind === 'draft' ? r.state.label : null; // "Draft by <name>"
    case 'unscored':
      return hasFinal(r) ? null : 'Not yet assessed';
  }
}

/**
 * `rows` are the register (lib/wells-view.ts buildRows); `finals` the wells' current final
 * assessments (any final of a well outside `rows` is ignored); `m` the current methodology.
 */
export function portfolioStats(rows: readonly WellRow[], finals: readonly Assessment[], m: Methodology): PortfolioStats {
  const ids = new Set(rows.map((r) => r.id));
  const current = finals.filter((f) => f.status === 'final' && ids.has(f.wellId));
  const finalOf = new Map(current.map((f) => [f.wellId, f]));

  const byRank: Record<string, number> = Object.fromEntries(m.matrix.bands.map((b) => [b.label, 0]));
  const matrix = Array.from({ length: MATRIX_SIZE }, () => Array<number>(MATRIX_SIZE).fill(0));
  for (const r of rows) {
    if (r.rank === null) continue;
    byRank[r.rank] = (byRank[r.rank] ?? 0) + 1;
    if (isRating(r.Lr) && isRating(r.Cr)) matrix[r.Lr - 1][r.Cr - 1] += 1;
  }

  const count = (test: (r: WellRow) => boolean): number => rows.filter(test).length;

  const listed = new Set<string>();
  const needing: AttentionItem[] = [];
  const riskiestFirst = sortRows(rows, DEFAULT_SORT);
  for (const kind of ATTENTION_KINDS) {
    for (const r of riskiestFirst) {
      if (listed.has(r.id)) continue;
      const reason = reasonFor(kind, r, finalOf);
      if (reason === null) continue;
      listed.add(r.id);
      needing.push({ wellId: r.id, licence: r.licence, name: r.name, kind, reason });
    }
  }

  return {
    total: rows.length,
    finals: count(hasFinal),
    byRank,
    unscored: count((r) => !hasFinal(r)),
    draft: count((r) => r.state.kind === 'draft'),
    stale: count((r) => hasFinal(r) && r.state.stale.stale),
    unknownHeavy: count((r) => r.unknownCount !== null && r.unknownCount >= UNKNOWN_HEAVY_MIN),
    recordChanged: count((r) => hasFinal(r) && r.state.recordChanged),
    matrix,
    drivers: driversOf(current, m),
    attention: needing.slice(0, ATTENTION_MAX),
    attentionTotal: needing.length,
  };
}

/** The Wells register with only `patch` set as its filters (Portfolio tiles and matrix cells link here). */
export function wellsFilterHref(patch: Partial<Filters>): string {
  return wellsHref(filtersToQuery({ ...EMPTY_FILTERS, ...patch }));
}
