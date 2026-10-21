import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_PROJECT_KEY, ProjectProvider, useProjectId, useProjects } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider, useStore, type StoreFactory } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

let dbCount = 0;
/** A database no other test uses; `seed` runs on it before the provider opens it. */
async function freshFactory(seed?: (s: Store) => Promise<void>): Promise<StoreFactory> {
  dbCount += 1;
  const dbName = `lwa-project-test-${dbCount}`;
  if (seed) await seed(createLocalStore({ dbName, actor: () => 'seed' }));
  return (actor) => createLocalStore({ dbName, actor });
}

function wrapperFor(createStore: StoreFactory) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StoreProvider createStore={createStore}>
        <ProjectProvider>{children}</ProjectProvider>
      </StoreProvider>
    );
  };
}

const useAll = () => ({ store: useStore(), active: useProjectId(), projects: useProjects() });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useProjectId', () => {
  it('is null while there are no projects', async () => {
    const { result } = renderHook(useAll, { wrapper: wrapperFor(await freshFactory()) });
    await waitFor(() => expect(result.current.projects.loading).toBe(false));
    expect(result.current.active[0]).toBeNull();
    expect(result.current.projects.activeProject).toBeNull();
  });

  it('falls back to the earliest-created project when nothing is stored', async () => {
    const factory = await freshFactory(async (s) => {
      await s.projects.create({ name: 'First' });
      await s.projects.create({ name: 'Second' });
    });
    const { result } = renderHook(useAll, { wrapper: wrapperFor(factory) });
    await waitFor(() => expect(result.current.projects.activeProject?.name).toBe('First'));
  });

  it('uses the stored project, and setting a project stores it', async () => {
    const ids: string[] = [];
    const factory = await freshFactory(async (s) => {
      ids.push((await s.projects.create({ name: 'First' })).id);
      ids.push((await s.projects.create({ name: 'Second' })).id);
    });
    localStorage.setItem(ACTIVE_PROJECT_KEY, ids[1]);
    const { result } = renderHook(useAll, { wrapper: wrapperFor(factory) });
    await waitFor(() => expect(result.current.active[0]).toBe(ids[1]));

    act(() => result.current.active[1](ids[0]));
    expect(result.current.active[0]).toBe(ids[0]);
    expect(result.current.projects.activeProject?.name).toBe('First');
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe(ids[0]);
  });

  it('falls back to the first project when the stored id no longer exists', async () => {
    const factory = await freshFactory(async (s) => {
      await s.projects.create({ name: 'Only' });
    });
    localStorage.setItem(ACTIVE_PROJECT_KEY, 'prj_deleted');
    const { result } = renderHook(useAll, { wrapper: wrapperFor(factory) });
    await waitFor(() => expect(result.current.projects.activeProject?.name).toBe('Only'));
  });

  it('picks up the first project as soon as it is created', async () => {
    const { result } = renderHook(useAll, { wrapper: wrapperFor(await freshFactory()) });
    await waitFor(() => expect(result.current.projects.loading).toBe(false));
    const created = await act(() => result.current.store.projects.create({ name: 'New' }));
    await waitFor(() => expect(result.current.active[0]).toBe(created.id));
  });

  it('works when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const ids: string[] = [];
    const factory = await freshFactory(async (s) => {
      ids.push((await s.projects.create({ name: 'First' })).id);
      ids.push((await s.projects.create({ name: 'Second' })).id);
    });
    const { result } = renderHook(useAll, { wrapper: wrapperFor(factory) });
    await waitFor(() => expect(result.current.active[0]).toBe(ids[0]));
    act(() => result.current.active[1](ids[1]));
    expect(result.current.active[0]).toBe(ids[1]);
  });

  it('throws a clear error outside the provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useProjectId())).toThrow('useProjectId must be used inside <ProjectProvider>');
  });
});
