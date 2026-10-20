import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useProfile, useStore, useStoreQuery, type StoreFactory } from '@/lib/store/provider';
import { createLocalStore } from '@/lib/store/local-store';
import type { Store } from '@/lib/store/store';

afterEach(cleanup);

let dbCount = 0;
/** A store factory on a database no other test uses. */
function freshFactory(): StoreFactory {
  dbCount += 1;
  const dbName = `lwa-provider-test-${dbCount}`;
  return (actor) => createLocalStore({ dbName, actor });
}

function wrapperFor(createStore: StoreFactory) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StoreProvider createStore={createStore} fallback={<p>Starting</p>}>
        {children}
      </StoreProvider>
    );
  };
}

/** A promise with its resolve/reject handles, for queries the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('StoreProvider', () => {
  it('shows the fallback until the store is open, then the children', async () => {
    render(
      <StoreProvider createStore={freshFactory()} fallback={<p>Starting</p>}>
        <p>Ready</p>
      </StoreProvider>,
    );
    expect(screen.getByText('Starting')).toBeTruthy();
    expect(await screen.findByText('Ready')).toBeTruthy();
    expect(screen.queryByText('Starting')).toBeNull();
  });

  it('creates exactly one store, even under StrictMode', async () => {
    const make = freshFactory();
    const factory = vi.fn<StoreFactory>((actor) => make(actor));
    render(
      <StrictMode>
        <StoreProvider createStore={factory}>
          <p>Ready</p>
        </StoreProvider>
      </StrictMode>,
    );
    await screen.findByText('Ready');
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('shows the error view when the store cannot be opened', async () => {
    const broken: StoreFactory = (actor) => {
      const store = createLocalStore({ dbName: 'unused', actor });
      return { ...store, profile: { ...store.profile, get: () => Promise.reject(new Error('IndexedDB is blocked')) } };
    };
    render(
      <StoreProvider createStore={broken} renderError={(e) => <p>Failed: {e.message}</p>}>
        <p>Ready</p>
      </StoreProvider>,
    );
    expect(await screen.findByText('Failed: IndexedDB is blocked')).toBeTruthy();
    expect(screen.queryByText('Ready')).toBeNull();
  });
});

describe('useStore', () => {
  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useStore())).toThrow('useStore must be used inside <StoreProvider>');
    vi.restoreAllMocks();
  });

  it('returns the same store on every render', async () => {
    const { result, rerender } = renderHook(() => useStore(), { wrapper: wrapperFor(freshFactory()) });
    await waitFor(() => expect(result.current).toBeTruthy());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useStoreQuery', () => {
  it('loads, then re-runs after every store change', async () => {
    const { result } = renderHook(() => ({ store: useStore(), q: useStoreQuery((s) => s.projects.list(), []) }), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.q.loading).toBe(false));
    expect(result.current.q).toEqual({ data: [], loading: false, error: null });

    await act(() => result.current.store.projects.create({ name: 'North AOR' }));
    await waitFor(() => expect(result.current.q.data?.map((p) => p.name)).toEqual(['North AOR']));
  });

  it('reports a failed query as an error instead of swallowing it', async () => {
    const { result } = renderHook(() => useStoreQuery(() => Promise.reject(new Error('read failed')), []), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.error?.message).toBe('read failed'));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('reports a query that throws before returning a promise', async () => {
    const { result } = renderHook(
      () =>
        useStoreQuery((): Promise<number> => {
          throw new Error('bad query');
        }, []),
      { wrapper: wrapperFor(freshFactory()) },
    );
    await waitFor(() => expect(result.current.error?.message).toBe('bad query'));
  });

  it('wraps a non-Error rejection in an Error', async () => {
    const { result } = renderHook(() => useStoreQuery(() => Promise.reject('plain string'), []), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toBe('plain string');
  });

  it('ignores a result that arrives after the deps changed', async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const answers: Record<string, Promise<string>> = { a: slow.promise, b: fast.promise };
    const { result, rerender } = renderHook(({ key }) => useStoreQuery(() => answers[key], [key]), {
      wrapper: wrapperFor(freshFactory()),
      initialProps: { key: 'a' },
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    rerender({ key: 'b' });
    await act(async () => fast.resolve('from b'));
    await act(async () => slow.resolve('from a'));
    expect(result.current.data).toBe('from b');
  });

  it('shows loading again, with no stale data, when the deps change', async () => {
    const pending = deferred<string>();
    const { result, rerender } = renderHook(
      ({ key }) => useStoreQuery(() => (key === 'a' ? Promise.resolve('from a') : pending.promise), [key]),
      { wrapper: wrapperFor(freshFactory()), initialProps: { key: 'a' } },
    );
    await waitFor(() => expect(result.current.data).toBe('from a'));
    rerender({ key: 'b' });
    expect(result.current).toEqual({ data: undefined, loading: true, error: null });
  });

  it('stops listening for store changes after unmount', async () => {
    const query = vi.fn((s: Store) => s.projects.list());
    const { result, unmount } = renderHook(() => ({ store: useStore(), q: useStoreQuery(query, []) }), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.q.loading).toBe(false));
    const { store } = result.current;
    const calls = query.mock.calls.length;
    unmount();
    await store.projects.create({ name: 'After unmount' });
    expect(query.mock.calls.length).toBe(calls);
  });
});

describe('useProfile', () => {
  it('starts with the stored profile (null when none) and stamps writes with "Unknown" until one is set', async () => {
    const { result } = renderHook(() => ({ store: useStore(), ...useProfile() }), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.store).toBeTruthy());
    expect(result.current.profile).toBeNull();
    const p = await result.current.store.projects.create({ name: 'Anonymous' });
    expect(p.createdBy).toBe('Unknown');
  });

  it('setProfile saves the profile and stamps later writes with the name', async () => {
    const { result } = renderHook(() => ({ store: useStore(), ...useProfile() }), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.store).toBeTruthy());
    await act(() => result.current.setProfile({ name: '  T. Chisti ', initials: 'TC' }));
    expect(result.current.profile).toEqual({ name: 'T. Chisti', initials: 'TC' });
    expect(await result.current.store.profile.get()).toEqual({ name: 'T. Chisti', initials: 'TC' });
    const p = await result.current.store.projects.create({ name: 'Signed' });
    expect(p.createdBy).toBe('T. Chisti');
  });

  it('reads a profile already in the database at start', async () => {
    const factory = freshFactory();
    await factory(() => 'setup').profile.set({ name: 'R. Reviewer', initials: 'RR' });
    const { result } = renderHook(() => ({ store: useStore(), ...useProfile() }), { wrapper: wrapperFor(factory) });
    await waitFor(() => expect(result.current.profile).toEqual({ name: 'R. Reviewer', initials: 'RR' }));
    const p = await result.current.store.projects.create({ name: 'Signed' });
    expect(p.createdBy).toBe('R. Reviewer');
  });

  it('picks up a profile written straight to the store (e.g. by an e2e hook)', async () => {
    const { result } = renderHook(() => ({ store: useStore(), ...useProfile() }), {
      wrapper: wrapperFor(freshFactory()),
    });
    await waitFor(() => expect(result.current.store).toBeTruthy());
    await act(() => result.current.store.profile.set({ name: 'E. Twoe', initials: 'ET' }));
    await waitFor(() => expect(result.current.profile).toEqual({ name: 'E. Twoe', initials: 'ET' }));
    const p = await result.current.store.projects.create({ name: 'Signed' });
    expect(p.createdBy).toBe('E. Twoe');
  });

  it('setProfile rejects an invalid profile and keeps the old one', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper: wrapperFor(freshFactory()) });
    await waitFor(() => expect(result.current).toBeTruthy());
    await expect(result.current.setProfile({ name: 'X', initials: 'TOOLONG' })).rejects.toThrow();
    expect(result.current.profile).toBeNull();
  });
});
