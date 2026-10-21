import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WellboreSchema, parseWellboreReport, type Wellbore } from '@lwa/engine';
import {
  LIGHT_COLOURS,
  LIST_KEYS,
  addRow,
  applyParsed,
  applyParsedToRows,
  exportFilename,
  hasUnsavedChanges,
  parseDecimal,
  removeRow,
  restoreDecision,
  reviveKeptCopy,
  reviveRows,
  rowForSvgId,
  rowName,
  rowSource,
  rowsFromWellbore,
  rowsNotDrawn,
  safeColour,
  sameConstruction,
  schematicExport,
  schematicInput,
  setHeader,
  setValue,
  sourceLabel,
  standaloneSvg,
  summariseReport,
  svgIdOf,
  swapValues,
  toConstruction,
  wellboreFromRows,
  constructionKey,
  type ConstructionRows,
} from '@/lib/construction-edit';

/** The engine's full renderer fixture (packages/engine/src/wellbore/wellbore.test.ts), with provenance and unknown fields added. */
const FULL: Wellbore = {
  td: 1500,
  kbElev: 800,
  source: 'manual',
  sourceText: 'Plug #1\n1400–1450 m',
  casings: [
    { name: 'Surface Casing', od_mm: 219, grade: 'J55', top_m: 0, shoe_m: 186, toc_m: 0, type: 'surface', vendor: 'Acme' },
    { name: 'Production Casing', od_mm: 139.7, top_m: 0, shoe_m: 1450, toc_m: 900, source: 'extractor', verbatim: '139.7 mm @ 1450 m' },
  ],
  plugs: [
    { n: 1, top_m: 1400, bottom_m: 1450, sacks: 25, kind: 'cement', source: 'parsed', verbatim: '1400–1450 m', tagged: true },
    { top_m: 1200, bottom_m: 1200, kind: 'cibp', extra: { by: 'rig 7', checks: [1, 2] } },
  ],
  perforations: [{ top_m: 1300, bottom_m: 1310, status: 'squeezed' }],
  formations: [{ name: 'Nisku', top_m: 1100, source: 'manual' }],
  packers: [{ depth_m: 1000 }],
  zones: [{ kind: 'salt', top_m: 600, bottom_m: 700 }],
  openHole: { top_m: 1450, bottom_m: 1500 },
  notes: [
    { depth_m: 1400, text: 'felt plug' },
    { depth_m: null, text: 'garbled', source: 'parsed', verbatim: 'garbled' },
  ],
};

const PLUG_REPORT = 'Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2';

const manualPlug = { n: 2, top_m: 900, bottom_m: 950, source: 'manual' as const };
const parsedPlug = { n: 1, top_m: 1448, bottom_m: 1463, source: 'parsed' as const, verbatim: '1463–1448 m' };

function emptyWellbore(overrides: Partial<Wellbore> = {}): Wellbore {
  return WellboreSchema.parse({ td: null, ...overrides });
}

/** The row keys of one list, for edits by key. */
const keysOf = (rows: ConstructionRows, list: (typeof LIST_KEYS)[number]) => rows.lists[list].map((r) => r.key);

