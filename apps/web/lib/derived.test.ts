import { describe, expect, it } from 'vitest';
import { emptyScores, type Assessment, type Well } from '@lwa/engine';
import { assessmentState } from '@/lib/derived';

const WELL: Well = {
  id: 'wel_1',
  projectId: 'prj_1',
  licence: '100/13-06-055-22W4/00',
  name: 'Wabamun 1',
  operator: '',
  lat: null,
  lon: null,
  spudYear: null,
  type: 'Unknown',
  trajectory: 'Unknown',
  status: 'Unknown',
  classification: 'Type 1',
  td_m: null,
  notes: '',
  construction: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'T. Chisti',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'T. Chisti',
};

function assessment(overrides: Partial<Assessment>): Assessment {
  return {
    id: 'asm_1',
    wellId: WELL.id,
    methodologyRevision: '2.0.0',
    scores: emptyScores(),
    justifications: {},
    suggestions: {},
    computed: null,
    recommendedAction: { auto: '', override: null },
    status: 'draft',
    reviewerName: 'T. Chisti',
    assessedAt: null,
    supersedesId: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const FINAL = assessment({
  id: 'asm_final',
  status: 'final',
  computed: { L: 3, C: 3, Lr: 3, Cr: 3, cell: 9, riskIndex: 9, rank: 'Moderate' },
  assessedAt: '2026-01-02T00:00:00.000Z',
});

describe('assessmentState', () => {
  it('no assessments → unscored', () => {
    expect(assessmentState({ current: null, draft: null, well: WELL, currentRevision: '2.0.0' })).toEqual({
      kind: 'unscored',
      stale: { stale: false, delta: 'none' },
      recordChanged: false,
      label: 'Unscored',
    });
  });

  it('draft only → draft, label "Draft by T. Chisti"', () => {
    const state = assessmentState({ current: null, draft: assessment({}), well: WELL, currentRevision: '2.0.0' });
    expect(state).toEqual({
      kind: 'draft',
      stale: { stale: false, delta: 'none' },
      recordChanged: false,
      label: 'Draft by T. Chisti',
    });
  });

  it('final under 2.0.0 with current 2.0.0 → final, label "Final"', () => {
    const state = assessmentState({ current: FINAL, draft: null, well: WELL, currentRevision: '2.0.0' });
    expect(state).toEqual({ kind: 'final', stale: { stale: false, delta: 'none' }, recordChanged: false, label: 'Final' });
  });

  it('final under 2.0.0 with current 2.0.1 → stale false, delta patch', () => {
    const state = assessmentState({ current: FINAL, draft: null, well: WELL, currentRevision: '2.0.1' });
    expect(state.kind).toBe('final');
    expect(state.stale).toEqual({ stale: false, delta: 'patch' });
    expect(state.label).toBe('Final');
  });

  it('final under 2.0.0 with current 2.1.0 → stale true, label "Stale revision"', () => {
    const state = assessmentState({ current: FINAL, draft: null, well: WELL, currentRevision: '2.1.0' });
    expect(state).toMatchObject({ kind: 'final', stale: { stale: true, delta: 'minor' }, label: 'Stale revision' });
    expect(assessmentState({ current: FINAL, draft: null, well: WELL, currentRevision: '3.0.0' }).stale).toEqual({
      stale: true,
      delta: 'major',
    });
  });

  it('a draft over a stale final → draft label, staleness still reported from the final', () => {
    const draft = assessment({ id: 'asm_draft', reviewerName: 'A. Reviewer' });
    const state = assessmentState({ current: FINAL, draft, well: WELL, currentRevision: '2.1.0' });
    expect(state).toEqual({
      kind: 'draft',
      stale: { stale: true, delta: 'minor' },
      recordChanged: false,
      label: 'Draft by A. Reviewer',
    });
  });

  it('well.updatedAt newer than assessedAt → recordChanged true', () => {
    const well = { ...WELL, updatedAt: '2026-01-03T00:00:00.000Z' };
    expect(assessmentState({ current: FINAL, draft: null, well, currentRevision: '2.0.0' }).recordChanged).toBe(true);
    // not changed: older, or the same instant
    expect(assessmentState({ current: FINAL, draft: null, well: WELL, currentRevision: '2.0.0' }).recordChanged).toBe(false);
    // no final → nothing to have changed since
    expect(assessmentState({ current: null, draft: assessment({}), well, currentRevision: '2.0.0' }).recordChanged).toBe(false);
  });

  it('recordChanged compares instants, not strings (fractional-second precision varies)', () => {
    // As strings 'Z' sorts after '.', so a string comparison would call these different.
    const final = { ...FINAL, assessedAt: '2026-01-02T00:00:00.000Z' };
    const sameInstant = { ...WELL, updatedAt: '2026-01-02T00:00:00Z' };
    expect(assessmentState({ current: final, draft: null, well: sameInstant, currentRevision: '2.0.0' }).recordChanged).toBe(
      false,
    );
    const later = { ...WELL, updatedAt: '2026-01-02T00:00:00.5Z' };
    expect(assessmentState({ current: final, draft: null, well: later, currentRevision: '2.0.0' }).recordChanged).toBe(true);
  });
});
