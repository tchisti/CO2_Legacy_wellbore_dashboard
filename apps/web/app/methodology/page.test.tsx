import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MethodologyPage from '@/app/methodology/page';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/methodology',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

let dbCount = 0;
async function renderPage() {
  dbCount += 1;
  const dbName = `lwa-methodology-page-test-${dbCount}`;
  await createLocalStore({ dbName, actor: () => 'seed' }).projects.create({ name: 'Test AOR' });
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <ProjectProvider>
        <TooltipProvider>
          <MethodologyPage />
        </TooltipProvider>
      </ProjectProvider>
    </StoreProvider>,
  );
  return screen.findByRole('heading', { level: 1, name: 'Methodology' });
}

describe('Methodology page', () => {
  it('heads the page with the revision, who updated it when, and the scoring rule in plain words', async () => {
    await renderPage();
    const rev = await screen.findByText('2.0.0', { selector: '[data-header-rev]' });
    expect(rev.className).toContain('num');
    expect(await screen.findByText('updated 2026-07-28 by Tahir Chisti')).toBeTruthy();
    expect(screen.getByText('Test AOR')).toBeTruthy();
    const rule = screen.getByText(/weighted sums/);
    expect(rule.textContent).toMatch(/1\.00/);
    expect(rule.textContent).toMatch(/round\(L\) × round\(C\)/);
    expect(rule.textContent).toMatch(/Risk Index/);
    expect(rule.textContent).toMatch(/Unknown/);
  });

  it('shows the parameters, rank bands, classification, figure, sources and revisions', async () => {
    await renderPage();
    const params = await screen.findByRole('table', { name: 'Scoring parameters' });
    expect(params.querySelectorAll('tr[data-param]')).toHaveLength(11);
    expect(params.querySelectorAll('tr[data-sum]')).toHaveLength(2);
    const bands = screen.getByRole('table', { name: 'Rank bands' });
    expect(bands.querySelectorAll('tbody tr')).toHaveLength(4);
    const types = screen.getByRole('table', { name: 'Legacy well classification' });
    expect(types.querySelectorAll('tbody tr')).toHaveLength(9);
    expect(screen.getByRole('img', { name: 'Legacy well classification types, adapted after Arbad et al. 2024' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Sources' })).toBeTruthy();
    const revisions = screen.getByRole('table', { name: 'Revisions in this project' });
    expect(within(revisions).getByText('2.0.0')).toBeTruthy();
    expect(within(revisions).getByText('built-in default')).toBeTruthy();
  });

  it('is read-only in Phase 1: no Edit control', async () => {
    await renderPage();
    await screen.findByRole('table', { name: 'Scoring parameters' });
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /edit/i })).toBeNull();
  });
});
