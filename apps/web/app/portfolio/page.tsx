'use client';

import { LayoutGridIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { useProjects } from '@/lib/project-context';

export default function PortfolioPage() {
  const { activeProject } = useProjects();
  return (
    <PageBody>
      <PageHeader title="Portfolio" context={activeProject?.name} />
      <EmptyState icon={LayoutGridIcon} title="Portfolio summary">
        Rank counts, the 5×5 risk matrix and the wells that need attention in this project will appear here.
      </EmptyState>
    </PageBody>
  );
}
