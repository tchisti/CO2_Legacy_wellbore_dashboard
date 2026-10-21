'use client';

// The Wells filters, kept in the URL (spec §4.2: a filtered view can be linked, reloaded and
// printed). The URL lags behind the page: router.replace commits in a transition, and in a
// static export it may fetch first. So the filters live in state, and the URL follows them —
// at once for a chip, after a pause for typing. A URL change the page did not write (a link, the
// Wells tab) replaces the filters; the page's own writes, landing late or out of date, never do.
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { wellsHref } from '@/lib/routes';
import { EMPTY_FILTERS, filtersFromQuery, filtersToQuery, type Filters } from '@/lib/wells-view';

/** How long typing pauses before the search text is written to the URL. */
export const TEXT_DEBOUNCE_MS = 250;

/** One spelling per filter set, so the URL and the state compare by meaning. */
const hrefOf = (f: Filters): string => wellsHref(filtersToQuery(f));

export function useUrlFilters(): {
  filters: Filters;
  /** The search text; filters at once, reaches the URL after a pause. */
  setText: (text: string) => void;
  setFilters: (next: Filters) => void;
  clear: () => void;
} {
  const router = useRouter();
  const params = useSearchParams();
  const urlHref = hrefOf(filtersFromQuery(params));

  const [state, setState] = useState(() => ({ filters: filtersFromQuery(params), debounce: false }));
  /** The URL as last seen, and the hrefs written since that have not shown up in it yet, oldest first. */
  const [seen, setSeen] = useState(urlHref);
  const [inFlight, setInFlight] = useState<readonly string[]>([]);

  if (urlHref !== seen) {
    setSeen(urlHref);
    const landed = inFlight.indexOf(urlHref);
    if (landed >= 0) {
      setInFlight(inFlight.slice(landed + 1)); // ours, and everything written before it has landed or been superseded
    } else {
      setInFlight([]);
      setState({ filters: filtersFromQuery(params), debounce: false }); // someone else's: follow the URL
    }
  }

  const href = hrefOf(state.filters);
  /** What the URL will say once every write has landed. */
  const target = inFlight.at(-1) ?? seen;

  useEffect(() => {
    if (href === target) return;
    const timer = setTimeout(
      () => {
        setInFlight((f) => [...f, href]);
        router.replace(href, { scroll: false });
      },
      state.debounce ? TEXT_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [href, target, state.debounce, router]);

  const setText = useCallback(
    (text: string) => setState((s) => ({ filters: { ...s.filters, text }, debounce: true })),
    [],
  );
  const setFilters = useCallback((next: Filters) => setState({ filters: next, debounce: false }), []);
  const clear = useCallback(() => setState({ filters: EMPTY_FILTERS, debounce: false }), []);

  return { filters: state.filters, setText, setFilters, clear };
}
