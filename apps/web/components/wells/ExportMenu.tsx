'use client';

// Wells → Export (spec §4.2): the wells shown (after the filters, in the table's sort order) or the
// selected ones, as a CSV in the v2 columns plus read-only result columns (lib/csv.ts exportCsv),
// saved as legacy_wells_<YYYY-MM-DD>.csv.
import { ChevronDownIcon, DownloadIcon } from 'lucide-react';
import { toast } from 'sonner';
import type { Assessment, Well } from '@lwa/engine';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { saveWithLink } from '@/lib/backup';
import { exportCsv, exportCsvFileName } from '@/lib/csv';
import { plural } from '@/lib/format';
import type { WellRow } from '@/lib/wells-view';

export function ExportMenu({
  view,
  selected,
  wells,
  current,
}: {
  /** The rows shown, filtered and sorted. */
  view: readonly WellRow[];
  /** The selected rows among those shown, in the same order. */
  selected: readonly WellRow[];
  wells: readonly Well[];
  /** Each well's current final (by well id). */
  current: ReadonlyMap<string, Assessment | null>;
}) {
  function download(rows: readonly WellRow[]) {
    const byId = new Map(wells.map((w) => [w.id, w]));
    const items = rows.flatMap((r) => {
      const well = byId.get(r.id);
      return well ? [{ well, final: current.get(r.id) ?? null }] : [];
    });
    const filename = exportCsvFileName(new Date());
    saveWithLink(new Blob([exportCsv(items)], { type: 'text/csv;charset=utf-8' }), filename);
    toast.success(`${plural(items.length, 'well')} exported`, { description: filename });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={wells.length === 0}>
          <DownloadIcon aria-hidden="true" />
          Export
          <ChevronDownIcon aria-hidden="true" className="-mr-1 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuItem disabled={view.length === 0} onSelect={() => download(view)}>
          Export CSV (current view)
        </DropdownMenuItem>
        {selected.length > 0 ? (
          <DropdownMenuItem onSelect={() => download(selected)}>Export selected ({selected.length})</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
