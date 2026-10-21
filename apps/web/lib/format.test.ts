import { describe, expect, it } from 'vitest';
import { fmt1, fmtCoord, fmtDate, fmtDateTime, fmtDepth, plural } from '@/lib/format';

describe('fmt1', () => {
  it('formats to one decimal', () => {
    expect(fmt1(3)).toBe('3.0');
    expect(fmt1(2.25)).toBe('2.3');
    expect(fmt1(3.14159)).toBe('3.1');
    expect(fmt1(12.96)).toBe('13.0');
    expect(fmt1(0)).toBe('0.0');
    expect(fmt1(-1.25)).toBe('-1.3');
  });

  it('never shows a negative zero', () => {
    expect(fmt1(-0)).toBe('0.0');
    expect(fmt1(-0.04)).toBe('0.0');
  });

  it('shows an em dash for a missing or non-finite value', () => {
    expect(fmt1(null)).toBe('—');
    expect(fmt1(undefined)).toBe('—');
    expect(fmt1(Number.NaN)).toBe('—');
    expect(fmt1(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('fmtDepth', () => {
  it('shows metres at one decimal with the unit', () => {
    expect(fmtDepth(1447.2, 'm')).toBe('1447.2 m');
    expect(fmtDepth(800, 'm')).toBe('800.0 m');
  });

  it('converts metres to feet for the ft unit', () => {
    expect(fmtDepth(100, 'ft')).toBe('328.1 ft');
    expect(fmtDepth(0.3048, 'ft')).toBe('1.0 ft');
  });

  it('shows an em dash for a missing or non-finite depth', () => {
    expect(fmtDepth(null, 'm')).toBe('—');
    expect(fmtDepth(undefined, 'ft')).toBe('—');
    expect(fmtDepth(Number.NaN, 'm')).toBe('—');
  });
});

describe('fmtDate', () => {
  it('shows the UTC calendar date', () => {
    expect(fmtDate('2026-10-20T20:28:24.002Z')).toBe('2026-10-20');
    expect(fmtDate('2026-10-20T23:59:59.999-06:00')).toBe('2026-10-21');
    expect(fmtDate('2026-01-05')).toBe('2026-01-05');
  });

  it('shows an em dash for a missing or unreadable date', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
    expect(fmtDate('not a date')).toBe('—');
  });
});

describe('plural', () => {
  it('puts the count before the singular or plural noun', () => {
    expect(plural(1, 'well')).toBe('1 well');
    expect(plural(0, 'assessment')).toBe('0 assessments');
    expect(plural(2, 'well')).toBe('2 wells');
    expect(plural(3, 'child', 'children')).toBe('3 children');
  });
});

describe('fmtDateTime', () => {
  it('shows the UTC date and time to the minute, labelled UTC', () => {
    expect(fmtDateTime('2026-08-07T16:16:21.843Z')).toBe('2026-08-07 16:16 UTC');
    expect(fmtDateTime('2026-10-20T23:59:59.999-06:00')).toBe('2026-10-21 05:59 UTC');
    expect(fmtDateTime('2026-01-05T00:00:00Z')).toBe('2026-01-05 00:00 UTC');
  });

  it('shows an em dash for a missing or unreadable timestamp', () => {
    expect(fmtDateTime(null)).toBe('—');
    expect(fmtDateTime(undefined)).toBe('—');
    expect(fmtDateTime('')).toBe('—');
    expect(fmtDateTime('soon')).toBe('—');
  });
});

describe('fmtCoord', () => {
  it('shows decimal degrees to six places', () => {
    expect(fmtCoord(53.764946)).toBe('53.764946');
    expect(fmtCoord(-113.2)).toBe('-113.200000');
    expect(fmtCoord(0)).toBe('0.000000');
  });

  it('shows an em dash for a missing or non-finite coordinate, never "-0.000000"', () => {
    expect(fmtCoord(null)).toBe('—');
    expect(fmtCoord(undefined)).toBe('—');
    expect(fmtCoord(Number.NaN)).toBe('—');
    expect(fmtCoord(-0.0000001)).toBe('0.000000');
  });
});
