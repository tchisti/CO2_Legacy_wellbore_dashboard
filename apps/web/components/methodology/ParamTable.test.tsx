import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY, type Methodology } from '@lwa/engine';
import { ParamTable } from '@/components/methodology/ParamTable';

afterEach(cleanup);

function renderTable(ui: ReactNode = <ParamTable methodology={DEFAULT_METHODOLOGY} labelledBy="h" />) {
  render(
    <>
      <h2 id="h">Scoring parameters</h2>
      {ui}
    </>,
  );
  return screen.getByRole('table', { name: 'Scoring parameters' });
}

const rowOf = (table: HTMLElement, key: string): HTMLElement => {
  const row = table.querySelector<HTMLElement>(`tr[data-param="${key}"]`);
  if (!row) throw new Error(`no row for ${key}`);
  return row;
};

describe('ParamTable', () => {
  it('lists all 11 parameters, Likelihood first then Consequence, in methodology order', () => {
    const table = renderTable();
    const rows = Array.from(table.querySelectorAll('tr[data-param]'));
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.getAttribute('data-param'))).toEqual(DEFAULT_METHODOLOGY.params.map((p) => p.key));
    expect(Array.from(table.querySelectorAll('tbody')).map((b) => b.getAttribute('data-axis'))).toEqual(['L', 'C']);
    expect(rows.slice(0, 7).every((r) => r.getAttribute('data-axis') === 'L')).toBe(true);
    expect(rows.slice(7).every((r) => r.getAttribute('data-axis') === 'C')).toBe(true);
    expect(Array.from(table.querySelectorAll('th[scope="rowgroup"]')).map((h) => h.textContent)).toEqual([
      'Likelihood (L)',
      'Consequence (C)',
    ]);
  });

  it('has the seven columns of the brief and no column for the in-between scores 2 and 4', () => {
    const table = renderTable();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Parameter',
      'Weight',
      'Anchor 1',
      'Anchor 3',
      'Anchor 5',
      'Unknown scores as',
      'References',
    ]);
  });

  it('shows a parameter with its description, weight, three anchors, unknown score and references', () => {
    const table = renderTable();
    const row = rowOf(table, 'plugQuality');
    const p = DEFAULT_METHODOLOGY.params.find((x) => x.key === 'plugQuality')!;
    expect(within(row).getByText(p.name)).toBeTruthy();
    expect(within(row).getByText(p.desc)).toBeTruthy();
    const weight = within(row).getByText('0.22');
    expect(weight.className).toContain('num');
    expect(within(row).getByText(p.anchors['1'])).toBeTruthy();
    expect(within(row).getByText(p.anchors['3'])).toBeTruthy();
    expect(within(row).getByText(p.anchors['5'])).toBeTruthy();
    const unknown = row.querySelector('[data-column="unknown"]')!;
    expect(unknown.textContent).toBe('5');
    expect(unknown.className).toContain('num');
    expect(row.querySelector('[data-column="refs"]')!.textContent).toBe('AER D020 §3; 40 CFR 146.84(c); Arbad et al. 2024');
  });

  it('closes each group with its weight sum, 1.00 for the shipped rulebook', () => {
    const table = renderTable();
    for (const axis of ['L', 'C']) {
      const sum = table.querySelector<HTMLElement>(`tr[data-sum="${axis}"]`)!;
      const value = sum.querySelector('[data-column="weight"]')!;
      expect(value.textContent).toBe('1.00');
      expect(value.className).toContain('num');
    }
  });

  it('shows the real weight sum when an axis does not add up to 1.00', () => {
    const m: Methodology = structuredClone(DEFAULT_METHODOLOGY);
    m.params.find((p) => p.key === 'access')!.weight = 0.1;
    const table = renderTable(<ParamTable methodology={m} labelledBy="h" />);
    expect(table.querySelector('tr[data-sum="C"] [data-column="weight"]')!.textContent).toBe('0.90');
    expect(table.querySelector('tr[data-sum="L"] [data-column="weight"]')!.textContent).toBe('1.00');
  });

  it('says once, in a caption, that scores 2 and 4 are judgment between the anchors, and does not print them', () => {
    const m: Methodology = structuredClone(DEFAULT_METHODOLOGY);
    m.params[0]!.anchors['2'] = 'Between one and three (hidden)';
    m.params[0]!.anchors['4'] = 'Between three and five (hidden)';
    renderTable(<ParamTable methodology={m} labelledBy="h" />);
    expect(screen.getAllByText(/judgment between/i)).toHaveLength(1);
    expect(screen.queryByText(/hidden/)).toBeNull();
  });

  it('shows an unknown score of 3 as a plain number, not a rank', () => {
    const table = renderTable();
    expect(rowOf(table, 'barriers').querySelector('[data-column="unknown"]')!.textContent).toBe('3');
    expect(table.querySelector('[data-rank]')).toBeNull();
  });
});
