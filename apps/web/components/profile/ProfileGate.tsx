'use client';

// Asks for the reviewer profile whenever the app has a project but no profile, and will not go away
// until one is saved, so nothing is ever written under "Unknown" from the UI.
import { ProfileDialog } from '@/components/profile/ProfileDialog';
import { useProfile } from '@/lib/store/provider';

export function ProfileGate() {
  const { profile } = useProfile();
  return <ProfileDialog open={profile === null} required />;
}
