import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY, type Methodology } from '@lwa/engine';
import { BandTable } from '@/components/methodology/BandTable';

afterEach(cleanup);

function renderTable(ui: ReactNode = <BandTable methodology={DEFAULT_METHODOLOGY} labelledBy="h" />) {
  render(
    <>
      <h2 id="h">Rank bands</h2>
      {ui}
    </>,
  );
  return screen.getByRole('table', { name: 'Rank bands' });
}

describe('BandTable', () => {
  it('shows all four bands, each as its rank badge with its cell range', () => {
    const table = renderTable();
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.querySelector('[data-rank]')?.getAttribute('data-rank'))).toEqual([
      'Low',
      'Moderate',
      'High',
      'Very High',
    ]);
    expect(rows.map((r) => r.querySelector('[data-column="cells"]')?.textContent)).toEqual([
      '1–4',
      '5–9',
      '10–16',
      '17–25',
    ]);
    for (const r of rows) expect(r.querySelector('[data-column="cells"]')!.className).toContain('num');
  });

  it('has Rank and Cells columns', () => {
    const table = renderTable();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Rank', 'Cells']);
  });

  it('shows a single-cell band as one number', () => {
    const m: Methodology = structuredClone(DEFAULT_METHODOLOGY);
    m.matrix.bands = [{ min: 1, max: 1, label: 'Low', cls: 'low', color: '#1fbf75' }];
    const table = renderTable(<BandTable methodology={m} labelledBy="h" />);
    expect(table.querySelector('[data-column="cells"]')!.textContent).toBe('1');
  });

  it('states the cell rule: round(L) × round(C), with Risk Index only breaking ties', () => {
    renderTable();
    const note = screen.getByText(/round\(L\) × round\(C\)/);
    expect(note.textContent).toMatch(/Risk Index/);
    expect(note.textContent).toMatch(/L × C/);
    expect(note.textContent).toMatch(/ties/);
  });
});
