import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METHODOLOGY,
  computeWell,
  emptyScores,
  recommend,
  recommendationText,
  type Assessment,
  type AuditEvent,
  type Methodology,
  type MethodologyRecord,
  type Scores,
} from '@lwa/engine';
import {
  actionText,
  attribution,
  axisSubtotals,
  diffSummary,
  isReconfirmation,
  methodologyForRevision,
  priorFinals,
  revisionNote,
  scoreRows,
  wellHistory,
} from '@/lib/assessment-view';

/* ---------- fixtures ---------- */

const M = DEFAULT_METHODOLOGY;

/** 100/07-21-055-22W4/00 in the Fort Saskatchewan fixture: L 1.76, C 2.6, cell 6, Moderate. */
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

function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'asm_1',
    wellId: 'wel_1',
    methodologyRevision: '2.0.0',
    scores: emptyScores(),
    justifications: {},
    suggestions: {},
    computed: null,
    recommendedAction: { auto: '', override: null },
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

function record(revision: string, m: Methodology = M): MethodologyRecord {
  return {
    revision,
    methodology: { ...m, revision },
    note: '',
    publishedAt: '2026-08-07T00:00:00.000Z',
    publishedBy: 'Tahir Chisti',
  };
}

let eventSeq = 0;
function event(overrides: Partial<AuditEvent>): AuditEvent {
  eventSeq += 1;
  return {
    id: `aud_${eventSeq}`,
    at: '2026-08-07T16:16:21.843Z',
    actorName: 'Tahir Chisti',
    projectId: 'prj_1',
    entity: 'well',
    entityId: 'wel_1',
    action: 'update',
    diff: { before: null, after: null },
    ...overrides,
  };
}

/* ---------- scoreRows ---------- */

describe('scoreRows', () => {
  it('scoreRows: Unknown row shows anchor "Unknown — scores as 5" and contribution weight×unknownScore', () => {
    const rows = scoreRows(assessment({ scores: { ...FT_SASK_SCORES, plugQuality: null } }), M);
    const plug = rows.find((r) => r.key === 'plugQuality');
    expect(plug).toMatchObject({ score: null, anchor: 'Unknown — scores as 5', weight: 0.22 });
    expect(plug?.contribution).toBeCloseTo(0.22 * 5, 10);
  });

  it('scoreRows: L rows come first, then C; subtotals equal computed.L and computed.C within 0.005', () => {
    const computed = computeWell(FT_SASK_SCORES, M);
    const rows = scoreRows(assessment({ scores: FT_SASK_SCORES }), M);
    expect(rows.map((r) => r.axis)).toEqual(['L', 'L', 'L', 'L', 'L', 'L', 'L', 'C', 'C', 'C', 'C']);
    expect(rows.map((r) => r.key)).toEqual([
      'plugQuality',
      'cement',
      'barriers',
      'scvf',
      'age',
      'complexity',
      'data',
      'penetration',
      'plume',
      'usdw',
      'access',
    ]);
    const { L, C } = axisSubtotals(rows);
    expect(Math.abs(L - computed.L)).toBeLessThan(0.005);
    expect(Math.abs(C - computed.C)).toBeLessThan(0.005);
    expect(computed.L).toBe(1.76);
    expect(computed.C).toBe(2.6);
  });

  it('a scored row carries the anchor for its score, its justification, and weight × score', () => {
    const rows = scoreRows(
      assessment({ scores: FT_SASK_SCORES, justifications: { penetration: 'Reaches the Nisku (Type 3).' } }),
      M,
    );
    const penetration = rows.find((r) => r.key === 'penetration');
    expect(penetration).toMatchObject({
      name: 'Penetration vs Storage Complex',
      axis: 'C',
      weight: 0.3,
      score: 4,
      anchor: 'Judgment call between the 3 and 5 anchors',
      justification: 'Reaches the Nisku (Type 3).',
    });
    expect(penetration?.contribution).toBeCloseTo(1.2, 10);
    expect(rows.find((r) => r.key === 'plugQuality')?.anchor).toBe(M.params[0]?.anchors['1']);
  });

  it('a missing or blank justification is the empty string', () => {
    const rows = scoreRows(assessment({ scores: FT_SASK_SCORES, justifications: { cement: '   ' } }), M);
    expect(rows.find((r) => r.key === 'cement')?.justification).toBe('');
    expect(rows.find((r) => r.key === 'age')?.justification).toBe('');
  });

  it('follows the order of the methodology it is given', () => {
    const reordered: Methodology = { ...M, params: [...M.params].reverse() };
    const rows = scoreRows(assessment({ scores: FT_SASK_SCORES }), reordered);
    expect(rows.slice(0, 7).every((r) => r.axis === 'L')).toBe(true);
    expect(rows[0]?.key).toBe('data');
    expect(rows[7]?.key).toBe('access');
  });
});

