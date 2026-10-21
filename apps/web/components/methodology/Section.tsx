'use client';

// The two pieces every block of the Methodology page shares: a titled section (a heading the
// block's table is named by) and the frame a wide table or the figure scrolls sideways inside.
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A titled block of the page; `children` gets the id of the heading, to name its table by. */
export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: (headingId: string) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-2">
      <div>
        <h2 id={headingId} className="text-sm font-medium">
          {title}
        </h2>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children(headingId)}
    </section>
  );
}

/**
 * A frame that scrolls sideways when its content is wider than the screen. It is a tab stop, so a
 * keyboard user can scroll it with the arrow keys, and a named group so it is announced as more
 * than an anonymous box.
 */
export function ScrollRegion({
  labelledBy,
  className,
  children,
}: {
  /** The id of the text that names the content. */
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={cn('overflow-x-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}
    >
      {children}
    </div>
  );
}
