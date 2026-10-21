import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NeedsAttention } from '@/components/portfolio/NeedsAttention';
import type { AttentionItem } from '@/lib/portfolio';

afterEach(cleanup);

const STALE: AttentionItem = {
  wellId: 'wel_1',
  licence: '100/13-05-056-22W4/00',
  name: 'SINOPEC REDWATER 13-5',
  kind: 'stale',
  reason: 'Assessed under 1.0.0',
};

const unscored = (i: number): AttentionItem => ({
  wellId: `wel_u${i}`,
  licence: `100/0${i}-01-001-01W5/00`,
  name: '',
  kind: 'unscored',
  reason: 'Not yet assessed',
});

describe('NeedsAttention', () => {
  it('lists each well as a link to its page with its reason; only a stale revision is amber', () => {
    render(<NeedsAttention items={[STALE, unscored(1)]} total={2} upToDate={3} />);
    const stale = screen.getByRole('link', { name: /100\/13-05-056-22W4\/00/ });
    expect(stale.getAttribute('href')).toBe('/wells/view?id=wel_1');
    expect(stale.textContent).toContain('SINOPEC REDWATER 13-5');
    expect(stale.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('warn');
    const other = screen.getByRole('link', { name: /100\/01-01-001-01W5\/00/ });
    expect(other.textContent).toContain('Unnamed well');
    expect(other.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('empty');
    expect(screen.getByText('The other 3 wells are up to date')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View all in Wells' })).toBeNull();
  });

  it('offers "View all in Wells" when more wells need attention than are listed', () => {
    const items = Array.from({ length: 8 }, (_, i) => unscored(i));
    render(<NeedsAttention items={items} total={11} upToDate={0} />);
    expect(screen.getAllByRole('link', { name: /Not yet assessed/ })).toHaveLength(8);
    expect(screen.getByText('8 of 11 shown')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View all in Wells' }).getAttribute('href')).toBe('/wells');
    expect(screen.getByText('No well is up to date yet')).toBeTruthy();
  });

  it('says so calmly when nothing needs attention', () => {
    render(<NeedsAttention items={[]} total={0} upToDate={5} />);
    expect(screen.getByText('Nothing needs attention')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
