'use client';

// Wells → Import (spec §4.2). Nothing is written before the final click:
// - CSV: File → Columns (how each column of the file is read, what is not recognised, what the file
//   lacks) → Review (each row: create, update or error, with its warnings; rows with errors are
//   skipped) → "Import N wells". Wells are upserted by licence; a row's scores become a draft under
//   the importing reviewer (lib/import-plan.ts). The CSV template downloads from the first step.
// - JSON: a project export is merged as Project settings → Backup merges it (lib/backup.ts
//   importProjectFile; a file of another project imports as that project, which becomes active);
//   a bare v2 wells.json is migrated in the browser and put under the active project.
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
import {
  ColumnMappingView,
  FilePicker,
  ProjectFileView,
  StepTrail,
  V2MigrationView,
  ValidationReport,
  type Failure,
} from '@/components/import/ImportSteps';
import { ImportProblems, NOT_IMPORTED } from '@/components/projects/ImportProblems';
import { ImportResultView } from '@/components/projects/ImportResultView';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  describeExport,
  importProjectFile,
  importedDescription,
  saveWithLink,
  skippedNote,
  type ExportSummary,
  type ImportedProjectFile,
} from '@/lib/backup';
import { TEMPLATE_FILE_NAME, templateCsv } from '@/lib/csv';
import { plural } from '@/lib/format';
import {
  carryStoredFields,
  migrateV2Into,
  planCsvImport,
  readImportJson,
  runCsvImport,
  type CsvImportOutcome,
  type CsvPlan,
  type V2Migration,
} from '@/lib/import-plan';
import { useProjectId, useProjects } from '@/lib/project-context';
import { UNKNOWN_ACTOR, toError, useProfile, useStore } from '@/lib/store/provider';
import { ImportError } from '@/lib/store/store';
import { loadRegister } from '@/lib/use-register';

type Step =
  | { kind: 'pick'; failure: Failure | null }
  | { kind: 'columns'; fileName: string; plan: CsvPlan }
  | { kind: 'review'; fileName: string; plan: CsvPlan }
  | { kind: 'csv-done'; fileName: string; outcome: CsvImportOutcome }
  | { kind: 'project'; fileName: string; data: unknown; summary: ExportSummary }
  | { kind: 'v2'; fileName: string; migration: V2Migration }
  | { kind: 'json-done'; fileName: string; imported: ImportedProjectFile; legacy: boolean };

const SPREADSHEET = /\.(xlsx|xlsm|xls|ods|numbers)$/i;
const isJson = (file: File): boolean => /\.json$/i.test(file.name) || file.type === 'application/json';

/** "2 created, 0 updated" and "2 drafts saved", as the result and the toast say it. */
function csvLines(o: CsvImportOutcome): { wells: string; added: string } {
  return { wells: `${o.created} created, ${o.updated} updated`, added: `${plural(o.drafts, 'draft')} saved` };
}

function downloadTemplate() {
  saveWithLink(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }), TEMPLATE_FILE_NAME);
}

