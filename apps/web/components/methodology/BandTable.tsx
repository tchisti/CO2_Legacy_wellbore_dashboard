// The rank bands (spec §4.6): each rank as its RankBadge with the range of matrix cells it covers,
// and the rule that gives a well its cell. Rank colours appear here because this table defines
// rank (spec §7); the range is in mono.
import type { Methodology } from '@lwa/engine';
import { RankBadge } from '@/components/domain/RankBadge';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** "1–4", or "5" for a band of one cell. */
function cellRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

export function BandTable({ methodology, labelledBy }: { methodology: Methodology; labelledBy: string }) {
  return (
    <div className="grid gap-2">
      <div className="max-w-sm overflow-hidden rounded-lg border bg-surface">
        <table aria-labelledby={labelledBy} className="w-full border-collapse text-[13px]">
          <TableHeader className="bg-subtle">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 px-3 text-xs font-normal text-muted-foreground">Rank</TableHead>
              <TableHead className="h-8 px-3 text-xs font-normal text-muted-foreground">Cells</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {methodology.matrix.bands.map((b) => (
              <TableRow key={b.label} className="hover:bg-transparent">
                <TableCell className="px-3 py-2">
                  <RankBadge label={b.label} />
                </TableCell>
                <TableCell data-column="cells" className="num px-3 py-2">
                  {cellRange(b.min, b.max)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      <p className="max-w-prose text-xs text-muted-foreground">
        A well&apos;s cell is round(L) × round(C), a whole number from 1 to 25, and its rank is the band that cell falls
        in. The Risk Index, L × C, is not the rank: it only breaks ties between wells in the same cell.
      </p>
    </div>
  );
}
