// The Construction tab's unsaved working copy, kept in sessionStorage per well while it has
// changes, so leaving the tab by any route the page cannot intercept (the browser's Back button,
// a link from elsewhere) does not lose it: the tab offers it back on the next visit. It is stored
// as { base, rows }, base being the content key of the saved record the edits were made from, so
// the tab can tell when that record has changed since. It is never written into the record; a
// save or a discard clears it. Storage can be unavailable or full
// (private windows, blocked site data), so every access is guarded and a failure only means
// nothing is kept.
import { reviveKeptCopy, type ConstructionRows, type KeptCopy } from '@/lib/construction-edit';

const keyOf = (wellId: string): string => `lwa.construction.unsaved.${wellId}`;

/** `base`: constructionKey of the saved record the edits were made from. */
export function saveUnsavedConstruction(wellId: string, rows: ConstructionRows, base: string): void {
  try {
    sessionStorage.setItem(keyOf(wellId), JSON.stringify({ base, rows }));
  } catch {
    // Nothing kept: the in-page guards still ask before leaving.
  }
}

export function readUnsavedConstruction(wellId: string): KeptCopy | null {
  try {
    const text = sessionStorage.getItem(keyOf(wellId));
    return text ? reviveKeptCopy(JSON.parse(text)) : null;
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
