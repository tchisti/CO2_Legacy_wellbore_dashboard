import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METHODOLOGY,
  PARAM_KEYS,
  emptyScores,
  type Assessment,
  type Scores,
  type Suggestions,
} from '@lwa/engine';
import {
  carriedNote,
  initialScoreState,
  isDirty,
  liveComputed,
  missingJustifications,
  nearestInjectorLine,
  scoreReducer,
  toDraftInput,
  visibleSuggestion,
  type ScoreState,
} from '@/lib/score-flow';

const M = DEFAULT_METHODOLOGY;

/** 100/07-21-055-22W4/00 in the Fort Saskatchewan fixture. */
const FT_SASK_SCORES: Scores = {
  plugQuality: 1,
  cement: 1,
  barriers: 1,
  scvf: 2,
  age: 4,
  complexity: 4,
  data: 1,
  penetration: 4,
  plume: 3,
  usdw: 1,
  access: 2,
};

const SUGGESTIONS: Suggestions = {
  penetration: { score: 5, source: 'derived', basis: 'from Type 3' },
  age: { score: 5, source: 'derived', basis: 'from spud year 1953' },
};

function final(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'asm_1',
    wellId: 'wel_1',
    methodologyRevision: '2.0.0',
    scores: FT_SASK_SCORES,
    justifications: { plugQuality: 'Seven plugs, tagged, 1953', penetration: 'Through the Nisku' },
    suggestions: {},
    computed: { L: 1.76, C: 2.6, Lr: 2, Cr: 3, cell: 6, riskIndex: 4.58, rank: 'Moderate' },
    recommendedAction: { auto: 'Targeted Diagnostics + Watchlist', override: 'Re-enter and re-plug' },
    status: 'final',
    reviewerName: 'Tahir Chisti',
    assessedAt: '2026-08-07T16:16:21.843Z',
    supersedesId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: '2026-08-07T16:16:21.843Z',
    updatedAt: '2026-08-07T16:16:21.843Z',
    ...overrides,
  };
}

const fresh = (): ScoreState => initialScoreState(null, SUGGESTIONS, 'new');

const allScores = (score: 3): Scores => Object.fromEntries(PARAM_KEYS.map((k) => [k, score])) as Scores;

describe('initialScoreState', () => {
  it('initial state for a first assessment has all 11 scores null and no override', () => {
    const s = fresh();
    expect(Object.keys(s.scores)).toHaveLength(11);
    expect(s.scores).toEqual(emptyScores());
    expect(s.justifications).toEqual({});
    expect(s.override).toBeNull();
    expect(s.suggestions).toEqual(SUGGESTIONS);
    expect(s.carriedFrom).toBeNull();
    expect(s.touched.size).toBe(0);
  });

  it('a first assessment ignores any previous assessment passed in', () => {
    const s = initialScoreState(final(), {}, 'new');
    expect(s.scores).toEqual(emptyScores());
    expect(s.justifications).toEqual({});
    expect(s.override).toBeNull();
  });

  it('initial state from a prior final carries scores, justifications and override', () => {
    const s = initialScoreState(final(), SUGGESTIONS, 'reassess');
    expect(s.scores).toEqual(FT_SASK_SCORES);
    expect(s.justifications).toEqual({ plugQuality: 'Seven plugs, tagged, 1953', penetration: 'Through the Nisku' });
    expect(s.override).toBe('Re-enter and re-plug');
    expect(s.carriedFrom).toBe('2026-08-07T16:16:21.843Z');
    expect(s.touched.size).toBe(0);
  });

  it('continuing a draft prefills from it and marks nothing carried', () => {
    const draft = final({ status: 'draft', computed: null, assessedAt: null });
    const s = initialScoreState(draft, SUGGESTIONS, 'draft');
    expect(s.scores).toEqual(FT_SASK_SCORES);
    expect(s.override).toBe('Re-enter and re-plug');
    expect(s.carriedFrom).toBeNull();
    for (const k of PARAM_KEYS) expect(carriedNote(s, k)).toBeNull();
  });

  it('does not share the previous assessment\'s objects', () => {
    const prev = final();
    const s = initialScoreState(prev, {}, 'reassess');
    const next = scoreReducer(s, { type: 'set', key: 'plugQuality', score: 5 });
    expect(next.scores.plugQuality).toBe(5);
    expect(prev.scores.plugQuality).toBe(1);
  });
});