function ImportFlow({
  project,
  busy,
  setBusy,
  onDone,
}: {
  project: Project;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDone: () => void;
}) {
  const store = useStore();
  const { profile } = useProfile();
  const { projects } = useProjects();
  const [, setProjectId] = useProjectId();
  const actor = profile?.name ?? UNKNOWN_ACTOR;
  const [step, setStep] = useState<Step>({ kind: 'pick', failure: null });
  /** Why the last import click wrote nothing (or did not finish); shown above the footer. */
  const [writeFailure, setWriteFailure] = useState<Failure | null>(null);

  const go = (next: Step) => {
    setWriteFailure(null);
    setStep(next);
  };
  const failed = (message: string) => go({ kind: 'pick', failure: { message, problems: [] } });

  async function read(file: File) {
    if (SPREADSHEET.test(file.name)) {
      failed('Spreadsheet files are not read directly: save the sheet as CSV (UTF-8) and import that file.');
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      if (isJson(file)) {
        const json = readImportJson(text);
        if (json.kind === 'project') {
          go({ kind: 'project', fileName: file.name, data: json.data, summary: describeExport(json.data) });
        } else {
          let migration: V2Migration;
          try {
            migration = migrateV2Into({ wells: json.wells, project, now: new Date().toISOString(), actor });
          } catch (err) {
            failed(`This v2 wells.json could not be migrated: ${toError(err).message}`);
            return;
          }
          go({ kind: 'v2', fileName: file.name, migration });
        }
      } else {
        const result = planCsvImport(text, await loadRegister(store, project.id));
        if (result.ok) go({ kind: 'columns', fileName: file.name, plan: result.plan });
        else failed(result.message);
      }
    } catch (err) {
      failed(toError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(fileName: string, plan: CsvPlan) {
    setBusy(true);
    setWriteFailure(null);
    try {
      const outcome = await runCsvImport(store, project.id, plan);
      // The wells are written: whatever happened to the drafts, the result step says what was done.
      const lines = csvLines(outcome);
      const title = `${plural(outcome.created + outcome.updated, 'well')} imported`;
      const description = `${lines.wells}. ${lines.added}.`;
      const failed = outcome.failedDrafts.length;
      if (failed > 0) toast.warning(`${title}; ${plural(failed, 'draft')} not saved`, { description });
      else toast.success(title, { description });
      go({ kind: 'csv-done', fileName, outcome });
    } catch (err) {
      // The wells are written in one all-or-nothing step, so a failure here wrote nothing.
      setWriteFailure({ message: `Nothing was imported: ${toError(err).message}`, problems: [] });
    } finally {
      setBusy(false);
    }
  }

  /** `data` is read at the click, so a v2 file is merged with the wells as they are then. */
  async function importJson(fileName: string, data: () => Promise<unknown>, legacy: boolean) {
    setBusy(true);
    setWriteFailure(null);
    try {
      const imported = await importProjectFile(store, await data(), 'merge', project.id);
      toast.success(legacy ? 'Legacy v2 wells imported' : 'Project imported', { description: importedDescription(imported) });
      go({ kind: 'json-done', fileName, imported, legacy });
      if (imported.switchTo) setProjectId(imported.switchTo.id);
    } catch (err) {
      setWriteFailure(
        err instanceof ImportError
          ? { message: NOT_IMPORTED, problems: err.problems }
          : { message: `The file could not be imported: ${toError(err).message}`, problems: [] },
      );
    } finally {
      setBusy(false);
    }
  }

  const startOver = () => go({ kind: 'pick', failure: null });
  const anotherFile = (
    <Button type="button" variant="outline" onClick={startOver} disabled={busy}>
      Choose another file
    </Button>
  );
  const done = (
    <>
      <Button type="button" variant="outline" onClick={startOver}>
        Import another file
      </Button>
      <Button type="button" onClick={onDone}>
        Done
      </Button>
    </>
  );
  const importButton = (count: number, onClick: () => void) => (
    <Button type="button" onClick={onClick} disabled={busy || count === 0}>
      {busy ? 'Importing…' : `Import ${plural(count, 'well')}`}
    </Button>
  );

  let description: string;
  let trail: 'File' | 'Columns' | 'Review' | null = null;
  let body: ReactNode;
  let footer: ReactNode;
  switch (step.kind) {
    case 'pick':
      description = 'Add or update wells from a CSV, a project file or a v2 wells.json. Nothing is written until you confirm.';
      trail = 'File';
      body = <FilePicker busy={busy} failure={step.failure} onFile={read} onTemplate={downloadTemplate} />;
      footer = (
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
      );
      break;
    case 'columns':
      description = 'Check how each column of the file is read.';
      trail = 'Columns';
      body = <ColumnMappingView plan={step.plan} fileName={step.fileName} actor={actor} />;
      footer = (
        <>
          {anotherFile}
          <Button type="button" onClick={() => go({ kind: 'review', fileName: step.fileName, plan: step.plan })}>
            Review rows
          </Button>
        </>
      );
      break;
    case 'review':
      description = 'Check each row before importing. Rows with errors are skipped; nothing has been written yet.';
      trail = 'Review';
      body = <ValidationReport plan={step.plan} actor={actor} />;
      footer = (
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => go({ kind: 'columns', fileName: step.fileName, plan: step.plan })}
            disabled={busy}
          >
            Back
          </Button>
          {importButton(step.plan.inputs.length, () => importCsv(step.fileName, step.plan))}
        </>
      );
      break;
    case 'csv-done': {
      const lines = csvLines(step.outcome);
      const skipped = step.outcome.skippedRows;
      description =
        step.outcome.failedDrafts.length > 0
          ? 'The wells are imported, but not every draft could be saved.'
          : 'The import is complete.';
      body = (
        <ImportResultView
          fileName={step.fileName}
          wells={lines.wells}
          added={lines.added}
          warnings={[
            ...(skipped > 0 ? [`${plural(skipped, 'row')} with errors skipped`] : []),
            ...step.outcome.failedDrafts.map(
              (f) => `Draft for ${f.licence} not saved (${f.message}); the well is imported, score it on its page.`,
            ),
            ...step.outcome.warnings,
          ]}
          switchedTo={null}
        />
      );
      footer = done;
      break;
    }
    case 'project': {
      const fileProject = step.summary.projectId;
      const other =
        fileProject !== null && fileProject !== project.id
          ? ((projects ?? []).find((p) => p.id === fileProject)?.name ?? step.summary.projectName ?? fileProject)
          : null;
      description = 'A project file exported from this app.';
      body = <ProjectFileView fileName={step.fileName} summary={step.summary} otherProjectName={other} />;
      footer = (
        <>
          {anotherFile}
          {importButton(step.summary.wells ?? 0, () => importJson(step.fileName, async () => step.data, false))}
        </>
      );
      break;
    }
    case 'v2':
      description = 'A v2 register file (wells.json).';
      body = <V2MigrationView fileName={step.fileName} migration={step.migration} projectName={project.name} />;
      footer = (
        <>
          {anotherFile}
          {importButton(step.migration.export.wells.length, () =>
            importJson(
              step.fileName,
              // v3-only fields (name, TD, construction) of wells already here are kept (lib/import-plan.ts).
              async () => carryStoredFields(step.migration.export, await store.wells.list(project.id)),
              true,
            ),
          )}
        </>
      );
      break;
    case 'json-done': {
      const note = skippedNote(step.imported.result);
      description = 'The import is complete.';
      body = (
        <ImportResultView
          fileName={step.fileName}
          wells={step.imported.wells}
          added={step.imported.added}
          warnings={[
            ...step.imported.result.warnings,
            ...(note === null ? [] : [note]),
          ]}
          switchedTo={step.imported.switchTo?.name ?? null}
          notice={step.legacy ? 'Legacy v2 format — migrated' : undefined}
        />
      );
      footer = done;
      break;
    }
  }

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Import wells</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {trail ? <StepTrail current={trail} /> : null}
      </DialogHeader>
      <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4" aria-busy={busy}>
        {body}
      </div>
      {writeFailure ? <ImportProblems message={writeFailure.message} problems={writeFailure.problems} /> : null}
      <DialogFooter>{footer}</DialogFooter>
    </>
  );
}

export function ImportDialog({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active project: CSV rows and a v2 wells.json go into it. */
  project: Project;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return; // an import in progress finishes first
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-3xl">
        {/* Mounted only while open, so every import starts from the file picker. */}
        {open ? <ImportFlow project={project} busy={busy} setBusy={setBusy} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
