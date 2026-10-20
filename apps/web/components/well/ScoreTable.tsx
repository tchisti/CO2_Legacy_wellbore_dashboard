// One assessment's scores (spec §4.3): parameter with its weight, the score (1–5, or "?" for
// Unknown), the anchor text for that score, the reviewer's justification and the weighted
// contribution, grouped Likelihood then Consequence, each group closed by its axis subtotal.
// Table text is 13 px on rows of at least 32 px; numbers are mono with tabular figures (spec §7).
import { Fragment } from 'react';
import type { Axis } from '@lwa/engine';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { axisSubtotals, type ScoreRow } from '@/lib/assessment-view';
import { MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';

const AXES: readonly { axis: Axis; name: string }[] = [
  { axis: 'L', name: 'Likelihood' },
  { axis: 'C', name: 'Consequence' },
];

/** A recorded axis value counts as the same as the row sum within this (both are two-decimal figures). */
const TOLERANCE = 0.005;

export function ScoreTable({
  rows,
  recorded,
  label,
  labelledBy,
}: {
  rows: readonly ScoreRow[];
  /** The assessment's stored L and C; shown beside a subtotal only when the rows do not add up to it. */
  recorded?: { L: number; C: number } | null;
  /** The table's accessible name, unless `labelledBy` points at a visible heading. */
  label?: string;
  labelledBy?: string;
}) {
  const subtotals = axisSubtotals(rows);
  return (
    <div className="overflow-hidden rounded-lg border bg-surface">
      <Table
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        className="min-w-[760px] table-fixed text-[13px]"
      >
        <colgroup>
          <col className="w-[23%]" />
          <col className="w-16" />
          <col />
          <col />
          <col className="w-28" />
        </colgroup>
        <TableHeader className="bg-subtle">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 px-3 text-xs text-muted-foreground">Parameter</TableHead>
            <TableHead className="h-8 px-3 text-center text-xs text-muted-foreground">Score</TableHead>
            <TableHead className="h-8 px-3 text-xs text-muted-foreground">Anchor</TableHead>
            <TableHead className="h-8 px-3 text-xs text-muted-foreground">Justification</TableHead>
            <TableHead className="h-8 px-3 text-right text-xs text-muted-foreground">Contribution</TableHead>
          </TableRow>
        </TableHeader>
        {AXES.map(({ axis, name }) => {
          const group = rows.filter((r) => r.axis === axis);
          const subtotal = subtotals[axis];
          const stored = recorded?.[axis];
          const differing = stored !== undefined && Math.abs(stored - subtotal) > TOLERANCE ? stored : null;
          return (
            <Fragment key={axis}>
              <TableBody data-axis={axis} className="[&_tr:last-child]:border-b-0 [&+tbody]:border-t">
                <TableRow className="border-b-0 hover:bg-transparent">
                  <th
                    scope="rowgroup"
                    colSpan={5}
                    className="px-3 pt-3 pb-1 text-left text-xs font-semibold tracking-wide text-ink"
                  >
                    {name}
                    <span className="ml-1.5 font-normal text-muted-foreground">({axis})</span>
                  </th>
                </TableRow>
                {group.map((r) => (
                  <TableRow key={r.key} data-param={r.key} data-axis={r.axis} className="align-top hover:bg-transparent">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal">
                      <span className="block text-ink">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        weight <span className="num">{r.weight.toFixed(2)}</span>
                      </span>
                    </th>
                    <TableCell data-column="score" className="num px-3 py-1.5 text-center align-top text-sm">
                      {r.score === null ? (
                        <abbr title="Unknown" className="text-muted-foreground no-underline">
                          ?
                        </abbr>
                      ) : (
                        r.score
                      )}
                    </TableCell>
                    <TableCell
                      data-column="anchor"
                      className={cn('px-3 py-1.5 align-top whitespace-normal', r.score === null && 'text-muted-foreground')}
                    >
                      {r.anchor}
                    </TableCell>
                    <TableCell data-column="justification" className="px-3 py-1.5 align-top whitespace-pre-line">
                      {r.justification === '' ? <span className="text-muted-foreground">{MISSING}</span> : r.justification}
                    </TableCell>
                    <TableCell data-column="contribution" className="num px-3 py-1.5 text-right align-top">
                      {r.contribution.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow data-subtotal={axis} className="border-t bg-subtle/50 hover:bg-subtle/50">
                  <th scope="row" colSpan={4} className="px-3 py-1.5 text-right text-xs font-medium text-muted-foreground">
                    Subtotal {axis}
                    {differing !== null ? (
                      <span className="ml-2 font-normal">
                        (recorded <span className="num">{differing.toFixed(2)}</span>)
                      </span>
                    ) : null}
                  </th>
                  <TableCell data-column="contribution" className="num px-3 py-1.5 text-right font-semibold">
                    {subtotal.toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Fragment>
          );
        })}
      </Table>
    </div>
  );
}
