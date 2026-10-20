import { useEffect, useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import { createLocalStore } from '@/lib/store/local-store';
import { StoreProvider, useStore } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

afterEach(cleanup);

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

/** Renders the dialog open, in a fresh store; `seed` runs on the database first. */
async function renderDialog(props: { required?: boolean; seed?: (s: Store) => Promise<void> } = {}) {
  dbCount += 1;
  const dbName = `lwa-profile-test-${dbCount}`;
  if (props.seed) await props.seed(createLocalStore({ dbName, actor: () => 'seed' }));
  const onSaved = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <StoreProbe />
        <p>{open ? 'dialog open' : 'dialog closed'}</p>
        <ProfileDialog open={open} onOpenChange={setOpen} required={props.required} onSaved={onSaved} />
      </>
    );
  }
  render(
    <StoreProvider createStore={(actor) => createLocalStore({ dbName, actor })}>
      <Harness />
    </StoreProvider>,
  );
  await screen.findByRole('dialog');
  return { onSaved };
}

describe('ProfileDialog', () => {
  it('saves a valid profile, trimmed, and closes', async () => {
    const user = userEvent.setup();
    const { onSaved } = await renderDialog({ required: true });
    await user.type(screen.getByLabelText('Your name'), 'T. Chisti ');
    await user.type(screen.getByLabelText('Initials'), 'tc');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(await store!.profile.get()).toEqual({ name: 'T. Chisti', initials: 'TC' });
    expect(screen.getByText('dialog closed')).toBeTruthy();
  });

  it('shows an error next to each invalid field and saves nothing', async () => {
    const user = userEvent.setup();
    const { onSaved } = await renderDialog({ required: true });
    await user.type(screen.getByLabelText('Your name'), 'T');
    await user.type(screen.getByLabelText('Initials'), 'T');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const name = screen.getByLabelText('Your name');
    const initials = screen.getByLabelText('Initials');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(initials.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toBe(
      'Enter at least 2 characters.',
    );
    expect(document.getElementById(initials.getAttribute('aria-describedby')!.split(' ').at(-1)!)?.textContent).toBe(
      'Use 2 or 3 letters.',
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(await store!.profile.get()).toBeNull();
  });

  it('cannot be dismissed while a profile is required', async () => {
    const user = userEvent.setup();
    await renderDialog({ required: true });
    expect(screen.queryByRole('button', { name: /close|cancel/i })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('dialog open')).toBeTruthy();
  });

  it('edits the current profile and can be cancelled', async () => {
    const user = userEvent.setup();
    await renderDialog({ seed: (s) => s.profile.set({ name: 'R. Reviewer', initials: 'RR' }) });
    await waitFor(() => expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('R. Reviewer'));
    expect((screen.getByLabelText('Initials') as HTMLInputElement).value).toBe('RR');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('dialog closed')).toBeTruthy();
  });
});
