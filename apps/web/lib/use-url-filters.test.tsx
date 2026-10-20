import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEXT_DEBOUNCE_MS, useUrlFilters } from '@/lib/use-url-filters';
import { EMPTY_FILTERS, type Filters } from '@/lib/wells-view';

/**
 * A router whose URL lags: router.replace only queues the href, and the test decides when each
 * one lands (as a slow transition would), or changes the URL itself (a link, the Wells tab).
 */
const nav = vi.hoisted(() => {
  let query = '';
  const listeners = new Set<() => void>();
  const pending: string[] = [];
  const replace = vi.fn((href: string) => {
    pending.push(href);
  });
  return {
    pending,
    replace,
    router: { replace, push: vi.fn() },
    query: () => query,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    setQuery: (q: string) => {
      query = q;
      listeners.forEach((l) => l());
    },
  };
});

vi.mock('next/navigation', async () => {
  const { useMemo, useSyncExternalStore } = await import('react');
  return {
    useRouter: () => nav.router,
    useSearchParams: () => {
      const q = useSyncExternalStore(nav.subscribe, nav.query);
      return useMemo(() => new URLSearchParams(q), [q]);
    },
  };
});

const filters = (f: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...f });

/** Lands the oldest queued replace in the URL. */
function landNext() {
  const href = nav.pending.shift();
  if (href === undefined) throw new Error('nothing to land');
  act(() => nav.setQuery(href.split('?')[1] ?? ''));
}

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  nav.pending.length = 0;
  nav.replace.mockClear();
  nav.setQuery('');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useUrlFilters', () => {
  it('starts from the URL and writes nothing back', () => {
    nav.setQuery('rank=Low&q=Sinopec&Lr=2&Cr=3');
    const { result } = renderHook(() => useUrlFilters());
    expect(result.current.filters).toEqual(filters({ rank: ['Low'], text: 'Sinopec', cell: { Lr: 2, Cr: 3 } }));
    tick(1000);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('writes a chip change at once and typing after a pause, last text only', () => {
    const { result } = renderHook(() => useUrlFilters());
    act(() => result.current.setFilters(filters({ status: ['Active'] })));
    tick(0);
    expect(nav.replace).toHaveBeenLastCalledWith('/wells?status=Active', { scroll: false });
    landNext();

    act(() => result.current.setText('S'));
    act(() => result.current.setText('Si'));
    expect(result.current.filters.text).toBe('Si'); // filters as you type
    tick(TEXT_DEBOUNCE_MS - 1);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    tick(1);
    expect(nav.replace).toHaveBeenCalledTimes(2);
    expect(nav.replace).toHaveBeenLastCalledWith('/wells?q=Si&status=Active', { scroll: false });
  });

  it('keeps a chip picked while the URL still lags, then the text typed after it', () => {
    const { result } = renderHook(() => useUrlFilters());
    act(() => result.current.setFilters(filters({ rank: ['Low'] })));
    tick(0); // '/wells?rank=Low' written, not landed yet
    act(() => result.current.setText('Redwater'));
    tick(TEXT_DEBOUNCE_MS);
    expect(nav.pending).toEqual(['/wells?rank=Low', '/wells?q=Redwater&rank=Low']);

    landNext(); // the older write lands late: it must not undo the text
    expect(result.current.filters).toEqual(filters({ rank: ['Low'], text: 'Redwater' }));
    landNext();
    expect(result.current.filters).toEqual(filters({ rank: ['Low'], text: 'Redwater' }));
    tick(1000);
    expect(nav.replace).toHaveBeenCalledTimes(2);
  });

  it('a chip picked while typing is written at once, with the text', () => {
    const { result } = renderHook(() => useUrlFilters());
    act(() => result.current.setText('Red'));
    act(() => result.current.setFilters({ ...result.current.filters, state: ['stale'] }));
    tick(0);
    expect(nav.pending).toEqual(['/wells?q=Red&state=stale']);
    tick(1000);
    expect(nav.pending).toHaveLength(1);
  });

  it('follows a URL change it did not write, and clear() empties the URL', () => {
    nav.setQuery('rank=Low');
    const { result } = renderHook(() => useUrlFilters());
    act(() => nav.setQuery('state=stale')); // e.g. a Portfolio link
    expect(result.current.filters).toEqual(filters({ state: ['stale'] }));
    act(() => nav.setQuery('')); // the Wells tab
    expect(result.current.filters).toEqual(EMPTY_FILTERS);
    tick(1000);
    expect(nav.replace).not.toHaveBeenCalled();

    act(() => result.current.setFilters(filters({ reviewer: ['T. Chisti'] })));
    tick(0);
    landNext();
    act(() => result.current.clear());
    tick(0);
    expect(nav.replace).toHaveBeenLastCalledWith('/wells', { scroll: false });
  });
});
