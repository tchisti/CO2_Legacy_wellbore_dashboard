// Derived score suggestions. These are hints for the assessor, never saved scores: a later UI
// task renders each as a chip "Suggested <score> · <basis>" and prefills the justification with
// "Suggested: <basis>", so the basis strings below are part of the contract.
import { nearestInjector, type Injector } from './geo';
import type { ParamKey, Score } from './types';

export type Suggestion = { score: Score; source: 'derived'; basis: string };
export type Suggestions = Partial<Record<ParamKey, Suggestion>>;

export type SuggestInput = {
  classification?: string | null;
  spudYear?: number | null;
  trajectory?: string | null;
  casingCount?: number | null;
  lat?: number | null;
  lon?: number | null;
  injectors?: readonly Injector[];
};

/** Within this distance of an injector the well sits in the plume / pressure-front corridor. */
const PLUME_CORRIDOR_M = 1600;

const derived = (score: Score, basis: string): Suggestion => ({ score, source: 'derived', basis });

const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function penetration(classification: string | null | undefined): Suggestion | undefined {
  if (typeof classification !== 'string' || !/^Type [1-9]$/.test(classification)) return undefined;
  const n = Number(classification.slice('Type '.length));
  const score: Score = n <= 3 ? 5 : n <= 7 ? 3 : 1;
  return derived(score, `from ${classification}`);
}

function age(spudYear: number | null | undefined): Suggestion | undefined {
  if (!isInteger(spudYear)) return undefined;
  const score: Score = spudYear >= 1995 ? 1 : spudYear >= 1965 ? 3 : 5;
  return derived(score, `from spud year ${spudYear}`);
}

function complexity(trajectory: string | null | undefined): Suggestion | undefined {
  if (trajectory === 'Vertical') return derived(1, 'from trajectory Vertical');
  if (trajectory === 'Deviated' || trajectory === 'Horizontal') return derived(3, `from trajectory ${trajectory}`);
  return undefined;
}

function barriers(casingCount: number | null | undefined): Suggestion | undefined {
  if (!isInteger(casingCount) || casingCount < 0) return undefined;
  const score: Score = casingCount >= 2 ? 1 : casingCount === 1 ? 3 : 5;
  return derived(score, `from ${casingCount} casing ${casingCount === 1 ? 'string' : 'strings'}`);
}

function plume(input: SuggestInput): Suggestion | undefined {
  const nearest = nearestInjector(input);
  if (nearest === null) return undefined;
  const km = (nearest.distance_m / 1000).toFixed(1);
  // In the corridor the distance alone gives 5, whichever side of an AoR the well is on, so the
  // basis names the corridor rule (not "outside the AoR" beside a 5).
  if (nearest.distance_m < PLUME_CORRIDOR_M) {
    return derived(5, `within ${PLUME_CORRIDOR_M / 1000} km of ${nearest.name}, ${km} km away`);
  }
  const score: Score = nearest.insideAoR ? 3 : 1;
  return derived(score, `from ${km} km to ${nearest.name}, ${nearest.insideAoR ? 'inside' : 'outside'} the AoR`);
}

export function suggest(input: SuggestInput): Suggestions {
  const out: Suggestions = {};
  const found: [ParamKey, Suggestion | undefined][] = [
    ['penetration', penetration(input.classification)],
    ['age', age(input.spudYear)],
    ['complexity', complexity(input.trajectory)],
    ['barriers', barriers(input.casingCount)],
    ['plume', plume(input)],
  ];
  for (const [key, s] of found) if (s) out[key] = s;
  return out;
}
