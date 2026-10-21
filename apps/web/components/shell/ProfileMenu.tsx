'use client';

// The reviewer in the top bar: initials and name, with "Edit profile" and the light/dark switch.
import { useState } from 'react';
import { ChevronDownIcon, MoonIcon, SunIcon, UserPenIcon } from 'lucide-react';
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProfile } from '@/lib/store/provider';
import { useTheme } from '@/lib/use-theme';

export function ProfileMenu() {
  const { profile } = useProfile();
  const [theme, setTheme] = useTheme();
  const [editing, setEditing] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 gap-2 px-1.5">
            <span className="grid size-6 place-items-center rounded-full bg-subtle text-[11px] font-semibold tracking-wide text-ink ring-1 ring-line">
              {profile?.initials ?? '?'}
            </span>
            <span className="hidden max-w-40 truncate md:inline">{profile?.name ?? 'Profile'}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="grid gap-0.5 py-1.5 font-normal">
            <span className="truncate text-sm font-medium text-ink">{profile?.name ?? 'No profile yet'}</span>
            <span className="text-xs text-muted-foreground">Reviewer in this browser (unverified)</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <UserPenIcon aria-hidden="true" />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </>
  );
}
