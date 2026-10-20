'use client';

// The entry URL: Portfolio when a project exists, the first-run screen when none does.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FirstRun } from '@/components/shell/FirstRun';
import { useProjects } from '@/lib/project-context';
import { ROUTES } from '@/lib/routes';

export default function HomePage() {
  const router = useRouter();
  const { projects, activeProject } = useProjects();
  const hasProject = activeProject !== null;

  useEffect(() => {
    if (hasProject) router.replace(ROUTES.portfolio);
  }, [hasProject, router]);

  if (projects && projects.length === 0) return <FirstRun />;
  return (
    <p role="status" className="sr-only">
      Opening Portfolio…
    </p>
  );
}
