// The scoring parameters (spec §4.6): for each one its description, weight, the anchor wording at
// scores 1, 3 and 5, the score an Unknown takes, and the references behind it. Likelihood first,
// then Consequence, each in methodology order and closed by the sum of its weights (which is
// 1.00 for a valid rulebook; the sum shown is the real one). Scores 2 and 4 have no column: they are
// the reviewer's judgment between two anchors, said once in the caption. Table text is 13 px with
// the numbers in mono (spec §7). The table is wide, so it scrolls sideways inside its frame. The
// `compact` table (a printed dossier's appendix) fits a letter page instead: 11 px text, tighter
// cells and narrow number columns, so the anchors get the width.
import { Fragment, type ReactNode } from 'react';
import { paramsOf, type Axis, type Methodology } from '@lwa/engine';
import { ScrollRegion } from '@/components/methodology/Section';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const AXES: readonly { axis: Axis; name: string }[] = [
  { axis: 'L', name: 'Likelihood' },
  { axis: 'C', name: 'Consequence' },
];

const COLUMNS = 7;

const PARAM_CAPTION =
  'Scores run from 1 (best) to 5 (worst) and are anchored at 1, 3 and 5. Scores 2 and 4 are judgment between the neighbouring anchors.';

/** The two densities: the Methodology page's, and the printed appendix's. */
const STYLE = {
  regular: {
    table: 'min-w-[1040px] text-[13px]',
    head: 'h-8 px-3 text-xs font-normal text-muted-foreground',
    cell: 'px-3 py-2 align-top whitespace-normal',
    sumCell: 'px-3 py-1.5',
    group: 'px-3 pt-3 pb-1',
    cols: ['w-[19%]', 'w-[72px]', 'w-28', 'w-[15%]'],
  },
  compact: {
    table: 'text-[11px] leading-[14px]',
    head: 'h-7 px-1.5 text-[10px] leading-3 font-normal text-muted-foreground',
    cell: 'px-1.5 py-1.5 align-top whitespace-normal',
    sumCell: 'px-1.5 py-1',
    group: 'px-1.5 pt-2 pb-0.5',
    cols: ['w-[17%]', 'w-11', 'w-14', 'w-[14%]'],
  },
} as const;

export function ParamTable({
  methodology,
  labelledBy,
  compact = false,
}: {
  methodology: Methodology;
  labelledBy: string;
  /** Fit the page (print) instead of scrolling sideways. */
  compact?: boolean;
}) {
  const st = STYLE[compact ? 'compact' : 'regular'];
  const HEAD = st.head;
  const CELL = st.cell;
  const [paramCol, weightCol, unknownCol, refsCol] = st.cols;
  const frame = (table: ReactNode) =>
    compact ? (
      <div className="overflow-hidden rounded-lg border bg-surface">{table}</div>
    ) : (
      <ScrollRegion labelledBy={labelledBy} className="rounded-lg border bg-surface">
        {table}
      </ScrollRegion>
    );
  return (
    // A grid on screen, so the scroll region (a grid item) can be narrower than its table; plain
    // blocks in print, which break across pages cleanly.
    <div className={compact ? 'space-y-2' : 'grid gap-2'}>
      {frame(
        <table aria-labelledby={labelledBy} className={cn('w-full table-fixed border-collapse', st.table)}>
          <colgroup>
            <col className={paramCol} />
            <col className={weightCol} />
            <col />
            <col />
            <col />
            <col className={unknownCol} />
            <col className={refsCol} />
          </colgroup>
          <TableHeader className="bg-subtle">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>Parameter</TableHead>
              <TableHead className={`${HEAD} text-right`}>Weight</TableHead>
              <TableHead className={HEAD}>Anchor 1</TableHead>
              <TableHead className={HEAD}>Anchor 3</TableHead>
              <TableHead className={HEAD}>Anchor 5</TableHead>
              <TableHead className={`${HEAD} text-center whitespace-normal`}>Unknown scores as</TableHead>
              <TableHead className={HEAD}>References</TableHead>
            </TableRow>
          </TableHeader>
          {AXES.map(({ axis, name }) => {
            const group = paramsOf(methodology, axis);
            const sum = group.reduce((total, p) => total + p.weight, 0);
            return (
              <Fragment key={axis}>
                <TableBody data-axis={axis} className="[&_tr:last-child]:border-b-0 [&+tbody]:border-t">
                  <TableRow className="border-b-0 hover:bg-transparent">
                    <th
                      scope="rowgroup"
                      colSpan={COLUMNS}
                      className={cn(st.group, 'text-left text-xs font-semibold tracking-wide text-ink')}
                    >
                      {name} <span className="font-normal text-muted-foreground">({axis})</span>
                    </th>
                  </TableRow>
                  {group.map((p) => (
                    <TableRow key={p.key} data-param={p.key} data-axis={p.axis} className="hover:bg-transparent">
                      <th scope="row" className={cn(CELL, 'text-left font-normal')}>
                        <span className="block text-ink">{p.name}</span>
                        <span className={cn('block text-muted-foreground', compact ? 'text-[10px] leading-3' : 'text-xs')}>
                          {p.desc}
                        </span>
                      </th>
                      <TableCell data-column="weight" className={`${CELL} num text-right`}>
                        {p.weight.toFixed(2)}
                      </TableCell>
                      <TableCell data-column="anchor1" className={CELL}>
                        {p.anchors['1']}
                      </TableCell>
                      <TableCell data-column="anchor3" className={CELL}>
                        {p.anchors['3']}
                      </TableCell>
                      <TableCell data-column="anchor5" className={CELL}>
                        {p.anchors['5']}
                      </TableCell>
                      <TableCell data-column="unknown" className={`${CELL} num text-center`}>
                        {p.unknownScore}
                      </TableCell>
                      <TableCell
                        data-column="refs"
                        className={cn(CELL, 'text-muted-foreground', compact ? 'text-[10px] leading-3' : 'text-xs')}
                      >
                        {p.refs.join('; ')}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow data-sum={axis} className="border-t bg-subtle/50 hover:bg-subtle/50">
                    <th scope="row" className={cn(st.sumCell, 'text-right text-xs font-normal text-muted-foreground')}>
                      Sum of {axis} weights
                    </th>
                    <TableCell data-column="weight" className={cn(st.sumCell, 'num text-right font-semibold')}>
                      {sum.toFixed(2)}
                    </TableCell>
                    <TableCell colSpan={COLUMNS - 2} className="p-0" />
                  </TableRow>
                </TableBody>
              </Fragment>
            );
          })}
        </table>,
      )}
      <p className="text-xs text-muted-foreground">{PARAM_CAPTION}</p>
    </div>
  );
}
