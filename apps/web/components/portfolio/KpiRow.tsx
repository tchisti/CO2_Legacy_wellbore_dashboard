// The Portfolio's count row (spec §4.1): how many wells, how many in each rank (with a small
// rank-colour accent, spec §7), then quieter tiles for the derived states (§5.1). Every tile links
// into the Wells register filtered to exactly the wells it counts, so a number is one click from
// its wells. A zero stays in place, muted. Only a stale revision, when there is one, is amber.
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { HistoryIcon } from 'lucide-react';
import { rankColour } from '@/components/domain/RankBadge';
import { plural } from '@/lib/format';
import { UNKNOWN_HEAVY_MIN, wellsFilterHref, type PortfolioStats } from '@/lib/portfolio';
import { wellsHref } from '@/lib/routes';
import { cn } from '@/lib/utils';

type StateTile = {
  key: string;
  label: string;
  count: number;
  href: string;
  /** Shown on hover: what the tile counts. */
  hint: string;
  warn?: boolean;
};

/** One count: a link that grows to share the row's spare width. */
const TILE =
  'flex grow flex-col justify-center gap-0.5 rounded-md px-3 py-2 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50';

export function KpiRow({ stats, rankLabels }: { stats: PortfolioStats; rankLabels: readonly string[] }) {
  const states: StateTile[] = [
    {
      key: 'unscored',
      label: 'Unscored',
      count: stats.unscored,
      href: wellsFilterHref({ state: ['unscored'] }),
      hint: 'Wells with no final assessment',
    },
    {
      key: 'draft',
      label: 'Drafts',
      count: stats.draft,
      href: wellsFilterHref({ state: ['draft'] }),
      hint: 'Wells with an assessment draft in progress',
    },
    {
      key: 'stale',
      label: 'Stale revision',
      count: stats.stale,
      href: wellsFilterHref({ state: ['stale'] }),
      hint: 'Current assessments made under an earlier methodology revision',
      warn: true,
    },
    {
      key: 'unknownHeavy',
      label: 'Unknown-heavy',
      count: stats.unknownHeavy,
      href: wellsFilterHref({ minUnknown: UNKNOWN_HEAVY_MIN }),
      hint: `Current assessments with ${UNKNOWN_HEAVY_MIN} or more parameters Unknown`,
    },
    {
      key: 'recordChanged',
      label: 'Record changed',
      count: stats.recordChanged,
      // The register has no filter for this state yet, so the tile opens it unfiltered.
      href: wellsHref(),
      hint: 'Wells whose record was edited after their current assessment (the Wells register has no filter for this yet)',
    },
  ];

  return (
    <div role="group" aria-label="Portfolio counts" className="flex flex-wrap rounded-lg border bg-surface p-1">
      {/* Two groups that wrap as wholes: the wells and their ranks, then the states (on their own row below xl). */}
      <div className="flex grow flex-wrap">
        <Link href={wellsHref()} aria-label={plural(stats.total, 'well')} data-kpi="total" className={cn(TILE, 'grow-0 pr-6')}>
          <span className="flex items-baseline gap-1.5">
            <span className="text-2xl leading-8 font-semibold text-ink">{stats.total}</span>
            <span className="text-sm text-muted-foreground">{stats.total === 1 ? 'well' : 'wells'}</span>
          </span>
          <span className="text-xs text-muted-foreground">in this area of review</span>
        </Link>

        <div className="flex grow flex-wrap sm:border-l sm:pl-1">
          {rankLabels.map((label) => {
            const count = stats.byRank[label] ?? 0;
            const colour = rankColour(label);
            return (
              <Link
                key={label}
                href={wellsFilterHref({ rank: [label] })}
                aria-label={`${label}: ${plural(count, 'well')}`}
                data-kpi={`rank:${label}`}
                data-zero={count === 0 || undefined}
                className={TILE}
              >
                <span className={cn('text-2xl leading-8 font-semibold', count === 0 ? 'text-muted-foreground' : 'text-ink')}>
                  {count}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    style={colour ? ({ '--rank': colour } as CSSProperties) : undefined}
                    className={cn(
                      'size-2 shrink-0 rounded-[2px]',
                      colour ? 'bg-(--rank)' : 'border border-line-strong',
                      count === 0 && 'opacity-40',
                    )}
                  />
                  <span className={cn('whitespace-nowrap', count > 0 && 'text-ink')}>{label}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex grow basis-full flex-wrap border-t pt-1 xl:basis-auto xl:border-t-0 xl:border-l xl:pt-0 xl:pl-1">
        {states.map((t) => {
          const zero = t.count === 0;
          const warn = t.warn && !zero;
          return (
            <Link
              key={t.key}
              href={t.href}
              title={t.hint}
              aria-label={`${t.label}: ${plural(t.count, 'well')}`}
              data-kpi={t.key}
              data-zero={zero || undefined}
              data-tone={warn ? 'warn' : undefined}
              className={cn(TILE, warn && 'border border-warn-line bg-warn-bg hover:bg-warn-bg/70')}
            >
              <span
                className={cn(
                  'text-lg leading-8 font-medium',
                  warn ? 'text-warn' : zero ? 'text-muted-foreground' : 'text-ink',
                )}
              >
                {t.count}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs whitespace-nowrap',
                  warn ? 'text-warn' : 'text-muted-foreground',
                )}
              >
                {warn ? <HistoryIcon aria-hidden="true" className="size-3" /> : null}
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
