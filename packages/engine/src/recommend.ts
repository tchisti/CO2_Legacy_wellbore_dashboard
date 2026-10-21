// Recommended action (§ 8), ported from v2 index.html recommend(). The wording is v2's, as plain
// text: the <b> lead-in tags are dropped and every other character is kept verbatim.
import { computeWell, resolveScore, type Methodology } from './scoring';
import type { BandClass, ParamKey, Scores } from './types';

export type Tier = BandClass;

export type Recommendation = {
  tier: Tier;
  title: string;
  summary: string;
  /** Names of the params whose resolved score is 4 or more, in methodology order. */
  drivers: string[];
  actions: string[];
  warn: string | null;
};

/** A param counts as a driver, and as a trigger for an action, at this resolved score or above. */
const DRIVER_MIN = 4;

type ActionRule = { text: string; when: (isDriver: (key: ParamKey) => boolean) => boolean };

// v2 order. The first and fourth actions fire on either of two params; the rest on one.
const ACTIONS: readonly ActionRule[] = [
  {
    text: 'Pressure-test surface casing vent + annular buildup (§ 8.1); if leak confirmed → squeeze cement or full re-abandonment (§ 8.2).',
    when: (d) => d('plugQuality') || d('barriers'),
  },
  {
    text: 'Run CBL/VDL or ultrasonic imaging across caprock interval; top-up annular cement via perforate-and-squeeze if TOC is below caprock.',
    when: (d) => d('cement'),
  },
  {
    text: 'Active/unrepaired SCVF-GM: bubble test + vent-flow measurement per AER ID 2003-01; repair before injection start-up.',
    when: (d) => d('scvf'),
  },
  {
    text: 'Stage dedicated monitoring well + soil-gas + satellite CO₂ surveillance — well is inside high-consequence corridor.',
    when: (d) => d('plume') || d('penetration'),
  },
  {
    text: 'Confirm BGWP/USDW isolation: surface-casing records + cement returns; if open pathway confirmed, prioritize corrective action per 40 CFR 146.84(d).',
    when: (d) => d('usdw'),
  },
  {
    text: 'Engage Orphan Well Association / regulator (§ 9–10); if inaccessible, default to long-term flux + satellite monitoring (§ 8.3).',
    when: (d) => d('access'),
  },
  {
    text: 'Treat all pre-1976 tubulars as analog to API 5L pre-NACE; assume corrosion-prone carbon steel and de-rate barrier credit.',
    when: (d) => d('age'),
  },
  {
    text: 'Flag as "Undocumented / Unverified abandonment" (§ 6.6) and carry conservative analog assumptions until logged.',
    when: (d) => d('data'),
  },
];

const HIGH_WARN =
  'Per CSA Z741 § 9 / EPA Class VI 40 CFR 146.84(d), high-risk wells inside AoR require corrective action plan before injection authorization.';

/**
 * The tier of a band's class. Exhaustive over the four classes BandSchema allows; any other value
 * means the methodology was never validated, so it throws rather than fall back to Low (v2 did).
 */
function tierOf(cls: BandClass): Tier {
  switch (cls) {
    case 'low':
    case 'mod':
    case 'high':
    case 'crit':
      return cls;
    default: {
      const unknown: never = cls;
      throw new Error(`Unknown band class ${JSON.stringify(unknown)}: validate the methodology first`);
    }
  }
}

export function recommend(scores: Scores, m: Methodology): Recommendation {
  const rank = computeWell(scores, m).rank;
  const tier = tierOf(rank.cls);

  const resolved = new Map<ParamKey, number>(m.params.map((p) => [p.key, resolveScore(p, scores[p.key])]));
  const isDriver = (key: ParamKey): boolean => (resolved.get(key) ?? 0) >= DRIVER_MIN;
  const drivers = m.params.filter((p) => isDriver(p.key)).map((p) => p.name);

  if (tier === 'crit' || tier === 'high') {
    return {
      tier,
      title: 'Re-entry + Mitigation Required',
      summary: `Tier ${rank.label} — re-entry diagnostics + mitigation candidate. Key drivers: ${drivers.join(', ') || 'none flagged'}.`,
      drivers,
      actions: ACTIONS.filter((a) => a.when(isDriver)).map((a) => a.text),
      warn: HIGH_WARN,
    };
  }
  if (tier === 'mod') {
    return {
      tier,
      title: 'Targeted Diagnostics + Watchlist',
      summary: `Moderate Tier. Add to MMV watchlist (§ 8.3). Recommended diagnostics: SCVF pressure test, annular surveillance, CBL across caprock if cement data is partial. Re-score on every MMV re-evaluation (3-year AER / 5-year EPA cadence). Drivers worth closing: ${drivers.join(', ') || 'data gaps only'}.`,
      drivers,
      actions: [],
      warn: null,
    };
  }
  return {
    tier,
    title: 'No Further Action — Monitor at MMV Cycle',
    summary:
      'Low Tier. Well is adequately documented and unlikely to act as a migration pathway. Carry through as background population; re-evaluate on AoR refresh or if plume forecast shifts.',
    drivers,
    actions: [],
    warn: null,
  };
}

/** Plain-text rendering used to prefill the reviewer-override field and to detect "saved unchanged". */
export function recommendationText(r: Recommendation): string {
  return [r.title, r.summary, ...r.actions.map((a) => `- ${a}`), ...(r.warn ? [r.warn] : [])].join('\n');
}
