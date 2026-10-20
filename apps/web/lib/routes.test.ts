import { describe, expect, it } from 'vitest';
import {
  ROUTES,
  WELL_TABS,
  newWellHref,
  parseWellTab,
  portfolioReportHref,
  wellHref,
  wellReportHref,
  wellsHref,
} from '@/lib/routes';

describe('routes', () => {
  it('ROUTES holds the four top-level pages', () => {
    expect(ROUTES).toEqual({
      portfolio: '/portfolio',
      wells: '/wells',
      methodology: '/methodology',
      settings: '/settings',
    });
  });

  it('wellHref and wellReportHref put the id in the query, encoded', () => {
    expect(wellHref('wel_abc123')).toBe('/wells/view?id=wel_abc123');
    expect(wellHref('a b/c&d')).toBe('/wells/view?id=a%20b%2Fc%26d');
    expect(wellReportHref('wel_abc123')).toBe('/report/well?id=wel_abc123');
    expect(wellReportHref('x?y=z')).toBe('/report/well?id=x%3Fy%3Dz');
  });

  it('wellHref adds the tab (the default assessment tab is left out) and score=1', () => {
    expect(wellHref('wel_1', { tab: 'history' })).toBe('/wells/view?id=wel_1&tab=history');
    expect(wellHref('wel_1', { tab: 'construction' })).toBe('/wells/view?id=wel_1&tab=construction');
    expect(wellHref('wel_1', { tab: 'assessment' })).toBe('/wells/view?id=wel_1');
    expect(wellHref('wel_1', { score: true })).toBe('/wells/view?id=wel_1&score=1');
    expect(wellHref('wel_1', { score: false })).toBe('/wells/view?id=wel_1');
    expect(wellHref('wel_1', { tab: 'history', score: true })).toBe('/wells/view?id=wel_1&score=1&tab=history');
    expect(wellHref('a b', {})).toBe('/wells/view?id=a%20b');
  });

  it('wellsHref without a query, or with only empty values, is the bare path', () => {
    expect(wellsHref()).toBe('/wells');
    expect(wellsHref({})).toBe('/wells');
    expect(wellsHref({ rank: undefined, text: '', status: [] })).toBe('/wells');
  });

  it('wellsHref sorts keys, repeats array keys in order, and omits undefined and empty values', () => {
    expect(wellsHref({ text: 'Sinopec', rank: ['High', 'Low'], state: undefined, status: ['', 'Abandoned'] })).toBe(
      '/wells?rank=High&rank=Low&status=Abandoned&text=Sinopec',
    );
  });

  it('the same query in a different key order gives the same href', () => {
    expect(wellsHref({ b: '2', a: '1' })).toBe(wellsHref({ a: '1', b: '2' }));
  });

  it('wellsHref encodes keys and values', () => {
    expect(wellsHref({ text: '100/07-21 W4', 'a&b': 'x=y' })).toBe('/wells?a%26b=x%3Dy&text=100%2F07-21%20W4');
  });

  it('portfolioReportHref builds the same query on the report path', () => {
    expect(portfolioReportHref()).toBe('/report/portfolio');
    expect(portfolioReportHref({ rank: ['Very High'], Lr: '4', Cr: '5' })).toBe(
      '/report/portfolio?Cr=5&Lr=4&rank=Very%20High',
    );
  });
});

describe('newWellHref', () => {
  it('is the new-well page', () => {
    expect(newWellHref()).toBe('/wells/new');
  });
});

describe('parseWellTab', () => {
  it('reads one of the three tabs and falls back to assessment', () => {
    expect(WELL_TABS).toEqual(['assessment', 'construction', 'history']);
    expect(parseWellTab('history')).toBe('history');
    expect(parseWellTab('construction')).toBe('construction');
    expect(parseWellTab('assessment')).toBe('assessment');
    expect(parseWellTab(null)).toBe('assessment');
    expect(parseWellTab('')).toBe('assessment');
    expect(parseWellTab('History')).toBe('assessment');
    expect(parseWellTab('location')).toBe('assessment');
  });

  it('round-trips through wellHref', () => {
    for (const tab of WELL_TABS) {
      const query = new URLSearchParams(wellHref('wel_1', { tab }).split('?')[1]);
      expect(parseWellTab(query.get('tab'))).toBe(tab);
    }
  });
});
