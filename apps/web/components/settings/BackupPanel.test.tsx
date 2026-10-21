import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@lwa/engine';
import { BackupPanel } from '@/components/settings/BackupPanel';
import { ProjectProvider } from '@/lib/project-context';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider } from '@/lib/store/provider';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

const FIXTURE_TEXT = readFileSync(join(__dirname, '..', '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8');
const PROJECT_ID = 'prj_v2_fort-saskatchewan-wabamun-hub-aor';

afterEach(cleanup);

let dbCount = 0;
/**
 * The fixture project stored with one extra well the fixture file does not have (so Replace would
 * delete it), and the panel rendered for that project.
 */
async function renderPanel(): Promise<void> {
  dbCount += 1;
  const dbName = `lwa-backup-panel-test-${dbCount}`;
  const seed = createLocalStore({ dbName, actor: () => 'seed' });
  await seed.importProject(JSON.parse(FIXTURE_TEXT), 'merge');
  await seed.wells.create(PROJECT_ID, { licence: '102/16-30-055-21W4/00' });
  const project = (await seed.projects.get(PROJECT_ID)) as Project;
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <ProjectProvider>
        <BackupPanel project={project} />
      </ProjectProvider>
    </StoreProvider>,
  );
}

async function pickFixture(): Promise<void> {
  const file = new File([FIXTURE_TEXT], 'fort-sask.lwa.json', { type: 'application/json' });
  await userEvent.upload(await screen.findByLabelText('Import project file'), file);
  await screen.findByRole('radio', { name: /^Merge/ });
}

const preview = () => document.querySelector<HTMLElement>('[data-replace-preview]');

describe('BackupPanel: the Replace preview', () => {
  it('is a live region that exists, empty, before Replace is chosen, and gains the deletion count after', async () => {
    await renderPanel();
    await pickFixture();

    // Merge (the default): the status region is already in the page, with no text, and Import is not described by it.
    const region = preview();
    expect(region).not.toBeNull();
    expect(region!.getAttribute('role')).toBe('status');
    expect(region!.textContent).toBe('');
    const importButton = screen.getByRole('button', { name: 'Import' });
    expect(importButton.hasAttribute('aria-describedby')).toBe(false);

    await userEvent.click(screen.getByRole('radio', { name: /^Replace/ }));

    // The same element (not a new one) now says what Replace would delete.
    await waitFor(() => expect(region!.textContent).toBe('1 well will be deleted.'));
    expect(preview()).toBe(region);
    expect(importButton.getAttribute('aria-describedby')).toBe(region!.id);

    // Back to Merge: the region stays, emptied.
    await userEvent.click(screen.getByRole('radio', { name: /^Merge/ }));
    expect(preview()).toBe(region);
    expect(region!.textContent).toBe('');
    expect(importButton.hasAttribute('aria-describedby')).toBe(false);
  });
});
