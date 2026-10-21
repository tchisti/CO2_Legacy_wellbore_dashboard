'use client';

// Project settings (spec §4.7): one page with anchored sections. The project's identity, its
// geometry (CO₂ injectors with their AoR radius, which drive the Score flow's plume suggestion,
// and the formation column), the reviewer profile of this browser, backup (export/import of the
// project file: Phase 1's only backup and hand-off) and the danger zone. Users and roles wait for
// sign-in (spec §11.1), so there is no section for them yet.
import { TriangleAlertIcon } from 'lucide-react';
import { BackupPanel } from '@/components/settings/BackupPanel';
import { DangerZone } from '@/components/settings/DangerZone';
import { FormationsEditor } from '@/components/settings/FormationsEditor';
import { InjectorsEditor } from '@/components/settings/InjectorsEditor';
import { ProjectForm } from '@/components/settings/ProjectForm';
import { ReviewerProfilePanel } from '@/components/settings/ReviewerProfilePanel';
import { SettingsNav, SettingsSection } from '@/components/settings/SettingsSection';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { useProjects } from '@/lib/project-context';

export default function SettingsPage() {
  const { activeProject: project, error } = useProjects();
  const header = <PageHeader title="Project settings" context={project?.name} />;

  if (error) {
    return (
      <PageBody>
        {header}
        <EmptyState icon={TriangleAlertIcon} title="The project could not be read">
          <span role="alert" className="font-mono text-xs">
            {error.message}
          </span>
        </EmptyState>
      </PageBody>
    );
  }

  if (!project) {
    return (
      <PageBody>
        {header}
        <p role="status" className="text-muted-foreground">
          Loading the project…
        </p>
      </PageBody>
    );
  }

  return (
    <PageBody>
      {header}
      <div className="grid gap-8 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <SettingsNav className="hidden self-start lg:sticky lg:top-6 lg:block" />
        <div className="grid min-w-0 max-w-4xl gap-10">
          {/* Keyed by project: switching projects starts every editor from that project's values. */}
          <SettingsSection id="project" description="How the project is named across the app and in reports.">
            <ProjectForm key={project.id} project={project} />
          </SettingsSection>

          <SettingsSection
            id="injectors"
            description="The CO₂ injection wells and the radius of each one’s area of review. The Score flow measures every well’s distance to the nearest injector to suggest Position vs Plume & Pressure Front."
          >
            <InjectorsEditor key={project.id} project={project} />
          </SettingsSection>

          <SettingsSection
            id="formations"
            description="The formations from the surface down, with the seal and the reservoir of the storage complex marked."
          >
            <FormationsEditor key={project.id} project={project} />
          </SettingsSection>

          <SettingsSection
            id="profile"
            description="Your identity is local to this browser in Phase 1 (there is no sign-in yet) and is not verified. Your name is recorded as the reviewer on the assessments you finalise, and on every change you make."
          >
            <ReviewerProfilePanel />
          </SettingsSection>

          <SettingsSection
            id="backup"
            description="The project lives in this browser only. A project file is its backup, and the way to hand it to someone else."
          >
            <BackupPanel project={project} />
          </SettingsSection>

          <SettingsSection id="danger-zone">
            <DangerZone key={project.id} project={project} />
          </SettingsSection>
        </div>
      </div>
    </PageBody>
  );
}
