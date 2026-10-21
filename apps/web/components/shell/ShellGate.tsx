'use client';

// Decides what the app shows around a page: the first-run screen while there is no project,
// otherwise the top bar, the section tabs and the page, with the reviewer profile asked for until
// one is set. A print report (/report/*) is a document: it gets none of that, only the page, which
// handles its own loading and missing data.
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ProfileGate } from '@/components/profile/ProfileGate';
import { FirstRun } from '@/components/shell/FirstRun';
import { NavTabs } from '@/components/shell/NavTabs';
import { ShellError, ShellFrame, ShellLoading } from '@/components/shell/ShellStatus';
import { TopBar } from '@/components/shell/TopBar';
import { useProjects } from '@/lib/project-context';
import { isReportPath } from '@/lib/routes';

export function ShellGate({ children }: { children: ReactNode }) {
  const { projects, error } = useProjects();
  const report = isReportPath(usePathname());

  if (report) return children;
  if (error) return <ShellError title="Your projects could not be read" error={error} />;
  if (!projects) return <ShellLoading />;
  if (projects.length === 0) {
    return (
      <ShellFrame>
        <main className="flex-1">
          <FirstRun />
        </main>
      </ShellFrame>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium ring-1 ring-line focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <TopBar />
      <NavTabs />
      <main id="main" className="flex-1">
        {children}
      </main>
      <ProfileGate />
    </div>
  );
}