describe('scoreReducer', () => {
  it('set changes one score and marks the row touched', () => {
    const s = scoreReducer(fresh(), { type: 'set', key: 'cement', score: 4 });
    expect(s.scores.cement).toBe(4);
    expect(s.scores.plugQuality).toBeNull();
    expect([...s.touched]).toEqual(['cement']);
  });

  it('set to the score already chosen is no change', () => {
    const s0 = initialScoreState(final(), {}, 'reassess');
    const s = scoreReducer(s0, { type: 'set', key: 'plugQuality', score: 1 });
    expect(s).toBe(s0);
    expect(s.touched.size).toBe(0);
  });

  it('set to null is a deliberate Unknown', () => {
    const s0 = initialScoreState(final(), {}, 'reassess');
    const s = scoreReducer(s0, { type: 'set', key: 'scvf', score: null });
    expect(s.scores.scvf).toBeNull();
    expect(s.touched.has('scvf')).toBe(true);
  });

  it('justify sets the text as typed and marks the row touched', () => {
    const s = scoreReducer(fresh(), { type: 'justify', key: 'age', text: 'Spud 1953 ' });
    expect(s.justifications.age).toBe('Spud 1953 ');
    expect(s.touched.has('age')).toBe(true);
  });

  it('applySuggestion sets the score and prefills justification with "Suggested: <basis>" when justification is empty', () => {
    const suggestion = SUGGESTIONS.penetration!;
    const s = scoreReducer(fresh(), { type: 'applySuggestion', key: 'penetration', suggestion });
    expect(s.scores.penetration).toBe(5);
    expect(s.justifications.penetration).toBe('Suggested: from Type 3');
    expect(s.touched.has('penetration')).toBe(true);

    const blank = scoreReducer(fresh(), { type: 'justify', key: 'penetration', text: '   ' });
    const applied = scoreReducer(blank, { type: 'applySuggestion', key: 'penetration', suggestion });
    expect(applied.justifications.penetration).toBe('Suggested: from Type 3');
  });

  it('applySuggestion leaves a non-empty justification alone', () => {
    const s0 = initialScoreState(final(), SUGGESTIONS, 'reassess');
    const s = scoreReducer(s0, { type: 'applySuggestion', key: 'penetration', suggestion: SUGGESTIONS.penetration! });
    expect(s.scores.penetration).toBe(5);
    expect(s.justifications.penetration).toBe('Through the Nisku');
    expect(s.touched.has('penetration')).toBe(true);
  });

  it('override keeps the text as typed; null removes it', () => {
    const typed = scoreReducer(fresh(), { type: 'override', text: 'Re-enter' });
    expect(typed.override).toBe('Re-enter');
    expect(scoreReducer(typed, { type: 'override', text: null }).override).toBeNull();
  });

  it('never mutates the state it is given', () => {
    const s0 = fresh();
    const snapshot = JSON.stringify({ ...s0, touched: [...s0.touched] });
    scoreReducer(s0, { type: 'set', key: 'cement', score: 4 });
    scoreReducer(s0, { type: 'justify', key: 'cement', text: 'x' });
    scoreReducer(s0, { type: 'applySuggestion', key: 'age', suggestion: SUGGESTIONS.age! });
    scoreReducer(s0, { type: 'override', text: 'x' });
    expect(JSON.stringify({ ...s0, touched: [...s0.touched] })).toBe(snapshot);
  });
});

