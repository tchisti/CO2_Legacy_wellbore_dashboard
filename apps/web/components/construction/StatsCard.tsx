// The schematic's statistics (schematic spec 2026-08-07 §6), from the engine's wellboreStats, in
// the active unit: TD, casing strings, plugs (count, deepest, longest, total plugged interval and
// its share of TD), open hole, perforated intervals and formation tops. A value that cannot be
// worked out (no TD, no plugs) shows as '—', never as 0. Two columns from 640 px, or one where the
// card sits in a narrow column (the printed dossier, beside the schematic).
import { useId } from 'react';
import { wellboreStats, type DepthUnit, type WellboreInput } from '@lwa/engine';
import { MISSING, fmt1, fmtDepth } from '@/lib/format';
import { cn } from '@/lib/utils';

export function StatsCard({
  wellbore,
  unit,
  columns = 2,
}: {
  wellbore: WellboreInput | null;
  unit: DepthUnit;
  columns?: 1 | 2;
}) {
  const headingId = useId();
  const s = wellboreStats(wellbore);
  const items: readonly { key: string; label: string; value: string }[] = [
    { key: 'td', label: 'TD', value: fmtDepth(s.td, unit) },
    { key: 'casings', label: 'Casing strings', value: String(s.casingCount) },
    { key: 'plugs', label: 'Plugs', value: String(s.plugCount) },
    { key: 'deepest', label: 'Deepest plug', value: fmtDepth(s.deepestPlug, unit) },
    { key: 'longest', label: 'Longest plug', value: fmtDepth(s.longestPlug, unit) },
    { key: 'plugged', label: 'Total plugged interval', value: fmtDepth(s.pluggedTotal, unit) },
    { key: 'coverage', label: 'Plug coverage', value: s.coveragePct === null ? MISSING : `${fmt1(s.coveragePct)} %` },
    { key: 'openHole', label: 'Open-hole length', value: fmtDepth(s.openHoleLen, unit) },
    { key: 'perfs', label: 'Perforated intervals', value: String(s.perfCount) },
    { key: 'formations', label: 'Formation tops', value: String(s.formationCount) },
  ];
  return (
    <section aria-labelledby={headingId} className="rounded-lg border bg-surface">
      <h3 id={headingId} className="border-b px-3 py-2 text-xs font-semibold tracking-wide text-ink uppercase">
        Statistics
      </h3>
      <dl className={cn('grid grid-cols-1 gap-x-6 px-3 py-1.5 text-[13px]', columns === 2 && 'sm:grid-cols-2')}>
        {items.map((item) => (
          <div
            key={item.key}
            className={cn(
              'flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed py-1 last:border-b-0',
              columns === 2 && 'sm:[&:nth-last-child(2)]:border-b-0',
            )}
          >
            <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
            <dd data-stat={item.key} className="num shrink-0 text-ink">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
