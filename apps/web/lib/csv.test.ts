import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAM_KEYS, emptyScores, type Assessment, type ProjectExport, type Well } from '@lwa/engine';
import {
  CSV_COLUMNS,
  EXPORT_EXTRA_HEADERS,
  TEMPLATE_FILE_NAME,
  describeColumns,
  exportCsv,
  exportCsvFileName,
  mapHeaders,
  missingColumns,
  parseCsv,
  rowsToWellInputs,
  templateCsv,
  toCsv,
  unguard,
  type CsvColumnKey,
} from '@/lib/csv';

const FIXTURE: ProjectExport = JSON.parse(
  readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8'),
) as ProjectExport;
const BAD_ROW_FIXTURE = readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'template-with-bad-row.csv'), 'utf8');

const HEADER = CSV_COLUMNS.map((c) => c.hdr);
const BOM = '﻿';

/** A data row in template column order: the given cells by key, the rest blank. */
function row(cells: Partial<Record<CsvColumnKey, string>>): string[] {
  return CSV_COLUMNS.map((c) => cells[c.key] ?? '');
}

/** Parses header + rows the way the importer does. */
function read(header: string[], rows: string[][], context?: Parameters<typeof rowsToWellInputs>[2]) {
  return rowsToWellInputs(rows, mapHeaders(header), context);
}

function storedWell(overrides: Partial<Well> = {}): Well {
  return {
    id: 'wel_1',
    projectId: 'prj_1',
    licence: '100/07-21-055-22W4/00',
    name: 'IMPERIAL FT SASK 7-21',
    operator: 'Imperial Oil Limited',
    lat: 53.764946,
    lon: -113.207628,
    spudYear: 1953,
    type: 'Strat Test',
    trajectory: 'Vertical',
    status: 'Abandoned (P&A)',
    classification: 'Type 3',
    td_m: 1463.3,
    notes: 'stored notes',
    construction: null,
    legacyV1: { scores: { plug: 5 }, total: 5 },
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'seed',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'seed',
    ...overrides,
  };
}

/* ---------- parsing ---------- */

describe('parseCsv', () => {
  it('parses quoted fields with embedded commas and CRLF', () => {
    const text = `${BOM}a,b,c\r\n"1,5","say ""hi""","two\r\nlines"\r\n\r\nx,,z\r\n`;
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1,5', 'say "hi"', 'two\r\nlines'],
      ['x', '', 'z'],
    ]);
  });

  it('keeps a last row without a line break and drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('mapHeaders', () => {
  it('mapHeaders maps the v2 template header exactly and flags v1Detected for "Plug Quality (Low/Med/High)"', () => {
    const map = mapHeaders(HEADER);
    CSV_COLUMNS.forEach((c, i) => expect(map.byKey[c.key]).toEqual([i]));
    expect(map.unmapped).toEqual([]);
    expect(map.v1Detected).toBe(false);

    const v1 = mapHeaders(['well id / LICENCE', 'Plug Quality (Low/Med/High)', 'Something else']);
    expect(v1.byKey.licence).toEqual([0]);
    expect(v1.byKey.sc_plugQuality).toEqual([1]);
    expect(v1.unmapped).toEqual(['Something else']);
    expect(v1.v1Detected).toBe(true);
  });

  it('is case- and space-insensitive and collects every matching column', () => {
    const map = mapHeaders([
      '  WELL ID/LICENCE ',
      'Depth vs Reservoir (Low/Med/High)',
      'Depth vs Storage Complex (Low/Med/High)',
      'latitude',
    ]);
    expect(map.byKey.licence).toEqual([0]);
    expect(map.byKey.sc_penetration).toEqual([1, 2]);
    expect(map.byKey.lat).toEqual([3]);
    expect(map.v1Detected).toBe(true);
  });
});

