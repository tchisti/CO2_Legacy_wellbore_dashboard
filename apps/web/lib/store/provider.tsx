'use client';

// React access to the Store (spec §6.1). One store per page lifetime, created in the browser only
// (in an effect), so nothing touches IndexedDB while `next build` prerenders the static export.
// The store's actor (the name stamped on every write) is the reviewer profile, read once before
// the children render and kept current whenever the profile changes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react';
import { ReviewerProfileSchema, type ReviewerProfile } from '@lwa/engine';
import { installE2EHooks } from '@/lib/e2e-hooks';
import { reportError } from '@/lib/log';
import { createLocalStore } from '@/lib/store/local-store';
import type { Store } from '@/lib/store/store';

/** Makes the page's store; `actor` returns the current reviewer name. Tests pass their own. */
export type StoreFactory = (actor: () => string) => Store;

const defaultFactory: StoreFactory = (actor) => createLocalStore({ actor });

/** The actor name used before a reviewer profile exists. */
export const UNKNOWN_ACTOR = 'Unknown';

type StoreContextValue = {
  store: Store;
  profile: ReviewerProfile | null;
  setProfile: (p: ReviewerProfile) => Promise<void>;
};

const StoreContext = createContext<StoreContextValue | null>(null);

/** Who the store stamps on writes: the reviewer profile's name, kept current by the provider. */
type Actor = { name: () => string; set: (p: ReviewerProfile | null) => void };

function createActor(): Actor {
  let current: string | null = null;
  return {
    name: () => current ?? UNKNOWN_ACTOR,
    set: (p) => {
      current = p?.name ?? null;
    },
  };
}

/** The page's store and its actor, made together once. */
type Session = { store: Store; actor: Actor };

type Startup = { status: 'starting' } | { status: 'ready'; session: Session } | { status: 'failed'; error: Error };

export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Whether two reads of the profile say the same thing (the store hands back a new object each time). */
function sameProfile(a: ReviewerProfile | null, b: ReviewerProfile | null): boolean {
  return a === b || (a !== null && b !== null && a.name === b.name && a.initials === b.initials);
}

export function StoreProvider({
  children,
  createStore = defaultFactory,
  fallback = null,
  renderError,
}: {
  children: ReactNode;
  /** Used once, when the provider first mounts; defaults to LocalStore on the `lwa` database. */
  createStore?: StoreFactory;
  /** Shown until the store is open and the profile has been read. */
  fallback?: ReactNode;
  /** Shown when the store cannot be opened (e.g. IndexedDB blocked); defaults to the message. */
  renderError?: (error: Error) => ReactNode;
}) {
  const [startup, setStartup] = useState<Startup>({ status: 'starting' });
  const [profile, setProfileState] = useState<ReviewerProfile | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const factoryRef = useRef(createStore);

  useEffect(() => {
    // Refs survive StrictMode's effect replay, so the page gets exactly one store.
    if (!sessionRef.current) {
      const actor = createActor();
      sessionRef.current = { actor, store: factoryRef.current(actor.name) };
    }
    const session = sessionRef.current;
    const { store, actor } = session;
    let active = true;
    let seq = 0;
    /**
     * Reads the profile; the latest read wins, so a slow early read cannot undo a newer one. Every
     * store write triggers a read, so an unchanged profile keeps its object: the context value, and
     * every consumer, then stay as they are.
     */
    const readProfile = async (): Promise<void> => {
      const mine = ++seq;
      const p = await store.profile.get();
      if (!active || mine !== seq) return;
      actor.set(p);
      setProfileState((prev) => (sameProfile(prev, p) ? prev : p));
    };
    readProfile().then(
      () => {
        if (!active) return;
        installE2EHooks(store);
        setStartup({ status: 'ready', session });
      },
      (e: unknown) => {
        if (active) setStartup({ status: 'failed', error: toError(e) });
      },
    );
    // Any change may be a profile write (the profile menu, another code path, an e2e hook).
    const unsubscribe = store.onChange(() => {
      readProfile().catch((e: unknown) => reportError(e, { where: 'store-provider', action: 'read-profile' }));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const session = startup.status === 'ready' ? startup.session : null;

  const setProfile = useCallback(
    async (p: ReviewerProfile): Promise<void> => {
      if (!session) throw new Error('The store is not open yet');
      const parsed = ReviewerProfileSchema.parse(p);
      await session.store.profile.set(parsed);
      session.actor.set(parsed);
      setProfileState(parsed);
    },
    [session],
  );

  const value = useMemo(
    () => (session ? { store: session.store, profile, setProfile } : null),
    [session, profile, setProfile],
  );

  if (startup.status === 'failed') return <>{renderError ? renderError(startup.error) : startup.error.message}</>;
  if (!value) return <>{fallback}</>;
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function useStoreContext(hook: string): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error(`${hook} must be used inside <StoreProvider>`);
  return ctx;
}

export function useStore(): Store {
  return useStoreContext('useStore').store;
}

/** The reviewer profile (null until one is saved) and its setter, which validates and persists. */
export function useProfile(): { profile: ReviewerProfile | null; setProfile: (p: ReviewerProfile) => Promise<void> } {
  const { profile, setProfile } = useStoreContext('useProfile');
  return { profile, setProfile };
}

export type StoreQuery<T> = { data: T | undefined; loading: boolean; error: Error | null };

type Settled<T> = { deps: DependencyList } & ({ ok: true; data: T } | { ok: false; error: Error });

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Runs `fn` against the store and again after every store change. `deps` work as for useEffect:
 * when they change, the old result is dropped (loading again) and late answers for old deps are
 * ignored, as is anything that settles after unmount. A rejection is returned as `error`.
 */
export function useStoreQuery<T>(fn: (s: Store) => Promise<T>, deps: DependencyList): StoreQuery<T> {
  const store = useStore();
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let active = true;
    let seq = 0;
    const run = (): void => {
      const mine = ++seq;
      const keep = (s: Settled<T>) => {
        if (active && mine === seq) setSettled(s);
      };
      let pending: Promise<T>;
      try {
        pending = fn(store);
      } catch (e) {
        pending = Promise.reject(e); // a query that throws before returning a promise is still an error
      }
      pending.then(
        (data) => keep({ deps, ok: true, data }),
        (e: unknown) => keep({ deps, ok: false, error: toError(e) }),
      );
    };
    run();
    const unsubscribe = store.onChange(run);
    return () => {
      active = false;
      unsubscribe();
    };
    // `deps` stand in for `fn`, as with useCallback; the caller lists what the query reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ...deps]);

  const current = settled && sameDeps(settled.deps, deps) ? settled : null;
  if (!current) return { data: undefined, loading: true, error: null };
  return current.ok ? { data: current.data, loading: false, error: null } : { data: undefined, loading: false, error: current.error };
}
