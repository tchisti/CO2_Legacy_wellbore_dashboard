// Free-text parsers for historic abandonment / casing records (spec
// 2026-08-07 §4). Ported function-for-function from v2; the one addition is
// provenance: every row a parser emits carries `source: 'parsed'` and
// `verbatim`, the clause (line, or `;`-separated part of a line) it was read from.
import { ftToM } from './units';
import type { DepthUnit, WellboreCasing, WellboreNote, WellboreOpenHole, WellborePerforation, WellborePlug } from './types';

const DASH = '[–—-]'; // en dash, em dash, hyphen
const NUM = '[\\d,]+(?:\\.\\d+)?';

function toNum(numStr: string | undefined): number {
  return parseFloat(String(numStr).replace(/,/g, ''));
}

// Convert a raw number (already parsed as a float, in `unit`) to metres.
function numToM(n: number, unit: string): number {
  return +(unit === 'ft' ? ftToM(n) : n).toFixed(1);
}

// Candidate clauses: split on line breaks and `;`, trimmed, blanks dropped.
function clauses(text: string): string[] {
  return text
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/* ---- interval text parsing (plugs / perforations / notes / warnings) ---- */

export type ParsedIntervals = {
  plugs: WellborePlug[];
  perforations: WellborePerforation[];
  notes: WellboreNote[];
  warnings: string[];
};

export function parseIntervalsText(text: string | null | undefined, defaultUnit: DepthUnit = 'm'): ParsedIntervals {
  const out: ParsedIntervals = { plugs: [], perforations: [], notes: [], warnings: [] };
  if (!text || !String(text).trim()) return out;

  const rawLines = clauses(String(text));

  let lastPlugHeader: { num: string } | null = null;
  // Most recently pushed plug: continuation lines (sacks/additives/kind with
  // no depth of their own) attach to it (spec §4, Finding 3).
  let lastPlug: WellborePlug | null = null;

  for (const line of rawLines) {
    // "No plug records on file" / similar negative statements → warning only.
    if (/^no\s+.*(records?|plugs?)\b/i.test(line) || /no plug records/i.test(line)) {
      out.warnings.push(`No records: "${line}"`);
      continue;
    }

    // Line-level unit fallback for bare numbers on this line; a number
    // carrying its OWN unit suffix (checked per-number below) always wins (Finding 4).
    let lineUnit: string = defaultUnit;
    if (/\bft\b/i.test(line) && !/\bm\b(?!m)/i.test(line)) lineUnit = 'ft';
    else if (/\bm\b(?!m)/i.test(line) && !/\bft\b/i.test(line)) lineUnit = 'm';

    // Plug header e.g. "Plug #1" — starts a fresh block; the plug it
    // eventually produces becomes the new `lastPlug` continuation target.
    const hdrMatch = line.match(/plug\s*#?\s*(\d+)/i);
    if (hdrMatch && !new RegExp(`${NUM}\\s*${DASH}\\s*${NUM}`).test(line)) {
      lastPlugHeader = { num: hdrMatch[1] ?? '' };
      lastPlug = null;
    }

    // Formation names in trailing (...) become notes.
    const parenMatches = [...line.matchAll(/\(([^)]+)\)/g)];

    // Interval range(s) "<num>[unit] - <num>[unit]"; each side's unit is
    // captured independently, only a unit-less number falls back to lineUnit.
    const rangeRe = new RegExp(`(${NUM})(?:\\s*(m|ft)\\b)?\\s*${DASH}\\s*(${NUM})(?:\\s*(m|ft)\\b)?`, 'gi');
    const ranges = [...line.matchAll(rangeRe)];

    // "and <num>" continuation — an additional single-depth entry
    // (e.g. "squeezed 831.7–839.7 and 871.5 m") sharing the same status.
    const andMatches = [...line.matchAll(new RegExp(`\\band\\s+(${NUM})\\s*(m|ft)?\\b`, 'gi'))];

    const isPerf = /perf|squeez/i.test(line);
    const isPlugKindLine = /jet|treatment|plug|cibp|bridge/i.test(line);

    const sacksMatch = line.match(/(\d+)\s*sacks?/i);
    const sacks = sacksMatch ? parseInt(sacksMatch[1] ?? '', 10) : undefined;

    // additives, e.g. "2% CaCl2"
    const addMatch = line.match(/(\d+(?:\.\d+)?%\s*[A-Za-z0-9]+(?:\s+cement)?)/i) || line.match(/(cement[^,.;]*)/i);
    const additives = addMatch ? (addMatch[1] ?? '').trim() : undefined;

    const status = /squeez/i.test(line) ? 'squeezed' : undefined;

    let kind: string | undefined;
    if (/cibp/i.test(line)) kind = 'cibp';
    else if (/bridge/i.test(line)) kind = 'bridge';

    const entries: { top_m: number; bottom_m: number }[] = [];

    for (const r of ranges) {
      const topUnit = (r[2] || lineUnit).toLowerCase();
      const bottomUnit = (r[4] || lineUnit).toLowerCase();
      const a = numToM(toNum(r[1]), topUnit);
      const b = numToM(toNum(r[3]), bottomUnit);
      entries.push({ top_m: Math.min(a, b), bottom_m: Math.max(a, b) });
    }

    for (const a of andMatches) {
      const unit = (a[2] || lineUnit).toLowerCase();
      const d = numToM(toNum(a[1]), unit);
      entries.push({ top_m: d, bottom_m: d });
    }

    // Single depth like "CIBP at 1200 m" or "felt plug at 3219 ft"
    if (!entries.length) {
      const atMatch = line.match(new RegExp(`(?:at|@)\\s*(${NUM})\\s*(m|ft)?`, 'i'));
      if (atMatch) {
        const unit = (atMatch[2] || lineUnit).toLowerCase();
        const d = numToM(toNum(atMatch[1]), unit);
        entries.push({ top_m: d, bottom_m: d });
      }
    }

    // "felt plug" note (may or may not carry its own depth already captured above)
    if (/felt plug/i.test(line)) {
      const atMatch = line.match(new RegExp(`felt plug\\s*(?:at|@)?\\s*(${NUM})?\\s*(m|ft)?`, 'i'));
      const depth = atMatch && atMatch[1] ? numToM(toNum(atMatch[1]), (atMatch[2] || lineUnit).toLowerCase()) : entries[0] ? entries[0].top_m : null;
      out.notes.push({ depth_m: depth, text: `Felt plug noted: "${line}"`, source: 'parsed', verbatim: line });
    }

    if (entries.length) {
      for (const e of entries) {
        if (isPerf) {
          out.perforations.push({ top_m: e.top_m, bottom_m: e.bottom_m, ...(status ? { status } : {}), source: 'parsed', verbatim: line });
        } else if (isPlugKindLine || lastPlugHeader) {
          const plug: WellborePlug = { top_m: e.top_m, bottom_m: e.bottom_m };
          if (kind) plug.kind = kind;
          if (sacks !== undefined) plug.sacks = sacks;
          if (additives) plug.additives = additives;
          // Plug number: prefer a header on THIS line ("Plug #3 100–200 m")
          // and fall back to a header on its own preceding line
          // ("Plug #1\n1463–1448 m", carried forward by lastPlugHeader).
          const plugNum = hdrMatch ? hdrMatch[1] : lastPlugHeader ? lastPlugHeader.num : undefined;
          if (plugNum !== undefined) plug.n = Number(plugNum);
          plug.source = 'parsed';
          plug.verbatim = line;
          out.plugs.push(plug);
          lastPlug = plug;
        } else {
          // Unclassified interval — keep as a note so nothing is silently dropped.
          out.notes.push({ depth_m: e.top_m, text: `Interval noted: "${line}"`, source: 'parsed', verbatim: line });
        }
      }
    } else if (!/felt plug/i.test(line)) {
      // No depth on this line. Within a Plug #N block, a continuation line
      // carrying sacks/additive/kind but no depth attaches to the most
      // recently opened plug instead of being reported as unparsed (Finding 3).
      if (!hdrMatch && lastPlug && (sacks !== undefined || additives || kind)) {
        if (sacks !== undefined && lastPlug.sacks === undefined) lastPlug.sacks = sacks;
        if (additives) lastPlug.additives = lastPlug.additives ? `${lastPlug.additives}; ${additives}` : additives;
        if (kind && !lastPlug.kind) lastPlug.kind = kind;
      } else if (!hdrMatch) {
        out.warnings.push(`Unparsed interval line: "${line}"`);
      }
    }

    for (const pm of parenMatches) {
      out.notes.push({ depth_m: entries[0] ? entries[0].top_m : null, text: `Formation: ${(pm[1] ?? '').trim()}`, source: 'parsed', verbatim: line });
    }
  }

  return out;
}

/* ---- casing text parsing ---- */

export type ParsedCasing = {
  casings: WellboreCasing[];
  /** `{}` = "open hole below the last casing, depths unknown" (Finding 2). */
  openHole: WellboreOpenHole | null;
  notes: string[];
  warnings: string[];
};

// parseCasingText with each note kept beside the clause it came from, so
// callers that turn notes into rows can record a verbatim.
type CasingNoteDraft = { text: string; verbatim: string };
type ParsedCasingDetail = Omit<ParsedCasing, 'notes'> & { notes: CasingNoteDraft[] };

const FRAC_CHARS: Readonly<Record<string, number>> = { '⅛': 0.125, '¼': 0.25, '⅜': 0.375, '½': 0.5, '⅝': 0.625, '¾': 0.75, '⅞': 0.875 };

export function parseCasingTextDetail(text: string | null | undefined): ParsedCasingDetail {
  const out: ParsedCasingDetail = { casings: [], openHole: null, notes: [], warnings: [] };
  if (!text || !String(text).trim()) return out;

  for (const line of clauses(String(text))) {
    if (/none\s*[—–-]?\s*open hole/i.test(line) || /open hole below/i.test(line)) {
      out.notes.push({ text: `Open hole: "${line}"`, verbatim: line });
      // Structured signal (not just prose in `notes`) so the bridge builder
      // can detect it without re-parsing text (Finding 2).
      out.openHole = {};
      continue;
    }

    // OD in inches, e.g. 8⅝", 8-5/8", 8 5/8", or "8.625 in"
    let od_mm: number | undefined;
    const inchMatch = line.match(/(\d+)\s*[-\s]?\s*(\d+)\/(\d+)\s*"/); // 8-5/8" or 8 5/8"
    if (inchMatch) {
      const whole = parseInt(inchMatch[1] ?? '', 10);
      const frac = parseInt(inchMatch[2] ?? '', 10) / parseInt(inchMatch[3] ?? '', 10);
      od_mm = (whole + frac) * 25.4;
    } else {
      const fracCharMatch = line.match(/(\d+)([⅛¼⅜½⅝¾⅞])\s*"/);
      if (fracCharMatch) {
        const whole = parseInt(fracCharMatch[1] ?? '', 10);
        od_mm = (whole + (FRAC_CHARS[fracCharMatch[2] ?? ''] ?? NaN)) * 25.4;
      } else {
        const decInMatch = line.match(/(\d+(?:\.\d+)?)\s*"/);
        if (decInMatch) {
          od_mm = parseFloat(decInMatch[1] ?? '') * 25.4;
        } else {
          const mmMatch = line.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
          if (mmMatch) od_mm = parseFloat(mmMatch[1] ?? '');
        }
      }
    }

    // grade, e.g. J55, K55, N80
    const gradeMatch = line.match(/\b([A-Z]\d{2,3})\b/);
    const grade = gradeMatch ? gradeMatch[1] : undefined;

    // weight, e.g. "35.7 kg/m"
    const wtMatch = line.match(/(\d+(?:\.\d+)?)\s*kg\/m/i);
    const weight_kgm = wtMatch ? parseFloat(wtMatch[1] ?? '') : undefined;

    // shoe depth: "@ 610 m" or "@ 1699.5 m"
    let shoe_m: number | undefined;
    const shoeMatch = line.match(new RegExp(`@\\s*(${NUM})\\s*(m|ft)?`, 'i'));
    if (shoeMatch) {
      const unit = (shoeMatch[2] || 'm').toLowerCase();
      shoe_m = numToM(toNum(shoeMatch[1]), unit);
    }

    // Casing context: OD, grade, weight, shoe (`@`), TOC, or a casing/liner/
    // type word. A bare "<num>–<num>" with none of these is far more likely a
    // plug/perf depth line from a mixed report (Finding 1) — not casing data.
    const hasCasingContext =
      od_mm !== undefined ||
      grade !== undefined ||
      weight_kgm !== undefined ||
      shoe_m !== undefined ||
      /casing|liner/i.test(line) ||
      /\btoc\b/i.test(line) ||
      /@/.test(line) ||
      /surface|intermediate|production|conductor/i.test(line);

    // range: "0–610 ft" — top and shoe, min/max-normalized like plugs. The
    // lookahead on the second number skips the fraction in an OD like `8-5/8"`.
    let top_m: number | undefined;
    const rangeMatch = line.match(new RegExp(`(${NUM})\\s*${DASH}\\s*(${NUM})(?!\\s*/)\\s*(m|ft)?`, 'i'));
    if (rangeMatch && hasCasingContext) {
      const unit = (rangeMatch[3] || 'm').toLowerCase();
      const a = numToM(toNum(rangeMatch[1]), unit);
      const b = numToM(toNum(rangeMatch[2]), unit);
      top_m = Math.min(a, b);
      const bottom = Math.max(a, b);
      if (shoe_m === undefined) shoe_m = bottom;
    }

    // TOC (top of cement)
    let toc_m: number | undefined;
    const tocMatch = line.match(new RegExp(`TOC\\s*(${NUM})\\s*(m|ft)?`, 'i'));
    if (tocMatch) {
      const unit = (tocMatch[2] || 'm').toLowerCase();
      toc_m = numToM(toNum(tocMatch[1]), unit);
    }

    let type: string | undefined;
    if (/surface/i.test(line)) type = 'surface';
    else if (/intermediate/i.test(line)) type = 'intermediate';
    else if (/production/i.test(line)) type = 'production';
    else if (/conductor/i.test(line)) type = 'conductor';

    const hasCasingData = od_mm !== undefined || shoe_m !== undefined || grade !== undefined || top_m !== undefined;

    if (hasCasingData) {
      const casing: WellboreCasing = {};
      if (type) casing.type = type;
      if (od_mm !== undefined) casing.od_mm = +od_mm.toFixed(2);
      if (grade) casing.grade = grade;
      if (weight_kgm !== undefined) casing.weight_kgm = weight_kgm;
      if (top_m !== undefined) casing.top_m = top_m;
      if (shoe_m !== undefined) casing.shoe_m = shoe_m;
      if (toc_m !== undefined) casing.toc_m = toc_m;
      casing.source = 'parsed';
      casing.verbatim = line;
      out.casings.push(casing);
    } else {
      out.warnings.push(`Unparsed casing line: "${line}"`);
    }
  }

  return out;
}

export function parseCasingText(text: string | null | undefined): ParsedCasing {
  const detail = parseCasingTextDetail(text);
  return { ...detail, notes: detail.notes.map((n) => n.text) };
}

/* ---- full report composition ---- */

export type ParsedReportWellbore = {
  plugs: WellborePlug[];
  perforations: WellborePerforation[];
  notes: WellboreNote[];
  casings: WellboreCasing[];
  openHole?: WellboreOpenHole;
};

export type ParsedReport = { wellbore: ParsedReportWellbore; warnings: string[] };

// The quoted lines of every warning `<prefix>: "<line>"`.
function quotedLines(warnings: readonly string[], prefix: string): Set<string> {
  const set = new Set<string>();
  const re = new RegExp(`^${prefix}: "([\\s\\S]*)"$`);
  for (const w of warnings) {
    const m = w.match(re);
    if (m) set.add(m[1] ?? '');
  }
  return set;
}

/** Parse a pasted abandonment/casing report. Never throws; anything it
 * cannot read becomes a warning (and a note when neither parser read it). */
export function parseWellboreReport(text: string | null | undefined): ParsedReport {
  const warnings: string[] = [];
  const wellbore: ParsedReportWellbore = { plugs: [], perforations: [], notes: [], casings: [] };
  if (!text || !String(text).trim()) return { wellbore, warnings };

  try {
    const lines = String(text).split(/\n/);
    let buffer: string[] = [];
    const flush = (): void => {
      if (!buffer.length) return;
      const chunk = buffer.join('\n');
      buffer = [];
      const iv = parseIntervalsText(chunk);
      const cs = parseCasingTextDetail(chunk);

      wellbore.plugs.push(...iv.plugs);
      wellbore.perforations.push(...iv.perforations);
      wellbore.notes.push(...iv.notes);
      warnings.push(...iv.warnings);

      if (cs.casings.length) wellbore.casings.push(...cs.casings);
      if (cs.openHole) wellbore.openHole = cs.openHole;
      // Casing notes (open-hole prose) become structured note rows so they
      // survive end-to-end (Finding 2).
      for (const n of cs.notes) wellbore.notes.push({ depth_m: null, text: n.text, source: 'parsed', verbatim: n.verbatim });
      // Never suppress one parser's warnings because the other found
      // something in the same chunk (Finding 6); dedupe identical strings.
      for (const w of cs.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }

      // A line unparsed by BOTH parsers also becomes a note (Finding 5).
      const ivUnparsed = quotedLines(iv.warnings, 'Unparsed interval line');
      const csUnparsed = quotedLines(cs.warnings, 'Unparsed casing line');
      for (const rawLine of ivUnparsed) {
        if (csUnparsed.has(rawLine)) wellbore.notes.push({ depth_m: null, text: rawLine, source: 'parsed', verbatim: rawLine });
      }
    };

    // Group a header and its depth/sacks/additive detail lines into one
    // chunk so parseIntervalsText can associate them. A blank line or a new
    // "Plug #" header starts a new group.
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        flush();
        continue;
      }
      if (/plug\s*#?\s*\d+/i.test(line) && buffer.length) flush();
      buffer.push(line);
    }
    flush();
  } catch (e) {
    warnings.push(`Report parse error: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { wellbore, warnings };
}
