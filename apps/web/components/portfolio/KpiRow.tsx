// The Portfolio's count row (spec §4.1): how many wells, how many in each rank (with a small
// rank-colour accent, spec §7), then quieter tiles for the derived states that are KPIs (§5.1:
// unscored, drafts, stale revision, plus unknown-heavy; "record changed" is not a KPI, it shows on
// the Well page and in Needs attention). Every tile links into the Wells register filtered to
// exactly the wells it counts, so a number is one click from its wells; on a printed report
// (`linked={false}`) the same tiles are plain text. Counts are in the mono number face (§7). A zero
// stays in place, muted. Only a stale revision, when there is one, is amber.
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
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

/** One count: a tile that grows to share the row's spare width. */
const TILE = 'flex grow flex-col justify-center gap-0.5 rounded-md px-3 py-2';
const TILE_LINK = 'outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50';

type TileProps = {
  href: string;
  /** The link's accessible name (a plain tile reads as its text). */
  label: string;
  className?: string;
  title?: string;
  children: ReactNode;
  'data-kpi': string;
  'data-zero'?: true;
  'data-tone'?: 'warn';
};

/** A count tile: a link into the Wells register, or plain text when `linked` is false. */
function Tile({ linked, href, label, className, children, ...rest }: TileProps & { linked: boolean }) {
  if (!linked) {
    return (
      <div className={cn(TILE, className)} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <Link href={href} aria-label={label} className={cn(TILE, TILE_LINK, className)} {...rest}>
      {children}
    </Link>
  );
}

export function KpiRow({
  stats,
  rankLabels,
  linked = true,
  stacked = false,
}: {
  stats: PortfolioStats;
  rankLabels: readonly string[];
  /** False on a printed report: the counts are not links. */
  linked?: boolean;
  /** The state counts always on a row of their own (a column narrower than the window, e.g. a printed page). */
  stacked?: boolean;
}) {
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
  ];

  return (
    <div role="group" aria-label="Portfolio counts" className="flex flex-wrap rounded-lg border bg-surface p-1">
      {/* Two groups that wrap as wholes: the wells and their ranks, then the states (on their own row below xl). */}
      <div className="flex grow flex-wrap">
        <Tile linked={linked} href={wellsHref()} label={plural(stats.total, 'well')} data-kpi="total" className="grow-0 pr-6">
          <span className="flex items-baseline gap-1.5">
            <span data-kpi-count className="num text-2xl leading-8 font-semibold text-ink">
              {stats.total}
            </span>
            <span className="text-sm text-muted-foreground">{stats.total === 1 ? 'well' : 'wells'}</span>
          </span>
          <span className="text-xs text-muted-foreground">in this area of review</span>
        </Tile>

        <div className="flex grow flex-wrap sm:border-l sm:pl-1">
          {rankLabels.map((label) => {
            const count = stats.byRank[label] ?? 0;
            const colour = rankColour(label);
            return (
              <Tile
                key={label}
                linked={linked}
                href={wellsFilterHref({ rank: [label] })}
                label={`${label}: ${plural(count, 'well')}`}
                data-kpi={`rank:${label}`}
                data-zero={count === 0 || undefined}
              >
                <span
                  data-kpi-count
                  className={cn('num text-2xl leading-8 font-semibold', count === 0 ? 'text-muted-foreground' : 'text-ink')}
                >
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
              </Tile>
            );
          })}
        </div>
      </div>

      <div
        className={cn(
          'flex grow basis-full flex-wrap border-t pt-1',
          !stacked && 'xl:basis-auto xl:border-t-0 xl:border-l xl:pt-0 xl:pl-1',
        )}
      >
        {states.map((t) => {
          const zero = t.count === 0;
          const warn = t.warn && !zero;
          return (
            <Tile
              key={t.key}
              linked={linked}
              href={t.href}
              title={t.hint}
              label={`${t.label}: ${plural(t.count, 'well')}`}
              data-kpi={t.key}
              data-zero={zero || undefined}
              data-tone={warn ? 'warn' : undefined}
              className={cn(warn && 'border border-warn-line bg-warn-bg', warn && linked && 'hover:bg-warn-bg/70')}
            >
              <span
                data-kpi-count
                className={cn(
                  'num text-lg leading-8 font-medium',
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
            </Tile>
          );
        })}
      </div>
    </div>
  );
}
