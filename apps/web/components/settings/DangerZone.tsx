'use client';

// Deleting the project (spec §4.7 "danger zone, two-step"): the dialog says what goes (the project,
// its N wells, their assessments and history) and "Delete project" stays disabled until the
// project's name is typed exactly. Afterwards the earliest remaining project becomes active and
// the app opens on its Portfolio; with none left, the first-run screen shows.
import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
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
import { useProjectId, useProjects } from '@/lib/project-context';
import { ROUTES } from '@/lib/routes';
import { toError, useStore, useStoreQuery } from '@/lib/store/provider';

export function DangerZone({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-surface px-4 py-3">
      <div className="grid min-w-0 gap-0.5">
        <p className="font-medium">Delete this project</p>
        <p className="text-muted-foreground">
          Removes the project, its wells, their assessments and history from this browser. It cannot be undone.
        </p>
      </div>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden="true" />
        Delete project…
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent role="alertdialog" className="sm:max-w-md">
          {/* Mounted only while open, so the typed confirmation starts empty every time. */}
          {open ? <DeleteProjectForm project={project} onCancel={() => setOpen(false)} onDeleted={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeleteProjectForm({
  project,
  onCancel,
  onDeleted,
}: {
  project: Project;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const store = useStore();
  const router = useRouter();
  const id = useId();
  const { projects } = useProjects();
  const [, setProjectId] = useProjectId();
  const wells = useStoreQuery((s) => s.wells.list(project.id), [project.id]);
  // The count as first read: the delete itself changes the store, and the text must not change under the button.
  const [n, setN] = useState<number | undefined>(undefined);
  if (n === undefined && wells.data) setN(wells.data.length);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed === project.name;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    const next = (projects ?? []).find((p) => p.id !== project.id) ?? null; // oldest first
    try {
      await store.projects.remove(project.id);
    } catch (err) {
      setError(toError(err).message);
      setBusy(false);
      return;
    }
    toast.success(`Project “${project.name}” deleted`);
    onDeleted();
    if (next) setProjectId(next.id);
    router.push(ROUTES.portfolio);
  }

  const what =
    n === undefined
      ? 'This deletes the project, its wells, their assessments and history.'
      : n === 0
        ? 'This deletes the project and its history. It has no wells.'
        : `This deletes the project, its ${plural(n, 'well')}, their assessments and history.`;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Delete project?</DialogTitle>
        <DialogDescription className="text-ink">{project.name}</DialogDescription>
      </DialogHeader>
      <p>
        {what} It cannot be undone. Export the project first if you may need it again.
      </p>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-confirm`}>Type the project name to confirm</Label>
        <Input
          id={`${id}-confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Exactly as shown above.
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
          Delete project
        </Button>
      </DialogFooter>
    </form>
  );
}
