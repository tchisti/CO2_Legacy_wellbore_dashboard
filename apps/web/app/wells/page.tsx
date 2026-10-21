'use client';

// The Wells register (spec §4.2): every well of the active project with its current rank and
// assessment state, filtered by chips whose state lives in the URL (so a filtered view can be
// linked, reloaded and printed), sorted riskiest first, with record edits and guarded deletes,
// Import (CSV or JSON, with a validation report before anything is written) and Export (CSV of the
// current view or of the selection).
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilterXIcon, PlusIcon, TableIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import type { Assessment, Well } from '@lwa/engine';
import { ImportDialog } from '@/components/import/ImportDialog';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { BulkDeleteDialog } from '@/components/wells/BulkDeleteDialog';
import { DeleteWellDialog, type DeletableWell } from '@/components/wells/DeleteWellDialog';
import { EditWellDialog } from '@/components/wells/EditWellDialog';
import { ExportMenu } from '@/components/wells/ExportMenu';
import { WellFilters } from '@/components/wells/WellFilters';
import { WellTable } from '@/components/wells/WellTable';
import { plural } from '@/lib/format';
import { useProjects } from '@/lib/project-context';
import { newWellHref, wellHref } from '@/lib/routes';
import { useRegister } from '@/lib/use-register';
import { useUrlFilters } from '@/lib/use-url-filters';
import { DEFAULT_SORT, applyFilters, nextSort, sortRows, type Sort, type SortKey, type WellRow } from '@/lib/wells-view';

const NO_ROWS: WellRow[] = [];
const NO_WELLS: Well[] = [];
const NO_FINALS: ReadonlyMap<string, Assessment | null> = new Map();

function WellsRegister() {
  const router = useRouter();
  const { activeProject } = useProjects();
  const projectId = activeProject?.id ?? null;
  const { filters, setText, setFilters, clear: clearFilters } = useUrlFilters();

  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DeletableWell | null>(null);
  const [bulk, setBulk] = useState<DeletableWell[] | null>(null);
  const [importing, setImporting] = useState(false);

  const register = useRegister(projectId);
  const data = register.data;
  const rows = data?.rows ?? NO_ROWS;
  const shown = useMemo(() => sortRows(applyFilters(rows, filters), sort), [rows, filters, sort]);
  const shownSelected = shown.filter((r) => selected.has(r.id));
  const rankLabels = useMemo(() => data?.methodology.matrix.bands.map((b) => b.label) ?? [], [data]);

  const open = (id: string) => router.push(wellHref(id));
  const deletable = (r: { id: string; licence: string; name: string }): DeletableWell => ({
    id: r.id,
    licence: r.licence,
    name: r.name,
  });
  const forget = (ids: readonly string[]) =>
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));

  const header = (
    <PageHeader
      title="Wells"
      context={activeProject?.name}
      actions={
        <>
          <Button variant="outline" onClick={() => setImporting(true)} disabled={!activeProject}>
            <UploadIcon aria-hidden="true" />
            Import
          </Button>
          <ExportMenu
            view={shown}
            selected={shownSelected}
            wells={data?.wells ?? NO_WELLS}
            current={data?.current ?? NO_FINALS}
          />
          <Button asChild>
            <Link href={newWellHref()}>
              <PlusIcon aria-hidden="true" />
              New well
            </Link>
          </Button>
          {activeProject ? <ImportDialog open={importing} onOpenChange={setImporting} project={activeProject} /> : null}
        </>
      }
    />
  );

  if (register.error) {
    return (
      <PageBody>
        {header}
        <EmptyState icon={TriangleAlertIcon} title="The wells could not be read">
          <span role="alert" className="font-mono text-xs">
            {register.error.message}
          </span>
        </EmptyState>
      </PageBody>
    );
  }

  if (!data) {
    return (
      <PageBody>
        {header}
        <p role="status" className="text-muted-foreground">
          Loading wells…
        </p>
      </PageBody>
    );
  }

  if (rows.length === 0) {
    return (
      <PageBody>
        {header}
        <EmptyState
          icon={TableIcon}
          title="No wells in this project yet"
          action={
            <Button asChild>
              <Link href={newWellHref()}>
                <PlusIcon aria-hidden="true" />
                New well
              </Link>
            </Button>
          }
        >
          Add the first well of this area of review. Each well is then scored on its own page.
        </EmptyState>
      </PageBody>
    );
  }

  const editing = editingId ? (data.wells.find((w) => w.id === editingId) ?? null) : null;
  return (
    <PageBody>
      {header}
      <div className="grid gap-3">
        <WellFilters
          rows={rows}
          filters={filters}
          rankLabels={rankLabels}
          onTextChange={setText}
          onChange={setFilters}
          onClear={clearFilters}
        />
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" className="text-xs text-muted-foreground">
            {shown.length === rows.length ? plural(rows.length, 'well') : `${shown.length} of ${plural(rows.length, 'well')}`}
          </p>
          {shownSelected.length > 0 ? (
            <div className="flex items-center gap-1 rounded-md border bg-surface py-0.5 pr-0.5 pl-2.5 text-xs">
              <span className="mr-1 font-medium">{shownSelected.length} selected</span>
              <Button variant="destructive" size="xs" onClick={() => setBulk(shownSelected.map(deletable))}>
                Delete…
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          ) : null}
        </div>
        {shown.length === 0 ? (
          <EmptyState
            icon={FilterXIcon}
            title="No wells match these filters"
            action={
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            The project has {plural(rows.length, 'well')}; none matches every filter above.
          </EmptyState>
        ) : (
          <WellTable
            rows={shown}
            sort={sort}
            onSortChange={(key: SortKey) => setSort((s) => nextSort(s, key))}
            selected={selected}
            onSelectedChange={setSelected}
            onOpen={open}
            onEdit={setEditingId}
            onDelete={(id) => {
              const row = rows.find((r) => r.id === id);
              if (row) setDeleting(deletable(row));
            }}
          />
        )}
      </div>

      <EditWellDialog
        well={editing}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditingId(null);
        }}
        wellTypes={data.methodology.wellTypes}
      />
      <DeleteWellDialog
        well={deleting}
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        onDeleted={() => {
          if (deleting) forget([deleting.id]);
        }}
      />
      <BulkDeleteDialog
        wells={bulk ?? []}
        open={bulk !== null}
        onOpenChange={(o) => {
          if (!o) setBulk(null);
        }}
        onDeleted={forget}
      />
    </PageBody>
  );
}

export default function WellsPage() {
  return (
    <Suspense
      fallback={
        <PageBody>
          <p role="status" className="text-muted-foreground">
            Loading wells…
          </p>
        </PageBody>
      }
    >
      <WellsRegister />
    </Suspense>
  );
}
