// The Construction tab's editing model (spec §4.3, §5; schematic spec 2026-08-07 §7). Pure: the
// tab (components/construction/ConstructionEditor.tsx) owns the state and saves through the store.
//
// - The tab edits a working copy, `ConstructionRows`: every edited field as the text in its input,
//   beside the row as it was stored, parsed or added (`original`). A field whose text is unchanged
//   keeps its stored value exactly, and fields the editor does not show (a casing `type`, unknown
//   fields, `verbatim`) ride along untouched, so rows → record → rows loses nothing.
// - Numbers are plain decimals with a point ("1463.5"): no hex, no exponent, no thousands
//   separator. A field that does not read is an error on that field; its row is left out of the
//   record (and drawn as nothing) until it is fixed.
// - A row is `manual` once any of its values differs from what it started with, and goes back to
//   its own source when the values do; it keeps its `verbatim` either way. Rows added by hand are
//   manual.
// - A pasted report only ever adds (applyParsed): parsed rows are appended to each list, existing
//   rows are never changed or removed, the open hole is taken only when the record has none, and
//   the pasted text is appended to `sourceText`.
import { WellboreSchema, type Wellbore, type WellboreInput, type WellboreSource } from '@lwa/engine';

export const LIST_KEYS = ['casings', 'plugs', 'perforations', 'formations', 'packers', 'zones', 'notes'] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export type NumberField = {
  key: string;
  /** The field's full name (the input's label): "Top (m)". */
  label: string;
  /** A shorter column heading, when the label is too long for one. */
  short?: string;
  kind: 'number';
  min?: number;
  integer?: boolean;
  /** Emptied, the field is stored as null (the schema allows it) instead of being left out. */
  nullable?: boolean;
};
export type TextField = { key: string; label: string; short?: string; kind: 'text'; wide?: boolean };
export type SelectOption = { value: string; label: string };
export type SelectField = { key: string; label: string; short?: string; kind: 'select'; options: readonly SelectOption[] };
export type FieldSpec = NumberField | TextField | SelectField;

const depth = (key: string, label: string, nullable = false): NumberField => ({ key, label, kind: 'number', min: 0, nullable });

export const PLUG_KINDS: readonly SelectOption[] = [
  { value: 'cement', label: 'Cement' },
  { value: 'bridge', label: 'Bridge plug' },
  { value: 'cibp', label: 'CIBP' },
];
export const ZONE_KINDS: readonly SelectOption[] = [
  { value: 'salt', label: 'Salt' },
  { value: 'hydrocarbon', label: 'Hydrocarbon' },
];

export type ListSpec = {
  title: string;
  /** "Plug", for row names: "Plug 1". */
  singular: string;
  /** The renderer's data-kind for the list's rows. */
  svgKind: string;
  fields: readonly FieldSpec[];
};

