'use client';

import { TableIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { useProjects } from '@/lib/project-context';

export default function WellsPage() {
  const { activeProject } = useProjects();
  return (
    <PageBody>
      <PageHeader title="Wells" context={activeProject?.name} />
      <EmptyState icon={TableIcon} title="Well register">
        Every well in this project, with its rank and assessment status, will be listed here.
      </EmptyState>
    </PageBody>
  );
}
