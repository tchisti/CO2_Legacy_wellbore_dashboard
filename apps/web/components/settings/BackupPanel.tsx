'use client';

// Backup (spec §6.1, §9, §10): Phase 1 has no backend, so a project file is the only backup and
// the only way to hand a project to someone else. Export downloads the whole project as one
// `.lwa.json` file (lib/backup.ts). Import reads a picked file, says what it holds (and whether it
// is another project), and imports it only once the reviewer has chosen how:
// - Merge (the default) adds new wells and history and updates matching wells by licence;
// - Replace makes the file the project, deleting wells and assessments the file does not have
//   (finals included). Before Import is enabled it says exactly what would go, and it needs the
//   project's name typed; the result reports what the store deleted.
// The store validates the file in full and writes nothing when anything is wrong (ImportError);
// every problem is listed. A file of another project is imported as that project, which then
// becomes the active one.
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { DownloadIcon, FileJsonIcon, InfoIcon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
import { ImportProblems, NOT_IMPORTED } from '@/components/projects/ImportProblems';
import { ImportResultView } from '@/components/projects/ImportResultView';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  describeExport,
  downloadExport,
  exportFacts,
  importProjectFile,
  importedDescription,
  readExportFile,
  replaceDeletions,
  replacePreviewText,
  type ExportSummary,
} from '@/lib/backup';
import { useProjectId, useProjects } from '@/lib/project-context';
import { toError, useStore, useStoreQuery } from '@/lib/store/provider';
import { ImportError, type ImportMode } from '@/lib/store/store';
import { cn } from '@/lib/utils';

type Picked = { fileName: string; data: unknown; summary: ExportSummary; seq: number };

type Outcome =
  | { kind: 'imported'; fileName: string; wells: string; added: string; warnings: string[]; switchedTo: string | null }
  | { kind: 'failed'; message: string; problems: string[] };