/** The lists of a construction record, in the editor's order, with the fields it edits (spec 2026-08-07 §2, §7). */
export const LISTS: Readonly<Record<ListKey, ListSpec>> = {
  casings: {
    title: 'Casings',
    singular: 'Casing',
    svgKind: 'casing',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', wide: true },
      { key: 'od_mm', label: 'OD (mm)', kind: 'number', min: 0 },
      { key: 'grade', label: 'Grade', kind: 'text' },
      { key: 'weight_kgm', label: 'Weight (kg/m)', short: 'Wt (kg/m)', kind: 'number', min: 0 },
      depth('top_m', 'Top (m)'),
      depth('shoe_m', 'Shoe (m)'),
      depth('toc_m', 'TOC (m)'),
    ],
  },
  plugs: {
    title: 'Plugs',
    singular: 'Plug',
    svgKind: 'plug',
    fields: [
      { key: 'n', label: 'Plug number', short: '#', kind: 'number', min: 0, integer: true },
      { key: 'kind', label: 'Kind', kind: 'select', options: PLUG_KINDS },
      depth('top_m', 'Top (m)'),
      depth('bottom_m', 'Bottom (m)'),
      { key: 'sacks', label: 'Sacks', kind: 'number', min: 0, integer: true },
      { key: 'additives', label: 'Additives', kind: 'text' },
      { key: 'notes', label: 'Notes', kind: 'text', wide: true },
    ],
  },
  perforations: {
    title: 'Perforations',
    singular: 'Perforation',
    svgKind: 'perf',
    fields: [depth('top_m', 'Top (m)'), depth('bottom_m', 'Bottom (m)'), { key: 'status', label: 'Status', kind: 'text', wide: true }],
  },
  formations: {
    title: 'Formation tops',
    singular: 'Formation top',
    svgKind: 'formation',
    fields: [{ key: 'name', label: 'Name', kind: 'text', wide: true }, depth('top_m', 'Top (m)')],
  },
  packers: { title: 'Packers', singular: 'Packer', svgKind: 'packer', fields: [depth('depth_m', 'Depth (m)')] },
  zones: {
    title: 'Zones',
    singular: 'Zone',
    svgKind: 'zone',
    fields: [{ key: 'kind', label: 'Kind', kind: 'select', options: ZONE_KINDS }, depth('top_m', 'Top (m)'), depth('bottom_m', 'Bottom (m)')],
  },
  notes: {
    title: 'Notes',
    singular: 'Note',
    svgKind: 'note',
    fields: [depth('depth_m', 'Depth (m)', true), { key: 'text', label: 'Text', kind: 'text', wide: true }],
  },
};

export const TD_FIELD: NumberField = { key: 'td', label: 'TD (m)', kind: 'number', min: 0, nullable: true };
export const KB_FIELD: NumberField = { key: 'kbElev', label: 'KB elevation (m)', kind: 'number', nullable: true };

/** Builds one value per list without a cast. */
function mapLists<T>(f: (k: ListKey) => T): Record<ListKey, T> {
  return {
    casings: f('casings'),
    plugs: f('plugs'),
    perforations: f('perforations'),
    formations: f('formations'),
    packers: f('packers'),
    zones: f('zones'),
    notes: f('notes'),
  };
}

/* ---------- numbers ---------- */

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const NOT_A_DECIMAL = 'Use digits only, with a point as the decimal separator (for example 1463.5).';

export type Parsed = { ok: true; value: number | null } | { ok: false; message: string };

/** A number input's text as a value: blank is null; anything but a plain decimal with a point is refused. */
export function parseDecimal(text: string, spec: NumberField): Parsed {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  if (!DECIMAL.test(t)) return { ok: false, message: NOT_A_DECIMAL };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, message: 'Enter a smaller number.' };
  if (spec.min !== undefined && n < spec.min) return { ok: false, message: `Enter ${spec.min} or more.` };
  if (spec.integer && !Number.isInteger(n)) return { ok: false, message: 'Enter a whole number.' };
  return { ok: true, value: n === 0 ? 0 : n }; // never -0
}

/** A number as a plain decimal (never with an exponent), short enough to read and exact when read back. */
export function numberText(n: number): string {
  const s = String(n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign = '', lead = '', frac = '', expText = '0'] = m;
  const digits = lead + frac;
  const exp = Number(expText);
  return exp < 0 ? `${sign}0.${'0'.repeat(-exp - 1)}${digits}` : `${sign}${digits}${'0'.repeat(Math.max(0, exp - frac.length))}`;
}

/** A stored value as its input's text. */
function toText(v: unknown): string {
  if (typeof v === 'number') return numberText(v);
  return typeof v === 'string' ? v : '';
}

/* ---------- the working copy ---------- */

export type EditRow = {
  /** Stable for the row's life in the editor (React key, edits by key). */
  readonly key: string;
  /** Each edited field's input text, as typed. */
  readonly values: Readonly<Record<string, string>>;
  /** The row as stored, parsed or added: its unknown fields, source and verbatim included. */
  readonly original: Readonly<Record<string, unknown>>;
  /** Added by hand in this editor: left out of the record while every value is blank. */
  readonly added: boolean;
};

