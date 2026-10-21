import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WellViewPage from '@/app/wells/view/page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/wells/view',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

afterEach(cleanup);

let dbCount = 0;
/** Renders the well page for `id` over a store holding one project (and no wells), optionally wrapped. */
async function renderWellPage(id: string, wrap: (s: Store) => Store = (s) => s) {
  dbCount += 1;
  const dbName = `lwa-well-page-test-${dbCount}`;
  await createLocalStore({ dbName, actor: () => 'seed' }).projects.create({ name: 'Test AOR' });
  nav.search = `id=${encodeURIComponent(id)}`;
  render(
    <StoreProvider createStore={(actor) => wrap(createLocalStore({ dbName, actor }))}>
      <ProjectProvider>
        <TooltipProvider>
          <WellViewPage />
        </TooltipProvider>
      </ProjectProvider>
    </StoreProvider>,
  );
}

/** The page's store, with every well read failing (a blocked or corrupt database). */
const failingWellReads = (s: Store): Store => ({
  ...s,
  wells: { ...s.wells, get: () => Promise.reject(new Error('IndexedDB read failed')) },
});

describe('well page: a well it cannot show', () => {
  it('an id with no stored well is "Well not found", with a link back to Wells', async () => {
    await renderWellPage('wel_missing');
    expect(await screen.findByRole('heading', { name: 'Well not found' })).toBeTruthy();
    expect(screen.getByText(/No well with this link is stored in this browser/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Wells' }).getAttribute('href')).toBe('/wells');
  });

  it('a failed read is "The well could not be read", with the detail and the way back, never "Well not found"', async () => {
    await renderWellPage('wel_any', failingWellReads);
    expect(await screen.findByRole('heading', { name: 'The well could not be read' })).toBeTruthy();
    expect(screen.getByText('This browser could not read the well: IndexedDB read failed')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Well not found' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Wells' }).getAttribute('href')).toBe('/wells');
  });
});
