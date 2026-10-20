// Loose-input helper shared by the stats and SVG modules: a list field that
// is missing, null, or not an array reads as empty (v2's Array.isArray guard).
export function asList<T>(xs: ReadonlyArray<T> | null | undefined): ReadonlyArray<T> {
  return Array.isArray(xs) ? xs : [];
}
