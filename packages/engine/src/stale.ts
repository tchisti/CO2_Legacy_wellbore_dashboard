// Methodology revision staleness. A saved assessment is stale when the rulebook moved by a minor
// or major revision since it was scored; a patch revision only changes wording, so it is not.

export type RevisionDelta = 'none' | 'patch' | 'minor' | 'major';

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Which component differs between two `major.minor.patch` revisions. The first differing
 * component decides. A string that is not semver is treated as 'major', so a bad revision reads
 * as stale rather than silently passing.
 */
export function revisionDelta(from: string, to: string): RevisionDelta {
  if (!SEMVER.test(from) || !SEMVER.test(to)) return 'major';
  const a = from.split('.').map(Number);
  const b = to.split('.').map(Number);
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'none';
}

export function isStale(
  assessmentRevision: string,
  currentRevision: string,
): { stale: boolean; delta: RevisionDelta } {
  const delta = revisionDelta(assessmentRevision, currentRevision);
  return { stale: delta === 'minor' || delta === 'major', delta };
}
