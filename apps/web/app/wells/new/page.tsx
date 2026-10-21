'use client';

// A new well, entered by hand: the record only (scores come later, on the well page). Saving
// returns to the register, where the well appears Unscored.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { WellForm } from '@/components/wells/WellForm';
import { useProjects } from '@/lib/project-context';
import { wellsHref } from '@/lib/routes';
import { useStore, useStoreQuery } from '@/lib/store/provider';

export default function NewWellPage() {
  const router = useRouter();
  const store = useStore();
  const { activeProject } = useProjects();
  const methodology = useStoreQuery((s) => s.methodology.current(), []);

  return (
    <PageBody>
      <div className="grid gap-2">
        <Link
          href={wellsHref()}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
          Wells
        </Link>
        <PageHeader title="New well" context={activeProject?.name} />
      </div>
      <section aria-label="Well record" className="w-full max-w-3xl rounded-lg border bg-surface p-5">
        <WellForm
          autoFocus
          submitLabel="Create well"
          wellTypes={methodology.data?.wellTypes}
          onCancel={() => router.push(wellsHref())}
          onSubmit={async (fields) => {
            if (!activeProject) throw new Error('There is no active project to add the well to.');
            await store.wells.create(activeProject.id, fields);
            toast.success('Well created');
            router.push(wellsHref());
          }}
        />
      </section>
    </PageBody>
  );
}
