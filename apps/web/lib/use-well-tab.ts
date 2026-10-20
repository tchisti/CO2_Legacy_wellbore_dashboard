'use client';

// The well page's tab, kept in the URL (`tab=`) so a tab can be linked and survives a reload.
// As with the Wells filters (use-url-filters.ts), the URL lags behind the page: router.replace
// commits in a transition and may fetch first. So the tab lives in state and the URL follows it;
// a URL change the page did not write (a link) replaces the tab, while the page's own writes,
// landing late, never undo a newer choice. `score=1` is kept as it is.
import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { parseWellTab, wellHref, type WellTab } from '@/lib/routes';

export function useWellTab(id: string): [WellTab, (tab: WellTab) => void] {
  const router = useRouter();
  const params = useSearchParams();
  const urlTab = parseWellTab(params.get('tab'));
  const score = params.get('score') === '1';

  const [tab, setTab] = useState<WellTab>(urlTab);
  /** The URL's tab as last seen, and the tabs written since that have not shown up in it yet, oldest first. */
  const [seen, setSeen] = useState<WellTab>(urlTab);
  const [inFlight, setInFlight] = useState<readonly WellTab[]>([]);

  if (urlTab !== seen) {
    setSeen(urlTab);
    const landed = inFlight.indexOf(urlTab);
    if (landed >= 0) {
      setInFlight(inFlight.slice(landed + 1)); // ours; everything written before it has landed or been superseded
    } else {
      setInFlight([]);
      setTab(urlTab); // someone else's: follow the URL
    }
  }

  /** What the URL will say once every write has landed. */
  const target = inFlight.at(-1) ?? seen;

  const select = useCallback(
    (next: WellTab) => {
      setTab(next);
      if (next === target) return;
      setInFlight((f) => [...f, next]);
      router.replace(wellHref(id, { tab: next, score }), { scroll: false });
    },
    [id, router, score, target],
  );

  return [tab, select];
}