/* ---------- methodologyForRevision ---------- */

describe('methodologyForRevision', () => {
  const current: Methodology = { ...M, revision: '2.1.0' };
  const records = [record('2.0.0'), record('2.1.0')];

  it('uses the record of the assessment revision when the project has it', () => {
    const shown = methodologyForRevision(records, '2.0.0', current);
    expect(shown.exact).toBe(true);
    expect(shown.methodology.revision).toBe('2.0.0');
  });

  it('falls back to the current methodology when the revision has no record (e.g. 1.0.0)', () => {
    const shown = methodologyForRevision(records, '1.0.0', current);
    expect(shown.exact).toBe(false);
    expect(shown.methodology).toBe(current);
  });

  it('falls back when there are no records at all', () => {
    expect(methodologyForRevision([], '2.0.0', current)).toEqual({ methodology: current, exact: false });
  });
});

/* ---------- attribution ---------- */

describe('attribution', () => {
  it('reads "assessed under <rev> by <reviewer> on <date>"', () => {
    expect(attribution(assessment())).toBe('assessed under 2.0.0 by Tahir Chisti on 2026-08-07');
  });
});

/* ---------- revisionNote ---------- */

describe('revisionNote', () => {
  it('reads "assessed under <a> (current <c>, wording only)" for a patch bump', () => {
    expect(revisionNote('2.0.0', '2.0.1', 'patch')).toBe('assessed under 2.0.0 (current 2.0.1, wording only)');
  });

  it('is null when the revision is current, or moved by minor or major (that is stale, not a note)', () => {
    expect(revisionNote('2.0.0', '2.0.0', 'none')).toBeNull();
    expect(revisionNote('2.0.0', '2.1.0', 'minor')).toBeNull();
    expect(revisionNote('1.0.0', '2.0.0', 'major')).toBeNull();
  });
});

/* ---------- actionText ---------- */

describe('actionText', () => {
  it('takes the first line as the title and the rest as paragraphs', () => {
    const text = recommendationText(recommend(FT_SASK_SCORES, M));
    const parsed = actionText(text);
    expect(parsed.title).toBe('Targeted Diagnostics + Watchlist');
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({ kind: 'paragraph' });
  });

  it('groups consecutive "- " lines into one list, between paragraphs', () => {
    const parsed = actionText('Re-entry\nTier High.\n- First\n- Second\nWarning text\n- Third');
    expect(parsed).toEqual({
      title: 'Re-entry',
      blocks: [
        { kind: 'paragraph', text: 'Tier High.' },
        { kind: 'list', items: ['First', 'Second'] },
        { kind: 'paragraph', text: 'Warning text' },
        { kind: 'list', items: ['Third'] },
      ],
    });
  });

  it('skips blank lines and trims; empty text has an empty title', () => {
    expect(actionText('\n  Title  \n\n  Body  \n')).toEqual({
      title: 'Title',
      blocks: [{ kind: 'paragraph', text: 'Body' }],
    });
    expect(actionText('')).toEqual({ title: '', blocks: [] });
  });
});

/* ---------- priorFinals ---------- */

describe('priorFinals', () => {
  it('lists the earlier finals, newest first, without the current one or drafts', () => {
    const current = assessment({ id: 'asm_c', assessedAt: '2026-09-01T00:00:00.000Z' });
    const older = assessment({ id: 'asm_o', assessedAt: '2026-07-01T00:00:00.000Z' });
    const middle = assessment({ id: 'asm_m', assessedAt: '2026-08-01T00:00:00.000Z' });
    const draft = assessment({ id: 'asm_d', status: 'draft', assessedAt: null });
    expect(priorFinals([older, draft, current, middle], 'asm_c').map((a) => a.id)).toEqual(['asm_m', 'asm_o']);
    expect(priorFinals([draft], null)).toEqual([]);
  });
});

