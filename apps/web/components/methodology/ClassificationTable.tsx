// Legacy well Types 1–9 (spec §4.6, Table A-1): what each type is called, what it penetrates and
// what is protected. Types arrive as a record keyed "Type 1" … "Type 9"; they are shown in the order
// of the number in the key. Text is wide, so the table scrolls sideways inside its frame.
import type { Methodology } from '@lwa/engine';
import { ScrollRegion } from '@/components/methodology/Section';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const HEAD = 'h-8 px-3 text-xs font-normal text-muted-foreground';
const CELL = 'px-3 py-2 align-top whitespace-normal';

/** The number in a type key ("Type 10" → 10); a key without one sorts last. */
function typeNumber(key: string): number {
  const n = Number.parseInt(key.replace(/\D+/g, ''), 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

export function ClassificationTable({
  wellTypes,
  labelledBy,
}: {
  wellTypes: Methodology['wellTypes'];
  labelledBy: string;
}) {
  const types = Object.entries(wellTypes).sort(([a], [b]) => typeNumber(a) - typeNumber(b));
  return (
    <ScrollRegion labelledBy={labelledBy} className="rounded-lg border bg-surface">
      <table aria-labelledby={labelledBy} className="w-full min-w-[760px] border-collapse text-[13px]">
        <colgroup>
          <col className="w-20" />
          <col className="w-[26%]" />
          <col className="w-[26%]" />
          <col />
        </colgroup>
        <TableHeader className="bg-subtle">
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Type</TableHead>
            <TableHead className={HEAD}>Name</TableHead>
            <TableHead className={HEAD}>Description</TableHead>
            <TableHead className={HEAD}>Protection provided</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map(([key, t]) => (
            <TableRow key={key} data-type={key} className="hover:bg-transparent">
              <th scope="row" data-column="type" className="px-3 py-2 text-left align-top font-medium whitespace-nowrap">
                {key}
              </th>
              <TableCell data-column="short" className={CELL}>
                {t.short}
              </TableCell>
              <TableCell data-column="desc" className={`${CELL} text-muted-foreground`}>
                {t.desc}
              </TableCell>
              <TableCell data-column="prot" className={CELL}>
                {t.prot}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ScrollRegion>
  );
}