describe('describeColumns / missingColumns', () => {
  it('lists each column of the file with what it maps to, and the template columns it lacks', () => {
    const map = mapHeaders(['Well ID / Licence', '', 'Plug Quality (Low/Med/High)', 'Reviewer', 'Risk Index']);
    expect(describeColumns(map).map((c) => [c.index, c.header, c.column?.key ?? null, c.alias])).toEqual([
      [0, 'Well ID / Licence', 'licence', false],
      [2, 'Plug Quality (Low/Med/High)', 'sc_plugQuality', true],
      [3, 'Reviewer', 'reviewer', false],
      [4, 'Risk Index', null, false],
    ]);
    const missing = missingColumns(map).map((c) => c.key);
    expect(missing).not.toContain('licence');
    expect(missing).not.toContain('reviewer');
    expect(missing).not.toContain('sc_plugQuality');
    expect(missing).toContain('lat');
    expect(missing).toHaveLength(CSV_COLUMNS.length - 3);
  });
});

/* ---------- rows → well inputs ---------- */

describe('rowsToWellInputs', () => {
  it('two v1 columns aliasing penetration import the max of the two', () => {
    const header = ['Well ID / Licence', 'Depth vs Reservoir (Low/Med/High)', 'Depth vs Storage Complex (Low/Med/High)'];
    const { scoreDrafts, report } = read(header, [
      ['A-1', 'Low', 'High'],
      ['A-2', 'Med', 'low'],
      ['A-3', '?', ''],
    ]);
    expect(scoreDrafts.get('A-1')).toEqual({ ...emptyScores(), penetration: 5 });
    expect(scoreDrafts.get('A-2')).toEqual({ ...emptyScores(), penetration: 3 });
    expect(scoreDrafts.has('A-3')).toBe(false); // "?" is unknown: nothing to draft
    expect(report.map((r) => r.status)).toEqual(['created', 'created', 'created']);
  });

  it('rowsToWellInputs: latitude 95 → row error "latitude out of range", other rows still ok', () => {
    const { inputs, report } = read(HEADER, [
      row({ licence: 'A-1', lat: '53.41', lon: '-113.54' }),
      row({ licence: 'A-2', lat: '95', lon: '-113.54' }),
      row({ licence: 'A-3', lat: '-12.5', lon: '181' }),
      row({ licence: 'A-4' }),
    ]);
    expect(report.map((r) => [r.row, r.licence, r.status, r.message])).toEqual([
      [2, 'A-1', 'created', ''],
      [3, 'A-2', 'error', 'latitude out of range'],
      [4, 'A-3', 'error', 'longitude out of range'],
      [5, 'A-4', 'created', ''],
    ]);
    expect(inputs.map((i) => i.licence)).toEqual(['A-1', 'A-4']);
    expect(inputs[0]).toMatchObject({ lat: 53.41, lon: -113.54 });
  });

  it('a decimal comma is a row error that names the point', () => {
    const { inputs, report } = read(HEADER, [row({ licence: 'A-1', lat: '53,41' }), row({ licence: 'A-2', lon: '0x10' })]);
    expect(report[0]).toMatchObject({ status: 'error', message: 'latitude "53,41": use a point as the decimal separator' });
    expect(report[1]).toMatchObject({ status: 'error', message: 'longitude "0x10" is not a number' });
    expect(inputs).toEqual([]);
  });

  it('enum normalisation: "abandoned (p&a)" → "Abandoned (P&A)"; unknown value → "Unknown"', () => {
    const { inputs, report } = read(HEADER, [
      row({ licence: 'A-1', status: 'abandoned (p&a)', type: ' gas  producer', traj: 'HORIZONTAL', klass: 'type 7' }),
      row({ licence: 'A-2', status: 'Plugged', type: 'Water well', traj: 'S-curve', klass: 'Type 12' }),
    ]);
    expect(inputs[0]).toMatchObject({
      status: 'Abandoned (P&A)',
      type: 'Gas Producer',
      trajectory: 'Horizontal',
      classification: 'Type 7',
    });
    expect(report[0]!.warnings).toEqual([]);
    expect(inputs[1]).toMatchObject({
      status: 'Unknown',
      type: 'Unknown',
      trajectory: 'Unknown',
      classification: 'Type 1',
    });
    expect(report[1]).toMatchObject({ status: 'created' });
    expect(report[1]!.warnings).toEqual([
      'well type "Water well" not recognised; set to Unknown',
      'trajectory "S-curve" not recognised; set to Unknown',
      'legal status "Plugged" not recognised; set to Unknown',
      'classification "Type 12" not recognised; set to Type 1 (no records)',
    ]);
  });

  it('upsert: duplicate licence within file → second row reported "updated", one input', () => {
    const { inputs, report, scoreDrafts } = read(HEADER, [
      row({ licence: '102/11-08-046-26W4', operator: 'Cenovus Energy', sc_plugQuality: '1', sc_age: '3' }),
      row({ licence: 'A-2' }),
      row({ licence: ' 102/11-08-046-26w4 ', operator: 'Cenovus (renamed)', sc_age: '4' }),
    ]);
    expect(report.map((r) => [r.row, r.status, r.message])).toEqual([
      [2, 'created', ''],
      [3, 'created', ''],
      [4, 'updated', 'same licence as row 2'],
    ]);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ licence: '102/11-08-046-26W4', operator: 'Cenovus (renamed)' });
    expect(scoreDrafts.get('102/11-08-046-26W4')).toEqual({ ...emptyScores(), plugQuality: 1, age: 4 });
  });

  it('a licence that matches a stored well is "updated" with only the cells present and non-empty', () => {
    const stored = storedWell();
    const { inputs, report } = read(
      ['Well ID / Licence', 'Operator', 'Latitude', 'Notes / Justification'],
      [['100/07-21-055-22w4/00', 'Imperial Oil Resources', '', '']],
      { wells: [stored] },
    );
    // Only what the row changes is passed on: coordinates, name, TD, construction and legacy are left alone.
    expect(inputs).toEqual([{ licence: '100/07-21-055-22w4/00', operator: 'Imperial Oil Resources' }]);
    expect(report[0]).toMatchObject({ status: 'updated', message: '', changes: ['operator'] });
  });

  it('a stored well whose row changes nothing is "updated" with no changes', () => {
    const stored = storedWell();
    const { inputs, report } = read(['Well ID / Licence', 'Operator'], [[stored.licence, stored.operator]], {
      wells: [stored],
    });
    expect(inputs).toEqual([{ licence: stored.licence }]);
    expect(report[0]).toMatchObject({ status: 'updated', changes: [] });
  });

  it('an unreadable value never overwrites a stored one', () => {
    const stored = storedWell();
    const { inputs, report } = read(
      ['Well ID / Licence', 'Well Type', 'Classification (Type 1-9)', 'Spud / Completion Year'],
      [[stored.licence, 'Mystery', 'Class B', '1700']],
      { wells: [stored], currentYear: 2026 },
    );
    expect(inputs).toEqual([{ licence: stored.licence }]);
    expect(report[0]!.warnings).toEqual([
      'spud year 1700 is outside 1850–2027; left unchanged',
      'well type "Mystery" not recognised; left unchanged',
      'classification "Class B" not recognised; left unchanged',
    ]);
  });

  it('spud year outside 1850…next year → blank with a warning; a whole number inside is kept', () => {
    const { inputs, report } = read(
      HEADER,
      [row({ licence: 'A-1', year: '1849' }), row({ licence: 'A-2', year: '2028' }), row({ licence: 'A-3', year: '2027' })],
      { currentYear: 2026 },
    );
    expect(inputs.map((i) => i.spudYear)).toEqual([undefined, undefined, 2027]);
    expect(report[0]!.warnings).toEqual(['spud year 1849 is outside 1850–2027; left blank']);
    expect(report[1]!.warnings).toEqual(['spud year 2028 is outside 1850–2027; left blank']);
    expect(report.map((r) => r.status)).toEqual(['created', 'created', 'created']);
  });

  it('score cells: 1-5 and v1 Low/Med/High read; "?" is unknown; anything else is a warning and stays unscored', () => {
    const { scoreDrafts, report } = read(HEADER, [
      row({ licence: 'A-1', sc_plugQuality: '5', sc_cement: 'Med', sc_barriers: 'high', sc_scvf: '?', sc_age: 'n/a' }),
    ]);
    expect(scoreDrafts.get('A-1')).toEqual({ ...emptyScores(), plugQuality: 5, cement: 3, barriers: 5 });
    expect(report[0]).toMatchObject({ status: 'created', scored: 3 });
    expect(report[0]!.warnings).toEqual(['Well Age & Regulatory Era (1-5 or ?) "n/a" not readable; left unscored']);
  });

  it('a row without a licence is an error; blank rows are skipped', () => {
    const { report } = read(HEADER, [row({ operator: 'Nobody' }), row({}), row({ licence: 'A-3' })]);
    expect(report.map((r) => [r.row, r.status, r.message])).toEqual([
      [2, 'error', 'no licence'],
      [4, 'created', ''],
    ]);
  });

  it('notes come in as written (line breaks as \\n); the Reviewer column is not imported', () => {
    const { inputs } = read(HEADER, [
      row({ licence: 'A-1', notes: '  line one\nline two ', reviewer: 'T. Khan' }),
      row({ licence: 'A-2', notes: 'saved by Excel\r\nsecond line' }),
    ]);
    expect(inputs[0]!.notes).toBe('  line one\nline two ');
    expect(inputs[0]).not.toHaveProperty('reviewer');
    expect(inputs[1]!.notes).toBe('saved by Excel\nsecond line');
  });
});

