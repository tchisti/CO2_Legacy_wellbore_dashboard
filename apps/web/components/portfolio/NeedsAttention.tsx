// Needs attention (spec §4.1): the wells to look at next, each once under its most pressing reason
// (lib/portfolio.ts: stale revision, record changed, unknown-heavy, draft, unscored). Each row
// opens the well. The reason is a state badge; only a stale revision is amber (spec §5.1).
import Link from 'next/link';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  FilePenLineIcon,
  HistoryIcon,
  PencilLineIcon,
  type LucideIcon,
} from 'lucide-react';
import { StateBadge, type StateTone } from '@/components/domain/StateBadge';
import { wellHref, wellsHref } from '@/lib/routes';
import { ATTENTION_MAX, type AttentionItem, type AttentionKind } from '@/lib/portfolio';

const KIND: Record<AttentionKind, { icon: LucideIcon; tone: StateTone }> = {
  stale: { icon: HistoryIcon, tone: 'warn' },
  recordChanged: { icon: FilePenLineIcon, tone: 'neutral' },
  unknownHeavy: { icon: CircleHelpIcon, tone: 'neutral' },
  draft: { icon: PencilLineIcon, tone: 'neutral' },
  unscored: { icon: CircleDashedIcon, tone: 'empty' },
};

export function NeedsAttention({
  items,
  total,
  upToDate,
}: {
  items: readonly AttentionItem[];
  /** How many wells need attention (items holds at most ATTENTION_MAX of them). */
  total: number;
  /** How many wells need nothing. */
  upToDate: number;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span className="grid size-8 place-items-center rounded-full bg-subtle text-muted-foreground">
          <CircleCheckIcon aria-hidden="true" className="size-4" />
        </span>
        <p className="text-sm font-medium">Nothing needs attention</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Every well has a current assessment under the current methodology, with its record unchanged since.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col">
      <ul className="divide-y">
        {items.map((item) => {
          const { icon, tone } = KIND[item.kind];
          return (
            <li key={item.wellId} data-attention={item.kind}>
              <Link
                href={wellHref(item.wellId)}
                className="flex items-center gap-3 px-3 py-2 outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="num truncate text-[13px] text-ink">{item.licence}</span>
                  <span className="truncate text-xs text-muted-foreground">{item.name || 'Unnamed well'}</span>
                </span>
                <StateBadge icon={icon} tone={tone} className="shrink-0">
                  {item.reason}
                </StateBadge>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CircleCheckIcon aria-hidden="true" className="size-3.5" />
          {upToDate === 0
            ? 'No well is up to date yet'
            : upToDate === 1
              ? 'The other well is up to date'
              : `The other ${upToDate} wells are up to date`}
        </span>
        {total > ATTENTION_MAX ? (
          <span className="inline-flex items-center gap-3">
            <span>
              {items.length} of {total} shown
            </span>
            <Link
              href={wellsHref()}
              className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              View all in Wells
            </Link>
          </span>
        ) : null}
      </div>
    </div>
  );
}
