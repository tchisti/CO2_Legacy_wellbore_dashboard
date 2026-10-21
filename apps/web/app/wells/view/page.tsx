'use client';

// The well page (spec §4.3), reached as /wells/view?id=… because the app is a static export. It
// leads with the verdict (WellHeader) and keeps the evidence one click away in three tabs whose
// choice lives in the URL (`tab=`). `score=1` opens the score flow over the page; closing it drops
// `score` and keeps the tab. A well that is not stored here, or belongs to another project than the
// active one, is "not found" (and never opens the score flow).
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftIcon, FileQuestionIcon } from 'lucide-react';
import { ConstructionEditor, DiscardConstructionDialog } from '@/components/construction/ConstructionEditor';
import { ScoreSheet } from '@/components/score/ScoreSheet';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { AssessmentView } from '@/components/well/AssessmentView';
import { HistoryTab } from '@/components/well/HistoryTab';
import { WellHeader } from '@/components/well/WellHeader';
import { WellTabs } from '@/components/well/WellTabs';
import { EditWellDialog } from '@/components/wells/EditWellDialog';
import { assessmentState } from '@/lib/derived';
import { useProjects } from '@/lib/project-context';
import { wellHref, wellsHref, type WellTab } from '@/lib/routes';
import { useStoreQuery } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';
import { useWellTab } from '@/lib/use-well-tab';

/**
 * The well with its project (injectors, for the score flow), its assessments and the methodologies
 * needed to show them; null when there is no such well.
 */
async function loadWell(s: Store, id: string) {
  const well = await s.wells.get(id);
  if (!well) return null;
  const [project, current, draft, assessments, records, methodology] = await Promise.all([
    s.projects.get(well.projectId),
    s.assessments.current(id),
    s.assessments.draft(id),
    s.assessments.listForWell(id),
    s.methodology.list(),
    s.methodology.current(),
  ]);
  return { well, project, current, draft, assessments, records, methodology };
}

const BackToWells = () => (
  <Link
    href={wellsHref()}
    className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
    Wells
  </Link>
);

const Loading = () => (
  <PageBody>
    <p role="status" className="text-muted-foreground">
      Loading the well…
    </p>
  </PageBody>
);

function NotFound({ reason }: { reason: string }) {
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
        {reason}
      </EmptyState>
    </PageBody>
  );
}

function WellView({ id }: { id: string }) {
  const { activeProject } = useProjects();
  const router = useRouter();
  const scoring = useSearchParams().get('score') === '1';
  const [tab, setTab] = useWellTab(id);
  const [editing, setEditing] = useState(false);
  // Leaving the Construction tab with unsaved changes asks first (the tab unmounts its working copy).
  const [constructionDirty, setConstructionDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<WellTab | null>(null);
  const changeTab = (next: WellTab) => {
    if (tab === 'construction' && next !== tab && constructionDirty) setPendingTab(next);
    else setTab(next);
  };
  const page = useStoreQuery((s) => (id ? loadWell(s, id) : Promise.resolve(null)), [id]);

  if (page.loading) return <Loading />;
  if (page.error) return <NotFound reason={`The well could not be read: ${page.error.message}`} />;
  if (!page.data) return <NotFound reason="No well with this link is stored in this browser. It may have been deleted." />;

  const { well, project, current, draft, assessments, records, methodology } = page.data;
  if (activeProject && well.projectId !== activeProject.id) {
    return <NotFound reason="This well belongs to another project. Switch to that project to open it." />;
  }

  const state = assessmentState({ current, draft, well, currentRevision: methodology.revision });
  return (
    <PageBody>
      <div className="grid gap-3">
        <BackToWells />
        <WellHeader
          well={well}
          current={current}
          draft={draft}
          state={state}
          currentRevision={methodology.revision}
          wellTypes={methodology.wellTypes}
          projectName={activeProject?.name}
          onEdit={() => setEditing(true)}
        />
      </div>
      <WellTabs
        tab={tab}
        onTabChange={changeTab}
        panels={{
          assessment: (
            <AssessmentView
              wellId={well.id}
              current={current}
              draft={draft}
              assessments={assessments}
              methodologies={{ records, current: methodology }}
            />
          ),
          construction: <ConstructionEditor well={well} onDirtyChange={setConstructionDirty} />,
          history: <HistoryTab well={well} />,
        }}
      />
      <DiscardConstructionDialog
        open={pendingTab !== null}
        onKeep={() => setPendingTab(null)}
        onDiscard={() => {
          if (pendingTab) setTab(pendingTab);
          setPendingTab(null);
          setConstructionDirty(false);
        }}
      />
      <EditWellDialog
        well={editing ? well : null}
        open={editing}
        onOpenChange={setEditing}
        wellTypes={methodology.wellTypes}
      />
      {scoring ? (
        <ScoreSheet
          well={well}
          project={project}
          methodology={methodology}
          current={current}
          draft={draft}
          onClosed={() => router.replace(wellHref(well.id, { tab }), { scroll: false })}
        />
      ) : null}
    </PageBody>
  );
}

function WellViewFromQuery() {
  const id = useSearchParams().get('id') ?? '';
  // Keyed by id: another well starts on its own tab, with no dialog open.
  return <WellView key={id} id={id} />;
}

export default function WellViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <WellViewFromQuery />
    </Suspense>
  );
}
