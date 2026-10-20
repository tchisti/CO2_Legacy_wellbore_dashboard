'use client';

import { SlidersHorizontalIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { useProjects } from '@/lib/project-context';

export default function SettingsPage() {
  const { activeProject } = useProjects();
  return (
    <PageBody>
      <PageHeader title="Project settings" context={activeProject?.name} />
      <EmptyState icon={SlidersHorizontalIcon} title="Project details">
        The project name, jurisdiction, injectors and formations will be edited here.
      </EmptyState>
    </PageBody>
  );
}
