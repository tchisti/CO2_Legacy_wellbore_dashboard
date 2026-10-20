import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellGate } from '@/components/shell/ShellGate';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/portfolio' }));

afterEach(cleanup);

let dbCount = 0;
async function renderShell(seed?: (s: Store) => Promise<void>) {
  dbCount += 1;
  const dbName = `lwa-shell-test-${dbCount}`;
  if (seed) await seed(createLocalStore({ dbName, actor: () => 'seed' }));
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <ProjectProvider>
        <ShellGate>
          <p>Page content</p>
        </ShellGate>
      </ProjectProvider>
    </StoreProvider>,
  );
}

describe('ShellGate', () => {
  it('shows the first-run screen, without the app chrome, when there is no project', async () => {
    await renderShell();
    expect(await screen.findByRole('heading', { name: 'Create your first project' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Page content')).toBeNull();
  });

  it('asks for the reviewer profile when a project exists and no profile is set', async () => {
    await renderShell(async (s) => {
      await s.projects.create({ name: 'Test AOR' });
    });
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Your name');
    expect(screen.queryByRole('heading', { name: 'Create your first project' })).toBeNull();
  });

  it('shows the top bar, navigation and page once a project and a profile exist', async () => {
    await renderShell(async (s) => {
      await s.projects.create({ name: 'Test AOR' });
      await s.profile.set({ name: 'T. Chisti', initials: 'TC' });
    });
    expect(await screen.findByText('Page content')).toBeTruthy();
    expect(screen.getByText('Legacy Well Assessment')).toBeTruthy();
    expect(screen.getByRole('navigation').textContent).toBe('PortfolioWellsMethodologyProject settings');
    expect(screen.getByRole('button', { name: /Test AOR/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /TC/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