describe('re-assessment: carried rows', () => {
  it('a row reads "carried from <date>" until its score or justification changes', () => {
    const s0 = initialScoreState(final(), SUGGESTIONS, 'reassess');
    for (const k of PARAM_KEYS) expect(carriedNote(s0, k)).toBe('carried from 2026-08-07');

    const scored = scoreReducer(s0, { type: 'set', key: 'cement', score: 3 });
    expect(carriedNote(scored, 'cement')).toBeNull();
    expect(carriedNote(scored, 'plugQuality')).toBe('carried from 2026-08-07');

    const justified = scoreReducer(scored, { type: 'justify', key: 'scvf', text: 'Tested 2019, none' });
    expect(carriedNote(justified, 'scvf')).toBeNull();

    const suggested = scoreReducer(justified, {
      type: 'applySuggestion',
      key: 'age',
      suggestion: SUGGESTIONS.age!,
    });
    expect(carriedNote(suggested, 'age')).toBeNull();

    const overridden = scoreReducer(suggested, { type: 'override', text: 'Something else' });
    expect(carriedNote(overridden, 'plugQuality')).toBe('carried from 2026-08-07');
  });

  it('a first assessment carries nothing', () => {
    const s = fresh();
    for (const k of PARAM_KEYS) expect(carriedNote(s, k)).toBeNull();
  });
});

describe('missingJustifications', () => {
  it('missingJustifications lists keys with a score and empty justification; Unknown never counts', () => {
    let s = fresh();
    expect(missingJustifications(s)).toEqual([]);
    s = scoreReducer(s, { type: 'set', key: 'usdw', score: 2 });
    s = scoreReducer(s, { type: 'set', key: 'plugQuality', score: 1 });
    s = scoreReducer(s, { type: 'set', key: 'cement', score: 3 });
    s = scoreReducer(s, { type: 'justify', key: 'cement', text: 'CBL 1998' });
    s = scoreReducer(s, { type: 'justify', key: 'plugQuality', text: '  \n ' });
    s = scoreReducer(s, { type: 'justify', key: 'age', text: '' }); // Unknown, empty: never missing
    expect(missingJustifications(s)).toEqual(['plugQuality', 'usdw']); // methodology (PARAM_KEYS) order
  });

  it('a migrated final with no justifications needs one for every scored row', () => {
    const s = initialScoreState(final({ justifications: {} }), {}, 'reassess');
    expect(missingJustifications(s)).toEqual([...PARAM_KEYS]);
  });
});

describe('liveComputed', () => {
  it('liveComputed on all-3 gives cell 9 Moderate', () => {
    let s = fresh();
    for (const k of PARAM_KEYS) s = scoreReducer(s, { type: 'set', key: k, score: 3 });
    expect(s.scores).toEqual(allScores(3));
    const c = liveComputed(s, M);
    expect(c.L).toBe(3);
    expect(c.C).toBe(3);
    expect(c.cell).toBe(9);
    expect(c.rank.label).toBe('Moderate');
  });

  it('all Unknown scores at each parameter\'s unknown score', () => {
    const c = liveComputed(fresh(), M);
    expect(c.L).toBeCloseTo(4.24, 2);
    expect(c.C).toBeCloseTo(3.6, 2);
  });
});

