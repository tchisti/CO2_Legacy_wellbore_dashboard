// The score flow's running verdict (spec §4.4): "L 3.0 × C 3.0 → cell 9 · Moderate", recomputed on
// every change under the current methodology. One decimal for L and C, an integer cell (spec §7);
// the rank colour appears only in the rank badge. A polite live region, so the new result is
// announced after each score without interrupting.
import type { Computed } from '@lwa/engine';
import { RankBadge } from '@/components/domain/RankBadge';
import { fmt1 } from '@/lib/format';
import { cn } from '@/lib/utils';

export function LiveResult({ computed, className }: { computed: Computed; className?: string }) {
  return (
    <output
      data-live-result
      aria-live="polite"
      className={cn('num inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm whitespace-nowrap text-ink', className)}
    >
      {`L ${fmt1(computed.L)} × C ${fmt1(computed.C)} → cell ${computed.cell} · `}
      <RankBadge label={computed.rank.label} className="font-sans" />
    </output>
  );
}