/** A construction record's fields that are not lists. */
export type ConstructionHeader = Omit<Wellbore, ListKey>;

export type ConstructionRows = {
  /** TD and KB elevation as typed. */
  readonly td: string;
  readonly kbElev: string;
  readonly lists: Readonly<Record<ListKey, readonly EditRow[]>>;
  /** The record's other fields (open hole, source, pasted text), kept as they are; also the stored td and kbElev. */
  readonly base: ConstructionHeader;
};

let lastKey = 0;
const nextKey = (): string => `row-${++lastKey}`;

function editRow(list: ListKey, row: Readonly<Record<string, unknown>>, added = false): EditRow {
  const values: Record<string, string> = {};
  for (const f of LISTS[list].fields) values[f.key] = toText(row[f.key]);
  return { key: nextKey(), values, original: { ...row }, added };
}

function headerOf(wb: Wellbore): ConstructionHeader {
  const { td, kbElev, openHole, source, sourceText } = wb;
  return { td, kbElev, openHole, source, sourceText };
}

/** The editor's rows for a stored record; null (no record yet) gives empty lists. */
export function rowsFromWellbore(wb: Wellbore | null): ConstructionRows {
  return {
    td: toText(wb?.td),
    kbElev: toText(wb?.kbElev),
    lists: mapLists((k) => (wb ? wb[k].map((row) => editRow(k, row)) : [])),
    base: wb ? headerOf(wb) : {},
  };
}

/** Whether a row's values differ from what it started with. */
function edited(row: EditRow): boolean {
  return Object.entries(row.values).some(([k, text]) => text !== toText(row.original[k]));
}

/** The row's provenance as it stands: `manual` once edited, else its own (undefined when it has none). */
export function rowSource(row: EditRow): WellboreSource | undefined {
  if (edited(row)) return 'manual';
  const s = row.original.source;
  return s === 'parsed' || s === 'manual' || s === 'extractor' || s === 'bridge' ? s : undefined;
}

/** "Parsed", "Manual", "Imported" (extractor or 3D bridge); null when a row has no recorded source. */
export function sourceLabel(source: WellboreSource | undefined): string | null {
  if (source === 'parsed') return 'Parsed';
  if (source === 'manual') return 'Manual';
  if (source === 'extractor' || source === 'bridge') return 'Imported';
  return null;
}

export function setHeader(rows: ConstructionRows, field: 'td' | 'kbElev', text: string): ConstructionRows {
  return { ...rows, [field]: text };
}

function updateList(rows: ConstructionRows, list: ListKey, f: (xs: readonly EditRow[]) => readonly EditRow[]): ConstructionRows {
  return { ...rows, lists: { ...rows.lists, [list]: f(rows.lists[list]) } };
}

export function setValue(rows: ConstructionRows, list: ListKey, key: string, field: string, text: string): ConstructionRows {
  return updateList(rows, list, (xs) => xs.map((r) => (r.key === key ? { ...r, values: { ...r.values, [field]: text } } : r)));
}

/** Appends an empty manual row; returns its key so the editor can focus it. */
export function addRow(rows: ConstructionRows, list: ListKey): { rows: ConstructionRows; key: string } {
  const row = editRow(list, { source: 'manual' }, true);
  return { rows: updateList(rows, list, (xs) => [...xs, row]), key: row.key };
}

export function removeRow(rows: ConstructionRows, list: ListKey, key: string): ConstructionRows {
  return updateList(rows, list, (xs) => xs.filter((r) => r.key !== key));
}

/* ---------- from the rows to a record ---------- */

export type FieldError = {
  /** null for TD, KB elevation and the record as a whole. */
  list: ListKey | null;
  rowKey: string | null;
  field: string;
  message: string;
};

export type RowsResult = {
  /** The record to save: valid rows only. */
  wellbore: Wellbore;
  /** What to draw: the same lists with each left-out row as null, so data-id indices match the editor's rows. */
  drawing: WellboreInput;
  errors: FieldError[];
};

