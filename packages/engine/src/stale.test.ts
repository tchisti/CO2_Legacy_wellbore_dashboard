import { describe, expect, it } from 'vitest';
import { isStale, revisionDelta } from './stale';

describe('revisionDelta', () => {
  it.each([
    ['2.0.0', '2.0.0', 'none'],
    ['2.0.0', '2.0.1', 'patch'],
    ['2.0.0', '2.1.0', 'minor'],
    ['1.0.0', '2.0.0', 'major'],
  ] as const)('revisionDelta(%s,%s)=%s', (from, to, want) => {
    expect(revisionDelta(from, to)).toBe(want);
  });

  it.each([
    ['2.0.9', '2.1.0', 'minor'],
    ['1.9.9', '2.0.0', 'major'],
    ['2.0.0', '3.1.1', 'major'],
    ['2.9.0', '2.10.0', 'minor'],
    ['2.1.0', '2.0.0', 'minor'],
    ['3.0.0', '2.0.0', 'major'],
    ['2.0.1', '2.0.0', 'patch'],
  ] as const)('first differing component decides: revisionDelta(%s,%s)=%s', (from, to, want) => {
    expect(revisionDelta(from, to)).toBe(want);
  });

  it.each([
    ['2.0', '2.0.0'],
    ['2.0.0', 'v2.0.0'],
    ['', '2.0.0'],
    ['2.0.0', '2.0.0-beta'],
    ['2.0.0', '2.0.0.1'],
    ['2.0.x', '2.0.0'],
  ])('invalid revision string revisionDelta(%j,%j) is conservatively major', (from, to) => {
    expect(revisionDelta(from, to)).toBe('major');
  });
});

describe('isStale', () => {
  it('patch → false, minor → true, major → true', () => {
    expect(isStale('2.0.0', '2.0.1')).toEqual({ stale: false, delta: 'patch' });
    expect(isStale('2.0.0', '2.1.0')).toEqual({ stale: true, delta: 'minor' });
    expect(isStale('1.0.0', '2.0.0')).toEqual({ stale: true, delta: 'major' });
  });

  it('identical revisions are not stale', () => {
    expect(isStale('2.0.0', '2.0.0')).toEqual({ stale: false, delta: 'none' });
  });

  it('an invalid revision string is stale (major)', () => {
    expect(isStale('not-a-revision', '2.0.0')).toEqual({ stale: true, delta: 'major' });
    expect(isStale('2.0.0', '2.0')).toEqual({ stale: true, delta: 'major' });
  });
});
