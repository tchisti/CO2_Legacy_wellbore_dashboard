'use client';

// Deleting a well is guarded (spec §4.2 "two-step confirm"): the dialog says what goes (the well
// and its N assessments) and "Delete well" stays disabled until the licence is typed exactly as
// stored. The store keeps both in the deletion's audit event.
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
import { plural } from '@/lib/format';
import { toError, useStore, useStoreQuery } from '@/lib/store/provider';

export type DeletableWell = { id: string; licence: string; name?: string };

function DeleteWellForm({
  well,
  onDone,
  onCancel,
}: {
  well: DeletableWell;
  onDone: () => void;
  onCancel: () => void;
}) {
  const store = useStore();
  const id = useId();
  const assessments = useStoreQuery((s) => s.assessments.listForWell(well.id), [well.id]);
  // The count as first read: the delete itself changes the store, and the text must not change under the button.
  const [n, setN] = useState<number | undefined>(undefined);
  if (n === undefined && assessments.data) setN(assessments.data.length);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed === well.licence;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await store.wells.remove(well.id);
      toast.success(`Well ${well.licence} deleted`);
      onDone();
    } catch (err) {
      setError(toError(err).message);
      setBusy(false);
    }
  }

  const what =
    n === undefined
      ? 'This deletes the well record and its assessments.'
      : n === 0
        ? 'This deletes the well record. It has no assessments.'
        : `This deletes the well record and its ${plural(n, 'assessment')}.`;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Delete well?</DialogTitle>
        <DialogDescription>
          <span className="num text-ink">{well.licence}</span>
          {well.name ? ` · ${well.name}` : null}
        </DialogDescription>
      </DialogHeader>
      <p>
        {what} This cannot be undone; the project history keeps a record of what was deleted.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Type the licence to confirm</Label>
        <Input
          id={`${id}-confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="font-mono"
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Exactly as shown above, including slashes.
        </p>
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
          Delete well
        </Button>
      </DialogFooter>
    </form>
  );
}

export function DeleteWellDialog({
  well,
  open,
  onOpenChange,
  onDeleted,
}: {
  well: DeletableWell | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  return (
    <Dialog open={open && well !== null} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        {/* Mounted only while open, so the typed confirmation starts empty every time. */}
        {well ? (
          <DeleteWellForm
            well={well}
            onCancel={() => onOpenChange(false)}
            onDone={() => {
              onDeleted?.();
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