describe('applyParsed', () => {
  it('applyParsed onto null creates a wellbore with td from parsed or null and keeps sourceText', () => {
    const report = parseWellboreReport(PLUG_REPORT);
    const wb = applyParsed(null, { ...report.wellbore, sourceText: PLUG_REPORT }, null);
    expect(wb.td).toBeNull();
    expect(wb.sourceText).toBe(PLUG_REPORT);
    expect(wb.plugs).toHaveLength(1);
    expect(wb.plugs[0]).toMatchObject({ n: 1, top_m: 1448, bottom_m: 1463, sacks: 25, source: 'parsed', verbatim: '1463–1448 m' });
    for (const k of LIST_KEYS) expect(Array.isArray(wb[k])).toBe(true);
    expect(WellboreSchema.parse(wb)).toEqual(wb); // a valid stored record

    expect(applyParsed(null, { td: 1200 }, 1463.3).td).toBe(1200); // parsed td first
    expect(applyParsed(null, {}, 1463.3).td).toBe(1463.3); // then the well's td
  });

  it('keeps an existing td over the fallback, and a parsed td over both', () => {
    expect(applyParsed(emptyWellbore({ td: 1500 }), {}, 1463.3).td).toBe(1500);
    expect(applyParsed(emptyWellbore({ td: 1500 }), { td: 1600 }, 1463.3).td).toBe(1600);
  });

  it('applyParsed never removes or changes rows with source "manual"', () => {
    const existing = emptyWellbore({ td: 1500, plugs: [manualPlug], casings: [{ name: 'Surface', shoe_m: 186, source: 'manual' }] });
    const before = structuredClone(existing);
    const wb = applyParsed(existing, { plugs: [parsedPlug], casings: [{ shoe_m: 610, source: 'parsed', verbatim: '@ 610 m' }] }, null);
    expect(wb.plugs).toEqual([manualPlug, parsedPlug]);
    expect(wb.casings).toEqual([before.casings[0], { shoe_m: 610, source: 'parsed', verbatim: '@ 610 m' }]);
    expect(existing).toEqual(before); // nothing mutated
  });

  it('existing parsed rows are kept too', () => {
    const existing = emptyWellbore({ plugs: [parsedPlug], notes: [{ depth_m: null, text: 'x', source: 'parsed', verbatim: 'x' }] });
    const second = { n: 2, top_m: 30, bottom_m: 0, source: 'parsed' as const, verbatim: 'surface plug 0–30 m' };
    const wb = applyParsed(existing, { plugs: [second], notes: [] }, null);
    expect(wb.plugs).toEqual([parsedPlug, second]);
    expect(wb.notes).toEqual(existing.notes);
  });

  it('sourceText appends, with a blank line between pastes', () => {
    const once = applyParsed(null, { sourceText: 'Plug #1\n1463–1448 m' }, null);
    const twice = applyParsed(once, { sourceText: 'Perforated 831.7–839.7 m' }, null);
    expect(twice.sourceText).toBe('Plug #1\n1463–1448 m\n\nPerforated 831.7–839.7 m');
    expect(applyParsed(twice, {}, null).sourceText).toBe(twice.sourceText); // nothing pasted, nothing appended
  });

  it('sets openHole only when the existing record has none', () => {
    expect(applyParsed(null, { openHole: {} }, null).openHole).toEqual({});
    const existing = emptyWellbore({ openHole: { top_m: 186, bottom_m: 1500 } });
    expect(applyParsed(existing, { openHole: {} }, null).openHole).toEqual({ top_m: 186, bottom_m: 1500 });
  });
});

describe('rowsFromWellbore / wellboreFromRows', () => {
  it('rowsFromWellbore → wellboreFromRows round-trips the Task 4 full fixture including unknown fields and plug.n as number', () => {
    const { wellbore, errors } = wellboreFromRows(rowsFromWellbore(FULL));
    expect(errors).toEqual([]);
    expect(wellbore).toEqual(FULL);
    expect(typeof wellbore.plugs[0]!.n).toBe('number');
    expect(wellbore.casings[0]).toHaveProperty('vendor', 'Acme');
    expect(wellbore.plugs[1]).toHaveProperty('extra', { by: 'rig 7', checks: [1, 2] });
    expect(wellbore.notes[1]!.depth_m).toBeNull(); // a null kept as null
    expect(sameConstruction(toConstruction(wellbore), FULL)).toBe(true);
  });

  it('round-trips numbers that print with an exponent', () => {
    const wb = emptyWellbore({ td: 1e21, plugs: [{ top_m: 1e-7, bottom_m: 0.1 + 0.2 }] });
    const rows = rowsFromWellbore(wb);
    expect(rows.td).toBe('1000000000000000000000');
    expect(rows.lists.plugs[0]!.values.top_m).toMatch(/^0\.0000001/);
    expect(wellboreFromRows(rows).wellbore).toEqual(wb);
    // re-typing the text shown gives the same number back
    const retyped = setValue(rows, 'plugs', rows.lists.plugs[0]!.key, 'top_m', `${rows.lists.plugs[0]!.values.top_m} `);
    expect(wellboreFromRows(retyped).wellbore.plugs[0]!.top_m).toBe(1e-7);
  });

  it('null makes empty rows; a record with nothing in it is no construction', () => {
    const rows = rowsFromWellbore(null);
    expect(rows.td).toBe('');
    for (const k of LIST_KEYS) expect(rows.lists[k]).toEqual([]);
    expect(toConstruction(wellboreFromRows(rows).wellbore)).toBeNull();
    expect(toConstruction(emptyWellbore({ sourceText: '  ' }))).toBeNull();
    expect(toConstruction(emptyWellbore({ kbElev: 800 }))).not.toBeNull();
  });
});

