'use client';

import { BookOpenIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { useProjects } from '@/lib/project-context';

export default function MethodologyPage() {
  const { activeProject } = useProjects();
  return (
    <PageBody>
      <PageHeader title="Methodology" context={activeProject?.name} />
      <EmptyState icon={BookOpenIcon} title="Scoring methodology">
        The parameters, weights and rank bands every assessment is scored against will be shown here.
      </EmptyState>
    </PageBody>
  );
}
