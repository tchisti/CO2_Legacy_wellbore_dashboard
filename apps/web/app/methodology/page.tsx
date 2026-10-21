'use client';

// The Methodology page (spec §4.6): the rulebook every assessment is scored against, read-only.
// It shows the current revision's parameters, rank bands and the Type 1–9 classification with the
// adapted Figure A-4, where they come from, and the revisions this project has seen. Editing the
// methodology is the Phase 2 admin editor; nothing here changes it.
import { TriangleAlertIcon } from 'lucide-react';
import { BandTable } from '@/components/methodology/BandTable';
import { ClassificationTable } from '@/components/methodology/ClassificationTable';
import { FigureA4 } from '@/components/methodology/FigureA4';
import { ParamTable } from '@/components/methodology/ParamTable';
import { RevisionList } from '@/components/methodology/RevisionList';
import { Section } from '@/components/methodology/Section';
import { Citation, Sources } from '@/components/methodology/Sources';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { fmtDate } from '@/lib/format';
import { useProjects } from '@/lib/project-context';
import { useStoreQuery } from '@/lib/store/provider';

export default function MethodologyPage() {
  const { activeProject } = useProjects();
  const { data, error } = useStoreQuery(
    async (s) => {
      const [current, records] = await Promise.all([s.methodology.current(), s.methodology.list()]);
      return { current, records };
    },
    [],
  );

  const header = (
    <PageHeader
      title="Methodology"
      context={activeProject?.name}
      actions={
        data ? (
          <p className="text-xs text-muted-foreground">
            <span>
              rev{' '}
              <span data-header-rev className="num text-ink">
                {data.current.revision}
              </span>
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              updated {fmtDate(data.current.updatedAt)} by {data.current.updatedBy}
            </span>
          </p>
        ) : null
      }
    />
  );

  if (error) {
    return (
      <PageBody>
        {header}
        <EmptyState icon={TriangleAlertIcon} title="The methodology could not be read">
          <span role="alert" className="font-mono text-xs">
            {error.message}
          </span>
        </EmptyState>
      </PageBody>
    );
  }

  if (!data) {
    return (
      <PageBody>
        {header}
        <p role="status" className="text-muted-foreground">
          Loading methodology…
        </p>
      </PageBody>
    );
  }

  const { current, records } = data;
  return (
    <PageBody>
      {header}
      <p className="max-w-3xl text-sm">
        Each parameter is scored from 1 (best) to 5 (worst), or marked Unknown, which scores as that parameter&apos;s own
        Unknown score. Likelihood (L) and Consequence (C) are weighted sums of their parameters&apos; scores; the weights
        on each axis add up to 1.00. A well&apos;s rank comes from its matrix cell, round(L) × round(C), read against the
        bands below. The Risk Index, L × C, only breaks ties between wells in the same cell.
      </p>

      <Section title="Scoring parameters">{(id) => <ParamTable methodology={current} labelledBy={id} />}</Section>

      <Section title="Rank bands">{(id) => <BandTable methodology={current} labelledBy={id} />}</Section>

      <Section title="Legacy well classification" subtitle="Types 1–9 (Table A-1, Figure A-4)">
        {(id) => (
          <div className="grid gap-4">
            <FigureA4 />
            <ClassificationTable wellTypes={current.wellTypes} labelledBy={id} />
          </div>
        )}
      </Section>

      <Section title="Sources">
        {() => (
          <div className="grid gap-2">
            <Sources />
            <Citation />
          </div>
        )}
      </Section>

      <Section title="Revisions in this project">
        {(id) => <RevisionList records={records} currentRevision={current.revision} labelledBy={id} />}
      </Section>
    </PageBody>
  );
}