describe('editing the rows', () => {
  const parsedRows = () =>
    rowsFromWellbore(applyParsed(null, { ...parseWellboreReport(PLUG_REPORT).wellbore, sourceText: PLUG_REPORT }, 1463.3));

  it('editing a value in a parsed row makes it manual and keeps its verbatim; changing it back makes it parsed again', () => {
    const rows = parsedRows();
    const [key] = keysOf(rows, 'plugs');
    const edited = setValue(rows, 'plugs', key!, 'top_m', '1450');
    expect(rowSource(edited.lists.plugs[0]!)).toBe('manual');
    const plug = wellboreFromRows(edited).wellbore.plugs[0]!;
    expect(plug).toMatchObject({ top_m: 1450, bottom_m: 1463, sacks: 25, source: 'manual', verbatim: '1463–1448 m' });

    const back = setValue(edited, 'plugs', key!, 'top_m', '1448');
    expect(rowSource(back.lists.plugs[0]!)).toBe('parsed');
    expect(wellboreFromRows(back).wellbore.plugs[0]!.source).toBe('parsed');
  });

  it('rows added by hand are manual; removing a row removes it', () => {
    const rows = parsedRows();
    const added = addRow(rows, 'plugs');
    expect(added.rows.lists.plugs).toHaveLength(2);
    expect(rowSource(added.rows.lists.plugs[1]!)).toBe('manual');
    const typed = setValue(setValue(added.rows, 'plugs', added.key, 'top_m', '0'), 'plugs', added.key, 'bottom_m', '30');
    expect(wellboreFromRows(typed).wellbore.plugs[1]).toEqual({ top_m: 0, bottom_m: 30, source: 'manual' });

    const removed = removeRow(typed, 'plugs', keysOf(typed, 'plugs')[0]!);
    expect(wellboreFromRows(removed).wellbore.plugs).toEqual([{ top_m: 0, bottom_m: 30, source: 'manual' }]);
  });

  it('an emptied field is left out (null where the schema allows null)', () => {
    const rows = rowsFromWellbore(FULL);
    const casingKey = keysOf(rows, 'casings')[0]!;
    const noteKey = keysOf(rows, 'notes')[0]!;
    let next = setValue(rows, 'casings', casingKey, 'grade', '');
    next = setValue(next, 'casings', casingKey, 'toc_m', '');
    next = setValue(next, 'notes', noteKey, 'depth_m', '');
    next = setHeader(next, 'kbElev', '');
    const wb = wellboreFromRows(next).wellbore;
    expect(wb.casings[0]).not.toHaveProperty('grade');
    expect(wb.casings[0]).not.toHaveProperty('toc_m');
    expect(wb.casings[0]).toHaveProperty('vendor', 'Acme');
    expect(wb.notes[0]!.depth_m).toBeNull();
    expect(wb.kbElev).toBeNull();
  });

  it('a value that is not a plain decimal is an error on that field; the row is left out of the record and drawn as nothing', () => {
    const rows = rowsFromWellbore(FULL);
    const key = keysOf(rows, 'plugs')[0]!;
    const bad = setValue(rows, 'plugs', key, 'top_m', '1400,5');
    const result = wellboreFromRows(bad);
    expect(result.errors).toEqual([
      { list: 'plugs', rowKey: key, field: 'top_m', kind: 'input', message: expect.stringContaining('point as the decimal separator') },
    ]);
    expect(result.wellbore.plugs).toEqual([FULL.plugs[1]]); // not saved
    expect(result.drawing.plugs).toEqual([null, FULL.plugs[1]]); // the second plug keeps its index (data-id plug:1)

    const badTd = wellboreFromRows(setHeader(rows, 'td', 'deep'));
    expect(badTd.errors).toEqual([{ list: null, rowKey: null, field: 'td', kind: 'input', message: expect.stringContaining('point') }]);
  });

  it('applyParsedToRows appends the parsed rows, fills an empty TD from the well, and keeps text as typed (even invalid)', () => {
    const report = parseWellboreReport(PLUG_REPORT);
    const parsed = { ...report.wellbore, sourceText: PLUG_REPORT };

    const fromEmpty = applyParsedToRows(rowsFromWellbore(null), parsed, 1463.3);
    expect(fromEmpty.td).toBe('1463.3');
    expect(wellboreFromRows(fromEmpty).wellbore.plugs).toHaveLength(1);
    expect(wellboreFromRows(fromEmpty).wellbore.sourceText).toBe(PLUG_REPORT);

    const rows = rowsFromWellbore(FULL);
    const key = keysOf(rows, 'plugs')[0]!;
    const typed = setHeader(setValue(rows, 'plugs', key, 'top_m', '14OO'), 'td', '1500.0');
    const next = applyParsedToRows(typed, parsed, 1463.3);
    expect(next.td).toBe('1500.0');
    expect(next.lists.plugs.map((r) => r.values.top_m)).toEqual(['14OO', '1200', '1448']);
    expect(next.lists.plugs[0]!.key).toBe(key); // existing rows are the same rows
    expect(rowSource(next.lists.plugs[2]!)).toBe('parsed');
    expect(wellboreFromRows(next).wellbore.sourceText).toBe(`${FULL.sourceText}\n\n${PLUG_REPORT}`);
  });
});

