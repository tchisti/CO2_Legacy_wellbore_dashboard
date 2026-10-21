// The methodology revisions this project knows (spec §4.6): which one is current, what each
// changed, and who published it when. Newest first. Revisions are never edited or deleted here.
import type { MethodologyRecord } from '@lwa/engine';
import { ScrollRegion } from '@/components/methodology/Section';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmtDate } from '@/lib/format';

const HEAD = 'h-8 px-3 text-xs font-normal text-muted-foreground';
const CELL = 'px-3 py-2 align-top whitespace-normal';

export function RevisionList({
  records,
  currentRevision,
  labelledBy,
}: {
  /** As the store lists them: oldest first. */
  records: readonly MethodologyRecord[];
  currentRevision: string;
  labelledBy: string;
}) {
  const newestFirst = [...records].reverse();
  return (
    <ScrollRegion labelledBy={labelledBy} className="rounded-lg border bg-surface">
      <table aria-labelledby={labelledBy} className="w-full min-w-[520px] border-collapse text-[13px]">
        <TableHeader className="bg-subtle">
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Revision</TableHead>
            <TableHead className={HEAD}>Note</TableHead>
            <TableHead className={HEAD}>Published</TableHead>
            <TableHead className={HEAD}>By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {newestFirst.map((r) => (
            <TableRow key={r.revision} className="hover:bg-transparent">
              <TableCell data-column="revision" className={`${CELL} whitespace-nowrap`}>
                <span className="num">{r.revision}</span>
                {r.revision === currentRevision ? <span className="text-muted-foreground"> (current)</span> : null}
              </TableCell>
              <TableCell data-column="note" className={CELL}>
                {r.note}
              </TableCell>
              <TableCell data-column="published" className={`${CELL} num whitespace-nowrap`}>
                {fmtDate(r.publishedAt)}
              </TableCell>
              <TableCell data-column="by" className={CELL}>
                {r.publishedBy}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ScrollRegion>
  );
}
