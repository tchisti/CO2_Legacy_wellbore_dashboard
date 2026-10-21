// A page's title row: the active project as context above the heading, actions on the right.
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  context,
  actions,
}: {
  title: string;
  /** Usually the active project's name. */
  context?: string | null;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {context ? <p className="truncate text-xs text-muted-foreground">{context}</p> : null}
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The page body: full width, on the same left gutter as the top bar and the section tabs. Its one
 * column never grows past the window (minmax(0, 1fr)), so a wide table scrolls inside its own box
 * instead of widening the page.
 */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="grid w-full grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6">{children}</div>;
}
