// 3D-viewer bridge enrichment (spec 2026-08-07 §3): builds a wellbore from a
// pushed 3D record. Every row it produces carries `source: 'bridge'`; rows
// read by the parsers keep the parser's `verbatim`.
import { parseCasingTextDetail, parseIntervalsText } from './parse';
import type { Wellbore, WellboreFormation, WellboreNote } from './types';

/** A record pushed by the 3D viewer. Fields are checked at runtime, so any value is accepted. */
export interface Bridge3DRecord {
  readonly td?: unknown;
  readonly tvd?: unknown;
  readonly surfaceCasingDepth?: unknown;
  readonly productionCasing?: unknown;
  readonly intermediateCasing?: unknown;
  readonly cementTop?: unknown;
  readonly plugIntervals?: unknown;
  readonly perfIntervals?: unknown;
  readonly formationPenetrated?: unknown;
  readonly [key: string]: unknown;
}

/** The bridge's wellbore: as v2, it never sets `formations` (a penetrated
 * formation has no depth, so it becomes a note). */
export type BridgeWellbore = Omit<Wellbore, 'td' | 'source' | 'formations'> & {
  td: number;
  source: 'bridge';
  formations?: WellboreFormation[];
};

function bridged<T extends object>(row: T): T & { source: 'bridge' } {
  return { ...row, source: 'bridge' };
}

const warningNote = (warning: string): WellboreNote => ({ depth_m: null, text: '[bridge] ' + warning, source: 'bridge' });

/** A 3D text field as v2 read it, through String(): a stray number or object is read the same way. */
const textOf = (v: unknown): string => String(v);

/** Returns null when the record has no positive td (or tvd fallback). */
export function wellboreFrom3D(r: Bridge3DRecord): BridgeWellbore | null {
  const td = typeof r.td === 'number' && r.td > 0 ? r.td : typeof r.tvd === 'number' && r.tvd > 0 ? r.tvd : null;
  if (!td) return null;

  const wb: BridgeWellbore = {
    td,
    source: 'bridge',
    casings: [],
    openHole: null,
    plugs: [],
    perforations: [],
    zones: [],
    packers: [],
    notes: [],
  };

  // Deepest shoe across ALL casings, and whether any casing text signalled open hole (Finding 1).
  let deepestShoe = 0;
  let openHoleSignal = false;

  if (typeof r.surfaceCasingDepth === 'number' && r.surfaceCasingDepth > 0) {
    wb.casings.push({ type: 'surface', top_m: 0, shoe_m: r.surfaceCasingDepth, source: 'bridge' });
    deepestShoe = Math.max(deepestShoe, r.surfaceCasingDepth);
  }

  // Production, then intermediate casing text; parser warnings fold into notes (Finding 2).
  for (const casingText of [r.productionCasing, r.intermediateCasing]) {
    if (!casingText) continue;
    const pc = parseCasingTextDetail(textOf(casingText));
    wb.casings.push(...pc.casings.map(bridged));
    if (pc.openHole) openHoleSignal = true;
    for (const note of pc.notes) wb.notes.push({ depth_m: null, text: note.text, source: 'bridge', verbatim: note.verbatim });
    if (pc.casings.length > 0) deepestShoe = Math.max(deepestShoe, ...pc.casings.map((c) => c.shoe_m || 0));
    for (const warning of pc.warnings) wb.notes.push(warningNote(warning));
  }

  // Concretize the open-hole signal: deepest shoe (else 0) down to td, only if it is above td.
  if (openHoleSignal && deepestShoe < td) {
    wb.openHole = { top_m: deepestShoe, bottom_m: td };
  }

  if (r.plugIntervals) {
    const iv = parseIntervalsText(textOf(r.plugIntervals));
    wb.plugs.push(...iv.plugs.map(bridged));
    wb.perforations.push(...iv.perforations.map(bridged));
    wb.notes.push(...iv.notes.map(bridged));
    for (const warning of iv.warnings) wb.notes.push(warningNote(warning));
  }

  if (r.perfIntervals) {
    const iv = parseIntervalsText(textOf(r.perfIntervals));
    wb.perforations.push(...iv.perforations.map(bridged));
    wb.notes.push(...iv.notes.map(bridged));
    for (const warning of iv.warnings) wb.notes.push(warningNote(warning));
  }

  // cementTop → toc_m on the deepest casing (highest shoe_m; first one wins a tie).
  const firstCasing = wb.casings[0];
  if (typeof r.cementTop === 'number' && r.cementTop >= 0 && firstCasing) {
    let deepestCasing = firstCasing;
    for (const c of wb.casings) {
      if ((c.shoe_m || 0) > (deepestCasing.shoe_m || 0)) deepestCasing = c;
    }
    deepestCasing.toc_m = r.cementTop;
  }

  // The penetrated formation has no depth: a note, not a formation marker.
  if (r.formationPenetrated) {
    wb.notes.push({ depth_m: null, text: textOf(r.formationPenetrated), source: 'bridge' });
  }

  return wb;
}
