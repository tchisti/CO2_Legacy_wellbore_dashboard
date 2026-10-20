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
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** The page body: full width, on the same left gutter as the top bar and the section tabs. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="grid w-full gap-6 px-4 py-6 sm:px-6">{children}</div>;
}
