import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KpiRow } from '@/components/portfolio/KpiRow';
import type { PortfolioStats } from '@/lib/portfolio';

afterEach(cleanup);

const RANKS = ['Low', 'Moderate', 'High', 'Very High'];

const STATS: PortfolioStats = {
  total: 7,
  finals: 5,
  byRank: { Low: 4, Moderate: 1, High: 0, 'Very High': 0 },
  unscored: 2,
  draft: 0,
  stale: 1,
  unknownHeavy: 0,
  recordChanged: 3,
  matrix: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]),
  drivers: [],
  attention: [],
  attentionTotal: 0,
};

// A string name matches the whole accessible name.
const tile = (name: string) => screen.getByRole('link', { name });

describe('KpiRow', () => {
  it('links every count into the Wells register filtered to the wells it counts', () => {
    render(<KpiRow stats={STATS} rankLabels={RANKS} />);
    expect(tile('7 wells').getAttribute('href')).toBe('/wells');
    expect(tile('Low: 4 wells').getAttribute('href')).toBe('/wells?rank=Low');
    expect(tile('Very High: 0 wells').getAttribute('href')).toBe('/wells?rank=Very%20High');
    expect(tile('Unscored: 2 wells').getAttribute('href')).toBe('/wells?state=unscored');
    expect(tile('Drafts: 0 wells').getAttribute('href')).toBe('/wells?state=draft');
    expect(tile('Stale revision: 1 well').getAttribute('href')).toBe('/wells?state=stale');
    expect(tile('Unknown-heavy: 0 wells').getAttribute('href')).toBe('/wells?minUnknown=4');
  });

  it('has no "Record changed" tile: that state is a Well page badge, not a KPI (spec §5.1)', () => {
    render(<KpiRow stats={STATS} rankLabels={RANKS} />);
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.queryByRole('link', { name: /Record changed/ })).toBeNull();
    expect(screen.queryByText(/Record changed/)).toBeNull();
  });

  it('sets every count in the mono number face (spec §7)', () => {
    const { container } = render(<KpiRow stats={STATS} rankLabels={RANKS} />);
    const counts = [...container.querySelectorAll('[data-kpi-count]')];
    expect(counts.map((c) => c.textContent)).toEqual(['7', '4', '1', '0', '0', '2', '0', '1', '0']);
    for (const c of counts) expect(c.classList.contains('num')).toBe(true);
    expect(tile('Low: 4 wells').querySelector('[data-kpi-count]')?.textContent).toBe('4');
  });

  it('keeps zero tiles in place, marked as zero; only a non-zero stale count is amber', () => {
    const { rerender } = render(<KpiRow stats={STATS} rankLabels={RANKS} />);
    expect(tile('High: 0 wells').hasAttribute('data-zero')).toBe(true);
    expect(tile('Low: 4 wells').hasAttribute('data-zero')).toBe(false);
    expect(tile('Stale revision: 1 well').getAttribute('data-tone')).toBe('warn');
    expect(tile('Unscored: 2 wells').getAttribute('data-tone')).toBeNull();

    rerender(<KpiRow stats={{ ...STATS, stale: 0 }} rankLabels={RANKS} />);
    expect(tile('Stale revision: 0 wells').getAttribute('data-tone')).toBeNull();
    expect(tile('Stale revision: 0 wells').hasAttribute('data-zero')).toBe(true);
  });

  it('says "1 well" for a single well', () => {
    render(<KpiRow stats={{ ...STATS, total: 1 }} rankLabels={RANKS} />);
    expect(tile('1 well').textContent).toContain('1well');
  });
});
