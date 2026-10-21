'use client';

// The Portfolio, home of a project (spec §4.1): one screen, no scrolling at 1440×900, answering
// "what is the state of the area of review and what needs attention". Counts by rank and state,
// the 5×5 matrix of current assessments, the wells to look at next, and which parameters carry the
// risk. Every count and populated cell links into the Wells register filtered to its wells.
import { useId, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { GaugeIcon, LayoutGridIcon, PlusIcon, TriangleAlertIcon, UploadIcon } from 'lucide-react';
import { DriverBars, DRIVER_CAPTION } from '@/components/portfolio/DriverBars';
import { KpiRow } from '@/components/portfolio/KpiRow';
import { Matrix5x5 } from '@/components/portfolio/Matrix5x5';
import { NeedsAttention } from '@/components/portfolio/NeedsAttention';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/format';
import { portfolioStats, wellsFilterHref } from '@/lib/portfolio';
import { useProjects } from '@/lib/project-context';
import { newWellHref, wellsHref } from '@/lib/routes';
import { useRegister } from '@/lib/use-register';
import { cn } from '@/lib/utils';

const cellHref = (Lr: number, Cr: number): string => wellsFilterHref({ cell: { Lr, Cr } });

/** A titled panel of the Portfolio; the body fills the panel, so panels in a row share one height. */
function Panel({
  title,
  subtitle,
  aside,
  className,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: (headingId: string) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-medium">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {aside}
      </div>
      <div className="flex flex-1 flex-col rounded-lg border bg-surface">{children(headingId)}</div>
    </section>
  );
}

/** What the matrix and the drivers show while no well has a current final. */
function NoFinals({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="grid size-8 place-items-center rounded-full bg-subtle text-muted-foreground">
        <GaugeIcon aria-hidden="true" className="size-4" />
      </span>
      <p className="text-sm font-medium">No current assessments yet</p>
      <p className="max-w-xs text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

export default function PortfolioPage() {
  const { activeProject } = useProjects();
  const { data, error } = useRegister(activeProject?.id ?? null);
  const stats = useMemo(() => (data ? portfolioStats(data.rows, data.finals, data.methodology) : null), [data]);

  const header = (
    <PageHeader
      title="Portfolio"
      context={activeProject?.name}
      actions={
        data ? (
          <p className="text-xs text-muted-foreground">
            Methodology rev <span className="num text-ink">{data.methodology.revision}</span>
          </p>
        ) : null
      }
    />
  );

  if (error) {
    return (
      <PageBody>
        {header}
        <EmptyState icon={TriangleAlertIcon} title="The portfolio could not be read">
          <span role="alert" className="font-mono text-xs">
            {error.message}
          </span>
        </EmptyState>
      </PageBody>
    );
  }

  if (!data || !stats) {
    return (
      <PageBody>
        {header}
        <p role="status" className="text-muted-foreground">
          Loading portfolio…
        </p>
      </PageBody>
    );
  }

  if (stats.total === 0) {
    return (
      <PageBody>
        {header}
        <EmptyState
          icon={LayoutGridIcon}
          title="No wells in this project yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href={newWellHref()}>
                  <PlusIcon aria-hidden="true" />
                  New well
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={wellsHref()}>
                  <UploadIcon aria-hidden="true" />
                  Import
                </Link>
              </Button>
            </div>
          }
        >
          Add the wells of this area of review. Their ranks, the risk matrix and what needs attention appear here once
          they are scored.
        </EmptyState>
      </PageBody>
    );
  }

  const noFinals = stats.finals === 0;
  return (
    <PageBody>
      {header}
      <KpiRow stats={stats} rankLabels={data.methodology.matrix.bands.map((b) => b.label)} />
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Risk matrix" subtitle="Current assessments by likelihood and consequence rating">
          {(headingId) =>
            noFinals ? (
              <NoFinals>Finalise a well&apos;s assessment to place it on the matrix.</NoFinals>
            ) : (
              <Matrix5x5
                counts={stats.matrix}
                methodology={data.methodology}
                hrefFor={cellHref}
                labelledBy={headingId}
                className="flex-1 content-center px-4 py-4"
              />
            )
          }
        </Panel>

        <Panel
          title="Needs attention"
          subtitle="Wells to look at next, most pressing reason first"
          aside={
            stats.attentionTotal > 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground">{plural(stats.attentionTotal, 'well')}</span>
            ) : null
          }
        >
          {() => (
            <NeedsAttention
              items={stats.attention}
              total={stats.attentionTotal}
              upToDate={stats.total - stats.attentionTotal}
            />
          )}
        </Panel>

        <Panel
          title="Driver contribution"
          subtitle="Which parameters carry the risk"
          className="md:col-span-2 xl:col-span-1"
        >
          {() =>
            noFinals ? (
              <NoFinals>Contributions appear once wells have a final assessment.</NoFinals>
            ) : (
              <div className="grid gap-3 px-4 py-3">
                <DriverBars drivers={stats.drivers} />
                <p className="text-xs text-muted-foreground">{DRIVER_CAPTION}</p>
              </div>
            )
          }
        </Panel>
      </div>
    </PageBody>
  );
}
