import type { ComponentType } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';
import MethodologyPage from '@/app/methodology/page';
import PortfolioPage from '@/app/portfolio/page';
import SettingsPage from '@/app/settings/page';
import WellsPage from '@/app/wells/page';
import { ShellGate } from '@/components/shell/ShellGate';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

let dbCount = 0;
async function renderPage(Page: ComponentType, withProject = true, inShell = false) {
  dbCount += 1;
  const dbName = `lwa-pages-test-${dbCount}`;
  if (withProject) await createLocalStore({ dbName, actor: () => 'seed' }).projects.create({ name: 'Test AOR' });
  const page = inShell ? (
    <ShellGate>
      <Page />
    </ShellGate>
  ) : (
    <Page />
  );
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <ProjectProvider>
        <TooltipProvider>{page}</TooltipProvider>
      </ProjectProvider>
    </StoreProvider>,
  );
}

describe('placeholder pages', () => {
  it.each([
    ['Portfolio', PortfolioPage],
    ['Wells', WellsPage],
    ['Methodology', MethodologyPage],
    ['Project settings', SettingsPage],
  ])('%s shows its heading and the active project', async (heading, Page) => {
    await renderPage(Page);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
    expect(await screen.findByText('Test AOR')).toBeTruthy();
  });
});

describe('home page', () => {
  it('sends the user to Portfolio when a project exists', async () => {
    await renderPage(HomePage);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/portfolio'));
  });

  it('shows the first-run screen while there is no project (ShellGate, around every page, shows it)', async () => {
    await renderPage(HomePage, false, true);
    expect(await screen.findByRole('heading', { name: 'Create your first project' })).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
