import { afterEach, describe, expect, it, vi } from 'vitest';
import { WellboreSchema } from '@lwa/engine';
import { constructionKey, rowsFromWellbore, setHeader } from '@/lib/construction-edit';
import {
  clearUnsavedConstruction,
  readUnsavedConstruction,
  saveUnsavedConstruction,
} from '@/lib/construction-session';

const saved = WellboreSchema.parse({ td: 1500, plugs: [{ top_m: 1, bottom_m: 2 }] });
const rows = () => setHeader(rowsFromWellbore(saved), 'td', '1600');

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('construction-session', () => {
  it('keeps a working copy per well, with the key of the record it was made from, until it is cleared', () => {
    saveUnsavedConstruction('wel_1', rows(), constructionKey(saved));
    expect(readUnsavedConstruction('wel_1')?.rows.td).toBe('1600');
    expect(readUnsavedConstruction('wel_1')?.base).toBe(constructionKey(saved));
    expect(JSON.parse(sessionStorage.getItem('lwa.construction.unsaved.wel_1') ?? '{}')).toMatchObject({ base: constructionKey(saved) });
    expect(readUnsavedConstruction('wel_2')).toBeNull();
    clearUnsavedConstruction('wel_1');
    expect(readUnsavedConstruction('wel_1')).toBeNull();
  });

  it('reads a copy stored before bases were kept with base null', () => {
    sessionStorage.setItem('lwa.construction.unsaved.wel_1', JSON.stringify(rows()));
    expect(readUnsavedConstruction('wel_1')).toMatchObject({ base: null, rows: { td: '1600' } });
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
    expect(() => saveUnsavedConstruction('wel_1', rows(), constructionKey(saved))).not.toThrow();
    expect(readUnsavedConstruction('wel_1')).toBeNull();
    expect(() => clearUnsavedConstruction('wel_1')).not.toThrow();
  });
});
