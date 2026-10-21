'use client';

// The portfolio report (spec §4.2 "Report: portfolio PDF of the current filter"), reached from the
// Wells toolbar as /report/portfolio?<the register's filters>. It prints, for the wells of that
// filter: the counts, the 5×5 matrix and the driver contributions (all computed over those wells
// only), the register in the Wells default order (riskiest first), the rank bands, and the identity
// footnote. Nothing on it is a link or a control except the screen-only toolbar.
import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DriverBars, DRIVER_CAPTION } from '@/components/portfolio/DriverBars';
import { KpiRow } from '@/components/portfolio/KpiRow';
import { Matrix5x5 } from '@/components/portfolio/Matrix5x5';
import { BandTable } from '@/components/methodology/BandTable';
import { RegisterTable } from '@/components/report/RegisterTable';
import { ReportFooter } from '@/components/report/ReportFooter';
import { ReportFrame, ReportMessage, ReportStatus, usePrintedAt } from '@/components/report/ReportFrame';
import { ReportHeader, ReportSection } from '@/components/report/ReportHeader';
import { Button } from '@/components/ui/button';
import { fmtDate, plural } from '@/lib/format';
import { portfolioStats } from '@/lib/portfolio';
import { useProjects } from '@/lib/project-context';
import { filterDescription } from '@/lib/report';
import { wellsHref } from '@/lib/routes';
import { useRegister } from '@/lib/use-register';
import { DEFAULT_SORT, applyFilters, filtersFromQuery, filtersToQuery, sortRows } from '@/lib/wells-view';

const LOADING = 'Loading the portfolio…';

function PortfolioReport() {
  const query = useSearchParams().toString();
  const filters = useMemo(() => filtersFromQuery(new URLSearchParams(query)), [query]);
  const { projects, activeProject } = useProjects();
  const { data, error } = useRegister(activeProject?.id ?? null);
  const printedAt = usePrintedAt();
  const backHref = wellsHref(filtersToQuery(filters));

  const report = useMemo(() => {
    if (!data) return null;
    const rows = sortRows(applyFilters(data.rows, filters), DEFAULT_SORT);
    return { rows, stats: portfolioStats(rows, data.finals, data.methodology) };
  }, [data, filters]);

  if (error) {
    return (
      <ReportMessage
        title="The portfolio could not be read"
        action={
          <Button asChild variant="outline">
            <Link href={backHref}>Back to Wells</Link>
          </Button>
        }
      >
        {error.message}
      </ReportMessage>
    );
  }
  if (!projects || (activeProject && !report)) return <ReportStatus>{LOADING}</ReportStatus>;
  if (!activeProject || !data || !report) {
    return (
      <ReportMessage
        title="No project to report on"
        action={
          <Button asChild variant="outline">
            <Link href={wellsHref()}>Back to Wells</Link>
          </Button>
        }
      >
        Create or open a project first; the portfolio report prints its wells.
      </ReportMessage>
    );
  }

  const { rows, stats } = report;
  const { methodology } = data;
  const finalOf = (id: string) => data.current.get(id) ?? null;
  const filter = filterDescription(filters);
  const revision = methodology.revision;

  return (
    <ReportFrame
      title={`Portfolio report ${activeProject.name}`}
      back={{ href: backHref, label: 'Wells' }}
      margins={{
        'top-left': activeProject.name,
        'top-right': `Portfolio report · ${filter}`,
        'bottom-left': `Methodology rev ${revision} · Printed ${fmtDate(printedAt)}`,
      }}
    >
      <ReportHeader
        project={activeProject.name}
        kind="Portfolio report"
        title="Portfolio report"
        subtitle={<span className="text-muted-foreground">{activeProject.name}</span>}
        meta={[
          { key: 'revision', label: 'Methodology rev', value: revision, mono: true },
          { key: 'wells', label: 'Wells', value: plural(rows.length, 'well') },
          { key: 'printed', label: 'Printed', value: fmtDate(printedAt), mono: true },
        ]}
      >
        <p data-filter className="text-sm text-ink">
          {filter}
        </p>
      </ReportHeader>

      <div data-section="counts" data-keep>
        <KpiRow stats={stats} rankLabels={methodology.matrix.bands.map((b) => b.label)} linked={false} stacked />
      </div>

      {stats.finals === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
          No current assessments in this selection.
        </p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2">
          <ReportSection
            name="matrix"
            title="Risk matrix"
            subtitle="Current assessments by likelihood and consequence rating"
            className="break-inside-avoid"
          >
            {(headingId) => <Matrix5x5 counts={stats.matrix} methodology={methodology} labelledBy={headingId} />}
          </ReportSection>
          <ReportSection
            name="drivers"
            title="Driver contribution"
            subtitle="Which parameters carry the risk"
            className="break-inside-avoid"
          >
            {() => (
              <div className="space-y-3">
                <DriverBars drivers={stats.drivers} />
                <p className="text-xs text-muted-foreground">{DRIVER_CAPTION}</p>
              </div>
            )}
          </ReportSection>
        </div>
      )}

      <ReportSection
        name="register"
        title="Wells"
        subtitle={rows.length > 0 ? 'Riskiest first: highest Risk Index first, unscored wells last' : undefined}
      >
        {(headingId) =>
          rows.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
              No wells match this filter.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <RegisterTable rows={rows} assessedAt={(id) => finalOf(id)?.assessedAt ?? null} labelledBy={headingId} />
            </div>
          )
        }
      </ReportSection>

      <ReportSection name="bands" title={`Rank bands (methodology rev ${revision})`} className="break-inside-avoid">
        {(headingId) => <BandTable methodology={methodology} labelledBy={headingId} />}
      </ReportSection>

      <ReportFooter />
    </ReportFrame>
  );
}

export default function PortfolioReportPage() {
  return (
    <Suspense fallback={<ReportStatus>{LOADING}</ReportStatus>}>
      <PortfolioReport />
    </Suspense>
  );
}
