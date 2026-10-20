'use client';

// Creates a project from a name; every other project field starts at its default and is edited in
// Project settings. Used by the first-run screen and the project switcher's "New project…" dialog.
import { useId, useState, type FormEvent } from 'react';
import type { Project } from '@lwa/engine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toError, useStore } from '@/lib/store/provider';
import { cn } from '@/lib/utils';

export function CreateProjectForm({
  onCreated,
  autoFocus = false,
  className,
}: {
  onCreated: (project: Project) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const store = useStore();
  const id = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a project name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await store.projects.create({ name: trimmed }));
    } catch (err) {
      setError(toError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const describedBy = error ? `${id}-error` : `${id}-hint`;
  return (
    <form onSubmit={submit} noValidate className={cn('grid gap-3', className)}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>Project name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {error ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            Usually the area of review, e.g. “Fort Saskatchewan / Wabamun Hub AOR”.
          </p>
        )}
      </div>
      <Button type="submit" disabled={busy}>
        Create project
      </Button>
    </form>
  );
}
