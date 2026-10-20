// A derived assessment state (spec §5.1) as a small badge: always an icon and a label, so colour is
// never the only cue. Tones: `neutral` (final, draft, record changed, the wording-only note),
// `warn` (stale revision: the amber warning tokens, never a rank colour, spec §7) and `empty`
// (unscored: dashed and muted). Used by the Wells table's Assessment column and the well header.
import type { ComponentProps } from 'react';
import { CircleCheckIcon, CircleDashedIcon, HistoryIcon, PencilLineIcon, type LucideIcon } from 'lucide-react';
import type { AssessmentState } from '@/lib/derived';
import { cn } from '@/lib/utils';

export type StateTone = 'neutral' | 'warn' | 'empty';

const TONE: Record<StateTone, { badge: string; icon: string }> = {
  neutral: { badge: 'border-line bg-subtle text-ink', icon: 'text-muted-foreground' },
  warn: { badge: 'border-warn-line bg-warn-bg text-warn', icon: 'text-warn' },
  empty: { badge: 'border-dashed border-line-strong text-muted-foreground', icon: 'text-muted-foreground' },
};

export function StateBadge({
  icon: Icon,
  tone = 'neutral',
  className,
  children,
  ...props
}: ComponentProps<'span'> & { icon: LucideIcon; tone?: StateTone }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-xs whitespace-nowrap',
        TONE[tone].badge,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className={cn('size-3 shrink-0', TONE[tone].icon)} />
      {children}
    </span>
  );
}

const STATE_ICON = {
  unscored: CircleDashedIcon,
  draft: PencilLineIcon,
  final: CircleCheckIcon,
} as const;

/** A well's assessment state as one badge (the Wells table): amber only for a current final that is stale. */
export function AssessmentStateBadge({ state }: { state: AssessmentState }) {
  const { kind, stale, label } = state;
  const isStale = kind === 'final' && stale.stale;
  return (
    <StateBadge
      data-state-kind={kind}
      icon={isStale ? HistoryIcon : STATE_ICON[kind]}
      tone={isStale ? 'warn' : kind === 'unscored' ? 'empty' : 'neutral'}
    >
      {label}
    </StateBadge>
  );
}