/* ---------- writing ---------- */

describe('toCsv', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv([['a,b', 'say "hi"', 'x\ny', null, 3]])).toBe('"a,b","say ""hi""","x\ny",,3');
  });

  it('formula guard: text starting with = + - @ TAB or CR gets an apostrophe; numbers never do', () => {
    expect(toCsv([['=SUM(1)', '+1', '-x', '@me', '\tx', -113.24, 0.5]])).toBe(`'=SUM(1),'+1,'-x,'@me,'\tx,-113.24,0.5`);
    expect(toCsv([['\rx']])).toBe(`"'\rx"`);
    expect(toCsv([[1e-7, Number.NaN]])).toBe('0.0000001,');
  });

  it('unguard drops the apostrophe only before a guarded character', () => {
    expect(unguard("'=SUM(1)")).toBe('=SUM(1)');
    expect(unguard("'-113.24")).toBe('-113.24');
    expect(unguard("'tis")).toBe("'tis");
    expect(unguard("''")).toBe("''");
  });

  it('toCsv → parseCsv round-trips the fixture wells', () => {
    const rows = FIXTURE.wells.map((w) => [w.licence, w.name, w.operator, w.lat, w.lon, w.spudYear, w.notes]);
    const back = parseCsv(toCsv(rows));
    expect(back).toEqual(rows.map((r) => r.map((v) => (v === null ? '' : String(v)))));
  });
});