describe('parseDecimal', () => {
  const depth = { key: 'top_m', label: 'Top (m)', kind: 'number', min: 0 } as const;
  it('reads plain decimals with a point', () => {
    expect(parseDecimal('1463.5', depth)).toEqual({ ok: true, value: 1463.5 });
    expect(parseDecimal(' 12 ', depth)).toEqual({ ok: true, value: 12 });
    expect(parseDecimal('.5', depth)).toEqual({ ok: true, value: 0.5 });
    expect(parseDecimal('', depth)).toEqual({ ok: true, value: null });
    expect(parseDecimal('-3.5', { key: 'kbElev', label: 'KB elevation (m)', kind: 'number' })).toEqual({ ok: true, value: -3.5 });
  });
  it.each(['1,5', '1.463,5', '0x10', '1e3', 'Infinity', 'abc', '12 m', '1.2.3', '-'])('refuses %j', (text) => {
    const r = parseDecimal(text, depth);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/point as the decimal separator/);
  });
  it('refuses a negative depth and a fractional count', () => {
    expect(parseDecimal('-1', depth)).toEqual({ ok: false, message: 'Enter 0 or more.' });
    expect(parseDecimal('2.5', { key: 'sacks', label: 'Sacks', kind: 'number', min: 0, integer: true })).toEqual({
      ok: false,
      message: 'Enter a whole number.',
    });
  });
});

describe('sameConstruction', () => {
  it('ignores key order and treats null like a missing value', () => {
    expect(sameConstruction(emptyWellbore({ td: 1, plugs: [{ top_m: 1, bottom_m: 2 }] }), { ...emptyWellbore(), plugs: [{ bottom_m: 2, top_m: 1 }], td: 1 })).toBe(true);
    expect(sameConstruction(emptyWellbore({ kbElev: null }), emptyWellbore())).toBe(true);
    expect(sameConstruction(null, null)).toBe(true);
    expect(sameConstruction(emptyWellbore({ td: 1 }), null)).toBe(false);
    expect(sameConstruction(emptyWellbore({ plugs: [{ top_m: 1 }] }), emptyWellbore({ plugs: [{ top_m: 2 }] }))).toBe(false);
  });
});

