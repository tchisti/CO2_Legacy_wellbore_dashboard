'use client';

// The Wells register (spec §4.2): every well of the active project with its current rank and
// assessment state, filtered by chips whose state lives in the URL (so a filtered view can be
// linked, reloaded and printed), sorted riskiest first, with record edits and guarded deletes.
import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DownloadIcon, FilterXIcon, PlusIcon, TableIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BulkDeleteDialog } from '@/components/wells/BulkDeleteDialog';
import { DeleteWellDialog, type DeletableWell } from '@/components/wells/DeleteWellDialog';
import { EditWellDialog } from '@/components/wells/EditWellDialog';
import { WellFilters } from '@/components/wells/WellFilters';
import { WellTable } from '@/components/wells/WellTable';
import { plural } from '@/lib/format';
import { useProjects } from '@/lib/project-context';
import { newWellHref, wellHref } from '@/lib/routes';
import { useRegister } from '@/lib/use-register';
import { useUrlFilters } from '@/lib/use-url-filters';
import { DEFAULT_SORT, applyFilters, nextSort, sortRows, type Sort, type SortKey, type WellRow } from '@/lib/wells-view';

const NO_ROWS: WellRow[] = [];

/** A toolbar action that is not wired yet: focusable, explained by a tooltip, and inert. */
function SoonButton({ icon: Icon, label }: { icon: typeof UploadIcon; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
          className="cursor-not-allowed opacity-50"
        >
          <Icon aria-hidden="true" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Not available</TooltipContent>
    </Tooltip>
  );
}

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
          <SoonButton icon={UploadIcon} label="Import" />
          <SoonButton icon={DownloadIcon} label="Export" />
          <Button asChild>
            <Link href={newWellHref()}>
              <PlusIcon aria-hidden="true" />
              New well
            </Link>
          </Button>
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