/** A row's record, or its errors. Unchanged fields keep their stored values exactly. */
function rowRecord(list: ListKey, row: EditRow): { record: Record<string, unknown> | null; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const out: Record<string, unknown> = { ...row.original };
  let changed = false;
  for (const f of LISTS[list].fields) {
    const text = row.values[f.key] ?? '';
    if (text === toText(row.original[f.key])) continue;
    changed = true;
    let value: number | string | null | undefined;
    if (f.kind === 'number') {
      const r = parseDecimal(text, f);
      if (!r.ok) {
        errors.push({ list, rowKey: row.key, field: f.key, message: r.message });
        continue;
      }
      value = r.value ?? (f.nullable ? null : undefined);
    } else {
      value = text.trim() || undefined;
    }
    if (value === undefined) delete out[f.key];
    else out[f.key] = value;
  }
  if (errors.length > 0) return { record: null, errors };
  if (row.added && Object.values(row.values).every((t) => t.trim() === '')) return { record: null, errors };
  if (changed) out.source = 'manual';
  return { record: out, errors };
}

function headerValue(text: string, stored: number | null | undefined, spec: NumberField, errors: FieldError[]): number | null | undefined {
  if (text === toText(stored)) return stored;
  const r = parseDecimal(text, spec);
  if (r.ok) return r.value;
  errors.push({ list: null, rowKey: null, field: spec.key, message: r.message });
  return null;
}

const EMPTY: Wellbore = WellboreSchema.parse({});

export function wellboreFromRows(rows: ConstructionRows): RowsResult {
  const errors: FieldError[] = [];
  const td = headerValue(rows.td, rows.base.td, TD_FIELD, errors);
  const kbElev = headerValue(rows.kbElev, rows.base.kbElev, KB_FIELD, errors);
  const records = mapLists((k) => rows.lists[k].map((row) => rowRecord(k, row)));
  for (const k of LIST_KEYS) for (const r of records[k]) errors.push(...r.errors);

  const parsed = WellboreSchema.safeParse({
    ...rows.base,
    td,
    kbElev,
    ...mapLists((k) => records[k].flatMap((r) => (r.record ? [r.record] : []))),
  });
  if (!parsed.success) {
    errors.push({ list: null, rowKey: null, field: 'record', message: `The construction record does not read: ${parsed.error.message}` });
    return { wellbore: { ...EMPTY, td: td ?? null }, drawing: { td: td ?? null }, errors };
  }
  const wellbore = parsed.data;
  const drawn = <T,>(k: ListKey, kept: readonly T[]): (T | null)[] => {
    let i = 0;
    return records[k].map((r) => (r.record ? (kept[i++] ?? null) : null));
  };
  const drawing: WellboreInput = {
    ...wellbore,
    casings: drawn('casings', wellbore.casings),
    plugs: drawn('plugs', wellbore.plugs),
    perforations: drawn('perforations', wellbore.perforations),
    formations: drawn('formations', wellbore.formations),
    packers: drawn('packers', wellbore.packers),
    zones: drawn('zones', wellbore.zones),
    notes: drawn('notes', wellbore.notes),
  };
  return { wellbore, drawing, errors };
}

/** The record as stored: null when it holds nothing (no rows, no TD or KB, no open hole, no pasted text). */
export function toConstruction(wb: Wellbore): Wellbore | null {
  const empty =
    LIST_KEYS.every((k) => wb[k].length === 0) &&
    wb.td == null &&
    wb.kbElev == null &&
    wb.openHole == null &&
    !wb.sourceText?.trim();
  return empty ? null : wb;
}

/** JSON with sorted keys and null or undefined object values left out. */
function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (x !== null && typeof x === 'object') {
    const entries: [string, unknown][] = Object.entries(x);
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (v !== null && v !== undefined) out[k] = canonical(v);
    }
    return out;
  }
  return x;
}

