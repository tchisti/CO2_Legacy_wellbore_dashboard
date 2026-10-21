'use client';

// What the app shows before it can show a project: opening the local database, or why it could
// not. Kept to the wordmark and one message, so a slow start never flashes a half-built shell.
// The error is also sent to the logging hook (lib/log.ts).
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/shell/Wordmark';
import { useReportError } from '@/lib/log';

export function ShellFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center border-b bg-surface px-4 sm:px-6">
        <Wordmark />
      </header>
      {children}
    </div>
  );
}

export function ShellLoading() {
  return (
    <ShellFrame>
      <main className="flex flex-1 items-center justify-center">
        <p role="status" className="text-muted-foreground">
          Opening your projects…
        </p>
      </main>
    </ShellFrame>
  );
}

const STORAGE_HELP =
  'Legacy Well Assessment keeps projects in this browser (IndexedDB). Allow site data for this page, or leave private browsing, then reload.';

export function ShellError({
  error,
  title = 'This browser is not letting the app store data',
}: {
  error: Error;
  title?: string;
}) {
  useReportError(error, 'shell');
  return (
    <ShellFrame>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-3 px-4 py-12">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-muted-foreground">{STORAGE_HELP}</p>
        <p role="alert" className="rounded-md border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">
          {error.message}
        </p>
      </main>
    </ShellFrame>
  );
}
