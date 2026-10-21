'use client';

// The four sections (spec §4). The current one carries aria-current="page" and an accent underline.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: ROUTES.portfolio, label: 'Portfolio' },
  { href: ROUTES.wells, label: 'Wells' },
  { href: ROUTES.methodology, label: 'Methodology' },
  { href: ROUTES.settings, label: 'Project settings' },
] as const;

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function NavTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="border-b bg-surface px-4 sm:px-6">
      <ul className="-mb-px flex gap-5 overflow-x-auto">
        {SECTIONS.map(({ href, label }) => {
          const current = isCurrent(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center border-b-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50',
                  current
                    ? 'border-primary font-medium text-ink'
                    : 'border-transparent text-muted-foreground hover:border-line-strong hover:text-ink',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