describe('summariseReport', () => {
  it('the Plug #1 report adds one row and every line was understood', () => {
    const s = summariseReport(PLUG_REPORT, parseWellboreReport(PLUG_REPORT));
    expect(s.rowsAdded).toBe(1);
    expect(s.notUnderstood).toEqual([]);
    expect(s.messages).toHaveLength(4); // the casing reader's messages are still listed, in full
  });

  it('lists the lines no reader turned into a row, once each, in report order', () => {
    const text = [
      'Surface casing 8⅝" J55 0–186 m TOC 0 m',
      'garbled unparseable text',
      'No plug records on file',
      '',
      'Plug #2 set with 30 sacks',
      '',
      'Plug #3',
      '100–130 m; 12 sacks; tagged hard',
    ].join('\n');
    const s = summariseReport(text, parseWellboreReport(text));
    expect(s.notUnderstood).toEqual(['garbled unparseable text', 'No plug records on file', 'Plug #2 set with 30 sacks', 'tagged hard']);
    expect(s.rowsAdded).toBeGreaterThan(0);
  });
});

describe('schematic helpers', () => {
  it('maps rows to SVG data-ids and back (a casing\'s cement belongs to its casing)', () => {
    expect(svgIdOf('plugs', 0)).toBe('plug:0');
    expect(svgIdOf('perforations', 2)).toBe('perf:2');
    expect(svgIdOf('formations', 1)).toBe('formation:1');
    expect(rowForSvgId('cement:1')).toEqual({ list: 'casings', index: 1 });
    expect(rowForSvgId('casing:0')).toEqual({ list: 'casings', index: 0 });
    expect(rowForSvgId('note:3')).toEqual({ list: 'notes', index: 3 });
    expect(rowForSvgId('openhole:0')).toBeNull();
    expect(rowForSvgId('nonsense')).toBeNull();
  });

  it('draws with the construction TD, else the well TD; nothing to draw without either', () => {
    expect(schematicInput(emptyWellbore({ td: 1500 }), 1463.3)?.td).toBe(1500);
    expect(schematicInput(emptyWellbore(), 1463.3)?.td).toBe(1463.3);
    expect(schematicInput(null, 1463.3)).toEqual({ td: 1463.3 });
    expect(schematicInput(null, null)).toBeNull();
    expect(schematicInput(emptyWellbore(), null)?.td).toBeNull();
  });

  it('names the export after the licence, with unsafe characters replaced', () => {
    expect(exportFilename('100/07-21-055-22W4/00')).toBe('100_07-21-055-22W4_00-schematic.svg');
  });

  it('a standalone file has a background under the drawing and only safe colours', () => {
    const out = standaloneSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 920"><g/></svg>', '#16191d');
    expect(out).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 920"><rect width="100%" height="100%" fill="#16191d"/><g/></svg>');
    expect(safeColour(' rgb(22, 25, 29) ', '#fff')).toBe('rgb(22, 25, 29)');
    expect(safeColour('"><script>', '#fff')).toBe('#fff');
    expect(safeColour('', '#fff')).toBe('#fff');
    expect(standaloneSvg('<svg>', '"/><x')).toContain('fill="#ffffff"');
  });

  it('labels row provenance', () => {
    expect(sourceLabel('parsed')).toBe('Parsed');
    expect(sourceLabel('manual')).toBe('Manual');
    expect(sourceLabel('extractor')).toBe('Imported');
    expect(sourceLabel('bridge')).toBe('Imported');
    expect(sourceLabel(undefined)).toBeNull();
  });
});

