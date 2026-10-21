// The well list as CSV (spec §4.2): the v2 column set, so teams keep the spreadsheets and the
// template they already have, read into well inputs with a row-by-row report, and written back out
// for the current view. Pure; lib/import-plan.ts adds the store's state and the writes, and
// components/import/ImportDialog.tsx shows the steps.
//
// Reading follows v2's importCSV (index.html): headers match case- and punctuation-insensitively on
// the header or any alias, every matching column counts (two v1 columns aliasing one score import
// the worse of the two), enums are normalised the same way, latitude/longitude out of range reject
// the row, a spud year outside 1850…next year is dropped. Where v3 is stricter:
// - numbers are plain decimals with a point (lib/settings-edit.ts): "53,41" or "0x10" reject the row;
// - nothing is invented: a row without a licence is an error (v2 named it "UNNAMED"), an unknown
//   operator stays blank (v2 wrote "Unknown");
// - a value that cannot be read never replaces a stored one: it is reported and left unchanged;
//   only a well that is new to the project falls back (Unknown, Type 1, blank year);
// - the Reviewer column is not imported (drafts are recorded under the importing reviewer).
import {
  CLASSIFICATIONS,
  STATUSES,
  TRAJECTORIES,
  WELL_TYPES,
  WellInputSchema,
  emptyScores,
  scoreLabelToValue,
  type Assessment,
  type ParamKey,
  type Score,
  type Scores,
  type Well,
  type WellInput,
} from '@lwa/engine';
import { numberText } from '@/lib/construction-edit';
import { readDecimal } from '@/lib/settings-edit';
import { licenceKey } from '@/lib/store/store';

/* ---------- the columns ---------- */

export type CsvColumnKey =
  | 'licence'
  | 'operator'
  | 'lat'
  | 'lon'
  | 'year'
  | 'type'
  | 'traj'
  | 'status'
  | 'klass'
  | 'reviewer'
  | `sc_${ParamKey}`
  | 'notes';

export type CsvColumn = {
  key: CsvColumnKey;
  /** The template's header text. */
  hdr: string;
  /** The template's first sample row. */
  sample: string;
  enum?: readonly string[];
  /** The scoring parameter of a score column. */
  score?: ParamKey;
  /** Older (v1) headers that map onto the same column. */
  aliases?: readonly string[];
};

/** The v2 CSV_COLS list, verbatim: keys, headers, samples, enums and aliases. */
export const CSV_COLUMNS: readonly CsvColumn[] = [
  { key: 'licence', hdr: 'Well ID / Licence', sample: '100/04-20-046-25W4' },
  { key: 'operator', hdr: 'Operator', sample: 'Orphan Well Assoc.' },
  { key: 'lat', hdr: 'Latitude', sample: '53.4123' },
  { key: 'lon', hdr: 'Longitude', sample: '-113.5421' },
  { key: 'year', hdr: 'Spud / Completion Year', sample: '1968' },
  { key: 'type', hdr: 'Well Type', sample: 'Oil Producer', enum: WELL_TYPES },
  { key: 'traj', hdr: 'Trajectory', sample: 'Vertical', enum: TRAJECTORIES },
  { key: 'status', hdr: 'Legal Status', sample: 'Orphaned', enum: STATUSES },
  { key: 'klass', hdr: 'Classification (Type 1-9)', sample: 'Type 2', enum: CLASSIFICATIONS },
  { key: 'reviewer', hdr: 'Reviewer', sample: 'T. Khan' },
  // 11 scoring parameters: 1-5, ? = unknown (Low/Med/High still accepted for v1 files)
  { key: 'sc_plugQuality', hdr: 'Abandonment & Plug Quality (1-5 or ?)', sample: '5', score: 'plugQuality', aliases: ['Plug Quality (Low/Med/High)'] },
  { key: 'sc_cement', hdr: 'Cement Coverage & Quality (1-5 or ?)', sample: '5', score: 'cement', aliases: ['Cement Coverage (Low/Med/High)'] },
  { key: 'sc_barriers', hdr: 'Barriers Across Flow Zones (1-5 or ?)', sample: '3', score: 'barriers', aliases: ['Number of Barriers (Low/Med/High)'] },
  { key: 'sc_scvf', hdr: 'SCVF / GM History (1-5 or ?)', sample: '?', score: 'scvf', aliases: [] },
  { key: 'sc_age', hdr: 'Well Age & Regulatory Era (1-5 or ?)', sample: '5', score: 'age', aliases: ['Well Age (Low/Med/High)'] },
  { key: 'sc_complexity', hdr: 'Wellbore Complexity (1-5 or ?)', sample: '?', score: 'complexity', aliases: [] },
  { key: 'sc_data', hdr: 'Data Confidence (1-5 or ?)', sample: '5', score: 'data', aliases: ['Data Availability (Low/Med/High)'] },
  {
    key: 'sc_penetration',
    hdr: 'Penetration vs Storage Complex (1-5 or ?)',
    sample: '5',
    score: 'penetration',
    aliases: ['Depth vs Reservoir (Low/Med/High)', 'Depth vs Storage Complex (Low/Med/High)'],
  },
  { key: 'sc_plume', hdr: 'Position vs Plume / AoR (1-5 or ?)', sample: '1', score: 'plume', aliases: ['Proximity to CO2 Plume (Low/Med/High)'] },
  { key: 'sc_usdw', hdr: 'USDW-BGWP Isolation (1-5 or ?)', sample: '?', score: 'usdw', aliases: [] },
  { key: 'sc_access', hdr: 'Corrective-Action Accessibility (1-5 or ?)', sample: '1', score: 'access', aliases: ['Access & Ownership (Low/Med/High)'] },
  { key: 'notes', hdr: 'Notes / Justification', sample: 'Orphan well, no surface marker, no abandonment records on file.' },
];

