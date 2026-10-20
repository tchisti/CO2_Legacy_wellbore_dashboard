import { asList } from './list';
import type { WellboreInput } from './types';

export type WellboreStats = {
  td: number | null;
  casingCount: number;
  plugCount: number;
  deepestPlug: number | null;
  shallowestPlug: number | null;
  longestPlug: number | null;
  pluggedTotal: number | null;
  coveragePct: number | null;
  openHoleLen: number | null;
  perfCount: number;
  formationCount: number;
};

type Interval = { top_m: number; bottom_m: number };

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.slice().sort((a, b) => a.top_m - b.top_m);
  const merged: Interval[] = [];
  let last: Interval | undefined;
  for (const cur of sorted) {
    if (last && cur.top_m <= last.bottom_m) {
      last.bottom_m = Math.max(last.bottom_m, cur.bottom_m);
    } else {
      last = { top_m: cur.top_m, bottom_m: cur.bottom_m };
      merged.push(last);
    }
  }
  return merged;
}

/** Aggregate statistics for the stats card. Counts are list lengths, as v2. */
export function wellboreStats(wb: WellboreInput | null | undefined): WellboreStats {
  const w: WellboreInput = wb || {};
  const td = typeof w.td === 'number' ? w.td : null;
  const casings = asList(w.casings);
  const plugs = asList(w.plugs);
  const perforations = asList(w.perforations);
  const formations = asList(w.formations);

  const casingCount = casings.length;
  const plugCount = plugs.length;
  const perfCount = perforations.length;
  const formationCount = formations.length;

  // v2 threw on a null plug entry here; null entries are skipped instead.
  const validPlugs: Interval[] = [];
  for (const p of plugs) {
    if (p && typeof p.top_m === 'number' && typeof p.bottom_m === 'number') validPlugs.push({ top_m: p.top_m, bottom_m: p.bottom_m });
  }
  const deepestPlug = validPlugs.length ? Math.max(...validPlugs.map((p) => p.bottom_m)) : null;
  const shallowestPlug = validPlugs.length ? Math.min(...validPlugs.map((p) => p.top_m)) : null;
  const longestPlug = validPlugs.length ? Math.max(...validPlugs.map((p) => p.bottom_m - p.top_m)) : null;

  // merged is empty iff validPlugs is empty, so null means "no plugs".
  const merged = mergeIntervals(validPlugs);
  const pluggedTotal = merged.length ? +merged.reduce((sum, iv) => sum + (iv.bottom_m - iv.top_m), 0).toFixed(1) : null;

  const coveragePct = td && td > 0 && pluggedTotal !== null ? +((pluggedTotal / td) * 100).toFixed(1) : null;

  let openHoleLen: number | null = null;
  const oh = w.openHole;
  if (oh && typeof oh.top_m === 'number' && typeof oh.bottom_m === 'number') {
    openHoleLen = +(oh.bottom_m - oh.top_m).toFixed(1);
  }

  return {
    td,
    casingCount,
    plugCount,
    deepestPlug,
    shallowestPlug,
    longestPlug,
    pluggedTotal,
    coveragePct,
    openHoleLen,
    perfCount,
    formationCount,
  };
}
