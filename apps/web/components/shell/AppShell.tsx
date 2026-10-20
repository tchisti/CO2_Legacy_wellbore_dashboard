'use client';

// Everything the root layout wraps a page in: the store (opened in the browser only), the active
// project, tooltips, and the shell itself. The layout stays a server component around this.
import type { ReactNode } from 'react';
import { ShellGate } from '@/components/shell/ShellGate';
import { ShellError, ShellLoading } from '@/components/shell/ShellStatus';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ProjectProvider } from '@/lib/project-context';
import { StoreProvider } from '@/lib/store/provider';

const renderStoreError = (error: Error) => <ShellError error={error} />;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <StoreProvider fallback={<ShellLoading />} renderError={renderStoreError}>
      <ProjectProvider>
        <TooltipProvider>
          <ShellGate>{children}</ShellGate>
        </TooltipProvider>
      </ProjectProvider>
    </StoreProvider>
  );
}
