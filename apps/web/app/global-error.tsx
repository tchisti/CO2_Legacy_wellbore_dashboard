'use client';

// The last-resort error boundary: it replaces the root layout when the layout itself throws while
// rendering (AppShell and everything in it, StoreProvider, ShellGate, FirstRun, TopBar, the project
// switcher and the profile menu, sit above app/error.tsx, which only wraps the page). It renders its
// own document, so it brings the global styles and the saved theme itself; there is no shell to
// link through, so the way back is a plain link that reloads the app on Portfolio. The error goes
// to the logging hook (lib/log.ts).
import { useState } from 'react';
import { TriangleAlertIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReportError } from '@/lib/log';
import { readStoredTheme } from '@/lib/theme';
import './globals.css';

export default function GlobalError({ error, reset }: { error: unknown; reset: () => void }) {
  useReportError(error, 'global-error-boundary');
  const [theme] = useState(readStoredTheme);
  const detail = error instanceof Error && error.message ? error.message : null;
  return (
    <html lang="en" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <title>Something went wrong · Legacy Well Assessment</title>
      </head>
      <body>
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-4 py-12 text-center">
          <span className="grid size-9 place-items-center rounded-full bg-subtle text-muted-foreground">
            <TriangleAlertIcon aria-hidden="true" className="size-4.5" />
          </span>
          <h1 className="mt-3 text-base font-semibold">Something went wrong on this page.</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What is saved in this browser is unaffected. Try again, or go back to Portfolio and open the page from there.
          </p>
          {detail ? (
            <p className="mt-3 max-w-md rounded-md border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">{detail}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={() => reset()}>Try again</Button>
            <Button asChild variant="outline">
              {/* A plain link: a full load of the app, since the shell is what failed. */}
              <a href="/portfolio">Back to Portfolio</a>
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