describe('depth sanity', () => {
  const withPlug = (plug: Record<string, unknown>, td: number | null = 1500) =>
    rowsFromWellbore(emptyWellbore({ td, plugs: [plug as Wellbore['plugs'][number]] }));

  it('an inverted plug (top below bottom) is an error with a swap, kept out of the saved record and the drawing', () => {
    const rows = withPlug({ n: 1, top_m: 1463, bottom_m: 1448, source: 'extractor', verbatim: 'P1 1463/1448' });
    const key = rows.lists.plugs[0]!.key;
    const result = wellboreFromRows(rows);
    expect(result.errors).toEqual([
      { list: 'plugs', rowKey: key, field: 'top_m', kind: 'depth', swap: ['top_m', 'bottom_m'], message: 'Top (m) is deeper than Bottom (m).' },
    ]);
    expect(result.wellbore.plugs).toEqual([]);
    expect(result.drawing.plugs).toEqual([null]);
    // As stored, the row is not an edit: the record as entered still holds it, equal to the stored record.
    expect(result.record.plugs).toHaveLength(1);

    const swapped = swapValues(rows, 'plugs', key, 'top_m', 'bottom_m');
    expect(rowSource(swapped.lists.plugs[0]!)).toBe('manual');
    const fixed = wellboreFromRows(swapped);
    expect(fixed.errors).toEqual([]);
    expect(fixed.wellbore.plugs[0]).toMatchObject({ top_m: 1448, bottom_m: 1463, source: 'manual', verbatim: 'P1 1463/1448' });
  });

  it.each([
    ['casings', { top_m: 200, shoe_m: 186 }, 'top_m', 'shoe_m', 'Top (m) is deeper than Shoe (m).'],
    ['perforations', { top_m: 1310, bottom_m: 1300 }, 'top_m', 'bottom_m', 'Top (m) is deeper than Bottom (m).'],
    ['zones', { kind: 'salt', top_m: 700, bottom_m: 600 }, 'top_m', 'bottom_m', 'Top (m) is deeper than Bottom (m).'],
  ] as const)('an inverted %s row is an error with a swap', (list, row, a, b, message) => {
    const rows = rowsFromWellbore(emptyWellbore({ td: 1500, [list]: [row] }));
    expect(wellboreFromRows(rows).errors).toEqual([
      { list, rowKey: rows.lists[list][0]!.key, field: a, kind: 'depth', swap: [a, b], message },
    ]);
  });

  it('a typed inversion is caught too; equal depths are fine', () => {
    const added = addRow(rowsFromWellbore(emptyWellbore({ td: 1500 })), 'plugs');
    let rows = setValue(added.rows, 'plugs', added.key, 'top_m', '1463');
    rows = setValue(rows, 'plugs', added.key, 'bottom_m', '1448');
    expect(wellboreFromRows(rows).errors.map((e) => e.kind)).toEqual(['depth']);
    expect(wellboreFromRows(setValue(rows, 'plugs', added.key, 'bottom_m', '1463')).errors).toEqual([]);
  });

  it('a stored negative depth is an error (typed ones are refused as input)', () => {
    const rows = withPlug({ top_m: -5, bottom_m: 10 });
    expect(wellboreFromRows(rows).errors).toEqual([
      { list: 'plugs', rowKey: rows.lists.plugs[0]!.key, field: 'top_m', kind: 'depth', message: 'Top (m) must be 0 or more.' },
    ]);
  });

  it('a depth below TD is a warning that does not block saving; TD falls back to the well', () => {
    const rows = withPlug({ top_m: 1448, bottom_m: 1520 }, null);
    const key = rows.lists.plugs[0]!.key;
    const result = wellboreFromRows(rows, 1463.3);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ list: 'plugs', rowKey: key, field: 'bottom_m', message: 'Bottom (m) is below TD (1463.3 m).' }]);
    expect(result.wellbore.plugs).toHaveLength(1);
    expect(wellboreFromRows(rows).warnings).toEqual([]); // no TD anywhere: nothing to compare with
  });
});

