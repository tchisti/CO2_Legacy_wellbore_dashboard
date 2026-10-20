import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect, useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteWellDialog } from '@/components/wells/DeleteWellDialog';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider, useStore } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '..', '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8')) as unknown;
const WELL = { id: 'wel_v2_W-4A62O7', licence: '100/07-21-055-22W4/00' };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

let dbCount = 0;
let store: Store | null = null;
function StoreProbe() {
  const s = useStore();
  useEffect(() => {
    store = s;
  }, [s]);
  return null;
}

async function renderDialog(well: { id: string; licence: string } = WELL) {
  dbCount += 1;
  const dbName = `lwa-delete-well-test-${dbCount}`;
  await createLocalStore({ dbName, actor: () => 'seed' }).importProject(FIXTURE, 'merge');
  const onDeleted = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <StoreProbe />
        <p>{open ? 'dialog open' : 'dialog closed'}</p>
        <button type="button" onClick={() => setOpen(true)}>
          reopen
        </button>
        <DeleteWellDialog well={well} open={open} onOpenChange={setOpen} onDeleted={onDeleted} />
      </>
    );
  }
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <Harness />
    </StoreProvider>,
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete well?' });
  return { dialog, onDeleted };
}

const confirmButton = () => screen.getByRole('button', { name: 'Delete well' }) as HTMLButtonElement;
const licenceInput = () => screen.getByLabelText(/Type the licence/);

describe('DeleteWellDialog', () => {
  it('says what will be deleted: the well and its assessments', async () => {
    const { dialog } = await renderDialog();
    expect(dialog.textContent).toContain('100/07-21-055-22W4/00');
    await waitFor(() => expect(dialog.textContent).toContain('its 1 assessment'));
  });

  it('keeps "Delete well" disabled until the licence is typed exactly as stored', async () => {
    const user = userEvent.setup();
    await renderDialog();
    expect(confirmButton().disabled).toBe(true);

    await user.type(licenceInput(), '100/07-21-055-22W4');
    expect(confirmButton().disabled).toBe(true);
    await user.clear(licenceInput());
    await user.type(licenceInput(), '100/07-21-055-22w4/00'); // case differs
    expect(confirmButton().disabled).toBe(true);
    await user.clear(licenceInput());
    await user.type(licenceInput(), ' 100/07-21-055-22W4/00'); // extra space
    expect(confirmButton().disabled).toBe(true);

    await user.clear(licenceInput());
    await user.type(licenceInput(), '100/07-21-055-22W4/00');
    expect(confirmButton().disabled).toBe(false);
  });

  it('does not delete when the disabled button is clicked', async () => {
    const user = userEvent.setup();
    const { onDeleted } = await renderDialog();
    await user.click(confirmButton());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(await store!.wells.get(WELL.id)).not.toBeNull();
  });

  it('deletes the well and its assessments once confirmed, then closes', async () => {
    const user = userEvent.setup();
    const { onDeleted } = await renderDialog();
    await user.type(licenceInput(), WELL.licence);
    await user.click(confirmButton());

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(await store!.wells.get(WELL.id)).toBeNull();
    expect(await store!.assessments.listForWell(WELL.id)).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith('Well 100/07-21-055-22W4/00 deleted');
    expect(await screen.findByText('dialog closed')).toBeTruthy();
  });

  it('starts empty again when reopened', async () => {
    const user = userEvent.setup();
    await renderDialog();
    await user.type(licenceInput(), WELL.licence);
    await user.keyboard('{Escape}');
    expect(await screen.findByText('dialog closed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'reopen' }));
    await screen.findByRole('alertdialog', { name: 'Delete well?' });
    expect((licenceInput() as HTMLInputElement).value).toBe('');
    expect(confirmButton().disabled).toBe(true);
  });
});