export function BackupPanel({ project }: { project: Project }) {
  const store = useStore();
  const id = useId();
  const { projects } = useProjects();
  const [, setProjectId] = useProjectId();
  const [exporting, setExporting] = useState(false);
  /** The last export's file name or failure, shown only while its project is the active one. */
  const [exported, setExported] = useState<({ filename: string } | { error: string }) & { projectId: string } | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const picks = useRef(0);

  async function exportNow() {
    setExporting(true);
    setExported(null);
    try {
      const { filename } = await downloadExport(store, project.id);
      setExported({ filename, projectId: project.id });
    } catch (err) {
      setExported({ error: `The project could not be exported: ${toError(err).message}`, projectId: project.id });
    } finally {
      setExporting(false);
    }
  }

  const lastExport = exported?.projectId === project.id ? exported : null;

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // so picking the same file again (after fixing it) fires a change
    if (!file) return;
    setBusy('reading');
    setOutcome(null);
    setPicked(null);
    try {
      const data = await readExportFile(file);
      picks.current += 1;
      setPicked({ fileName: file.name, data, summary: describeExport(data), seq: picks.current });
    } catch (err) {
      setOutcome({ kind: 'failed', message: toError(err).message, problems: [] });
    } finally {
      setBusy(null);
    }
  }

  async function runImport(file: Picked, mode: ImportMode) {
    setBusy('importing');
    try {
      const imported = await importProjectFile(store, file.data, mode, project.id);
      toast.success('Project imported', { description: importedDescription(imported) });
      setPicked(null);
      setOutcome({
        kind: 'imported',
        fileName: file.fileName,
        wells: imported.wells,
        added: imported.added,
        warnings: imported.result.warnings,
        switchedTo: imported.switchTo?.name ?? null,
      });
      if (imported.switchTo) setProjectId(imported.switchTo.id);
    } catch (err) {
      setPicked(null);
      setOutcome(
        err instanceof ImportError
          ? { kind: 'failed', message: NOT_IMPORTED, problems: err.problems }
          : { kind: 'failed', message: `The file could not be imported: ${toError(err).message}`, problems: [] },
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid rounded-lg border bg-surface">
      <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Export</h3>
          <p className="text-muted-foreground">
            Downloads the whole project as one <span className="num text-ink">.lwa.json</span> file: every well,
            assessment and history event. Keep it as a backup, or give it to a colleague to import in their browser.
          </p>
          {lastExport && 'filename' in lastExport ? (
            <p role="status" className="text-xs text-muted-foreground">
              Downloaded <span className="num text-ink">{lastExport.filename}</span>
            </p>
          ) : null}
          {lastExport && 'error' in lastExport ? (
            <p role="alert" className="text-xs text-destructive">
              {lastExport.error}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={exportNow} disabled={exporting} className="justify-self-start">
          <DownloadIcon aria-hidden="true" />
          {exporting ? 'Exporting…' : 'Export project'}
        </Button>
      </div>

      <div className="grid gap-3 border-t p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">Import</h3>
            <p className="text-muted-foreground">
              Restore a backup, or take in a colleague’s export. Nothing is written until you have chosen how to import
              the file.
            </p>
          </div>
          <div className="justify-self-start">
            <input
              id={`${id}-file`}
              type="file"
              accept=".json,application/json"
              className="peer sr-only"
              onChange={pick}
              disabled={busy !== null}
            />
            <label
              htmlFor={`${id}-file`}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:cursor-wait peer-disabled:opacity-60',
              )}
            >
              <UploadIcon aria-hidden="true" />
              {busy === 'reading' ? 'Reading…' : 'Import project file'}
            </label>
          </div>
        </div>

        {picked ? (
          <ImportReview
            key={picked.seq}
            picked={picked}
            activeProjectId={project.id}
            projects={projects ?? []}
            busy={busy === 'importing'}
            onCancel={() => setPicked(null)}
            onImport={(mode) => runImport(picked, mode)}
          />
        ) : null}
        {outcome?.kind === 'failed' ? <ImportProblems message={outcome.message} problems={outcome.problems} /> : null}
        {outcome?.kind === 'imported' ? (
          <ImportResultView
            fileName={outcome.fileName}
            wells={outcome.wells}
            added={outcome.added}
            warnings={outcome.warnings}
            switchedTo={outcome.switchedTo}
            onDismiss={() => setOutcome(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** What a picked file holds, and how to import it. Mounted per file, so every choice starts over. */
function ImportReview({
  picked,
  activeProjectId,
  projects,
  busy,
  onCancel,
  onImport,
}: {
  picked: Picked;
  activeProjectId: string;
  projects: readonly Project[];
  busy: boolean;
  onCancel: () => void;
  onImport: (mode: ImportMode) => void;
}) {
  const id = useId();
  const { fileName, summary } = picked;
  const [mode, setMode] = useState<ImportMode>('merge');
  const [typed, setTyped] = useState('');
  /** The stored project the file imports into, when this browser has it. */
  const target = projects.find((p) => p.id === summary.projectId) ?? null;
  const otherProject = summary.projectId !== null && summary.projectId !== activeProjectId;
  const confirmName = target?.name ?? summary.projectName ?? '';

  // What Replace would delete: the stored project against the file (none when this browser lacks it).
  const stored = useStoreQuery(
    async (s) => {
      if (!target) return { wells: [], assessments: [] };
      const wells = await s.wells.list(target.id);
      const assessments = (await Promise.all(wells.map((w) => s.assessments.listForWell(w.id)))).flat();
      return { wells, assessments };
    },
    [target?.id],
  );
  const deletions = stored.data ? replaceDeletions(stored.data, summary) : null;
  const deletes = deletions !== null && deletions.wells + deletions.assessments > 0;
  // Replace is enabled only once its preview is shown and the name is typed exactly.
  const confirmed = mode === 'merge' || (deletions !== null && confirmName !== '' && typed === confirmName);

  const facts = exportFacts(summary);

  function choose(next: ImportMode) {
    setMode(next);
    setTyped(''); // leaving Replace drops the confirmation; coming back asks again
  }

  const option = (value: ImportMode, title: string, description: string) => (
    <label
      className={cn(
        'flex cursor-pointer gap-2.5 rounded-md border bg-surface px-3 py-2.5',
        mode === value && 'border-primary ring-1 ring-primary',
      )}
    >
      <input
        type="radio"
        name={`${id}-mode`}
        value={value}
        checked={mode === value}
        onChange={() => choose(value)}
        disabled={busy}
        aria-labelledby={`${id}-${value}`}
        aria-describedby={`${id}-${value}-desc`}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="grid gap-0.5">
        <span id={`${id}-${value}`} className="font-medium">
          {title}
        </span>
        <span id={`${id}-${value}-desc`} className="text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );

  return (
    <div role="group" aria-labelledby={`${id}-file`} className="grid gap-3 rounded-md border bg-subtle/60 p-3">
      <div className="grid gap-0.5">
        <p id={`${id}-file`} className="flex min-w-0 items-center gap-1.5 font-medium">
          <FileJsonIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="num truncate">{fileName}</span>
        </p>
        {facts.length > 0 ? <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p> : null}
      </div>

      {otherProject ? (
        <p className="flex gap-2 rounded-md border bg-surface px-3 py-2 text-xs">
          <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          <span>
            This file holds another project: {summary.projectName ?? summary.projectId}. Importing adds or updates that
            project.
          </span>
        </p>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">How to import</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {option('merge', 'Merge', 'Adds new wells and history, updates matching wells by licence.')}
          {option(
            'replace',
            'Replace',
            'The file becomes the project: wells and assessments not in the file, finals included, are deleted. The history is kept.',
          )}
        </div>
      </fieldset>

      {mode === 'replace' ? (
        <div className="grid gap-2">
          {/* A live region: the count arrives after the store is read, and screen readers hear it. The
              Import button points at it, so it is read again when the button is focused. */}
          <p
            id={`${id}-preview`}
            role="status"
            data-replace-preview
            className={cn('text-xs', deletes || stored.error ? 'text-destructive' : 'text-muted-foreground')}
          >
            {deletions
              ? replacePreviewText(deletions)
              : stored.error
                ? `What Replace would delete could not be worked out: ${stored.error.message}`
                : 'Working out what Replace would delete…'}
          </p>
          <div className="grid max-w-sm gap-1.5">
            <Label htmlFor={`${id}-confirm`}>Type the project name to confirm</Label>
            <Input
              id={`${id}-confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              aria-describedby={`${id}-confirm-hint`}
            />
            <p id={`${id}-confirm-hint`} className="text-xs text-muted-foreground">
              Type “<span className="text-ink">{confirmName}</span>” exactly.
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={mode === 'replace' ? 'destructive' : 'default'}
          disabled={!confirmed || busy}
          aria-describedby={mode === 'replace' ? `${id}-preview` : undefined}
          onClick={() => onImport(mode)}
        >
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </div>
  );
}
