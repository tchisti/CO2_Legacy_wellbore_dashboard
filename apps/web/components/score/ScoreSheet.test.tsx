import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METHODOLOGY, type Well } from '@lwa/engine';
import { ScoreSheet } from '@/components/score/ScoreSheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';

/** jsdom has no ResizeObserver; the schematic only needs one to exist (it draws at its default size). */
class NoResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STAMP = '2026-10-21T09:00:00.000Z';

/** A stored well whose construction holds an inverted plug (top below bottom), as an import or the migration can store it. */
const WELL: Well = {
  id: 'wel_inverted',
  projectId: 'prj_test',
  licence: '100/07-21-055-22W4/00',
  name: 'INVERTED PLUG 7-21',
  operator: '',
  lat: null,
  lon: null,
  spudYear: null,
  type: 'Unknown',
  trajectory: 'Unknown',
  status: 'Unknown',
  classification: 'Type 3',
  td_m: 1500,
  notes: '',
  construction: {
    td: 1500,
    casings: [],
    plugs: [
      { n: 1, kind: 'cement', top_m: 1400, bottom_m: 1450 },
      { n: 2, kind: 'cement', top_m: 1463, bottom_m: 1448, source: 'extractor', verbatim: 'Plug 2: 1463/1448 m' },
    ],
    perforations: [],
    formations: [],
    packers: [],
    zones: [],
    notes: [],
  },
  createdAt: STAMP,
  createdBy: 'seed',
  updatedAt: STAMP,
  updatedBy: 'seed',
};

let dbCount = 0;
function renderSheet(well: Well) {
  dbCount += 1;
  const dbName = `lwa-score-sheet-test-${dbCount}`;
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <TooltipProvider>
        <ScoreSheet
          well={well}
          project={null}
          methodology={DEFAULT_METHODOLOGY}
          current={null}
          draft={null}
          onClosed={vi.fn()}
        />
      </TooltipProvider>
    </StoreProvider>,
  );
}

describe('ScoreSheet: the saved construction beside the rows', () => {
  it('draws it as the dossier does: a stored inverted plug is left out, the valid plug keeps its id', async () => {
    renderSheet(WELL);
    await userEvent.click(await screen.findByRole('button', { name: 'Show schematic' }));
    const dialog = screen.getByRole('dialog');
    const plugs = [...dialog.querySelectorAll('svg [data-kind="plug"]')];
    expect(plugs.map((p) => p.getAttribute('data-id'))).toEqual(['plug:0']);
  });

  it('draws both plugs once the stored rows are the right way round', async () => {
    const plugs = WELL.construction!.plugs;
    renderSheet({ ...WELL, construction: { ...WELL.construction!, plugs: [plugs[0]!, { ...plugs[1]!, top_m: 1448, bottom_m: 1463 }] } });
    await userEvent.click(await screen.findByRole('button', { name: 'Show schematic' }));
    const drawn = [...screen.getByRole('dialog').querySelectorAll('svg [data-kind="plug"]')];
    expect(drawn.map((p) => p.getAttribute('data-id'))).toEqual(['plug:0', 'plug:1']);
  });
});
