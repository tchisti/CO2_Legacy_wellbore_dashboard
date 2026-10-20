'use client';

// The well page (spec §4.3), reached as /wells/view?id=… because the app is a static export.
// For now it names the well, or says it was not found; the assessment, construction, location
// and history tabs come with the full well page.
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, FileQuestionIcon, NotebookTabsIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/lib/project-context';
import { wellsHref } from '@/lib/routes';
import { useStoreQuery } from '@/lib/store/provider';

const BackToWells = () => (
  <Link
    href={wellsHref()}
    className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
    Wells
  </Link>
);

function WellView() {
  const id = useSearchParams().get('id');
  const { activeProject } = useProjects();
  const well = useStoreQuery((s) => (id ? s.wells.get(id) : Promise.resolve(null)), [id]);

  if (well.loading) {
    return (
      <PageBody>
        <BackToWells />
        <p role="status" className="text-muted-foreground">
          Loading the well…
        </p>
      </PageBody>
    );
  }

  if (!well.data) {
    return (
      <PageBody>
        <BackToWells />
        <EmptyState
          icon={FileQuestionIcon}
          title="Well not found"
          action={
            <Button asChild variant="outline">
              <Link href={wellsHref()}>Back to Wells</Link>
            </Button>
          }
        >
          {well.error
            ? `The well could not be read: ${well.error.message}`
            : 'No well with this link is stored in this browser. It may have been deleted.'}
        </EmptyState>
      </PageBody>
    );
  }

  const w = well.data;
  return (
    <PageBody>
      <div className="grid gap-2">
        <BackToWells />
        <PageHeader title={w.licence} context={activeProject?.name} />
        {w.name || w.operator ? (
          <p className="-mt-1 text-sm text-muted-foreground">{[w.name, w.operator].filter(Boolean).join(' · ')}</p>
        ) : null}
      </div>
      <EmptyState icon={NotebookTabsIcon} title="Well page">
        This well&apos;s assessment, construction, location and history will appear here.
      </EmptyState>
    </PageBody>
  );
}

export default function WellViewPage() {
  return (
    <Suspense
      fallback={
        <PageBody>
          <p role="status" className="text-muted-foreground">
            Loading the well…
          </p>
        </PageBody>
      }
    >
      <WellView />
    </Suspense>
  );
}
