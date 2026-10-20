// A designed empty state (spec §7): what belongs here, in one line, and what to do next.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-14 text-center">
      <span className="grid size-9 place-items-center rounded-full bg-subtle text-muted-foreground">
        <Icon aria-hidden="true" className="size-4.5" />
      </span>
      <h2 className="mt-3 text-sm font-medium">{title}</h2>
      {children ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
