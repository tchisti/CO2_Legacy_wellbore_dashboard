import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect, type ReactNode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstRun } from '@/components/shell/FirstRun';
import { ACTIVE_PROJECT_KEY, ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider, useStore } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/' }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const FIXTURE = readFileSync(join(__dirname, '..', '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8');

let dbCount = 0;
let store: Store | null = null;
/** Hands the provider's store to the test once it is open. */
function StoreProbe() {
  const s = useStore();
  useEffect(() => {
    store = s;
  }, [s]);
  return null;
}

function renderFirstRun(): void {
  dbCount += 1;
  const dbName = `lwa-firstrun-test-${dbCount}`;
  const tree = (children: ReactNode) => (
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <ProjectProvider>{children}</ProjectProvider>
    </StoreProvider>
  );
  render(
    tree(
      <>
        <StoreProbe />
        <FirstRun />
      </>,
    ),
  );
}

const jsonFile = (text: string) => new File([text], 'project.json', { type: 'application/json' });

beforeEach(() => {
  localStorage.clear();
  store = null;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('FirstRun', () => {
  it('creates a project, makes it active and opens Portfolio', async () => {
    const user = userEvent.setup();
    renderFirstRun();
    expect(await screen.findByRole('heading', { name: 'Create your first project' })).toBeTruthy();

    await user.type(screen.getByLabelText('Project name'), '  Test AOR ');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/portfolio'));
    const projects = await store!.projects.list();
    expect(projects.map((p) => p.name)).toEqual(['Test AOR']);
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe(projects[0].id);
  });

  it('asks for a name instead of creating a project with a blank one', async () => {
    const user = userEvent.setup();
    renderFirstRun();
    await user.type(await screen.findByLabelText('Project name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect((await screen.findByText('Enter a project name.')).id).toBeTruthy();
    expect(screen.getByLabelText('Project name').getAttribute('aria-invalid')).toBe('true');
    expect(await store!.projects.list()).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('imports a project file, makes its project active and reports the wells imported', async () => {
    const user = userEvent.setup();
    renderFirstRun();
    await user.upload(await screen.findByLabelText('Import project file'), jsonFile(FIXTURE));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('5 wells imported'));
    expect(router.replace).toHaveBeenCalledWith('/portfolio');
    expect(localStorage.getItem(ACTIVE_PROJECT_KEY)).toBe('prj_v2_fort-saskatchewan-wabamun-hub-aor');
    expect((await store!.wells.list('prj_v2_fort-saskatchewan-wabamun-hub-aor')).length).toBe(5);
  });

  it('shows a readable message for a file that is not JSON', async () => {
    const user = userEvent.setup();
    renderFirstRun();
    await user.upload(await screen.findByLabelText('Import project file'), jsonFile('not json at all'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This file is not valid JSON.');
    expect(await store!.projects.list()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('lists every problem of a project file the store rejects', async () => {
    const user = userEvent.setup();
    renderFirstRun();
    const broken = JSON.parse(FIXTURE) as { project: { name: string; jurisdiction: string } };
    broken.project.name = '';
    broken.project.jurisdiction = 'Mars';
    await user.upload(await screen.findByLabelText('Import project file'), jsonFile(JSON.stringify(broken)));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This file was not imported');
    const items = within(alert).getAllByRole('listitem').map((li) => li.textContent);
    expect(items.some((t) => t?.startsWith('project.name'))).toBe(true);
    expect(items.some((t) => t?.startsWith('project.jurisdiction'))).toBe(true);
    expect(await store!.projects.list()).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says so when a JSON file is not a project export', async () => {
    const user = userEvent.setup();
    renderFirstRun();
    await user.upload(await screen.findByLabelText('Import project file'), jsonFile('[{"licence":"0001"}]'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not a Legacy Well Assessment export');
  });
});
