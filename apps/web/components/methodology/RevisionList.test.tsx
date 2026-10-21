import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY, type MethodologyRecord } from '@lwa/engine';
import { RevisionList } from '@/components/methodology/RevisionList';

afterEach(cleanup);

const record = (revision: string, note: string, publishedAt: string, publishedBy: string): MethodologyRecord => ({
  revision,
  methodology: { ...DEFAULT_METHODOLOGY, revision },
  note,
  publishedAt,
  publishedBy,
});

// The store lists oldest first.
const RECORDS: MethodologyRecord[] = [
  record('2.0.0', 'migrated from v2', '2026-07-28T00:00:00Z', 'Tahir Chisti'),
  record('2.1.0', 'Plug quality anchors reworded', '2026-09-02T14:30:00Z', 'T. Chisti'),
];

function renderList(ui: ReactNode) {
  render(
    <>
      <h2 id="h">Revisions in this project</h2>
      {ui}
    </>,
  );
  return screen.getByRole('table', { name: 'Revisions in this project' });
}

describe('RevisionList', () => {
  it('lists the revisions newest first with revision, note, published date and publisher', () => {
    const table = renderList(<RevisionList records={RECORDS} currentRevision="2.1.0" labelledBy="h" />);
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Revision',
      'Note',
      'Published',
      'By',
    ]);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows.map((r) => r.querySelector('[data-column="revision"]')!.textContent)).toEqual(['2.1.0 (current)', '2.0.0']);
    const [newest, oldest] = rows as [HTMLElement, HTMLElement];
    expect(within(newest).getByText('2.1.0').className).toContain('num');
    expect(within(newest).getByText('Plug quality anchors reworded')).toBeTruthy();
    expect(within(newest).getByText('2026-09-02').className).toContain('num');
    expect(within(newest).getByText('T. Chisti')).toBeTruthy();
    expect(within(oldest).getByText('migrated from v2')).toBeTruthy();
    expect(within(oldest).getByText('2026-07-28')).toBeTruthy();
    expect(within(oldest).getByText('Tahir Chisti')).toBeTruthy();
  });

  it('marks only the current revision', () => {
    const table = renderList(<RevisionList records={RECORDS} currentRevision="2.1.0" labelledBy="h" />);
    expect(within(table).getAllByText(/current/i)).toHaveLength(1);
  });

  it('does not reorder the caller\'s array', () => {
    const copy = [...RECORDS];
    renderList(<RevisionList records={RECORDS} currentRevision="2.1.0" labelledBy="h" />);
    expect(RECORDS).toEqual(copy);
  });
});
