'use client';

// Imports a project export (merge mode) from a file the user picks. The file is checked for being a
// project export first (lib/backup.ts); the store then validates it in full and writes nothing when
// anything is wrong, and every problem it found is listed here.
import { useId, useState, type ChangeEvent } from 'react';
import { UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button';
import { exportProjectId, readExportFile } from '@/lib/backup';
import { toError, useStore } from '@/lib/store/provider';
import { ImportError } from '@/lib/store/store';
import { cn } from '@/lib/utils';

/** Problems listed before the rest are summarised as "…and N more". */
const MAX_PROBLEMS = 12;

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'failed'; message: string; problems: string[] };

export function ImportProjectFile({ onImported }: { onImported: (projectId: string) => void }) {
  const store = useStore();
  const id = useId();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again (after fixing it) fires a change
    if (!file) return;
    setState({ kind: 'busy' });
    try {
      const data = await readExportFile(file);
      const result = await store.importProject(data, 'merge');
      const wells = result.wells.created + result.wells.updated;
      setState({ kind: 'idle' });
      const message = `${wells} ${wells === 1 ? 'well' : 'wells'} imported`;
      if (result.warnings.length > 0) toast.success(message, { description: result.warnings.join(' ') });
      else toast.success(message);
      const projectId = exportProjectId(data);
      if (projectId) onImported(projectId);
    } catch (err) {
      setState(
        err instanceof ImportError
          ? { kind: 'failed', message: 'This file was not imported. Nothing was changed. Problems found:', problems: err.problems }
          : { kind: 'failed', message: toError(err).message, problems: [] },
      );
    }
  }

  const busy = state.kind === 'busy';
  const shown = state.kind === 'failed' ? state.problems.slice(0, MAX_PROBLEMS) : [];
  const hidden = state.kind === 'failed' ? state.problems.length - shown.length : 0;
  return (
    <div className="grid gap-1.5">
      <input
        id={`${id}-file`}
        type="file"
        accept=".json,application/json"
        className="peer sr-only"
        onChange={onChange}
        disabled={busy}
        aria-describedby={state.kind === 'failed' ? `${id}-error` : `${id}-hint`}
      />
      <label
        htmlFor={`${id}-file`}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'w-full cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:cursor-wait peer-disabled:opacity-60',
        )}
      >
        <UploadIcon aria-hidden="true" />
        {busy ? 'Importing…' : 'Import project file'}
      </label>
      {state.kind === 'failed' ? (
        <div id={`${id}-error`} role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
          <p className="font-medium text-destructive">{state.message}</p>
          {shown.length > 0 ? (
            <ul className="mt-1.5 grid list-disc gap-0.5 pl-4 font-mono text-[11px] text-ink">
              {shown.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          ) : null}
          {hidden > 0 ? <p className="mt-1 text-muted-foreground">…and {hidden} more.</p> : null}
        </div>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          A .json project file exported from this app, or made by the v2 migration.
        </p>
      )}
    </div>
  );
}
