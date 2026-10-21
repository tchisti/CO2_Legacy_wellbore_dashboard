'use client';

// The well dossier (spec §4.3 "Report"), reached as /report/well?id=… (static export: the id is in
// the query). A document to print or save as PDF for a regulator: see DossierSections for what it
// holds. A well that is not stored here, or belongs to another project than the active one, is
// "Well not found", with the way back to Wells.
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Dossier } from '@/components/report/DossierSections';
import { ReportFrame, ReportMessage, ReportStatus, usePrintedAt } from '@/components/report/ReportFrame';
import { Button } from '@/components/ui/button';
import { loadWell } from '@/lib/load-well';
import { useProjects } from '@/lib/project-context';
import { reportAttribution } from '@/lib/report';
import { wellHref, wellsHref } from '@/lib/routes';
import { useStoreQuery } from '@/lib/store/provider';

const LOADING = 'Loading the well…';

function WellNotFound({ reason }: { reason: string }) {
  return (
    <ReportMessage
      title="Well not found"
      action={
        <Button asChild variant="outline">
          <Link href={wellsHref()}>Back to Wells</Link>
        </Button>
      }
    >
      {reason}
    </ReportMessage>
  );
}

function WellReport({ id }: { id: string }) {
  const { projects, activeProject } = useProjects();
  const printedAt = usePrintedAt();
  const page = useStoreQuery((s) => (id ? loadWell(s, id) : Promise.resolve(null)), [id]);

  if (page.loading || !projects) return <ReportStatus>{LOADING}</ReportStatus>;
  if (page.error) return <WellNotFound reason={`The well could not be read: ${page.error.message}`} />;
  if (!page.data) return <WellNotFound reason="No well with this link is stored in this browser. It may have been deleted." />;
  const { well, project, current } = page.data;
  if (activeProject && well.projectId !== activeProject.id) {
    return <WellNotFound reason="This well belongs to another project. Switch to that project to print it." />;
  }

  return (
    <ReportFrame
      title={`Well dossier ${well.licence}`}
      back={{ href: wellHref(well.id), label: 'well' }}
      margins={{
        'top-left': project?.name ?? '',
        'top-right': `Well dossier · ${well.licence}`,
        'bottom-left': reportAttribution(current, printedAt),
      }}
    >
      <Dossier data={page.data} printedAt={printedAt} />
    </ReportFrame>
  );
}

function WellReportFromQuery() {
  const id = useSearchParams().get('id') ?? '';
  return <WellReport key={id} id={id} />;
}

export default function WellReportPage() {
  return (
    <Suspense fallback={<ReportStatus>{LOADING}</ReportStatus>}>
      <WellReportFromQuery />
    </Suspense>
  );
}
