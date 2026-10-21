'use client';

// The screen a browser with no projects opens on: create a project, or import a project file
// (a colleague's export or the v2 migration). Either way the new project becomes active and the
// app opens on Portfolio, where the reviewer profile is asked for if none is set (ProfileGate).
import { useRouter } from 'next/navigation';
import { ImportProjectFile } from '@/components/projects/ImportProjectFile';
import { CreateProjectForm } from '@/components/projects/CreateProjectForm';
import { useProjectId } from '@/lib/project-context';
import { ROUTES } from '@/lib/routes';

export function FirstRun() {
  const router = useRouter();
  const [, setProjectId] = useProjectId();

  function open(projectId: string) {
    setProjectId(projectId);
    router.replace(ROUTES.portfolio);
  }

  return (
    <section aria-labelledby="first-run-title" className="mx-auto w-full max-w-md px-4 py-16">
      <h1 id="first-run-title" className="text-xl font-semibold tracking-tight">
        Create your first project
      </h1>
      <p className="mt-2 text-muted-foreground">
        A project holds the wells of one area of review, their risk assessments and a record of every change. It is
        kept in this browser; export it to back it up or share it.
      </p>

      <div className="mt-8 rounded-lg border bg-surface">
        <div className="p-5">
          <CreateProjectForm autoFocus onCreated={(p) => open(p.id)} />
        </div>
        <div className="border-t p-5">
          <p className="mb-2 text-sm font-medium">Or start from a project file</p>
          <ImportProjectFile onImported={open} />
        </div>
      </div>
    </section>
  );
}
