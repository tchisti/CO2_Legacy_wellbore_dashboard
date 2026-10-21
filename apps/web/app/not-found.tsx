// The page for an address the app does not have (the static export's 404.html). It sits inside the
// app's shell, with the two places a reviewer most likely meant to go.
import Link from 'next/link';
import { CompassIcon } from 'lucide-react';
import { EmptyState } from '@/components/shell/EmptyState';
import { PageBody } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/routes';

export default function NotFound() {
  return (
    <PageBody>
      <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
      <EmptyState
        icon={CompassIcon}
        title="There is no page at this address"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href={ROUTES.portfolio}>Portfolio</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={ROUTES.wells}>Wells</Link>
            </Button>
          </div>
        }
      >
        The link may be mistyped or out of date. Wells, their reports and the score flow open from the Wells list.
      </EmptyState>
    </PageBody>
  );
}
