// The score flow as data (spec §4.4, §5.1): what the reviewer has entered so far, and the rules
// over it. Pure: the sheet (components/score/ScoreSheet.tsx) loads the records, owns the reducer
// and saves through the store.
//
// - No default score: a first assessment starts with every parameter Unknown (null).
// - Re-assessment starts from the current final, and each row reads "carried from <date>" until
//   the reviewer changes that row's score or justification.
// - Suggestions are shown, never applied by themselves: only applySuggestion (a reviewer's click)
//   turns one into a score.
// - Finalise needs a justification for every parameter that has a score; Unknown never does.
import {
  PARAM_KEYS,
  computeWell,
  emptyScores,
  type Assessment,
  type Computed,
  type Methodology,
  type NearestInjector,
  type ParamKey,
  type Score,
  type Scores,
  type Suggestion,
  type Suggestions,
} from '@lwa/engine';
import { MISSING, fmtDate } from '@/lib/format';
import type { DraftInput } from '@/lib/store/store';

/** Where the sheet's first values come from: nothing (`new`), the well's draft, or its current final. */
export type ScoreMode = 'new' | 'draft' | 'reassess';

export type Justifications = Assessment['justifications'];

/** The values a save writes and that dirtiness is measured against. */
type Entered = { scores: Scores; justifications: Justifications; override: string | null };

export type ScoreState = {
  scores: Scores;
  /** As typed (not trimmed); a key may be missing or blank. */
  justifications: Justifications;
  /** As typed; null when the reviewer has not opened an override. Blank counts as no override. */
  override: string | null;
  /** Computed when the sheet opened; shown beside the scores, never applied without a click. */
  suggestions: Suggestions;
  /** assessedAt of the final a re-assessment started from; null when nothing is carried. */
  carriedFrom: string | null;
  /** Rows whose score or justification the reviewer has changed since the sheet opened. */
  touched: ReadonlySet<ParamKey>;
  /** What the store holds for this flow (as opened, or as last saved). */
  baseline: Entered;
};

export type ScoreAction =
  | { type: 'set'; key: ParamKey; score: Score | null }
  | { type: 'justify'; key: ParamKey; text: string }
  | { type: 'applySuggestion'; key: ParamKey; suggestion: Suggestion }
  | { type: 'override'; text: string | null }
  /** A save of `input` succeeded: that is now what the store holds. */
  | { type: 'saved'; input: DraftInput };

/** The prefix a suggestion writes into an empty justification: "Suggested: from Type 3". */
export const SUGGESTED_PREFIX = 'Suggested: ';

const blank = (text: string | null | undefined): boolean => !text?.trim();

/** An override as the store keeps it: trimmed, and blank means none. */
const normalOverride = (text: string | null): string | null => text?.trim() || null;

/**
 * The flow's opening state. `new` starts every parameter Unknown with nothing written, whatever
 * `prev` is; `draft` and `reassess` copy the scores, justifications and override of `prev` (the
 * draft or the current final), and `reassess` marks every row carried from the final's date.
 */
export function initialScoreState(prev: Assessment | null, suggestions: Suggestions, mode: ScoreMode): ScoreState {
  const from = mode === 'new' ? null : prev;
  const entered: Entered = {
    scores: from ? { ...emptyScores(), ...from.scores } : emptyScores(),
    justifications: from ? { ...from.justifications } : {},
    override: from?.recommendedAction.override ?? null,
  };
  return {
    ...entered,
    suggestions: { ...suggestions },
    carriedFrom: mode === 'reassess' && from ? from.assessedAt : null,
    touched: new Set(),
    baseline: entered,
  };
}

function touch(touched: ReadonlySet<ParamKey>, key: ParamKey): ReadonlySet<ParamKey> {
  return touched.has(key) ? touched : new Set([...touched, key]);
}

