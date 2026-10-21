// The Construction tab's unsaved working copy, kept in sessionStorage per well while it has
// changes, so leaving the tab by any route the page cannot intercept (the browser's Back button,
// a link from elsewhere) does not lose it: the tab offers it back on the next visit. It is never
// written into the record; a save or a discard clears it. Storage can be unavailable or full
// (private windows, blocked site data), so every access is guarded and a failure only means
// nothing is kept.
import { reviveRows, type ConstructionRows } from '@/lib/construction-edit';

const keyOf = (wellId: string): string => `lwa.construction.unsaved.${wellId}`;

export function saveUnsavedConstruction(wellId: string, rows: ConstructionRows): void {
  try {
    sessionStorage.setItem(keyOf(wellId), JSON.stringify(rows));
  } catch {
    // Nothing kept: the in-page guards still ask before leaving.
  }
}

export function readUnsavedConstruction(wellId: string): ConstructionRows | null {
  try {
    const text = sessionStorage.getItem(keyOf(wellId));
    return text ? reviveRows(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function clearUnsavedConstruction(wellId: string): void {
  try {
    sessionStorage.removeItem(keyOf(wellId));
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