/** A record's data as one string, for comparing (key order aside; null counts as missing). */
export function constructionKey(wb: Wellbore | null): string {
  return JSON.stringify(canonical(wb));
}

/** Whether two records hold the same data (key order aside; null counts as missing). */
export function sameConstruction(a: Wellbore | null, b: Wellbore | null): boolean {
  return constructionKey(a) === constructionKey(b);
}

/* ---------- a pasted report ---------- */

/**
 * The record with a parsed report added (spec §4.3 "paste report → parse"): the parsed rows are
 * appended to each list (with their `source: 'parsed'` and `verbatim`), existing rows are never
 * changed or removed, `openHole` is taken only when the record has none, and `parsed.sourceText`
 * (the pasted text) is appended to the record's, a blank line between pastes. TD is the parsed
 * one, else the record's, else `fallbackTd` (the well's td_m).
 */
export function applyParsed(existing: Wellbore | null, parsed: Partial<Wellbore>, fallbackTd: number | null): Wellbore {
  const base = existing ?? EMPTY;
  const texts = [base.sourceText, parsed.sourceText].filter((t): t is string => !!t?.trim());
  const append = <T extends object>(rows: readonly T[], more: readonly T[] | undefined): T[] => [
    ...rows,
    ...(more ?? []).map((row) => ({ ...row })),
  ];
  return {
    ...base,
    casings: append(base.casings, parsed.casings),
    plugs: append(base.plugs, parsed.plugs),
    perforations: append(base.perforations, parsed.perforations),
    formations: append(base.formations, parsed.formations),
    packers: append(base.packers, parsed.packers),
    zones: append(base.zones, parsed.zones),
    notes: append(base.notes, parsed.notes),
    td: parsed.td ?? base.td ?? fallbackTd ?? null,
    kbElev: parsed.kbElev ?? base.kbElev ?? null,
    openHole: base.openHole ?? parsed.openHole ?? null,
    source: base.source ?? 'parsed',
    sourceText: texts.length > 0 ? texts.join('\n\n') : (base.sourceText ?? null),
  };
}

/**
 * applyParsed onto the working copy. Existing rows stay as they are, text as typed (even text that
 * does not read yet); the parsed rows are appended; an empty TD or KB input takes what applyParsed
 * gives (the parsed value, else the well's TD).
 */
export function applyParsedToRows(rows: ConstructionRows, parsed: Partial<Wellbore>, fallbackTd: number | null): ConstructionRows {
  const { wellbore: current, errors } = wellboreFromRows(rows);
  const next = applyParsed(current, parsed, fallbackTd);
  const invalid = new Set(errors.filter((e) => e.list === null).map((e) => e.field));
  const header = (field: 'td' | 'kbElev'): string =>
    invalid.has(field) || (next[field] ?? null) === (current[field] ?? null) ? rows[field] : toText(next[field]);
  return {
    td: header('td'),
    kbElev: header('kbElev'),
    lists: mapLists((k) => [...rows.lists[k], ...next[k].slice(current[k].length).map((row) => editRow(k, row))]),
    base: { ...rows.base, openHole: next.openHole, source: next.source, sourceText: next.sourceText },
  };
}

export type ReportSummary = {
  /** Rows the report adds, over every list. */
  rowsAdded: number;
  /** Lines (or `;` parts of lines) that no reader turned into a row, in report order, once each. */
  notUnderstood: string[];
  /** The parser's own messages, in full. */
  messages: string[];
};

// The report parser runs two readers over every line, an interval reader (plugs, perforations,
// notes) and a casing reader, and each reports the lines it could not read, so most lines draw a
// message from one of them. A line was understood when it became a row, or when it belongs to a
// plug block that made a plug ("Plug #1" / "1463–1448 m" / "25 sacks") and the interval reader
// took it. These mirror parseWellboreReport: blocks split at blank lines and "Plug #" headers,
// clauses at line ends and ';', and the interval reader's message prefixes.
const QUOTED = /^(Unparsed interval line|No records|Unparsed casing line): "([\s\S]*)"$/;
const PLUG_HEADER = /plug\s*#?\s*\d+/i;

