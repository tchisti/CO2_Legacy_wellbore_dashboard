'use client';

// The register table (spec §4.2, §7): 13 px text on 32 px rows, licences and numbers in mono with
// tabular figures, rank as the RankBadge (the only place rank colours appear), the assessment state
// as a state badge (neutral; amber for a stale revision). Every row is focusable: Enter or a click opens the well, ↑/↓ move between rows;
// the checkbox and the actions menu do not open it. Rows arrive filtered and sorted (lib/wells-view);
// clicking a sortable header asks for a new sort. Columns are TanStack Table definitions; the
// selection, sort and row actions reach the cells through context so the definitions stay static.
import { createContext, useContext, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpIcon, EllipsisIcon } from 'lucide-react';
import { RankBadge } from '@/components/domain/RankBadge';
import { AssessmentStateBadge } from '@/components/domain/StateBadge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MISSING, fmt1, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Sort, SortKey, WellRow } from '@/lib/wells-view';

type TableActions = {
  sort: Sort;
  onSort: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  /** Selection state of the rows shown: drives the header checkbox. */
  shown: 'none' | 'some' | 'all';
  onSelect: (id: string, selected: boolean) => void;
  onSelectShown: (selected: boolean) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

const ActionsContext = createContext<TableActions | null>(null);

function useActions(): TableActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('WellTable cells must render inside <WellTable>');
  return ctx;
}

/* ---------- cells ---------- */

const Missing = () => <span className="text-muted-foreground">{MISSING}</span>;

/** "Unknown" values are muted so the known ones stand out. */
const Plain = ({ value }: { value: string }) =>
  value === '' ? <Missing /> : <span className={cn(value === 'Unknown' && 'text-muted-foreground')}>{value}</span>;

function SelectAll() {
  const { shown, onSelectShown } = useActions();
  return (
    <input
      type="checkbox"
      aria-label="Select all shown wells"
      className="size-3.5 cursor-pointer align-middle accent-primary"
      checked={shown === 'all'}
      ref={(el) => {
        if (el) el.indeterminate = shown === 'some';
      }}
      onChange={(e) => onSelectShown(e.target.checked)}
    />
  );
}

function SelectRow({ row }: { row: WellRow }) {
  const { selected, onSelect } = useActions();
  return (
    <input
      type="checkbox"
      aria-label={`Select ${row.licence}`}
      className="size-3.5 cursor-pointer align-middle accent-primary"
      checked={selected.has(row.id)}
      onChange={(e) => onSelect(row.id, e.target.checked)}
    />
  );
}

