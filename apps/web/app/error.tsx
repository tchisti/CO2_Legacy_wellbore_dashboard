'use client';

// The route error boundary (spec §10: error boundaries per route). A page that throws while it
// renders shows this in its place, inside the app's shell: a calm sentence, the way to try again
// (reset re-renders the page; the data is in this browser, so there is nothing to re-fetch) and
// the way back to Portfolio. The error goes to the logging hook (lib/log.ts).
import Link from 'next/link';
import { TriangleAlertIcon } from 'lucide-react';
import { PageBody } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { useReportError } from '@/lib/log';
import { ROUTES } from '@/lib/routes';

export default function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  useReportError(error, 'route-error-boundary');
  const detail = error instanceof Error && error.message ? error.message : null;
  return (
    <PageBody>
      <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center">
        <span className="grid size-9 place-items-center rounded-full bg-subtle text-muted-foreground">
          <TriangleAlertIcon aria-hidden="true" className="size-4.5" />
        </span>
        <h1 className="mt-3 text-base font-semibold">Something went wrong on this page.</h1>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          What is saved in this browser is unaffected. Try again, or go back to Portfolio and open the page from there.
        </p>
        {detail ? (
          <p className="mt-3 max-w-md rounded-md border bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">{detail}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button onClick={() => reset()}>Try again</Button>
          <Button asChild variant="outline">
            <Link href={ROUTES.portfolio}>Back to Portfolio</Link>
          </Button>
        </div>
      </div>
    </PageBody>
  );
}
