'use client';

// Everything the root layout wraps a page in: the store (opened in the browser only), the active
// project, tooltips, and the shell itself. The layout stays a server component around this. A print
// report opens the store behind a plain status line, not the app's header (ShellGate leaves the
// chrome out of reports).
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ReportStatus } from '@/components/report/ReportFrame';
import { ShellGate } from '@/components/shell/ShellGate';
import { ShellError, ShellLoading } from '@/components/shell/ShellStatus';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { isReportPath } from '@/lib/routes';
import { StoreProvider } from '@/lib/store/provider';

const renderStoreError = (error: Error) => <ShellError error={error} />;

export function AppShell({ children }: { children: ReactNode }) {
  const report = isReportPath(usePathname());
  return (
    <StoreProvider fallback={report ? <ReportStatus /> : <ShellLoading />} renderError={renderStoreError}>
      <ProjectProvider>
        <TooltipProvider>
          <ShellGate>{children}</ShellGate>
        </TooltipProvider>
      </ProjectProvider>
    </StoreProvider>
  );
}