describe('isDirty', () => {
  it('is false as opened, and for every mode', () => {
    expect(isDirty(fresh())).toBe(false);
    expect(isDirty(initialScoreState(final(), SUGGESTIONS, 'reassess'))).toBe(false);
    expect(isDirty(initialScoreState(final({ status: 'draft' }), SUGGESTIONS, 'draft'))).toBe(false);
  });

  it('is true after a score, justification or override change, and false again once reverted', () => {
    const s0 = fresh();
    const scored = scoreReducer(s0, { type: 'set', key: 'cement', score: 2 });
    expect(isDirty(scored)).toBe(true);
    expect(isDirty(scoreReducer(scored, { type: 'set', key: 'cement', score: null }))).toBe(false);

    const justified = scoreReducer(s0, { type: 'justify', key: 'cement', text: 'x' });
    expect(isDirty(justified)).toBe(true);
    expect(isDirty(scoreReducer(justified, { type: 'justify', key: 'cement', text: '' }))).toBe(false);

    expect(isDirty(scoreReducer(s0, { type: 'override', text: 'Re-enter' }))).toBe(true);
  });

  it('a blank override is the same as no override', () => {
    expect(isDirty(scoreReducer(fresh(), { type: 'override', text: '   ' }))).toBe(false);
    const withOverride = initialScoreState(final(), {}, 'reassess');
    expect(isDirty(scoreReducer(withOverride, { type: 'override', text: '  Re-enter and re-plug ' }))).toBe(false);
    expect(isDirty(scoreReducer(withOverride, { type: 'override', text: '' }))).toBe(true);
  });

  it('is false after "saved" with what was saved, and true again for a later edit', () => {
    const edited = scoreReducer(fresh(), { type: 'set', key: 'cement', score: 2 });
    const saved = scoreReducer(edited, { type: 'saved', input: toDraftInput(edited) });
    expect(isDirty(saved)).toBe(false);
    expect(saved.touched.has('cement')).toBe(true);
    expect(isDirty(scoreReducer(saved, { type: 'set', key: 'cement', score: 3 }))).toBe(true);

    // An edit made while the save was in flight stays unsaved.
    const later = scoreReducer(edited, { type: 'justify', key: 'cement', text: 'typed during the save' });
    expect(isDirty(scoreReducer(later, { type: 'saved', input: toDraftInput(edited) }))).toBe(true);
  });
});

describe('toDraftInput', () => {
  it('keeps every score, drops blank justifications, trims the override and carries the suggestions', () => {
    let s = fresh();
    s = scoreReducer(s, { type: 'set', key: 'cement', score: 2 });
    s = scoreReducer(s, { type: 'justify', key: 'cement', text: ' CBL 1998 ' });
    s = scoreReducer(s, { type: 'justify', key: 'age', text: '   ' });
    s = scoreReducer(s, { type: 'override', text: '  Re-enter  ' });
    const input = toDraftInput(s);
    expect(input.scores).toEqual({ ...emptyScores(), cement: 2 });
    expect(input.justifications).toEqual({ cement: ' CBL 1998 ' });
    expect(input.override).toBe('Re-enter');
    expect(input.suggestions).toEqual(SUGGESTIONS);

    expect(toDraftInput(scoreReducer(s, { type: 'override', text: ' ' })).override).toBeNull();
  });
});

describe('visibleSuggestion', () => {
  it('is shown only while it differs from the chosen score, Unknown included', () => {
    const s0 = fresh();
    expect(visibleSuggestion(s0, 'penetration')).toEqual(SUGGESTIONS.penetration);
    const chosen = scoreReducer(s0, { type: 'set', key: 'penetration', score: 5 });
    expect(visibleSuggestion(chosen, 'penetration')).toBeNull();
    const other = scoreReducer(chosen, { type: 'set', key: 'penetration', score: 4 });
    expect(visibleSuggestion(other, 'penetration')).toEqual(SUGGESTIONS.penetration);
    expect(visibleSuggestion(s0, 'plugQuality')).toBeNull(); // no suggestion for this parameter
  });
});

describe('nearestInjectorLine', () => {
  it('names the nearest injector, the distance in km to one decimal and the AoR side', () => {
    expect(nearestInjectorLine({ name: 'Oak (proposed)', distance_m: 2919.52, insideAoR: true })).toBe(
      'Nearest injector: Oak (proposed) · 2.9 km (inside the AoR)',
    );
    expect(nearestInjectorLine({ name: 'Pine (proposed)', distance_m: 5111.2, insideAoR: false })).toBe(
      'Nearest injector: Pine (proposed) · 5.1 km (outside the AoR)',
    );
  });

  it('is a dash when the well has no coordinates or the project no injectors', () => {
    expect(nearestInjectorLine(null)).toBe('Nearest injector: —');
  });
});