const SCORE_COLUMNS = CSV_COLUMNS.filter((c): c is CsvColumn & { score: ParamKey } => c.score !== undefined);

/** The well fields a CSV row can set. */
export type CsvField = 'operator' | 'lat' | 'lon' | 'spudYear' | 'type' | 'trajectory' | 'status' | 'classification' | 'notes';
export type CsvFields = Pick<Required<WellInput>, CsvField>;

/** Labels of the well fields, for the import's mapping and report. */
export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  operator: 'Operator',
  lat: 'Latitude',
  lon: 'Longitude',
  spudYear: 'Spud year',
  type: 'Well type',
  trajectory: 'Trajectory',
  status: 'Legal status',
  classification: 'Classification',
  notes: 'Notes',
};

const CSV_FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[];

/** Short parameter names for the import report ("Plug quality 1→5"). */
export const SCORE_SHORT_LABELS: Record<ParamKey, string> = {
  plugQuality: 'Plug quality',
  cement: 'Cement',
  barriers: 'Barriers',
  scvf: 'SCVF / GM',
  age: 'Well age',
  complexity: 'Complexity',
  data: 'Data confidence',
  penetration: 'Penetration',
  plume: 'Plume / AoR',
  usdw: 'USDW isolation',
  access: 'Access',
};

/**
 * The score cells a row (or the rows of one licence) gives: a value 1–5, or null for an explicit
 * unknown ("?", "unknown", "u"). An empty cell or an absent column gives nothing.
 */
export type ScoreCells = Partial<Record<ParamKey, Score | null>>;

/* ---------- reading and writing CSV text ---------- */

/**
 * CSV text as rows of cells (v2's csvParse): quoted fields with embedded commas, quotes ("") and
 * line breaks; CRLF or LF; a leading byte-order mark is dropped, and so are blank lines.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (ch !== '\r') {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

/** A value to write: text, a number (written plainly, never guarded), or blank. */
export type CsvCell = string | number | null | undefined;

/** First characters a spreadsheet would read as a formula (or that hide one). */
const GUARDED = new Set(['=', '+', '-', '@', '\t', '\r']);

function escapeCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? numberText(value) : '';
  // Formula-injection guard: text that a spreadsheet would run gets a leading apostrophe.
  const s = GUARDED.has(value.charAt(0)) ? `'${value}` : value;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows as CSV text, CRLF between rows (v2's csvJoin), with the formula guard on text cells. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Undoes the formula guard: drops a leading apostrophe only when a guarded character follows. */
export function unguard(cell: string): string {
  return cell.charAt(0) === "'" && GUARDED.has(cell.charAt(1)) ? cell.slice(1) : cell;
}

/* ---------- headers ---------- */

export type HeaderMap = {
  /** The header cells, trimmed. */
  headers: string[];
  /** Every column whose header matches the key's header or one of its aliases. */
  byKey: Partial<Record<CsvColumnKey, number[]>>;
  /** Non-blank headers that match no column, in file order. */
  unmapped: string[];
  /** An older (v1, Low/Med/High) header was matched. */
  v1Detected: boolean;
};

/** Lower case with every run of other characters removed: "Well ID / Licence" → "wellidlicence". */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function mapHeaders(headerRow: readonly string[]): HeaderMap {
  const headers = headerRow.map((h) => h.trim());
  const normed = headers.map(norm);
  const byKey: HeaderMap['byKey'] = {};
  const mapped = new Set<number>();
  let v1Detected = false;
  for (const c of CSV_COLUMNS) {
    const names = new Set([c.hdr, ...(c.aliases ?? [])].map(norm));
    const matches = normed.flatMap((h, i) => (names.has(h) ? [i] : []));
    if (matches.length === 0) continue;
    byKey[c.key] = matches;
    matches.forEach((i) => mapped.add(i));
    if (matches.some((i) => normed[i] !== norm(c.hdr))) v1Detected = true;
  }
  const unmapped = headers.filter((h, i) => h !== '' && !mapped.has(i));
  return { headers, byKey, unmapped, v1Detected };
}

/** One column of the file as the mapping step shows it. */
export type ColumnMapping = {
  index: number;
  header: string;
  /** The template column it maps to, or null when it is not recognised (ignored). */
  column: CsvColumn | null;
  /** Matched through an older (v1) alias. */
  alias: boolean;
};

/** Every non-blank column of the file with what it maps to, in file order. */
export function describeColumns(map: HeaderMap): ColumnMapping[] {
  const columnAt = new Map<number, CsvColumn>();
  for (const c of CSV_COLUMNS) for (const i of map.byKey[c.key] ?? []) columnAt.set(i, c);
  return map.headers.flatMap((header, index) => {
    if (header === '') return [];
    const column = columnAt.get(index) ?? null;
    return [{ index, header, column, alias: column !== null && norm(header) !== norm(column.hdr) }];
  });
}

/** The template's columns the file does not have (the Reviewer column is never imported, so it is not missed). */
export function missingColumns(map: HeaderMap): CsvColumn[] {
  return CSV_COLUMNS.filter((c) => c.key !== 'reviewer' && map.byKey[c.key] === undefined);
}

/* ---------- rows → well inputs ---------- */

export type RowStatus = 'created' | 'updated' | 'error';

export type ReportRow = {
  /** The record's number in the file, the header being row 1 (blank lines are not counted). */
  row: number;
  licence: string;
  status: RowStatus;
  /** The row's error(s), e.g. "latitude out of range", or "same licence as row N"; '' otherwise. */
  message: string;
  warnings: string[];
  /** For an update: the fields whose value the row changes. Empty otherwise. */
  changes: CsvField[];
  /** How many score values (1–5) the row carries. */
  scored: number;
  /** The row's own score cells, explicit unknowns included. */
  scores: ScoreCells;
};

export type CsvRows = {
  /**
   * One input per licence, in file order. A new well carries every field the file gives it (the
   * schema defaults the rest); a stored well only the licence and the fields that change.
   */
  inputs: WellInput[];
  /**
   * A first assessment's scores for each licence (by licenceKey) whose rows carry at least one
   * score value 1–5: the cells given, every other parameter null.
   */
  scoreDrafts: Map<string, Scores>;
  /** What the rows of each licence (by licenceKey) say about its scores, explicit unknowns included. */
  scoreCells: Map<string, ScoreCells>;
  report: ReportRow[];
};

export type CsvContext = {
  /** The project's stored wells: a row with one of their licences updates that well. */
  wells?: readonly Well[];
  /** The latest acceptable spud year is the year after this one. Defaults to the current UTC year. */
  currentYear?: number;
};

const SPUD_MIN = 1850;
const UNKNOWN_SCORE_LABELS = new Set(['?', 'unknown', 'u']);
const ENUM_LABEL: Partial<Record<CsvColumnKey, string>> = {
  type: 'well type',
  traj: 'trajectory',
  status: 'legal status',
  klass: 'classification',
};

function fieldsOf(w: Well): CsvFields {
  return Object.fromEntries(CSV_FIELDS.map((k) => [k, w[k]])) as CsvFields;
}

type ReadNumber = { ok: true; value: number } | { ok: false; message: string };

function readNumber(label: string, text: string): ReadNumber {
  if (/^[+-]?\d+,\d+$/.test(text)) return { ok: false, message: `${label} "${text}": use a point as the decimal separator` };
  const read = readDecimal(text, { blank: '', example: '' });
  return read.ok ? read : { ok: false, message: `${label} "${text}" is not a number` };
}

function readEnum<T extends string>(text: string, allowed: readonly T[]): T | null {
  const v = norm(text);
  return allowed.find((a) => norm(a) === v) ?? null;
}

type CellRead = {
  fields: Partial<CsvFields>;
  scores: ScoreCells;
  errors: string[];
  warnings: string[];
};

/**
 * The fields and scores one row gives. `hasBase`: the licence already has a record (stored, or an
 * earlier row), so a value that cannot be read leaves it unchanged rather than falling back.
 */
function readCells(row: readonly string[], map: HeaderMap, hasBase: boolean, currentYear: number): CellRead {
  const out: CellRead = { fields: {}, scores: {}, errors: [], warnings: [] };
  const raw = (key: CsvColumnKey): string => {
    const i = map.byKey[key]?.[0];
    return i === undefined ? '' : (row[i] ?? '');
  };
  const cell = (key: CsvColumnKey): string => unguard(raw(key).trim()).trim();
  const unreadable = (what: string, fallback: string) =>
    `${what}; ${hasBase ? 'left unchanged' : fallback}`;

  const operator = cell('operator');
  if (operator) out.fields.operator = operator;

  for (const [key, field, max] of [
    ['lat', 'lat', 90],
    ['lon', 'lon', 180],
  ] as const) {
    const text = cell(key);
    if (!text) continue;
    const label = key === 'lat' ? 'latitude' : 'longitude';
    const n = readNumber(label, text);
    if (!n.ok) out.errors.push(n.message);
    else if (n.value < -max || n.value > max) out.errors.push(`${label} out of range`);
    else out.fields[field] = n.value;
  }

  const yearText = cell('year');
  if (yearText) {
    const n = readNumber('spud year', yearText);
    const maxYear = currentYear + 1;
    if (!n.ok || !Number.isInteger(n.value)) {
      out.warnings.push(unreadable(`spud year "${yearText}" is not a year`, 'left blank'));
    } else if (n.value < SPUD_MIN || n.value > maxYear) {
      out.warnings.push(unreadable(`spud year ${n.value} is outside ${SPUD_MIN}–${maxYear}`, 'left blank'));
    } else {
      out.fields.spudYear = n.value;
    }
  }

  const enums = [
    ['type', 'type', WELL_TYPES, 'Unknown', 'set to Unknown'],
    ['traj', 'trajectory', TRAJECTORIES, 'Unknown', 'set to Unknown'],
    ['status', 'status', STATUSES, 'Unknown', 'set to Unknown'],
    ['klass', 'classification', CLASSIFICATIONS, 'Type 1', 'set to Type 1 (no records)'],
  ] as const;
  for (const [key, field, allowed, fallback, fallbackText] of enums) {
    const text = cell(key);
    if (!text) continue;
    const hit = readEnum<string>(text, allowed);
    if (hit !== null) {
      Object.assign(out.fields, { [field]: hit });
    } else {
      out.warnings.push(unreadable(`${ENUM_LABEL[key]} "${text}" not recognised`, fallbackText));
      if (!hasBase) Object.assign(out.fields, { [field]: fallback });
    }
  }

  for (const c of SCORE_COLUMNS) {
    for (const i of map.byKey[c.key] ?? []) {
      const text = unguard((row[i] ?? '').trim()).trim();
      if (!text) continue;
      const v = scoreLabelToValue(text);
      const before = out.scores[c.score];
      if (v === null) {
        if (!UNKNOWN_SCORE_LABELS.has(text.toLowerCase())) {
          out.warnings.push(`${map.headers[i]} "${text}" not readable; left unscored`);
        } else if (before === undefined) {
          out.scores[c.score] = null; // an explicit unknown, unless another column gives a value
        }
        continue;
      }
      // Two columns for one parameter (v1 files): the worse (higher) score counts.
      out.scores[c.score] = Math.max(before ?? 0, v) as Score;
    }
  }

  // Notes are kept as written (only the formula guard is undone, and CRLF line breaks, as some
  // spreadsheets save them inside a cell, become \n as the app writes them); blank means "not given".
  const notes = unguard(raw('notes')).replace(/\r\n?/g, '\n');
  if (notes.trim()) out.fields.notes = notes;
  return out;
}

/** Problems WellInputSchema finds in an input (a safety net: readCells should leave none). */
function schemaProblems(input: WellInput): string[] {
  const parsed = WellInputSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`);
}

type Entry = {
  licence: string;
  firstRow: number;
  stored: CsvFields | null;
  /** The record as the rows so far leave it. */
  values: Partial<CsvFields>;
  /** The score cells as the rows so far leave them: a later row's cell (a value or "?") wins. */
  scores: ScoreCells;
};

/**
 * Data rows (the header excluded) as well inputs, one per licence, with the scores each licence
 * carries and a report line per non-blank row. A row with an error is left out entirely. A later
 * row with the same licence updates the earlier one ("same licence as row N").
 */
export function rowsToWellInputs(rows: readonly (readonly string[])[], map: HeaderMap, context: CsvContext = {}): CsvRows {
  const currentYear = context.currentYear ?? new Date().getUTCFullYear();
  const stored = new Map((context.wells ?? []).map((w) => [licenceKey(w.licence), w]));
  const entries = new Map<string, Entry>();
  const report: ReportRow[] = [];

  rows.forEach((row, index) => {
    if (row.every((c) => c.trim() === '')) return;
    const rowNumber = index + 2;
    const licenceIndex = map.byKey.licence?.[0];
    const licence = unguard((licenceIndex === undefined ? '' : (row[licenceIndex] ?? '')).trim()).trim();
    const line = (status: RowStatus, rest: Partial<ReportRow> = {}): ReportRow => ({
      row: rowNumber,
      licence,
      status,
      message: '',
      warnings: [],
      changes: [],
      scored: 0,
      scores: {},
      ...rest,
    });
    if (!licence) {
      report.push(line('error', { message: 'no licence' }));
      return;
    }

    const key = licenceKey(licence);
    const prior = entries.get(key);
    const storedWell = stored.get(key);
    const base: Partial<CsvFields> | null = prior ? prior.values : storedWell ? fieldsOf(storedWell) : null;
    const read = readCells(row, map, base !== null, currentYear);
    const errors = read.errors.length > 0 ? read.errors : schemaProblems({ licence, ...read.fields });
    if (errors.length > 0) {
      report.push(line('error', { message: errors.join('; '), warnings: read.warnings }));
      return;
    }

    const changes = base ? CSV_FIELDS.filter((k) => k in read.fields && read.fields[k] !== base[k]) : [];
    const scored = Object.values(read.scores).filter((v) => v !== null).length;
    const entry: Entry = prior ?? {
      licence,
      firstRow: rowNumber,
      stored: storedWell ? fieldsOf(storedWell) : null,
      values: storedWell ? fieldsOf(storedWell) : {},
      scores: {},
    };
    entry.values = { ...entry.values, ...read.fields };
    entry.scores = { ...entry.scores, ...read.scores };
    entries.set(key, entry);
    report.push(
      line(prior || storedWell ? 'updated' : 'created', {
        message: prior ? `same licence as row ${prior.firstRow}` : '',
        warnings: read.warnings,
        changes,
        scored,
        scores: read.scores,
      }),
    );
  });

  const inputs: WellInput[] = [];
  const scoreDrafts = new Map<string, Scores>();
  const scoreCells = new Map<string, ScoreCells>();
  for (const [key, e] of entries) {
    const fields = e.stored
      ? Object.fromEntries(CSV_FIELDS.filter((k) => k in e.values && e.values[k] !== e.stored![k]).map((k) => [k, e.values[k]]))
      : e.values;
    inputs.push({ licence: e.licence, ...fields });
    if (Object.keys(e.scores).length > 0) scoreCells.set(key, e.scores);
    if (Object.values(e.scores).some((v) => v !== null)) scoreDrafts.set(key, { ...emptyScores(), ...e.scores });
  }
  return { inputs, scoreDrafts, scoreCells, report };
}

/* ---------- the template ---------- */

export const TEMPLATE_FILE_NAME = 'legacy_wells_template.csv';

const BOM = '﻿';

/** v2's second sample row (downloadCSVTemplate). */
const SAMPLE_B: Record<CsvColumnKey, string> = {
  licence: '102/11-08-046-26W4',
  operator: 'Cenovus Energy',
  lat: '53.4501',
  lon: '-113.6011',
  year: '1998',
  type: 'Gas Producer',
  traj: 'Vertical',
  status: 'Abandoned (P&A)',
  klass: 'Type 7',
  reviewer: 'T. Khan',
  sc_plugQuality: '1',
  sc_cement: '1',
  sc_barriers: '1',
  sc_scvf: '?',
  sc_age: '3',
  sc_complexity: '?',
  sc_data: '1',
  sc_penetration: '5',
  sc_plume: '3',
  sc_usdw: '?',
  sc_access: '1',
  notes: 'Modern P&A (2018), CBL verified to caprock, full records on file.',
};

const NUMERIC_KEYS: ReadonlySet<CsvColumnKey> = new Set<CsvColumnKey>(['lat', 'lon', 'year']);

/** Numbers stay numbers, so the formula guard does not touch a negative longitude. */
const sampleCell = (key: CsvColumnKey, text: string): CsvCell => (NUMERIC_KEYS.has(key) ? Number(text) : text);

/** The CSV template: the header and v2's two sample rows, BOM first (Excel then reads UTF-8). */
export function templateCsv(): string {
  return (
    BOM +
    toCsv([
      CSV_COLUMNS.map((c) => c.hdr),
      CSV_COLUMNS.map((c) => sampleCell(c.key, c.sample)),
      CSV_COLUMNS.map((c) => sampleCell(c.key, SAMPLE_B[c.key])),
    ])
  );
}

/* ---------- export ---------- */

/** Read-only result columns after the v2 ones; ignored (unmapped) when the file is imported again. */
export const EXPORT_EXTRA_HEADERS = ['L', 'C', 'Cell', 'Rank', 'Risk Index', 'Assessment', 'Methodology rev'] as const;

export type ExportItem = { well: Well; final: Assessment | null };

function exportCell(c: CsvColumn, well: Well, final: Assessment | null): CsvCell {
  if (c.score) return final?.scores[c.score] ?? '?';
  switch (c.key) {
    case 'licence':
      return well.licence;
    case 'operator':
      return well.operator;
    case 'lat':
      return well.lat;
    case 'lon':
      return well.lon;
    case 'year':
      return well.spudYear;
    case 'type':
      return well.type;
    case 'traj':
      return well.trajectory;
    case 'status':
      return well.status;
    case 'klass':
      return well.classification;
    case 'reviewer':
      return final?.reviewerName ?? '';
    case 'notes':
      return well.notes;
    default:
      return '';
  }
}

function resultCells(final: Assessment | null): CsvCell[] {
  const c = final?.computed;
  if (!final || !c) return EXPORT_EXTRA_HEADERS.map(() => '');
  return [c.L, c.C, c.cell, c.rank, c.riskIndex, final.assessedAt?.slice(0, 10) ?? '', final.methodologyRevision];
}

/**
 * The wells as CSV, BOM first: the v2 columns (scores from the current final, "?" for unknown or
 * unscored, Reviewer from the final), then the result columns (blank when unscored).
 */
export function exportCsv(items: readonly ExportItem[]): string {
  const header = [...CSV_COLUMNS.map((c) => c.hdr), ...EXPORT_EXTRA_HEADERS];
  const rows = items.map(({ well, final }) => [
    ...CSV_COLUMNS.map((c) => exportCell(c, well, final)),
    ...resultCells(final),
  ]);
  return BOM + toCsv([header, ...rows]);
}

/** `legacy_wells_<YYYY-MM-DD>.csv`, dated with the UTC day. */
export function exportCsvFileName(at: string | Date): string {
  return `legacy_wells_${new Date(at).toISOString().slice(0, 10)}.csv`;
}
