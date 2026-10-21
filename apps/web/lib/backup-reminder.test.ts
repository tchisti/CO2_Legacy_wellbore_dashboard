import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimBackupReminder, exportBackup, toastFinalised } from '@/lib/backup-reminder';
import { downloadExport } from '@/lib/backup';

const sonner = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => sonner);
vi.mock('@/lib/backup', async (original) => ({ ...(await original<typeof import('@/lib/backup')>()), downloadExport: vi.fn() }));

const store = { exportProject: vi.fn() };
const download = vi.mocked(downloadExport);

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

type ToastOptions = { description: string; duration: number; action: { label: string; onClick: () => void } };

describe('claimBackupReminder', () => {
  it('is due once per project per browser session', () => {
    expect(claimBackupReminder('prj_a')).toBe(true);
    expect(claimBackupReminder('prj_a')).toBe(false);
    expect(claimBackupReminder('prj_b')).toBe(true);
    expect(window.sessionStorage.getItem('lwa.backupReminder.prj_a')).toBe('1');
    window.sessionStorage.clear(); // a new session
    expect(claimBackupReminder('prj_a')).toBe(true);
  });

  it('when sessionStorage is blocked, it remembers for the life of the page instead', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(claimBackupReminder('prj_blocked')).toBe(true);
    expect(claimBackupReminder('prj_blocked')).toBe(false);
  });
});

describe('toastFinalised', () => {
  it('the first finalise of the session offers "Export a backup", which downloads the project file', async () => {
    download.mockResolvedValue({ filename: 'north-aor-2026-10-21.lwa.json', data: {} as never });
    toastFinalised(store, 'prj_north');
    expect(sonner.toast.success).toHaveBeenCalledTimes(1);
    const [title, options] = sonner.toast.success.mock.calls[0] as [string, ToastOptions];
    expect(title).toBe('Assessment finalised');
    expect(options.description).toMatch(/only copy/);
    expect(options.action.label).toBe('Export a backup');

    options.action.onClick();
    await vi.waitFor(() => expect(sonner.toast.success).toHaveBeenCalledTimes(2));
    expect(download).toHaveBeenCalledWith(store, 'prj_north');
    expect(sonner.toast.success).toHaveBeenLastCalledWith('Backup saved as north-aor-2026-10-21.lwa.json');
  });

  it('later finalises in the same session and project toast without the reminder', () => {
    toastFinalised(store, 'prj_north');
    toastFinalised(store, 'prj_north');
    expect(sonner.toast.success.mock.calls[1]).toEqual(['Assessment finalised']);
  });
});

describe('exportBackup', () => {
  it('a failed export is reported in an error toast, never thrown', async () => {
    download.mockRejectedValue(new Error('IndexedDB is blocked'));
    await expect(exportBackup(store, 'prj_north')).resolves.toBeUndefined();
    expect(sonner.toast.error).toHaveBeenCalledWith('The backup could not be exported: IndexedDB is blocked');
  });
});
