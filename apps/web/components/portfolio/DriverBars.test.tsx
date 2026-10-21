import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DriverBars } from '@/components/portfolio/DriverBars';
import type { Driver } from '@/lib/portfolio';

afterEach(cleanup);

const DRIVERS: Driver[] = [
  { key: 'penetration', name: 'Penetration vs Storage Complex', avgContribution: 1.02 },
  { key: 'plume', name: 'Position vs Plume & Pressure Front', avgContribution: 0.51 },
  { key: 'data', name: 'Data Confidence', avgContribution: 0.1 },
];

describe('DriverBars', () => {
  it('draws one bar per parameter in the given order, scaled to the largest, with values to two decimals', () => {
    const { container } = render(<DriverBars drivers={DRIVERS} />);
    const rows = [...container.querySelectorAll('[data-driver]')];
    expect(rows.map((g) => g.getAttribute('data-driver'))).toEqual(['penetration', 'plume', 'data']);
    const width = (g: Element) => g.querySelector('svg')?.getAttribute('width');
    expect(rows.map(width)).toEqual(['100%', '50%', `${(0.1 / 1.02) * 100}%`]);
    expect(rows[0]!.textContent).toContain('1.02');
    expect(rows[2]!.textContent).toContain('0.10');
  });

  it('gives screen readers the same numbers as a table', () => {
    render(<DriverBars drivers={DRIVERS} />);
    const table = screen.getByRole('table', { name: 'Driver contribution by parameter, largest first' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getByRole('rowheader', { name: 'Data Confidence' }).nextElementSibling?.textContent).toBe('0.10');
  });

  it('a zero contribution draws no bar', () => {
    const { container } = render(<DriverBars drivers={[...DRIVERS, { key: 'age', name: 'Well Age', avgContribution: 0 }]} />);
    expect(container.querySelector('[data-driver="age"] svg')).toBeNull();
  });
});
