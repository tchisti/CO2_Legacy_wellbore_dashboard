'use client';

// The History tab (spec §4.3): the audit trail of the record and of every assessment of the well,
// newest first: what happened, to what, who did it, when (UTC), and which fields changed. Never
// the raw diff. Read from the project's audit events so a discarded draft, whose assessment no
// longer exists, still shows.
import { HistoryIcon, TriangleAlertIcon } from 'lucide-react';
import type { Well } from '@lwa/engine';
import { EmptyState } from '@/components/shell/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { wellHistory } from '@/lib/assessment-view';
import { fmtDateTime } from '@/lib/format';
import { useStoreQuery } from '@/lib/store/provider';

const COLUMNS = [
  { id: 'at', label: 'When (UTC)', className: 'w-48' },
  { id: 'action', label: 'Action', className: 'w-32' },
  { id: 'entity', label: 'Entity', className: 'w-28' },
  { id: 'actor', label: 'Actor', className: 'w-44' },
  { id: 'summary', label: 'Changes', className: '' },
] as const;

export function HistoryTab({ well }: { well: Pick<Well, 'id' | 'projectId'> }) {
  const history = useStoreQuery(
    async (s) => {
      const [events, assessments] = await Promise.all([
        s.audit.list({ projectId: well.projectId }),
        s.assessments.listForWell(well.id),
      ]);
      return wellHistory(events, well.id, new Set(assessments.map((a) => a.id)));
    },
    [well.id, well.projectId],
  );

  if (history.error) {
    return (
      <EmptyState icon={TriangleAlertIcon} title="The history could not be read">
        <span role="alert" className="font-mono text-xs">
          {history.error.message}
        </span>
      </EmptyState>
    );
  }
  if (!history.data) {
    return (
      <p role="status" className="text-muted-foreground">
        Loading the history…
      </p>
    );
  }
  if (history.data.length === 0) {
    return (
      <EmptyState icon={HistoryIcon} title="No history yet">
        Changes to this record and its assessments will be listed here.
      </EmptyState>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-surface">
      <Table aria-label="History" className="min-w-[720px] table-fixed text-[13px]">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} className={c.className} />
          ))}
        </colgroup>
        <TableHeader className="bg-subtle">
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <TableHead key={c.id} className="h-8 px-3 text-xs text-muted-foreground">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.data.map((e) => (
            <TableRow key={e.id} className="hover:bg-transparent">
              <TableCell data-column="at" className="num h-8 px-3 py-1.5 align-top">
                <time dateTime={e.at}>{fmtDateTime(e.at)}</time>
              </TableCell>
              <TableCell data-column="action" className="h-8 px-3 py-1.5 align-top font-medium text-ink">
                {e.action}
              </TableCell>
              <TableCell data-column="entity" className="h-8 px-3 py-1.5 align-top text-muted-foreground">
                {e.entity}
              </TableCell>
              <TableCell data-column="actor" className="h-8 truncate px-3 py-1.5 align-top" title={e.actor}>
                {e.actor}
              </TableCell>
              <TableCell data-column="summary" className="h-8 px-3 py-1.5 align-top whitespace-normal text-muted-foreground">
                {e.summary}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
