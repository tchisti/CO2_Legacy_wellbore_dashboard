import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_INIT_SCRIPT, THEME_KEY, applyTheme, readStoredTheme, storeTheme } from '@/lib/theme';

const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root.dataset.theme;
});
afterEach(() => vi.restoreAllMocks());

function storageThrows() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage disabled');
  });
}

describe('theme', () => {
  it('is light unless dark was stored', () => {
    expect(readStoredTheme()).toBe('light');
    localStorage.setItem(THEME_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
    localStorage.setItem(THEME_KEY, 'purple');
    expect(readStoredTheme()).toBe('light');
  });

  it('storeTheme persists under lwa.theme', () => {
    expect(THEME_KEY).toBe('lwa.theme');
    storeTheme('dark');
    expect(localStorage.getItem('lwa.theme')).toBe('dark');
    storeTheme('light');
    expect(localStorage.getItem('lwa.theme')).toBe('light');
  });

  it('reads light and stores nothing, without throwing, when storage throws', () => {
    storageThrows();
    expect(readStoredTheme()).toBe('light');
    expect(() => storeTheme('dark')).not.toThrow();
  });

  it('applyTheme sets data-theme="dark" on <html> and removes it for light', () => {
    applyTheme('dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(root.dataset.theme).toBeUndefined();
  });

  it('the inline script applies a stored dark theme before paint', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    new Function(THEME_INIT_SCRIPT)();
    expect(root.dataset.theme).toBe('dark');
  });

  it('the inline script leaves the page light when nothing is stored or storage throws', () => {
    new Function(THEME_INIT_SCRIPT)();
    expect(root.dataset.theme).toBeUndefined();
    storageThrows();
    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
    expect(root.dataset.theme).toBeUndefined();
  });
});
