// A well's rank: the band label, always as text, with the band colour as a second signal (spec §7:
// the four rank colours are used only for rank, and colour is never the only cue). The optional
// matrix cell follows in tabular figures. An unscored well shows a neutral "Unscored".
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const RANK_TOKEN: Record<string, string> = {
  Low: 'var(--rank-low)',
  Moderate: 'var(--rank-mod)',
  High: 'var(--rank-high)',
  'Very High': 'var(--rank-crit)',
};

export function RankBadge({
  label,
  cell,
  className,
}: {
  label: string | null;
  cell?: number | null;
  className?: string;
}) {
  const colour = label ? RANK_TOKEN[label] : undefined;
  const style = colour ? ({ '--rank': colour } as CSSProperties) : undefined;
  return (
    <span
      data-rank={label ?? 'unscored'}
      style={style}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm border px-1.5 text-xs font-medium whitespace-nowrap',
        colour
          ? 'border-[color-mix(in_srgb,var(--rank)_45%,transparent)] bg-[color-mix(in_srgb,var(--rank)_12%,transparent)] text-ink'
          : 'border-dashed border-line-strong text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-[2px]', colour ? 'bg-(--rank)' : 'border border-line-strong')}
      />
      {label ?? 'Unscored'}
      {label && cell !== null && cell !== undefined ? (
        <>
          <span className="sr-only">, cell </span>
          <span className="num text-muted-foreground tabular-nums">{cell}</span>
        </>
      ) : null}
    </span>
  );
}
