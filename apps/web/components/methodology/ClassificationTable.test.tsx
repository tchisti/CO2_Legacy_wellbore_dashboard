import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY } from '@lwa/engine';
import { ClassificationTable } from '@/components/methodology/ClassificationTable';

afterEach(cleanup);

function renderTable(ui: ReactNode = <ClassificationTable wellTypes={DEFAULT_METHODOLOGY.wellTypes} labelledBy="h" />) {
  render(
    <>
      <h2 id="h">Legacy well classification</h2>
      {ui}
    </>,
  );
  return screen.getByRole('table', { name: 'Legacy well classification' });
}

describe('ClassificationTable', () => {
  it('lists Type 1 to Type 9 in order, each with its short name, description and protection', () => {
    const table = renderTable();
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.querySelector('[data-column="type"]')!.textContent)).toEqual(
      Array.from({ length: 9 }, (_, i) => `Type ${i + 1}`),
    );
    for (const [i, row] of rows.entries()) {
      const t = DEFAULT_METHODOLOGY.wellTypes[`Type ${i + 1}`]!;
      expect(row.querySelector('[data-column="short"]')!.textContent).toBe(t.short);
      expect(row.querySelector('[data-column="desc"]')!.textContent).toBe(t.desc);
      expect(row.querySelector('[data-column="prot"]')!.textContent).toBe(t.prot);
    }
  });

  it('has Type, Name, Description and Protection provided columns', () => {
    const table = renderTable();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Type',
      'Name',
      'Description',
      'Protection provided',
    ]);
  });

  it('orders by the number in the key, whatever order the record arrives in', () => {
    const t = (short: string) => ({ short, desc: 'd', prot: 'p' });
    const table = renderTable(
      <ClassificationTable wellTypes={{ 'Type 10': t('ten'), 'Type 9': t('nine'), 'Type 2': t('two') }} labelledBy="h" />,
    );
    const types = Array.from(table.querySelectorAll('[data-column="type"]')).map((c) => c.textContent);
    expect(types).toEqual(['Type 2', 'Type 9', 'Type 10']);
  });
});
