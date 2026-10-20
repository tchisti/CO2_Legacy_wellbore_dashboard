// Light/dark theme. Light is the default whatever the OS prefers (spec §7: reads better in offices
// and prints); dark applies only when the user picks it, as data-theme="dark" on <html>, and the
// choice is kept in localStorage. Every storage access is guarded: the app works when storage throws
// (blocked site data, some private modes). The hook lives in use-theme.ts (client only).

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'lwa.theme';

/**
 * Runs in <head> before first paint (app/layout.tsx), so a saved dark theme never flashes light.
 * Must stay self-contained ES5: it is inlined as text.
 */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="dark")document.documentElement.dataset.theme="dark"}catch(e){}})()`;

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the theme still applies for this page, it just is not remembered.
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

/** The theme currently applied to the page. */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
