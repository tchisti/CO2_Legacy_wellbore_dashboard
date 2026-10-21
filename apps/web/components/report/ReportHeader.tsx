// The head of a printed report (spec §7: project, methodology revision, reviewer, date): the
// project and the kind of report on one line, the subject as the page's one heading (a well's
// licence, or "Portfolio report") with its verdict beside it, then the facts the report was made
// under as a row of labelled values, and whatever else the report adds (the well record, the
// filter). Also the titled section every later part of a report is.
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type MetaItem = {
  /** Also the item's data-meta attribute: "revision", "reviewer", "assessed", "printed". */
  key: string;
  label: string;
  value: ReactNode;
  /** Numbers and dates are set in the mono face. */
  mono?: boolean;
};

export function ReportHeader({
  project,
  kind,
  title,
  mono = false,
  subtitle,
  verdict,
  meta,
  children,
}: {
  project: string | null | undefined;
  /** "Well dossier", "Portfolio report". */
  kind: string;
  title: string;
  /** The title is a licence (mono). */
  mono?: boolean;
  subtitle?: ReactNode;
  verdict?: ReactNode;
  meta: readonly MetaItem[];
  children?: ReactNode;
}) {
  return (
    <header data-section="header" className="grid gap-4 border-b pb-5">
      <div className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground">
        <p className="min-w-0 truncate">{project}</p>
        <p className="shrink-0 font-medium tracking-wide uppercase">{kind}</p>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <h1 className={cn('text-xl font-semibold tracking-tight text-ink', mono && 'font-mono break-all')}>{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm">{subtitle}</div> : null}
        </div>
        {verdict ? <div className="grid justify-items-start gap-1">{verdict}</div> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md bg-subtle px-3 py-2 sm:grid-cols-4">
        {meta.map((m) => (
          <div key={m.key} data-meta={m.key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{m.label}</dt>
            <dd className={cn('truncate text-ink', m.mono && 'num')}>{m.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </header>
  );
}

/**
 * A titled part of a report; `children` gets the heading's id, to name a table by. Laid out as plain
 * blocks, not a grid, so the browser can break it across pages cleanly; the heading (with its
 * subtitle) is never left alone at the foot of a page.
 */
export function ReportSection({
  name,
  title,
  subtitle,
  className,
  children,
}: {
  /** The section's data-section attribute: "summary", "scores", … */
  name: string;
  title: string;
  subtitle?: ReactNode;
  className?: string;
  children: (headingId: string) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section data-section={name} aria-labelledby={headingId} className={cn('min-w-0 space-y-2.5', className)}>
      <div data-keep-with-next>
        <h2 id={headingId} className="text-sm font-semibold text-ink">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children(headingId)}
    </section>
  );
}
