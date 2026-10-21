// Display formatting for numbers, depths and dates (spec §7: one decimal for L, C and Risk Index;
// units next to values). A missing or unreadable value shows as an em dash, never as 0 or NaN.

export const MISSING = '—';

const FEET_PER_METRE = 1 / 0.3048;

/** One decimal place; '—' for null, undefined or a non-finite number. Never "-0.0". */
export function fmt1(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return MISSING;
  const text = n.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

/** A depth stored in metres, shown in the chosen unit at one decimal: "1447.2 m", "328.1 ft". */
export function fmtDepth(m: number | null | undefined, unit: 'm' | 'ft'): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return MISSING;
  return `${fmt1(unit === 'ft' ? m * FEET_PER_METRE : m)} ${unit}`;
}

/** The UTC calendar date of an ISO-8601 timestamp, as YYYY-MM-DD; '—' when missing or unreadable. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? MISSING : new Date(t).toISOString().slice(0, 10);
}

/** The UTC date and time of an ISO-8601 timestamp to the minute, labelled: "2026-08-07 16:16 UTC"; '—' when missing or unreadable. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return MISSING;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return MISSING;
  const text = new Date(t).toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

/** A coordinate in decimal degrees to six places (about 0.1 m); '—' when missing. Never "-0.000000". */
export function fmtCoord(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || !Number.isFinite(deg)) return MISSING;
  const text = deg.toFixed(6);
  return text === '-0.000000' ? '0.000000' : text;
}

/** A count with its noun: "1 well", "2 wells", "0 assessments". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