describe('export', () => {
  it('always uses the light palette: light background and ink, no CSS variables', () => {
    const svg = schematicExport({ td: 1500, packers: [{ depth_m: 1000 }], formations: [{ name: 'Nisku', top_m: 1100 }] }, 'm');
    expect(svg).toMatch(/^<svg [^>]*><rect width="100%" height="100%" fill="#ffffff"\/>/);
    expect(svg).toContain(`fill="${LIGHT_COLOURS.ink}"`);
    expect(svg).toContain(`stroke="${LIGHT_COLOURS.line}"`);
    expect(svg).not.toContain('var(--');
    expect(svg).toContain('viewBox="0 0 760 920"');
  });

  it('the light palette matches the light theme tokens in app/globals.css', () => {
    const css = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`).exec(root)?.[1];
    expect(LIGHT_COLOURS).toEqual({ line: token('line'), muted: token('muted'), ink: token('ink'), surface: token('surface') });
  });
});

describe('reviveRows', () => {
  it('revives a stored working copy as typed, with fresh row keys', () => {
    const base = rowsFromWellbore(FULL);
    const typed = setValue(base, 'plugs', base.lists.plugs[0]!.key, 'top_m', '14OO');
    const revived = reviveRows(JSON.parse(JSON.stringify(typed)));
    expect(revived).not.toBeNull();
    expect(revived!.lists.plugs.map((r) => r.values.top_m)).toEqual(['14OO', '1200']);
    expect(revived!.lists.plugs[0]!.key).not.toBe(typed.lists.plugs[0]!.key);
    const keys = LIST_KEYS.flatMap((k) => revived!.lists[k].map((r) => r.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(wellboreFromRows(revived!).record).toEqual(wellboreFromRows(typed).record);
  });

  it.each([null, 'x', {}, { td: '', kbElev: '', lists: {}, base: {} }, { td: 1, kbElev: '', lists: {}, base: {} }])(
    'refuses what is not a working copy: %j',
    (data) => {
      expect(reviveRows(data)).toBeNull();
    },
  );
});

describe('hasUnsavedChanges', () => {
  const inverted = emptyWellbore({
    td: 1500,
    plugs: [{ n: 1, top_m: 1463, bottom_m: 1448, source: 'extractor', verbatim: 'P1 1463/1448' }],
  });

  it('a stored inverted row read back is not unsaved, yet carries its blocking depth error', () => {
    const result = wellboreFromRows(rowsFromWellbore(inverted));
    expect(hasUnsavedChanges(result, inverted)).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ kind: 'depth', swap: ['top_m', 'bottom_m'] })]);
    expect(result.wellbore.plugs).toEqual([]); // and it is not what Save would write
  });

  it('is true after an edit, after typed text that does not read, and false once reverted', () => {
    const rows = rowsFromWellbore(FULL);
    const key = rows.lists.plugs[0]!.key;
    expect(hasUnsavedChanges(wellboreFromRows(rows), FULL)).toBe(false);
    expect(hasUnsavedChanges(wellboreFromRows(setValue(rows, 'plugs', key, 'sacks', '30')), FULL)).toBe(true);
    expect(hasUnsavedChanges(wellboreFromRows(setValue(rows, 'plugs', key, 'sacks', '3O')), FULL)).toBe(true);
    expect(hasUnsavedChanges(wellboreFromRows(setHeader(rowsFromWellbore(null), 'td', 'deep')), null)).toBe(true);
    expect(hasUnsavedChanges(wellboreFromRows(setValue(rows, 'plugs', key, 'sacks', '25')), FULL)).toBe(false);
  });
});

describe('a kept working copy', () => {
  const edited = () => {
    const rows = rowsFromWellbore(FULL);
    return setValue(rows, 'plugs', rows.lists.plugs[0]!.key, 'sacks', '30');
  };

  it('is stored with the key of the saved record it was made from, and read back as such', () => {
    const stored = JSON.parse(JSON.stringify({ base: constructionKey(FULL), rows: edited() }));
    const kept = reviveKeptCopy(stored);
    expect(kept?.base).toBe(constructionKey(FULL));
    expect(kept?.rows.lists.plugs[0]!.values.sacks).toBe('30');
  });

  it('a copy stored without a base (before bases were kept) reads with base null', () => {
    const kept = reviveKeptCopy(JSON.parse(JSON.stringify(edited())));
    expect(kept?.base).toBeNull();
    expect(kept?.rows.lists.plugs[0]!.values.sacks).toBe('30');
    expect(reviveKeptCopy({ base: 'x', rows: 'nope' })).toBeNull();
    expect(reviveKeptCopy(null)).toBeNull();
  });

  it('restore when made from the saved record; conflict when that record changed (or the base is unknown); drop when nothing differs', () => {
    const rows = edited();
    expect(restoreDecision({ base: constructionKey(FULL), rows }, FULL, null)).toBe('restore');
    const newer = { ...FULL, kbElev: 805 };
    expect(restoreDecision({ base: constructionKey(FULL), rows }, newer, null)).toBe('conflict');
    expect(restoreDecision({ base: null, rows }, FULL, null)).toBe('conflict');
    // A key, not a timestamp: the same content under another key order is the same record.
    const reordered: Wellbore = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(FULL).reverse())));
    expect(Object.keys(reordered)).not.toEqual(Object.keys(FULL));
    expect(restoreDecision({ base: constructionKey(reordered), rows }, FULL, null)).toBe('restore');
    expect(restoreDecision({ base: 'stale', rows: rowsFromWellbore(FULL) }, FULL, null)).toBe('drop');
  });
});

describe('rows not drawn (for the printed dossier)', () => {
  it('rowName is the editor\'s name for a row: singular and 1-based index', () => {
    expect(rowName('plugs', 0)).toBe('Plug 1');
    expect(rowName('formations', 2)).toBe('Formation top 3');
  });

  it('lists every stored row the depth rules leave out of the drawing, with why, its depths and its source text', () => {
    const stored: Wellbore = WellboreSchema.parse({
      td: 1500,
      plugs: [
        { n: 1, kind: 'cement', top_m: 1400, bottom_m: 1450 },
        { n: 2, kind: 'cement', top_m: 1463, bottom_m: 1448, source: 'extractor', verbatim: 'Plug 2: 1463/1448 m' },
      ],
      casings: [{ name: 'Surface', top_m: -5, shoe_m: 186 }],
      formations: [{ name: 'Nisku', top_m: 1100 }],
    });
    const rows = rowsFromWellbore(stored);
    const result = wellboreFromRows(rows, null);
    expect(rowsNotDrawn(rows, result.errors)).toEqual([
      { name: 'Casing 1', reasons: ['Top (m) must be 0 or more.'], depths: 'Top (m) -5, Shoe (m) 186', verbatim: null },
      {
        name: 'Plug 2',
        reasons: ['Top (m) is deeper than Bottom (m).'],
        depths: 'Top (m) 1463, Bottom (m) 1448',
        verbatim: 'Plug 2: 1463/1448 m',
      },
    ]);
    // ... and the drawing indeed leaves them out, keeping the other rows' indices.
    expect(result.drawing.plugs?.[1]).toBeNull();
    expect(result.drawing.casings?.[0]).toBeNull();
  });

  it('is empty when every row is drawn', () => {
    const rows = rowsFromWellbore(FULL);
    expect(rowsNotDrawn(rows, wellboreFromRows(rows, null).errors)).toEqual([]);
  });

  it('names a record-wide error too, so nothing is ever left out silently', () => {
    const rows = rowsFromWellbore(FULL);
    const errors = [{ list: null, rowKey: null, field: 'record', kind: 'input' as const, message: 'The construction record does not read: x' }];
    expect(rowsNotDrawn(rows, errors)).toEqual([
      { name: 'Construction record', reasons: ['The construction record does not read: x'], depths: '', verbatim: null },
    ]);
  });
});

describe('schematicExport at a given size', () => {
  it('draws at the size asked for, in the light palette', () => {
    const svg = schematicExport({ td: 1500, packers: [{ depth_m: 1000 }] }, 'm', { width: 420, height: 640 });
    expect(svg).toContain('viewBox="0 0 420 640"');
    expect(svg).toContain(`fill="${LIGHT_COLOURS.ink}"`);
    expect(svg).not.toContain('var(--');
  });
});
