'use client';

// Deleting the selected wells at once. Guarded like a single delete, but the typed confirmation is
// the number of wells, and the button names it ("Delete 3 wells"). Wells are removed one by one;
// if one fails, the ones already gone are reported and the rest stay selected.
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DeletableWell } from '@/components/wells/DeleteWellDialog';
import { plural } from '@/lib/format';
import { toError, useStore, useStoreQuery } from '@/lib/store/provider';

/** Licences listed by name before the rest are summarised. */
const LISTED = 6;

function BulkDeleteForm({
  wells,
  onDeleted,
  onDone,
  onCancel,
}: {
  wells: readonly DeletableWell[];
  onDeleted: (ids: string[]) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const id = useId();
  const count = wells.length;
  const key = wells.map((w) => w.id).join('|');
  const assessments = useStoreQuery(
    async (s) => (await Promise.all(wells.map((w) => s.assessments.listForWell(w.id)))).reduce((n, a) => n + a.length, 0),
    [key], // `key` stands for the list of wells
  );
  // The total as first read: the deletes change the store, and the text must not change under the button.
  const [n, setN] = useState<number | undefined>(undefined);
  if (n === undefined && assessments.data !== undefined) setN(assessments.data);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim() === String(count);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    const deleted: string[] = [];
    try {
      for (const w of wells) {
        await store.wells.remove(w.id);
        deleted.push(w.id);
      }
    } catch (err) {
      onDeleted(deleted);
      setError(`${plural(deleted.length, 'well')} of ${count} deleted, then: ${toError(err).message}`);
      setBusy(false);
      return;
    }
    onDeleted(deleted);
    toast.success(`${plural(count, 'well')} deleted`);
    onDone();
  }

  const listed = wells.slice(0, LISTED);
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Delete {plural(count, 'well')}?</DialogTitle>
        <DialogDescription>
          {n === undefined
            ? `This deletes ${plural(count, 'well record')} and their assessments.`
            : `This deletes ${plural(count, 'well record')} and ${plural(n, 'assessment')}.`}{' '}
          This cannot be undone; the project history keeps a record of what was deleted.
        </DialogDescription>
      </DialogHeader>
      <ul className="grid gap-0.5 rounded-md border bg-subtle px-3 py-2 font-mono text-xs">
        {listed.map((w) => (
          <li key={w.id} className="truncate">
            {w.licence}
          </li>
        ))}
        {count > listed.length ? (
          <li className="font-sans text-muted-foreground">…and {count - listed.length} more</li>
        ) : null}
      </ul>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Type {count} to confirm</Label>
        <Input
          id={`${id}-confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          className="num w-24"
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={!confirmed || busy}>
          Delete {plural(count, 'well')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BulkDeleteDialog({
  wells,
  open,
  onOpenChange,
  onDeleted,
}: {
  wells: readonly DeletableWell[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The ids actually deleted (all of them, or those removed before a failure). */
  onDeleted: (ids: string[]) => void;
}) {
  return (
    <Dialog open={open && wells.length > 0} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        {wells.length > 0 ? (
          <BulkDeleteForm
            wells={wells}
            onDeleted={onDeleted}
            onCancel={() => onOpenChange(false)}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
