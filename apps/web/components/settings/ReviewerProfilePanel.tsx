'use client';

// The reviewer profile of this browser (spec §6.1): the name and initials stamped on assessments
// and changes, edited in the same dialog as the top bar's "Edit profile".
import { useState } from 'react';
import { UserPenIcon } from 'lucide-react';
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import { Button } from '@/components/ui/button';
import { useProfile } from '@/lib/store/provider';

export function ReviewerProfilePanel() {
  const { profile } = useProfile();
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-surface px-4 py-3">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold tracking-wide text-ink ring-1 ring-line"
      >
        {profile?.initials ?? '?'}
      </span>
      <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd className="truncate font-medium">{profile?.name ?? 'Not set'}</dd>
        <dt className="text-muted-foreground">Initials</dt>
        <dd className="num">{profile?.initials ?? '—'}</dd>
      </dl>
      <Button type="button" variant="outline" onClick={() => setEditing(true)}>
        <UserPenIcon aria-hidden="true" />
        Edit profile
      </Button>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </div>
  );
}
