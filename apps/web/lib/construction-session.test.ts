import { afterEach, describe, expect, it, vi } from 'vitest';
import { WellboreSchema } from '@lwa/engine';
import { rowsFromWellbore, setHeader } from '@/lib/construction-edit';
import {
  clearUnsavedConstruction,
  readUnsavedConstruction,
  saveUnsavedConstruction,
} from '@/lib/construction-session';

const rows = () => setHeader(rowsFromWellbore(WellboreSchema.parse({ td: 1500, plugs: [{ top_m: 1, bottom_m: 2 }] })), 'td', '1600');

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('construction-session', () => {
  it('keeps a working copy per well until it is cleared', () => {
    saveUnsavedConstruction('wel_1', rows());
    expect(readUnsavedConstruction('wel_1')?.td).toBe('1600');
    expect(readUnsavedConstruction('wel_2')).toBeNull();
    clearUnsavedConstruction('wel_1');
    expect(readUnsavedConstruction('wel_1')).toBeNull();
  });

  it('ignores unreadable stored text', () => {
    sessionStorage.setItem('lwa.construction.unsaved.wel_1', '{not json');
    expect(readUnsavedConstruction('wel_1')).toBeNull();
  });

  it('never throws when storage does', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveUnsavedConstruction('wel_1', rows())).not.toThrow();
    expect(readUnsavedConstruction('wel_1')).toBeNull();
    expect(() => clearUnsavedConstruction('wel_1')).not.toThrow();
  });
});