function RowActions({ row }: { row: WellRow }) {
  const { onOpen, onEdit, onDelete } = useActions();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${row.licence}`} className="text-muted-foreground">
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onOpen(row.id)}>Open well</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onEdit(row.id)}>Edit record</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row.id)}>
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------- columns ---------- */

const features = tableFeatures({});
const col = createColumnHelper<typeof features, WellRow>();

const columns = col.columns([
  col.display({ id: 'select', header: () => <SelectAll />, cell: ({ row }) => <SelectRow row={row.original} /> }),
  col.display({ id: 'licence', header: 'Licence / UWI', cell: ({ row }) => row.original.licence }),
  col.display({ id: 'name', header: 'Name', cell: ({ row }) => <Plain value={row.original.name} /> }),
  col.display({ id: 'operator', header: 'Operator', cell: ({ row }) => <Plain value={row.original.operator} /> }),
  col.display({ id: 'type', header: 'Type', cell: ({ row }) => <Plain value={row.original.type} /> }),
  col.display({ id: 'status', header: 'Status', cell: ({ row }) => <Plain value={row.original.status} /> }),
  col.display({ id: 'classification', header: 'Class', cell: ({ row }) => row.original.classification }),
  col.display({
    id: 'spudYear',
    header: 'Spud',
    cell: ({ row }) => (row.original.spudYear === null ? <Missing /> : row.original.spudYear),
  }),
  col.display({
    id: 'lc',
    header: 'L × C',
    cell: ({ row }) => (row.original.L === null ? <Missing /> : `${fmt1(row.original.L)} × ${fmt1(row.original.C)}`),
  }),
  col.display({
    id: 'cell',
    header: 'Cell',
    cell: ({ row }) => (row.original.cell === null ? <Missing /> : row.original.cell),
  }),
  col.display({ id: 'rank', header: 'Rank', cell: ({ row }) => <RankBadge label={row.original.rank} /> }),
  col.display({ id: 'state', header: 'Assessment', cell: ({ row }) => <AssessmentStateBadge state={row.original.state} /> }),
  col.display({
    id: 'reviewer',
    header: 'Reviewer',
    cell: ({ row }) => (row.original.reviewerName === null ? <Missing /> : row.original.reviewerName),
  }),
  col.display({ id: 'updatedAt', header: 'Updated', cell: ({ row }) => fmtDate(row.original.updatedAt) }),
  col.display({ id: 'actions', header: () => <span className="sr-only">Actions</span>, cell: ({ row }) => <RowActions row={row.original} /> }),
]);

/** The sort key behind each sortable column. L × C sorts by Risk Index (L × C is the index). */
const SORT_KEY: Partial<Record<string, SortKey>> = {
  licence: 'licence',
  name: 'name',
  operator: 'operator',
  type: 'type',
  status: 'status',
  classification: 'classification',
  spudYear: 'spudYear',
  lc: 'riskIndex',
  cell: 'cell',
  rank: 'rank',
  state: 'state',
  reviewer: 'reviewer',
  updatedAt: 'updatedAt',
};

const NUMERIC: ReadonlySet<string> = new Set(['spudYear', 'lc', 'cell', 'updatedAt']);

/**
 * Frozen columns: the checkbox and licence on the left, the actions on the right, so a table
 * wider than the screen (tablets, long names) still shows which well a row is and its menu.
 * A frozen cell needs its own background, matched to the row's hover, selected and focus fills.
 */
const FROZEN_BODY =
  'sticky z-10 bg-surface group-hover/row:bg-[color-mix(in_srgb,var(--subtle)_50%,var(--surface))] group-data-[state=selected]/row:bg-subtle group-focus-visible/row:bg-accent';
const FROZEN_HEAD = 'sticky z-10 bg-subtle';
const FROZEN_EDGE_LEFT = 'shadow-[inset_-1px_0_0_var(--line)]';
const FROZEN_EDGE_RIGHT = 'shadow-[inset_1px_0_0_var(--line)]';

/** Per-column cell styling: mono for licences and numbers, truncation for long text. */
const CELL_CLASS: Partial<Record<string, string>> = {
  select: cn('left-0 w-8 min-w-8 pr-0 pl-3', FROZEN_BODY),
  licence: cn('left-8 font-mono text-xs tabular-nums', FROZEN_BODY, FROZEN_EDGE_LEFT),
  name: 'max-w-48 truncate',
  operator: 'max-w-40 truncate',
  reviewer: 'max-w-32 truncate',
  spudYear: 'num text-right',
  lc: 'num text-right',
  cell: 'num text-right',
  updatedAt: 'num text-right text-xs text-muted-foreground',
  actions: cn('right-0 w-8 pr-2 text-right', FROZEN_BODY, FROZEN_EDGE_RIGHT),
};

/** The full text of the columns that truncate, for their tooltip. */
const TRUNCATED: Partial<Record<string, (r: WellRow) => string>> = {
  name: (r) => r.name,
  operator: (r) => r.operator,
  reviewer: (r) => r.reviewerName ?? '',
};

/** Header styling where it differs from the cells'. */
const HEAD_CLASS: Partial<Record<string, string>> = {
  select: cn('left-0 w-8 min-w-8 pr-0 pl-3', FROZEN_HEAD),
  licence: cn('left-8', FROZEN_HEAD, FROZEN_EDGE_LEFT),
  actions: cn('right-0 w-8', FROZEN_HEAD, FROZEN_EDGE_RIGHT),
};

/** Columns whose clicks belong to their control, not to the row. */
const ROW_CONTROLS: ReadonlySet<string> = new Set(['select', 'actions']);

function SortHeader({ columnId, children }: { columnId: string; children: ReactNode }) {
  const { sort, onSort } = useActions();
  const key = SORT_KEY[columnId];
  if (!key) return <>{children}</>;
  const active = sort.key === key;
  // Only the sorted column carries an arrow: a reserved slot in every header would cost the
  // table its fit at 1440 px. The others show they sort by the pointer and the hover colour.
  const Icon = sort.dir === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={cn(
        '-mx-1 inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-1 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50',
        NUMERIC.has(columnId) && 'flex-row-reverse',
        active && 'text-ink',
      )}
    >
      {children}
      {active ? <Icon aria-hidden="true" className="size-3" /> : null}
    </button>
  );
}

const getRowId = (row: WellRow) => row.id;

/** Moves focus to the previous or next row of the same table body. */
function focusSibling(row: HTMLTableRowElement, step: 1 | -1) {
  const next = step === 1 ? row.nextElementSibling : row.previousElementSibling;
  if (next instanceof HTMLTableRowElement) next.focus();
}

export function WellTable({
  rows,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  onOpen,
  onEdit,
  onDelete,
}: {
  rows: WellRow[];
  sort: Sort;
  onSortChange: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: ReadonlySet<string>) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const table = useTable({ features, columns, data: rows, getRowId });

  const shownSelected = rows.filter((r) => selected.has(r.id)).length;
  const actions: TableActions = {
    sort,
    onSort: onSortChange,
    selected,
    shown: shownSelected === 0 ? 'none' : shownSelected === rows.length ? 'all' : 'some',
    onSelect: (id, on) => {
      const next = new Set(selected);
      if (on) next.add(id);
      else next.delete(id);
      onSelectedChange(next);
    },
    onSelectShown: (on) => {
      const next = new Set(selected);
      for (const r of rows) {
        if (on) next.add(r.id);
        else next.delete(r.id);
      }
      onSelectedChange(next);
    },
    onOpen,
    onEdit,
    onDelete,
  };

  function rowClick(e: MouseEvent<HTMLTableRowElement>, id: string) {
    const target = e.target as Node;
    // React events bubble out of portals (menus, dialogs): only clicks on the row itself count.
    if (!e.currentTarget.contains(target)) return;
    if (target instanceof Element && target.closest('[data-row-control]')) return;
    onOpen(id);
  }

  function rowKey(e: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (e.target !== e.currentTarget) return; // keys on the checkbox or the menu button are theirs
    if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusSibling(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  return (
    <ActionsContext.Provider value={actions}>
      <div className="overflow-hidden rounded-lg border bg-surface">
        <Table aria-label="Wells" className="text-[13px]">
          <TableHeader className="bg-subtle">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const id = header.column.id;
                  const key = SORT_KEY[id];
                  return (
                    <TableHead
                      key={header.id}
                      data-column={id}
                      aria-sort={key ? (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                      className={cn(
                        'h-8 px-1.5 text-xs font-medium text-muted-foreground',
                        NUMERIC.has(id) && 'text-right',
                        HEAD_CLASS[id],
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <SortHeader columnId={id}>
                          <table.FlexRender header={header} />
                        </SortHeader>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const isSelected = selected.has(row.id);
              return (
                <TableRow
                  key={row.id}
                  tabIndex={0}
                  data-state={isSelected ? 'selected' : undefined}
                  onClick={(e) => rowClick(e, row.id)}
                  onKeyDown={(e) => rowKey(e, row.id)}
                  className="group/row h-8 cursor-pointer outline-none focus-visible:bg-accent focus-visible:[&>td:first-child]:shadow-[inset_2px_0_0_var(--accent)]"
                >
                  {row.getAllCells().map((cell) => {
                    const id = cell.column.id;
                    return (
                      <TableCell
                        key={cell.id}
                        data-column={id}
                        data-row-control={ROW_CONTROLS.has(id) ? '' : undefined}
                        className={cn('h-8 px-1.5 py-0', CELL_CLASS[id])}
                        title={TRUNCATED[id]?.(row.original) || undefined}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </ActionsContext.Provider>
  );
}
