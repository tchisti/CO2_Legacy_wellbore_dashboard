'use client';

// Spec §4 top bar: wordmark, the active project, and the reviewer.
import Link from 'next/link';
import { ProfileMenu } from '@/components/shell/ProfileMenu';
import { ProjectSwitcher } from '@/components/shell/ProjectSwitcher';
import { Wordmark } from '@/components/shell/Wordmark';
import { ROUTES } from '@/lib/routes';

export function TopBar() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 bg-surface px-4 sm:px-6">
      <Link
        href={ROUTES.portfolio}
        className="shrink-0 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Wordmark />
      </Link>
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />
      <ProjectSwitcher />
      <div className="ml-auto">
        <ProfileMenu />
      </div>
    </header>
  );
}