/* ---------- diffSummary ---------- */

describe('diffSummary', () => {
  const well = { name: 'A', operator: 'Imperial', notes: '', spudYear: 1953, updatedAt: 'x', updatedBy: 'y' };

  it('a record with nothing before is the initial record; nothing after is removed', () => {
    expect(diffSummary(null, well)).toBe('initial record');
    expect(diffSummary(well, null)).toBe('removed');
  });

  it('names the changed top-level fields, leaving out the update stamps', () => {
    const after = { ...well, operator: 'Redwater', notes: 'n', updatedAt: 'z', updatedBy: 'w' };
    expect(diffSummary(well, after)).toBe('operator, notes');
  });

  it('uses readable names for coded fields and compares nested values', () => {
    expect(diffSummary({ spudYear: 1953, td_m: 1, scores: { a: 1 } }, { spudYear: 1954, td_m: 1, scores: { a: 2 } })).toBe(
      'spud year, scores',
    );
    expect(diffSummary({ a: 1 }, { a: 1, lat: 53.1 })).toBe('latitude');
  });

  it('says so when nothing but the stamps changed, and copes with non-objects', () => {
    expect(diffSummary(well, { ...well, updatedAt: 'later' })).toBe('no field changes');
    expect(diffSummary({ mode: 'merge' }, 3)).toBe('changed');
    expect(diffSummary(null, null)).toBe('');
  });
});

/* ---------- wellHistory ---------- */

describe('wellHistory', () => {
  const wellBefore = { id: 'wel_1', operator: 'Imperial Oil Limited', updatedAt: 'a' };
  const wellAfter = { id: 'wel_1', operator: 'Redwater Holdings Ltd.', updatedAt: 'b' };
  const draft = { id: 'asm_gone', wellId: 'wel_1', status: 'draft' };

  const imported = event({ at: '2026-08-07T16:16:21.843Z', actorName: 'v2 migration', action: 'import', diff: { before: null, after: wellBefore } });
  const updated = event({ at: '2026-10-20T10:00:00.000Z', action: 'update', diff: { before: wellBefore, after: wellAfter } });
  const finalised = event({
    at: '2026-10-20T09:00:00.000Z',
    entity: 'assessment',
    entityId: 'asm_1',
    action: 'finalise',
    diff: { before: { id: 'asm_1', wellId: 'wel_1', status: 'draft' }, after: { id: 'asm_1', wellId: 'wel_1', status: 'final' } },
  });
  const discarded = event({
    at: '2026-10-20T11:00:00.000Z',
    entity: 'assessment',
    entityId: 'asm_gone',
    action: 'delete',
    diff: { before: draft, after: null },
  });
  const otherWell = event({ entityId: 'wel_2', diff: { before: null, after: { id: 'wel_2' } }, action: 'create' });
  const otherAssessment = event({
    entity: 'assessment',
    entityId: 'asm_9',
    action: 'create',
    diff: { before: null, after: { id: 'asm_9', wellId: 'wel_2' } },
  });
  const projectImport = event({ entity: 'project', entityId: 'prj_1', action: 'import', diff: { before: null, after: { mode: 'merge' } } });

  const events = [imported, otherWell, finalised, projectImport, updated, otherAssessment, discarded];

  it("keeps the well's own events and its assessments' (including a discarded draft), newest first", () => {
    const entries = wellHistory(events, 'wel_1', [assessment({ id: 'asm_1' })]);
    expect(entries.map((e) => e.id)).toEqual([discarded.id, updated.id, finalised.id, imported.id]);
  });

  it('labels the action and entity, and summarises the change', () => {
    const entries = wellHistory(events, 'wel_1', [assessment({ id: 'asm_1' })]);
    expect(entries.map(({ action, entity, actor, summary }) => ({ action, entity, actor, summary }))).toEqual([
      { action: 'Deleted draft', entity: 'Assessment', actor: 'Tahir Chisti', summary: 'removed' },
      { action: 'Updated', entity: 'Well', actor: 'Tahir Chisti', summary: 'operator' },
      { action: 'Finalised', entity: 'Assessment', actor: 'Tahir Chisti', summary: 'status' },
      { action: 'Imported', entity: 'Well', actor: 'v2 migration', summary: 'initial record' },
    ]);
  });

  it('labels creates and exports, and shows a blank actor as a dash', () => {
    const created = event({ action: 'create', actorName: '', diff: { before: null, after: wellBefore } });
    const exported = event({ action: 'export', diff: { before: null, after: { wells: 1 } } });
    const entries = wellHistory([created, exported], 'wel_1', []);
    expect(entries.map((e) => [e.action, e.actor])).toEqual([
      ['Created', '—'],
      ['Exported', 'Tahir Chisti'],
    ]);
  });
});

