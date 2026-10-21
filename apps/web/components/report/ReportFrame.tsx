'use client';

// What a print report sits in (spec §7). Reports render without the app's chrome (ShellGate leaves
// it out on /report/*): on screen a letter-width white sheet on the page background, under a small
// toolbar (back to where the report was opened from, Print / Save as PDF) that is never printed;
// in print only the sheet, on the named page `report` (app/report/report.css: letter, 18 mm
// margins, page numbers), with the report's own running header and footer written into the page
// margins. The root carries .report-root, which also forces the light palette whatever the theme.
// Everything on screen sits in the page's <main> landmark, and the browser tab carries the report's
// own title, which "Save as PDF" proposes as the file name.
import { useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { ArrowLeftIcon, PrinterIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReportError } from '@/lib/log';
import { pageMarginCss, type MarginBoxes } from '@/lib/report';
import { useDocumentTitle } from '@/lib/use-document-title';

/** The page background, light palette forced (report.css), filling the window. */
const ROOT = 'report-root min-h-dvh bg-bg text-ink print:min-h-0 print:bg-surface';

/**
 * The time the report is printed, as ISO-8601: now, and again just before the browser prints (the
 * update is flushed before the print layout), so a report left open overnight prints today's date.
 */
export function usePrintedAt(): string {
  const [at, setAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    const refresh = () => flushSync(() => setAt(new Date().toISOString()));
    window.addEventListener('beforeprint', refresh);
    return () => window.removeEventListener('beforeprint', refresh);
  }, []);
  return at;
}

/** A report's one-line state while it cannot be shown yet (the store opening, records loading). */
export function ReportStatus({ children = 'Opening the report…' }: { children?: ReactNode }) {
  return (
    <div data-report-root className={`${ROOT} grid place-items-center`}>
      <main>
        <p role="status" className="text-sm text-muted-foreground">
          {children}
        </p>
      </main>
    </div>
  );
}

/**
 * A plain page in place of a report that cannot be made: what is wrong, and a way back. When it is
 * shown because of an `error` (a failed read), the error goes to the logging hook.
 */
export function ReportMessage({
  title,
  children,
  action,
  error = null,
}: {
  title: string;
  children: ReactNode;
  action: ReactNode;
  error?: Error | null;
}) {
  useReportError(error, 'report');
  return (
    <div data-report-root className={ROOT}>
      <main className="mx-auto grid max-w-lg gap-3 px-4 py-16">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-muted-foreground">{children}</p>
        <div>{action}</div>
      </main>
    </div>
  );
}

/**
 * What a report shows when the projects cannot be read (ShellGate leaves reports to handle this
 * themselves): the error and the way back, never an endless loading line.
 */
export function ProjectReadError({ error, backHref }: { error: Error; backHref: string }) {
  return (
    <ReportMessage
      title="The project could not be read"
      error={error}
      action={
        <Button asChild variant="outline">
          <Link href={backHref}>Back to Wells</Link>
        </Button>
      }
    >
      This browser could not read the project the report is made from: {error.message}
    </ReportMessage>
  );
}

export function ReportFrame({
  title,
  documentTitle,
  back,
  margins,
  children,
}: {
  /** The report's accessible name: "Well dossier 100/07-21-055-22W4/00". */
  title: string;
  /** The browser tab's title while the report is open: "Well dossier 100/07-21-055-22W4/00 — <project>". */
  documentTitle: string;
  /** Where the toolbar's back link goes, and what it is called ("well", "Wells"). */
  back: { href: string; label: string };
  /** The running header and footer printed in the page margins (the page number is report.css's). */
  margins: MarginBoxes;
  children: ReactNode;
}) {
  useDocumentTitle(documentTitle);
  return (
    <main data-report-root className={ROOT}>
      <style>{pageMarginCss(margins)}</style>
      <div
        role="group"
        aria-label="Report actions"
        className="mx-auto flex w-full max-w-[8.5in] flex-wrap items-center justify-between gap-3 px-4 pt-5 sm:px-0 print:hidden"
      >
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Back to {back.label}
        </Link>
        <Button onClick={() => window.print()}>
          <PrinterIcon aria-hidden="true" />
          Print / Save as PDF
        </Button>
      </div>
      <article
        aria-label={title}
        className="mx-auto my-5 w-full max-w-[8.5in] space-y-8 bg-surface px-4 py-8 shadow-sm ring-1 ring-line sm:px-[18mm] sm:py-[16mm] print:m-0 print:max-w-none print:p-0 print:shadow-none print:ring-0"
      >
        {children}
      </article>
    </main>
  );
}
