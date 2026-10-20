// Every internal link goes through this module. The app is a static export (spec §6.1), so detail
// pages take their ids from the query string (/wells/view?id=…) instead of dynamic segments, and
// list filters live in the query too, so a filtered view can be linked, reloaded and printed.

export const ROUTES = {
  portfolio: '/portfolio',
  wells: '/wells',
  methodology: '/methodology',
  settings: '/settings',
} as const;

/** Query values: a string, a repeated key (array), or undefined/empty to leave the key out. */
export type RouteQuery = Record<string, string | string[] | undefined>;

/**
 * `?key=value&…` with keys in sorted order (so equal queries give equal hrefs), array values as
 * repeated keys in their given order, and undefined or empty values left out. '' when nothing is left.
 */
function queryString(query: RouteQuery | undefined): string {
  if (!query) return '';
  const pairs: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v !== '') pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** The well page's tabs (spec §4.3), in display order. The first is the default and stays out of links. */
export const WELL_TABS = ['assessment', 'construction', 'history'] as const;
export type WellTab = (typeof WELL_TABS)[number];

/** The tab a `tab=` query value names; anything else (missing, misspelt, another case) is the default. */
export function parseWellTab(value: string | null | undefined): WellTab {
  return WELL_TABS.find((t) => t === value) ?? WELL_TABS[0];
}

/**
 * The well page. `tab` is left out for the default (assessment) tab; `score: true` adds `score=1`,
 * which opens the score flow over the page.
 */
export function wellHref(id: string, opts: { tab?: WellTab; score?: boolean } = {}): string {
  const tab = opts.tab && opts.tab !== WELL_TABS[0] ? opts.tab : undefined;
  return `/wells/view${queryString({ id, tab, score: opts.score ? '1' : undefined })}`;
}

export function wellReportHref(id: string): string {
  return `/report/well${queryString({ id })}`;
}

export function wellsHref(query?: RouteQuery): string {
  return `${ROUTES.wells}${queryString(query)}`;
}

export function portfolioReportHref(query?: RouteQuery): string {
  return `/report/portfolio${queryString(query)}`;
}

export function newWellHref(): string {
  return `${ROUTES.wells}/new`;
}
