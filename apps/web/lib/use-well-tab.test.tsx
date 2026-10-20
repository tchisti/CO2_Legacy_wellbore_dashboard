import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWellTab } from '@/lib/use-well-tab';

/**
 * A router whose URL lags: router.replace only queues the href, and the test decides when each
 * one lands (as a slow transition would), or changes the URL itself (a link elsewhere on the page).
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

/** Lands the oldest queued replace in the URL. */
function landNext() {
  const href = nav.pending.shift();
  if (href === undefined) throw new Error('nothing to land');
  act(() => nav.setQuery(href.split('?')[1] ?? ''));
}

beforeEach(() => {
  nav.pending.length = 0;
  nav.replace.mockClear();
  nav.setQuery('id=wel_1');
});
afterEach(cleanup);

describe('useWellTab', () => {
  it('starts from the URL (assessment when there is no tab) and writes nothing back', () => {
    const { result } = renderHook(() => useWellTab('wel_1'));
    expect(result.current[0]).toBe('assessment');
    cleanup();
    nav.setQuery('id=wel_1&tab=history');
    const again = renderHook(() => useWellTab('wel_1'));
    expect(again.result.current[0]).toBe('history');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('switches at once and writes the tab to the URL, keeping score=1', () => {
    nav.setQuery('id=wel_1&score=1');
    const { result } = renderHook(() => useWellTab('wel_1'));
    act(() => result.current[1]('history'));
    expect(result.current[0]).toBe('history');
    expect(nav.replace).toHaveBeenCalledWith('/wells/view?id=wel_1&score=1&tab=history', { scroll: false });
    landNext();
    expect(result.current[0]).toBe('history');
    act(() => result.current[1]('assessment'));
    expect(nav.replace).toHaveBeenLastCalledWith('/wells/view?id=wel_1&score=1', { scroll: false });
  });

  it('a late URL write never undoes a newer choice', () => {
    const { result } = renderHook(() => useWellTab('wel_1'));
    act(() => result.current[1]('history'));
    act(() => result.current[1]('construction'));
    landNext(); // history lands after construction was chosen
    expect(result.current[0]).toBe('construction');
    landNext();
    expect(result.current[0]).toBe('construction');
  });

  it('follows a URL change it did not write', () => {
    const { result } = renderHook(() => useWellTab('wel_1'));
    act(() => nav.setQuery('id=wel_1&tab=history'));
    expect(result.current[0]).toBe('history');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('choosing the tab already shown writes nothing', () => {
    const { result } = renderHook(() => useWellTab('wel_1'));
    act(() => result.current[1]('assessment'));
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
