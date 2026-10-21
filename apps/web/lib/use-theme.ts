'use client';

// The theme as React state. The DOM (data-theme on <html>, set before paint by the inline script)
// is the source of truth; this hook reads it, and setTheme applies, persists and notifies.
import { useCallback, useSyncExternalStore } from 'react';
import { applyTheme, currentTheme, storeTheme, type Theme } from '@/lib/theme';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server render and hydration see light; the client then reads what the inline script applied. */
const serverTheme = (): Theme => 'light';

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, serverTheme);
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    storeTheme(next);
    for (const listener of [...listeners]) listener();
  }, []);
  return [theme, setTheme];
}
