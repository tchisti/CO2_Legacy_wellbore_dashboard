// The portfolio report's register (spec §4.2): the wells of the report's filter in the order given
// (the Wells default, riskiest first), one row each with licence, name and operator, class, L × C,
// cell, rank, assessment state, and who assessed the current final and when. Plain text, no
// controls: it is printed. Ten facts in eight fixed columns so the table fits a letter page at a
// readable size: the name sits over the operator, the reviewer over the date.
import { RankBadge } from '@/components/domain/RankBadge';
import { MISSING, fmt1, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { WellRow } from '@/lib/wells-view';

const HEAD = 'px-1.5 py-1.5 text-left align-bottom text-[11px] font-normal text-muted-foreground';
const CELL = 'px-1.5 py-1.5 align-top';

export function RegisterTable({
  rows,
  assessedAt,
  labelledBy,
}: {
  rows: readonly WellRow[];
  /** When each well's current final was assessed (ISO-8601), or null. */
  assessedAt: (wellId: string) => string | null;
  labelledBy: string;
}) {
  return (
    <table aria-labelledby={labelledBy} className="w-full table-fixed border-collapse text-[12px] leading-4">
      <colgroup>
        <col className="w-[22.5%]" />
        <col />
        <col className="w-[8%]" />
        <col className="w-[10.5%]" />
        <col className="w-[4.5%]" />
        <col className="w-[12.5%]" />
        <col className="w-[10%]" />
        <col className="w-[12.5%]" />
      </colgroup>
      <thead className="border-b bg-subtle">
        <tr>
          <th scope="col" className={HEAD}>
            Licence
          </th>
          <th scope="col" className={HEAD}>
            Name / operator
          </th>
          <th scope="col" className={HEAD}>
            Class
          </th>
          <th scope="col" className={HEAD}>
            L × C
          </th>
          <th scope="col" className={cn(HEAD, 'text-right')}>
            Cell
          </th>
          <th scope="col" className={HEAD}>
            Rank
          </th>
          <th scope="col" className={HEAD}>
            Assessment
          </th>
          <th scope="col" className={HEAD}>
            Reviewer / assessed
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          // Amber only for the label "Stale revision" (as AssessmentStateBadge), never a rank colour.
          const stale = r.state.kind === 'final' && r.state.stale.stale;
          return (
            <tr key={r.id} data-well={r.id} className="border-b last:border-b-0">
              <th
                scope="row"
                data-field="licence"
                className={cn(CELL, 'text-left font-mono text-[11px] font-normal break-all text-ink')}
              >
                {r.licence}
              </th>
              <td className={CELL}>
                <span data-field="name" className="block text-ink">
                  {r.name || MISSING}
                </span>
                <span data-field="operator" className="block text-muted-foreground">
                  {r.operator || MISSING}
                </span>
              </td>
              <td data-field="class" className={cn(CELL, 'whitespace-nowrap')}>
                {r.classification}
              </td>
              <td data-field="lxc" className={cn(CELL, 'num text-[11px] whitespace-nowrap')}>
                {r.L === null || r.C === null ? MISSING : `${fmt1(r.L)} × ${fmt1(r.C)}`}
              </td>
              <td data-field="cell" className={cn(CELL, 'num text-right text-[11px]')}>
                {r.cell ?? MISSING}
              </td>
              <td data-field="rank" className={CELL}>
                <RankBadge label={r.rank} className="gap-1 px-1 text-[11px]" />
              </td>
              <td data-field="state" className={cn(CELL, stale ? 'font-medium text-warn' : 'text-ink')}>
                {r.state.label}
              </td>
              <td className={CELL}>
                <span data-field="reviewer" className="block text-ink">
                  {r.reviewerName ?? MISSING}
                </span>
                <span data-field="assessed" className="num block text-[11px] whitespace-nowrap text-muted-foreground">
                  {fmtDate(assessedAt(r.id))}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