function blocksOf(text: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line || (PLUG_HEADER.test(line) && block.length > 0)) {
      if (block.length > 0) blocks.push(block);
      block = [];
    }
    if (line) block.push(line);
  }
  if (block.length > 0) blocks.push(block);
  return blocks.map((b) =>
    b
      .join('\n')
      .split(/\n|;/)
      .map((c) => c.trim())
      .filter(Boolean),
  );
}

export function summariseReport(text: string, report: { wellbore: Partial<Wellbore>; warnings: readonly string[] }): ReportSummary {
  const wb = report.wellbore;
  const rowsAdded = LIST_KEYS.reduce((n, k) => n + (wb[k]?.length ?? 0), 0);

  const intervalUnread = new Set<string>();
  for (const w of report.warnings) {
    const m = QUOTED.exec(w);
    if (m && m[1] !== 'Unparsed casing line') intervalUnread.add(m[2] ?? '');
  }
  const madeRow = new Set<string>();
  for (const k of LIST_KEYS) {
    for (const row of wb[k] ?? []) {
      const v = row.verbatim;
      // A note whose text is its whole line is the parser keeping a line it could not read.
      const unreadNote = k === 'notes' && row.text === v && (row.depth_m ?? null) === null;
      if (v && !unreadNote) madeRow.add(v);
    }
  }
  const plugLines = new Set((wb.plugs ?? []).map((p) => p.verbatim));

  const notUnderstood: string[] = [];
  for (const clauses of blocksOf(text)) {
    const madePlug = clauses.some((c) => plugLines.has(c));
    for (const c of clauses) {
      if (madeRow.has(c) || (madePlug && !intervalUnread.has(c))) continue;
      if (!notUnderstood.includes(c)) notUnderstood.push(c);
    }
  }
  return { rowsAdded, notUnderstood, messages: [...report.warnings] };
}

/* ---------- the schematic ---------- */

/** The renderer's data-id for a row: "plug:0". */
export function svgIdOf(list: ListKey, index: number): string {
  return `${LISTS[list].svgKind}:${index}`;
}

/** The editor row a drawn element belongs to (a casing's cement to its casing); null for the open hole and anything else. */
export function rowForSvgId(id: string): { list: ListKey; index: number } | null {
  const m = /^([a-z]+):(\d+)$/.exec(id);
  if (!m) return null;
  const kind = m[1] === 'cement' ? 'casing' : m[1];
  const list = LIST_KEYS.find((k) => LISTS[k].svgKind === kind);
  return list ? { list, index: Number(m[2]) } : null;
}

/** What the schematic draws: the record with its TD, else the well's (spec decision: td ?? well.td_m); null with neither. */
export function schematicInput(wb: WellboreInput | null, fallbackTd: number | null): WellboreInput | null {
  if (!wb) return fallbackTd != null ? { td: fallbackTd } : null;
  return { ...wb, td: wb.td ?? fallbackTd ?? null };
}

/** A colour read from a CSS custom property, when it is safe to write into an SVG attribute; else the fallback. */
export function safeColour(value: string, fallback: string): string {
  const v = value.trim();
  return v !== '' && /^[#a-zA-Z0-9(),.%\s-]+$/.test(v) ? v : fallback;
}

/**
 * The engine's SVG as a file of its own: a background under the drawing, so labels drawn in the
 * current theme's resolved colours stay legible wherever the file is opened.
 */
export function standaloneSvg(svg: string, background: string): string {
  return svg.replace(/^<svg[^>]*>/, (open) => `${open}<rect width="100%" height="100%" fill="${safeColour(background, '#ffffff')}"/>`);
}

/** "100_07-21-055-22W4_00-schematic.svg": the licence with anything but letters, digits, '.', '_' and '-' replaced. */
export function exportFilename(licence: string): string {
  const safe = licence.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${safe || 'wellbore'}-schematic.svg`;
}
