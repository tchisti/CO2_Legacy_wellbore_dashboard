// A form's working copy of a stored value (Project settings: the details, the injectors, the
// formation column). Values are compared as JSON, so they must be plain data.
//
// - The draft starts as the stored value and is `dirty` while it differs from the value it was
//   last synced to (loaded, saved or discarded to).
// - A new stored value (a save from another section, an import, another tab) replaces a clean
//   draft; a dirty draft keeps the reviewer's edits, and `discard` then goes to the newest value.
// - `saved` marks what was just written as the synced value, so the store change that follows
//   (which may arrive a render later) does not disturb it.
import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';

type State<T> = {
  draft: T;
  /** The JSON of the value the draft was last synced to: clean while the draft matches it. */
  base: string;
  /** The newest stored value known: the last one seen, or the one just saved. */
  latest: T;
  /** The JSON of the last stored value seen (the `upstream` argument). */
  seenKey: string;
};

export type Draft<T> = {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  dirty: boolean;
  /** Back to the newest stored value. */
  discard: () => void;
  /** The value just written: the draft becomes it, clean. */
  saved: (value: T) => void;
};

const keyOf = (value: unknown): string => JSON.stringify(value);

export function useDraft<T>(upstream: T): Draft<T> {
  const upstreamKey = keyOf(upstream);
  const [state, setState] = useState<State<T>>(() => ({
    draft: upstream,
    base: upstreamKey,
    latest: upstream,
    seenKey: upstreamKey,
  }));

  // A changed stored value, adopted during render (React's pattern for state that follows a prop).
  let current = state;
  if (upstreamKey !== state.seenKey) {
    const clean = keyOf(state.draft) === state.base;
    current = clean
      ? { draft: upstream, base: upstreamKey, latest: upstream, seenKey: upstreamKey }
      : { ...state, latest: upstream, seenKey: upstreamKey };
    setState(current);
  }

  const setDraft = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setState((s) => ({ ...s, draft: typeof action === 'function' ? (action as (prev: T) => T)(s.draft) : action }));
  }, []);
  const discard = useCallback(() => setState((s) => ({ ...s, draft: s.latest, base: keyOf(s.latest) })), []);
  // `seenKey` stays: the stored value has not been seen to change yet, and when it is, it is adopted.
  const saved = useCallback((value: T) => setState((s) => ({ ...s, draft: value, base: keyOf(value), latest: value })), []);

  return { draft: current.draft, setDraft, dirty: keyOf(current.draft) !== current.base, discard, saved };
}
