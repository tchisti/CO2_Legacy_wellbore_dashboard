import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOG_PREFIX, reportError, useReportError } from '@/lib/log';

afterEach(() => vi.restoreAllMocks());

function spyConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('reportError', () => {
  it('logs an Error under the stable prefix with its message, stack and the context', () => {
    const spy = spyConsole();
    const error = new TypeError('Cannot read the well');
    reportError(error, { where: 'well-page', action: 'load' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [line, detail] = spy.mock.calls[0]!;
    expect(line).toBe(`${LOG_PREFIX} TypeError: Cannot read the well`);
    expect(detail).toEqual({ where: 'well-page', action: 'load', stack: error.stack });
  });

  it('keeps a Next.js error digest', () => {
    const spy = spyConsole();
    reportError(Object.assign(new Error('Server error'), { digest: 'abc123' }), { where: 'boundary' });
    expect(spy.mock.calls[0]![1]).toMatchObject({ where: 'boundary', digest: 'abc123' });
  });

  it('logs a thrown string or number as text', () => {
    const spy = spyConsole();
    reportError('quota exceeded', { where: 'x' });
    reportError(42, { where: 'x' });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([`${LOG_PREFIX} NonError: quota exceeded`, `${LOG_PREFIX} NonError: 42`]);
  });

  it('never logs a thrown object itself: a well or an assessment payload stays out of the log', () => {
    const spy = spyConsole();
    const well = { id: 'wel_1', licence: '100/13-06-055-22W4/00', operator: 'Private Owner', notes: 'site contact 555-0100' };
    reportError(well, { where: 'listener' });
    reportError(null, { where: 'listener' });
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain('555-0100');
    expect(logged).not.toContain('100/13-06-055-22W4/00');
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      `${LOG_PREFIX} NonError: a thrown object (not logged)`,
      `${LOG_PREFIX} NonError: a thrown null (not logged)`,
    ]);
  });

  it('never throws, even when the console does', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is gone');
    });
    expect(() => reportError(new Error('x'), { where: 'y' })).not.toThrow();
  });
});

describe('useReportError', () => {
  it('reports each distinct error once, and nothing for null', () => {
    const spy = spyConsole();
    const first = new Error('first');
    const { rerender } = renderHook(({ error }: { error: Error | null }) => useReportError(error, 'shell'), {
      initialProps: { error: null as Error | null },
    });
    expect(spy).not.toHaveBeenCalled();
    rerender({ error: first });
    rerender({ error: first });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([`${LOG_PREFIX} Error: first`, { where: 'shell', stack: first.stack }]);
    rerender({ error: new Error('second') });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