describe('templateCsv', () => {
  it('is the v2 header and its two sample rows, BOM first', () => {
    expect(TEMPLATE_FILE_NAME).toBe('legacy_wells_template.csv');
    const text = templateCsv();
    expect(text.startsWith(BOM)).toBe(true);
    const rows = parseCsv(text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1]).toEqual(CSV_COLUMNS.map((c) => c.sample));
    expect(rows[2]!.slice(0, 10)).toEqual([
      '102/11-08-046-26W4',
      'Cenovus Energy',
      '53.4501',
      '-113.6011',
      '1998',
      'Gas Producer',
      'Vertical',
      'Abandoned (P&A)',
      'Type 7',
      'T. Khan',
    ]);
    // Longitudes are numbers, so the formula guard leaves them alone.
    expect(text).toContain(',-113.5421,');
  });

  it('the e2e fixture is the template plus one row with latitude 95', () => {
    const rows = parseCsv(BAD_ROW_FIXTURE);
    expect(rows.slice(0, 3)).toEqual(parseCsv(templateCsv()));
    expect(rows).toHaveLength(4);
    const map = mapHeaders(rows[0]!);
    expect(rows[3]![map.byKey.lat![0]!]).toBe('95');
  });
});

describe('exportCsv', () => {
  const finalOf = (w: Well): Assessment | null => FIXTURE.assessments.find((a) => a.wellId === w.id && a.status === 'final') ?? null;

  it('names the file legacy_wells_<UTC date>.csv', () => {
    expect(exportCsvFileName('2026-10-20T23:30:00.000-03:00')).toBe('legacy_wells_2026-10-21.csv');
  });

  it('writes the v2 columns then the read-only result columns, BOM first; blanks when unscored', () => {
    const [first, second] = FIXTURE.wells as [Well, Well];
    const text = exportCsv([
      { well: first, final: finalOf(first) },
      { well: { ...second, lat: null, operator: '=cmd' }, final: null },
    ]);
    expect(text.startsWith(BOM)).toBe(true);
    expect(text).not.toContain(`${BOM}${BOM}`);
    const rows = parseCsv(text);
    expect(rows[0]).toEqual([...HEADER, ...EXPORT_EXTRA_HEADERS]);
    expect(EXPORT_EXTRA_HEADERS).toEqual(['L', 'C', 'Cell', 'Rank', 'Risk Index', 'Assessment', 'Methodology rev']);
    const at = (r: string[], header: string) => r[rows[0]!.indexOf(header)];
    const a = rows[1]!;
    expect(at(a, 'Well ID / Licence')).toBe('100/13-06-055-22W4/00');
    expect(at(a, 'Longitude')).toBe('-113.269667');
    expect(at(a, 'Reviewer')).toBe('Tahir Chisti');
    expect(at(a, 'SCVF / GM History (1-5 or ?)')).toBe('2');
    expect(at(a, 'L')).toBe('1.56');
    expect(at(a, 'Cell')).toBe('4');
    expect(at(a, 'Rank')).toBe('Low');
    expect(at(a, 'Risk Index')).toBe('3.74');
    expect(at(a, 'Assessment')).toBe('2026-08-07');
    expect(at(a, 'Methodology rev')).toBe('2.0.0');
    const b = rows[2]!;
    expect(at(b, 'Latitude')).toBe('');
    expect(at(b, 'Operator')).toBe("'=cmd");
    expect(PARAM_KEYS.map((k) => at(b, CSV_COLUMNS.find((c) => c.score === k)!.hdr))).toEqual(PARAM_KEYS.map(() => '?'));
    expect(EXPORT_EXTRA_HEADERS.map((h) => at(b, h))).toEqual(EXPORT_EXTRA_HEADERS.map(() => ''));
    expect(at(b, 'Reviewer')).toBe('');
  });

  it('export → import round-trips the well fields and scores', () => {
    const items = FIXTURE.wells.map((w) => ({ well: w, final: finalOf(w) }));
    const rows = parseCsv(exportCsv(items));
    const map = mapHeaders(rows[0]!);
    expect(map.unmapped).toEqual(EXPORT_EXTRA_HEADERS);

    // Into an empty project: every well created with its fields, every final's scores as a draft.
    const fresh = rowsToWellInputs(rows.slice(1), map, { currentYear: 2026 });
    expect(fresh.report.every((r) => r.status === 'created' && r.warnings.length === 0)).toBe(true);
    expect(fresh.inputs).toEqual(
      FIXTURE.wells.map((w) => ({
        licence: w.licence,
        operator: w.operator,
        lat: w.lat,
        lon: w.lon,
        spudYear: w.spudYear,
        type: w.type,
        trajectory: w.trajectory,
        status: w.status,
        classification: w.classification,
        notes: w.notes,
      })),
    );
    for (const w of FIXTURE.wells) expect(fresh.scoreDrafts.get(w.licence)).toEqual(finalOf(w)!.scores);

    // Back into the project it came from: every well matched, nothing changed.
    const again = rowsToWellInputs(rows.slice(1), map, { wells: FIXTURE.wells, currentYear: 2026 });
    expect(again.report.map((r) => [r.status, r.changes])).toEqual(FIXTURE.wells.map(() => ['updated', []]));
    expect(again.inputs).toEqual(FIXTURE.wells.map((w) => ({ licence: w.licence })));
  });
});
