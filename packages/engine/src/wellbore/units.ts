import type { DepthUnit } from './types';

export const mToFt = (m: number): number => m / 0.3048;
export const ftToM = (ft: number): number => ft * 0.3048;

/** parseDepth: accepts "1463", "1,463.5", "3219 ft", "850 m"; bare numbers
 * use defaultUnit. Returns metres rounded to 0.1, or null if unparseable. */
export function parseDepth(str: string | number | null | undefined, defaultUnit: DepthUnit = 'm'): number | null {
  if (str === null || str === undefined) return null;
  const s = String(str).trim();
  if (!s) return null;
  const m = s.match(/^(-?[\d,]+(?:\.\d+)?)\s*(m|ft)?\b/i);
  if (!m) return null;
  const num = parseFloat((m[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] || defaultUnit).toLowerCase();
  const metres = unit === 'ft' ? ftToM(num) : num;
  return +metres.toFixed(1);
}