export function scoreReducer(state: ScoreState, action: ScoreAction): ScoreState {
  switch (action.type) {
    case 'set': {
      if (state.scores[action.key] === action.score) return state;
      return {
        ...state,
        scores: { ...state.scores, [action.key]: action.score },
        touched: touch(state.touched, action.key),
      };
    }
    case 'justify': {
      if ((state.justifications[action.key] ?? '') === action.text) return state;
      return {
        ...state,
        justifications: { ...state.justifications, [action.key]: action.text },
        touched: touch(state.touched, action.key),
      };
    }
    case 'applySuggestion': {
      const { key, suggestion } = action;
      const justifications = blank(state.justifications[key])
        ? { ...state.justifications, [key]: `${SUGGESTED_PREFIX}${suggestion.basis}` }
        : state.justifications;
      return {
        ...state,
        scores: { ...state.scores, [key]: suggestion.score },
        justifications,
        touched: touch(state.touched, key),
      };
    }
    case 'override':
      return state.override === action.text ? state : { ...state, override: action.text };
    case 'saved': {
      const { scores, justifications, override } = action.input;
      return { ...state, baseline: { scores: { ...scores }, justifications: { ...justifications }, override } };
    }
  }
}

/** "carried from 2026-08-07" while a re-assessed row is as the final had it; null otherwise. */
export function carriedNote(state: ScoreState, key: ParamKey): string | null {
  if (state.carriedFrom === null || state.touched.has(key)) return null;
  return `carried from ${fmtDate(state.carriedFrom)}`;
}

/** The suggestion for `key` while it differs from the chosen score (Unknown included); null otherwise. */
export function visibleSuggestion(state: Pick<ScoreState, 'scores' | 'suggestions'>, key: ParamKey): Suggestion | null {
  const s = state.suggestions[key];
  return s && s.score !== state.scores[key] ? s : null;
}

/** "Nearest injector: Oak (proposed) · 2.9 km (inside the AoR)", or "Nearest injector: —" when there is none to measure. */
export function nearestInjectorLine(nearest: NearestInjector | null): string {
  if (!nearest) return `Nearest injector: ${MISSING}`;
  const km = (nearest.distance_m / 1000).toFixed(1);
  return `Nearest injector: ${nearest.name} · ${km} km (${nearest.insideAoR ? 'inside' : 'outside'} the AoR)`;
}

/** Parameters with a score but no justification, in methodology (PARAM_KEYS) order. Unknown never counts. */
export function missingJustifications(state: Pick<ScoreState, 'scores' | 'justifications'>): ParamKey[] {
  return PARAM_KEYS.filter((k) => state.scores[k] !== null && blank(state.justifications[k]));
}

/** L, C, cell and rank of the scores as they stand, under `m` (the current methodology). */
export function liveComputed(state: Pick<ScoreState, 'scores'>, m: Methodology): Computed {
  return computeWell(state.scores, m);
}

/** What saveDraft is given: every score, the non-blank justifications as typed, the override trimmed (blank → null). */
export function toDraftInput(state: ScoreState): DraftInput {
  const justifications: Justifications = {};
  for (const k of PARAM_KEYS) {
    const text = state.justifications[k];
    if (text !== undefined && !blank(text)) justifications[k] = text;
  }
  return {
    scores: { ...state.scores },
    justifications,
    override: normalOverride(state.override),
    suggestions: { ...state.suggestions },
  };
}

/** Whether anything entered differs from what the store holds (blank justifications and overrides count as none). */
export function isDirty(state: ScoreState): boolean {
  const now = toDraftInput(state);
  const was = state.baseline;
  const text = (j: Justifications, k: ParamKey): string => (blank(j[k]) ? '' : (j[k] ?? ''));
  return (
    PARAM_KEYS.some((k) => now.scores[k] !== was.scores[k]) ||
    PARAM_KEYS.some((k) => text(now.justifications, k) !== text(was.justifications, k)) ||
    now.override !== normalOverride(was.override)
  );
}
