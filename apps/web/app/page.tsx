'use client';

// The entry URL: it opens Portfolio. With no project, ShellGate shows the first-run screen in
// place of every page, this one included, so the page itself only ever redirects.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProjects } from '@/lib/project-context';
import { ROUTES } from '@/lib/routes';

export default function HomePage() {
  const router = useRouter();
  const { activeProject } = useProjects();
  const hasProject = activeProject !== null;

  useEffect(() => {
    if (hasProject) router.replace(ROUTES.portfolio);
  }, [hasProject, router]);

  return (
    <p role="status" className="sr-only">
      Opening Portfolio…
    </p>
  );
}
