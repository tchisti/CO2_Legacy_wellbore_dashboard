'use client';

// The bodies of the Import dialog's steps (components/import/ImportDialog.tsx owns the flow):
// the file picker, the CSV column mapping, the CSV validation report, and the reviews of a project
// file and of a migrated v2 wells.json. Presentational: everything shown comes from lib/csv.ts,
// lib/import-plan.ts and lib/backup.ts.
import { useId, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import {
  CircleAlertIcon,
  DownloadIcon,
  FileJsonIcon,
  InfoIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UploadIcon,
  type LucideIcon,
} from 'lucide-react';
import { DEFAULT_METHODOLOGY } from '@lwa/engine';
import { ImportProblems } from '@/components/projects/ImportProblems';
import { Button, buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { exportFacts, type ExportSummary } from '@/lib/backup';
import {
  CSV_FIELD_LABELS,
  describeColumns,
  missingColumns,
  type CsvColumn,
  type CsvColumnKey,
  type RowStatus,
} from '@/lib/csv';
import { plural } from '@/lib/format';
import { parityText, type CsvPlan, type PlannedRow, type V2Migration } from '@/lib/import-plan';
import { cn } from '@/lib/utils';

export type Failure = { message: string; problems: string[] };

/* ---------- shared bits ---------- */

/** A quiet boxed note with an icon. */
export function Notice({ icon: Icon = InfoIcon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-2 rounded-md border bg-subtle/60 px-3 py-2 text-xs', className)}>
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-muted-foreground" />
      <div className="grid min-w-0 gap-1">{children}</div>
    </div>
  );
}

const CSV_STEPS = ['File', 'Columns', 'Review'] as const;

/** Where the CSV import is: File → Columns → Review. */
export function StepTrail({ current }: { current: (typeof CSV_STEPS)[number] }) {
  const at = CSV_STEPS.indexOf(current);
  return (
    <ol aria-label="Import steps" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      {CSV_STEPS.map((label, i) => (
        <li key={label} aria-current={i === at ? 'step' : undefined} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true">→</span> : null}
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5',
              i === at ? 'bg-subtle font-medium text-ink' : i < at ? 'text-ink' : '',
            )}
          >
            <span className="num">{i + 1}</span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- picking a file ---------- */

export function FilePicker({
  busy,
  failure,
  onFile,
  onTemplate,
}: {
  busy: boolean;
  failure: Failure | null;
  onFile: (file: File) => void;
  onTemplate: () => void;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);

  function change(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // picking the same file again (after fixing it) fires a change
    if (file) onFile(file);
  }

  function drop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  }

  return (
    <div className="grid gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={cn(
          'grid justify-items-center gap-2 rounded-lg border border-dashed border-line-strong bg-subtle/40 px-4 py-8 text-center',
          dragging && 'border-primary bg-subtle',
        )}
      >
        <UploadIcon aria-hidden="true" className="size-5 text-muted-foreground" />
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="peer sr-only"
          onChange={change}
          disabled={busy}
          aria-describedby={`${id}-hint`}
        />
        <label
          htmlFor={`${id}-file`}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'cursor-pointer peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:cursor-wait peer-disabled:opacity-60',
          )}
        >
          {busy ? 'Reading…' : 'Choose a file…'}
        </label>
        <p id={`${id}-hint`} className="max-w-sm text-xs text-muted-foreground">
          or drop it here. A <span className="num text-ink">.csv</span> in the template’s columns, a project file (
          <span className="num text-ink">.lwa.json</span>) or a v2 <span className="num text-ink">wells.json</span>.
        </p>
      </div>
      {failure ? <ImportProblems message={failure.message} problems={failure.problems} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Starting a list? The template has every column and two sample rows.</span>
        <Button type="button" variant="link" size="sm" onClick={onTemplate} className="h-auto px-0">
          <DownloadIcon aria-hidden="true" />
          Download CSV template
        </Button>
      </div>
    </div>
  );
}

/* ---------- CSV: columns ---------- */

const FIELD_OF: Partial<Record<CsvColumnKey, keyof typeof CSV_FIELD_LABELS>> = {
  operator: 'operator',
  lat: 'lat',
  lon: 'lon',
  year: 'spudYear',
  type: 'type',
  traj: 'trajectory',
  status: 'status',
  klass: 'classification',
  notes: 'notes',
};

/** A score column's parameter name: the template header without "(1-5 or ?)". */
const scoreName = (c: CsvColumn): string => c.hdr.replace(/\s*\(1-5 or \?\)$/, '');

function importedAs(c: CsvColumn): string {
  if (c.key === 'licence') return 'Licence (matches existing wells)';
  if (c.score) return `Score: ${scoreName(c)} → draft`;
  const field = FIELD_OF[c.key];
  return field ? CSV_FIELD_LABELS[field] : 'Not imported';
}

export function ColumnMappingView({ plan, fileName, actor }: { plan: CsvPlan; fileName: string; actor: string }) {
  const columns = describeColumns(plan.map);
  const missing = missingColumns(plan.map);
  const missingFields = missing.filter((c) => !c.score);
  const missingScores = missing.length - missingFields.length;
  const dataRows = plan.rows.length;
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        <span className="num text-ink">{fileName}</span> · {plural(columns.length, 'column')} · {plural(dataRows, 'row')}
      </p>
      {plan.v1Detected ? (
        <Notice>
          <p>
            <span className="font-medium text-ink">Older Low/Med/High score columns detected.</span> They are read as 1, 3
            and 5; where two columns feed one parameter, the higher (worse) score is used.
          </p>
        </Notice>
      ) : null}
      <Table aria-label="Column mapping" className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-1/2">Column in file</TableHead>
            <TableHead>Imported as</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map(({ index, header, column, alias }) => (
            <TableRow key={index}>
              <TableCell className="max-w-0 truncate" title={header}>
                {header}
              </TableCell>
              <TableCell className="whitespace-normal">
                {column === null ? (
                  <span className="text-muted-foreground">Not imported</span>
                ) : column.key === 'reviewer' ? (
                  <span className="text-muted-foreground">Not imported: drafts are recorded under {actor}</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-x-2">
                    {importedAs(column)}
                    {alias ? <span className="text-xs text-muted-foreground">(v1 column)</span> : null}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {plan.map.unmapped.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not recognised, so ignored: <span className="text-ink">{plan.map.unmapped.join(', ')}</span>
        </p>
      ) : null}
      {missing.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Not in this file:{' '}
          <span className="text-ink">
            {[...missingFields.map((c) => importedAs(c)), ...(missingScores > 0 ? [plural(missingScores, 'score column')] : [])].join(
              ', ',
            )}
          </span>
          . New wells get the defaults; existing wells keep what they have.
        </p>
      ) : null}
    </div>
  );
}

/* ---------- CSV: the validation report ---------- */

const STATUS: Record<RowStatus, { label: string; icon: LucideIcon; className: string }> = {
  created: { label: 'Create', icon: PlusIcon, className: 'border-line bg-subtle text-ink' },
  updated: { label: 'Update', icon: RefreshCwIcon, className: 'border-line bg-subtle text-ink' },
  error: { label: 'Error', icon: CircleAlertIcon, className: 'border-destructive/40 bg-destructive/5 text-destructive' },
};

function StatusBadge({ status }: { status: RowStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs whitespace-nowrap', className)}>
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      {label}
    </span>
  );
}

function scoresText(r: PlannedRow): string {
  switch (r.draft) {
    case 'new':
      return `Draft · ${plural(r.scored, 'score')}`;
    case 'reassessment':
      return `Re-assessment draft · ${plural(r.scored, 'score')}`;
    case 'kept':
      return 'Not imported';
    case 'same':
      return 'Same as final';
    default:
      return '—';
  }
}

const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The counts line: "2 to create · 0 to update · 1 with errors (skipped)". */
export function countsText(plan: CsvPlan): string {
  const { create, update, errors } = plan.counts;
  return `${create} to create · ${update} to update · ${errors} with errors (skipped)`;
}

export function ValidationReport({ plan, actor }: { plan: CsvPlan; actor: string }) {
  return (
    <div className="grid gap-3">
      <p className="text-[13px] font-medium tabular-nums" data-counts>
        {countsText(plan)}
      </p>
      <Notice>
        <p>
          Scores become <span className="font-medium text-ink">drafts</span>, never final assessments: a CSV carries no
          justifications.{' '}
          {plan.counts.drafts > 0 ? `${plural(plan.counts.drafts, 'draft')} will be saved; finalise each on its well’s page.` : ''}
        </p>
        {plan.reviewerColumn ? <p>The Reviewer column is not imported: drafts are recorded under {actor}.</p> : null}
      </Notice>
      <Table aria-label="Validation report" className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12 text-right">Row</TableHead>
            <TableHead>Licence</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Scores</TableHead>
            <TableHead className="w-2/5">Messages</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.rows.map((r) => (
            <TableRow key={r.row} data-status={r.status} className="*:align-top">
              <TableCell className="num text-right text-muted-foreground">{r.row}</TableCell>
              <TableCell className="num">{r.licence || '—'}</TableCell>
              <TableCell>
                <StatusBadge status={r.status} />
              </TableCell>
              <TableCell className={cn(r.draft === null && 'text-muted-foreground')}>{scoresText(r)}</TableCell>
              <TableCell className="min-w-56 whitespace-normal">
                <div className="grid gap-0.5 text-xs">
                  {r.status === 'error' ? <p className="text-destructive">{capitalised(r.message)}</p> : null}
                  {r.status !== 'error' && r.message ? <p className="text-muted-foreground">{capitalised(r.message)}</p> : null}
                  {r.status === 'updated' ? (
                    <p>{r.changes.length > 0 ? `Changes: ${r.changes.map((c) => CSV_FIELD_LABELS[c]).join(', ')}` : 'No changes'}</p>
                  ) : null}
                  {r.warnings.map((w, i) => (
                    <p key={i} className="flex gap-1 text-warn">
                      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                      <span>{capitalised(w)}</span>
                    </p>
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---------- JSON ---------- */

export function ProjectFileView({
  fileName,
  summary,
  otherProjectName,
}: {
  fileName: string;
  summary: ExportSummary;
  /** Set when the file holds another project than the active one. */
  otherProjectName: string | null;
}) {
  const facts = exportFacts(summary);
  return (
    <div className="grid gap-3">
      <div className="grid gap-0.5 rounded-md border bg-subtle/60 p-3">
        <p className="flex min-w-0 items-center gap-1.5 font-medium">
          <FileJsonIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="num truncate">{fileName}</span>
        </p>
        {facts.length > 0 ? <p className="text-xs text-muted-foreground">{facts.join(' · ')}</p> : null}
      </div>
      {otherProjectName ? (
        <Notice>
          <p>
            This file holds another project: {otherProjectName}. Importing adds or updates that project, which then becomes
            the active project.
          </p>
        </Notice>
      ) : null}
      <p className="text-xs text-muted-foreground">
        The file is merged: new wells and history are added, wells with a matching licence are updated. To make a file
        replace the project, use Project settings → Backup.
      </p>
    </div>
  );
}

export function V2MigrationView({
  fileName,
  migration,
  projectName,
}: {
  fileName: string;
  migration: V2Migration;
  projectName: string;
}) {
  const wells = migration.export.wells.length;
  const scored = migration.parity.filter((p) => p.v3 !== null).length;
  const { mismatches, warnings } = migration;
  return (
    <div className="grid gap-3">
      <Notice>
        <p className="font-medium text-ink">Legacy v2 format — migrated</p>
        <p>
          {plural(wells, 'well')} from <span className="num text-ink">{fileName}</span>, converted to v3 in this browser and
          placed in <span className="text-ink">{projectName}</span>. Wells with a matching licence are updated. Scored wells
          keep their v2 assessment, with its reviewer and date.
        </p>
      </Notice>
      <p className="text-xs text-muted-foreground">
        {scored === 0
          ? 'No well in the file is scored.'
          : mismatches.length === 0
            ? `${plural(scored, 'scored well')}: the results recomputed under methodology ${DEFAULT_METHODOLOGY.revision} match v2.`
            : `${mismatches.length} of ${plural(scored, 'scored well')} differ from v2 when recomputed under methodology ${DEFAULT_METHODOLOGY.revision}:`}
      </p>
      {mismatches.length > 0 ? (
        <ul className="grid list-disc gap-0.5 pl-4 font-mono text-[11px] text-destructive">
          {mismatches.map((m) => (
            <li key={m.licence}>{parityText(m)}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium">Migration notes</p>
          <ul className="grid gap-0.5 text-xs text-warn">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-1">
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