/* ---------- re-confirmation ---------- */

describe('isReconfirmation', () => {
  const previous = assessment({
    id: 'asm_prev',
    scores: FT_SASK_SCORES,
    justifications: { plugQuality: 'Seven plugs, tagged', cement: 'CBL 1998' },
    recommendedAction: { auto: 'Targeted Diagnostics + Watchlist', override: 'Re-enter' },
  });
  const same = assessment({
    id: 'asm_next',
    supersedesId: 'asm_prev',
    scores: { ...FT_SASK_SCORES },
    justifications: { cement: 'CBL 1998', plugQuality: 'Seven plugs, tagged' },
    recommendedAction: { auto: 'something else', override: 'Re-enter' },
    methodologyRevision: '2.1.0',
  });

  it('is true when the scores, justifications and override equal those of the final it supersedes', () => {
    expect(isReconfirmation(same, previous)).toBe(true);
    // Blank and missing justifications are the same; so are surrounding spaces and a blank override.
    expect(
      isReconfirmation(
        { ...same, justifications: { ...same.justifications, age: '  ' }, recommendedAction: { auto: '', override: ' Re-enter ' } },
        previous,
      ),
    ).toBe(true);
  });

  it('is false when any score, justification or the override differs, or there is no previous final', () => {
    expect(isReconfirmation({ ...same, scores: { ...FT_SASK_SCORES, scvf: null } }, previous)).toBe(false);
    expect(isReconfirmation({ ...same, justifications: { ...same.justifications, cement: 'CBL 2001' } }, previous)).toBe(false);
    expect(isReconfirmation({ ...same, justifications: { ...same.justifications, age: 'Spud 1953' } }, previous)).toBe(false);
    expect(isReconfirmation({ ...same, recommendedAction: { auto: '', override: null } }, previous)).toBe(false);
    expect(isReconfirmation(same, null)).toBe(false);
  });
});

describe('wellHistory: re-confirmation', () => {
  const first = assessment({ id: 'asm_a', scores: FT_SASK_SCORES, justifications: { plugQuality: 'Tagged' } });
  const second = assessment({
    id: 'asm_b',
    supersedesId: 'asm_a',
    scores: { ...FT_SASK_SCORES },
    justifications: { plugQuality: 'Tagged' },
    assessedAt: '2026-10-20T10:00:00.000Z',
  });
  const third = assessment({
    id: 'asm_c',
    supersedesId: 'asm_b',
    scores: { ...FT_SASK_SCORES, age: 5 },
    justifications: { plugQuality: 'Tagged', age: 'Spud 1953' },
    assessedAt: '2026-10-20T11:00:00.000Z',
  });
  const finalise = (id: string, at: string) =>
    event({ at, entity: 'assessment', entityId: id, action: 'finalise', diff: { before: { id, wellId: 'wel_1' }, after: { id, wellId: 'wel_1' } } });

  it('labels a finalise that changed nothing "Re-confirmed", and one that changed something "Finalised"', () => {
    const events = [
      finalise('asm_a', '2026-08-07T16:16:21.843Z'),
      finalise('asm_b', '2026-10-20T10:00:00.000Z'),
      finalise('asm_c', '2026-10-20T11:00:00.000Z'),
    ];
    const entries = wellHistory(events, 'wel_1', [third, second, first]);
    expect(entries.map((e) => e.action)).toEqual(['Finalised', 'Re-confirmed', 'Finalised']);
  });
});
