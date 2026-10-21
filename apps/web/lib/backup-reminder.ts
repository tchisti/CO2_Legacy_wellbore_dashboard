// The backup reminder (spec §10: "the UI reminds the user to export after finalising"). Phase 1
// keeps a project only in this browser, so after a finalise the success toast offers "Export a
// backup", which downloads the project file (lib/backup.ts downloadExport). It is offered at most
// once per browser session per project: sessionStorage remembers it was shown, and when storage is
// blocked (private modes, sandboxed frames) a page-lifetime memory does instead.
import { toast } from 'sonner';
import { downloadExport } from '@/lib/backup';
import { toError } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';

const KEY_PREFIX = 'lwa.backupReminder.';
/** Projects reminded about while sessionStorage could not be used. */
const remindedInMemory = new Set<string>();

/**
 * True the first time it is asked for `projectId` in this browser session (the reminder is then
 * due, and is recorded as shown); false afterwards.
 */
export function claimBackupReminder(projectId: string): boolean {
  const key = KEY_PREFIX + projectId;
  try {
    if (window.sessionStorage.getItem(key) !== null) return false;
    window.sessionStorage.setItem(key, '1');
    return true;
  } catch {
    if (remindedInMemory.has(projectId)) return false;
    remindedInMemory.add(projectId);
    return true;
  }
}

/** Downloads the project file, saying in a toast what happened. */
export async function exportBackup(store: Pick<Store, 'exportProject'>, projectId: string): Promise<void> {
  try {
    const { filename } = await downloadExport(store, projectId);
    toast.success(`Backup saved as ${filename}`);
  } catch (e) {
    toast.error(`The backup could not be exported: ${toError(e).message}`);
  }
}

/** The toast after a finalise: with the backup reminder the first time this session, plain after that. */
export function toastFinalised(store: Pick<Store, 'exportProject'>, projectId: string): void {
  if (!claimBackupReminder(projectId)) {
    toast.success('Assessment finalised');
    return;
  }
  toast.success('Assessment finalised', {
    description: 'This browser holds the only copy of the project. Export a backup to keep one elsewhere.',
    duration: 10_000,
    action: { label: 'Export a backup', onClick: () => void exportBackup(store, projectId) },
  });
}
