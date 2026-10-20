// Derived assessment state of a well (spec §5.1). Computed on read, never stored.
import { isStale, type Assessment, type RevisionDelta, type Well } from '@lwa/engine';

export type AssessmentStateKind = 'unscored' | 'draft' | 'final';

export type AssessmentState = {
  /** 'draft' whenever the well has a draft, else 'final' when it has a current final, else 'unscored'. */
  kind: AssessmentStateKind;
  /** Of the current final against the current revision; not stale when there is no final. */
  stale: { stale: boolean; delta: RevisionDelta };
  /** The record was edited after the current final was assessed. */
  recordChanged: boolean;
  label: string;
};

const NOT_STALE = { stale: false, delta: 'none' } as const;

export function assessmentState(args: {
  current: Assessment | null;
  draft: Assessment | null;
  well: Well;
  currentRevision: string;
}): AssessmentState {
  const { current, draft, well, currentRevision } = args;
  const stale = current ? isStale(current.methodologyRevision, currentRevision) : { ...NOT_STALE };
  // Instants, not strings: stored timestamps may differ in fractional-second precision.
  const recordChanged =
    current !== null && current.assessedAt !== null && Date.parse(well.updatedAt) > Date.parse(current.assessedAt);

  if (draft) return { kind: 'draft', stale, recordChanged, label: `Draft by ${draft.reviewerName}` };
  if (current) return { kind: 'final', stale, recordChanged, label: stale.stale ? 'Stale revision' : 'Final' };
  return { kind: 'unscored', stale, recordChanged, label: 'Unscored' };
}
