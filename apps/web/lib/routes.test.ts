import { describe, expect, it } from 'vitest';
import { ROUTES, portfolioReportHref, wellHref, wellReportHref, wellsHref } from '@/lib/routes';

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
