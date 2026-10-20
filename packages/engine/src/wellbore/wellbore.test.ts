// Port of v2 tools/wellbore.test.js: every ok/eq check is an it() with the
// same name and the same expected value (ok → expect(cond).toBe(true),
// eq → toEqual). The only edits to the v2 expressions are TypeScript ones:
// `!` where v2 indexed straight into a result (a missing value still throws
// and fails the test, as it did in v2) and type annotations on fixtures.
// New v3 cases (provenance, WellboreSchema) are at the end of the file.
import { describe, expect, it } from 'vitest';
import * as W from './index';

describe('conversions', () => {
  it('m→ft→m round trip', () => {
    expect(Math.abs(W.ftToM(W.mToFt(1234.5)) - 1234.5) < 1e-9).toBe(true);
  });
  it('parseDepth m', () => {
    expect(W.parseDepth('850 m')).toEqual(850);
  });
  it('parseDepth ft', () => {
    expect(W.parseDepth('3219 ft')).toEqual(+(3219 * 0.3048).toFixed(1));
  });
  it('parseDepth bare uses default', () => {
    expect(W.parseDepth('610', 'ft')).toEqual(+(610 * 0.3048).toFixed(1));
  });
  it('parseDepth junk', () => {
    expect(W.parseDepth('unknown')).toEqual(null);
  });
});

describe('intervals — real Enbridge strings', () => {
  const iv1 = W.parseIntervalsText('JET 1677–1679 m (Nordegg); TREATMENT 1673–1676 m (Fernie)');
  const iv2 = W.parseIntervalsText('Viking perfs squeezed 831.7–839.7 and 871.5 m (treatment)');
  const iv3 = W.parseIntervalsText('Plug #1 3658-3277 ft 170 sacks cement 2% CaCl2 felt plug at 3219 ft', 'ft');
  const iv4 = W.parseIntervalsText('No plug records on file');

  it('JET plug parsed', () => {
    expect([iv1.plugs[0]!.top_m, iv1.plugs[0]!.bottom_m]).toEqual([1677, 1679]);
  });
  it('JET formation noted', () => {
    expect(iv1.notes.some((n) => /Nordegg/.test(n.text ?? ''))).toBe(true);
  });
  it('squeezed perf parsed', () => {
    expect(iv2.perforations.length >= 1 && iv2.perforations[0]!.status === 'squeezed').toBe(true);
  });
  it('ft plug converted+ordered', () => {
    expect([iv3.plugs[0]!.top_m, iv3.plugs[0]!.bottom_m]).toEqual([+(3277 * 0.3048).toFixed(1), +(3658 * 0.3048).toFixed(1)]);
  });
  it('sacks captured', () => {
    expect(iv3.plugs[0]!.sacks).toEqual(170);
  });
  it('additive captured', () => {
    expect(/CaCl2/i.test(iv3.plugs[0]!.additives || '')).toBe(true);
  });
  it('felt plug note', () => {
    expect(iv3.notes.some((n) => /felt plug/i.test(n.text ?? ''))).toBe(true);
  });
  it('no-records → nothing + warning', () => {
    expect([iv4.plugs.length, iv4.warnings.length >= 1]).toEqual([0, true]);
  });
  it('bridge plug kind', () => {
    expect(W.parseIntervalsText('CIBP at 1200 m').plugs[0]!.kind === 'cibp').toBe(true);
  });
});

describe('casing text', () => {
  const c1 = W.parseCasingText('Production @ 1699.5 m');
  const c2 = W.parseCasingText('None — open hole below surface casing');
  const c3 = W.parseCasingText('8-5/8" J55 35.7 kg/m 0–610 ft TOC 850 ft');

  it('casing shoe', () => {
    expect(c1.casings[0]!.shoe_m).toEqual(1699.5);
  });
  it('open-hole text', () => {
    expect([c2.casings.length, !!c2.openHole || c2.notes.length >= 1]).toEqual([0, true]);
  });
  it('casing od from inches', () => {
    expect(Math.abs(c3.casings[0]!.od_mm! - 8.625 * 25.4) < 0.5).toBe(true);
  });
  it('casing grade', () => {
    expect(c3.casings[0]!.grade).toEqual('J55');
  });
  it('casing shoe ft→m', () => {
    expect(c3.casings[0]!.shoe_m).toEqual(+(610 * 0.3048).toFixed(1));
  });
});

// Shared by the "full report" and review-fix sections, as in v2.
const rep = W.parseWellboreReport('Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2\ntotally unparseable gibberish line');
const repPhantom = W.parseWellboreReport('Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2');

describe('full report — never throws, warnings for junk', () => {
  it('report plug found', () => {
    expect(rep.wellbore.plugs.length === 1).toBe(true);
  });
  it('report warning kept', () => {
    expect(rep.warnings.length >= 1).toBe(true);
  });
});

describe('review-fix regression tests (task-1 report review)', () => {
  // Finding 1 — a plug's own depth line must not spawn a phantom casing, and
  // must remain min/max-normalized like every other plug.
  it('no phantom casing from bare plug depth line', () => {
    expect(repPhantom.wellbore.casings.length).toEqual(0);
  });
  it('plug from phantom-probe still normalized top<bottom', () => {
    expect([repPhantom.wellbore.plugs[0]!.top_m, repPhantom.wellbore.plugs[0]!.bottom_m]).toEqual([1448, 1463]);
  });
  // casing shoe/top ranges are still recognized AND normalized when real
  // casing context is present.
  it('casing range with context is min/max-normalized', () => {
    const cNeg = W.parseCasingText('Casing 850–200 m');
    expect([cNeg.casings[0]!.top_m, cNeg.casings[0]!.shoe_m]).toEqual([200, 850]);
  });

  // Finding 2 — open-hole prose must survive as a structured signal AND as a
  // note, end-to-end through parseWellboreReport (not silently dropped).
  it('parseCasingText open-hole structured signal', () => {
    const c2b = W.parseCasingText('None — open hole below surface casing');
    expect(c2b.openHole).toEqual({});
  });
  const repOpenHole = W.parseWellboreReport('None — open hole below surface casing');
  it('open-hole flag survives to wellbore.openHole', () => {
    expect(!!repOpenHole.wellbore.openHole).toBe(true);
  });
  it('open-hole note survives to wellbore.notes', () => {
    expect(repOpenHole.wellbore.notes.some((n) => n.depth_m === null && /open hole/i.test(n.text ?? ''))).toBe(true);
  });

  // Finding 3 — sacks/additives on lines AFTER the depth range (multi-line
  // plug record) must attach to that plug, not vanish as unparsed noise.
  it('multi-line sacks attach to the plug', () => {
    expect(repPhantom.wellbore.plugs[0]!.sacks).toEqual(25);
  });
  it('multi-line additive attaches to the plug', () => {
    expect(/CaCl2/i.test(repPhantom.wellbore.plugs[0]!.additives || '')).toBe(true);
  });

  // Finding 4 — a number's own inline unit wins over the line-level fallback
  // unit (and over defaultUnit); a dash-less mixed-unit sentence is grammar
  // we intentionally don't guess at, so it must be left unparsed rather than
  // silently misconverted.
  it('per-number unit overrides line fallback + defaultUnit', () => {
    const iv5 = W.parseIntervalsText('plug 3658–3277 ft', 'm');
    expect([iv5.plugs[0]!.top_m, iv5.plugs[0]!.bottom_m]).toEqual([+(3277 * 0.3048).toFixed(1), +(3658 * 0.3048).toFixed(1)]);
  });
  it('dash-less mixed-unit prose left unparsed, not misconverted', () => {
    const ivMixed = W.parseIntervalsText('from 100 m to 400 ft');
    expect([ivMixed.plugs.length, ivMixed.perforations.length, ivMixed.warnings.length >= 1]).toEqual([0, 0, true]);
  });

  // Finding 5 — a line genuinely unparsed by BOTH the interval and casing
  // parsers must land in wellbore.notes as well as warnings.
  it('report gibberish line also noted', () => {
    expect(rep.wellbore.notes.some((n) => n.depth_m === null && n.text === 'totally unparseable gibberish line')).toBe(true);
  });
  const repGibberish = W.parseWellboreReport('totally unparseable gibberish line');
  it('standalone gibberish line warns', () => {
    expect(repGibberish.warnings.length >= 1).toBe(true);
  });
  it('standalone gibberish line also notes', () => {
    expect(repGibberish.wellbore.notes.some((n) => n.depth_m === null && n.text === 'totally unparseable gibberish line')).toBe(true);
  });

  // Finding 6 — casing warnings must not be suppressed wholesale just because
  // the same chunk also contains a plug/perforation.
  it('casing warnings survive alongside a found plug', () => {
    expect(repPhantom.warnings.some((w) => /Unparsed casing line/.test(w))).toBe(true);
  });
});

describe('stats', () => {
  const wbFix: W.WellboreInput = {
    td: 1000,
    casings: [{ top_m: 0, shoe_m: 200 }],
    plugs: [{ top_m: 100, bottom_m: 200 }, { top_m: 150, bottom_m: 300 }],
    perforations: [{ top_m: 900, bottom_m: 910 }],
    formations: [{ name: 'X', top_m: 800 }],
    openHole: { top_m: 200, bottom_m: 1000 },
  };
  const st = W.wellboreStats(wbFix);
  it('stats plugged merged overlap', () => {
    expect(st.pluggedTotal).toEqual(200); // 100–300 merged
  });
  it('stats coverage', () => {
    expect(st.coveragePct).toEqual(20);
  });
  it('stats deepest plug', () => {
    expect(st.deepestPlug).toEqual(300);
  });
  it('stats openHole len', () => {
    expect(st.openHoleLen).toEqual(800);
  });
});

describe('depth scale', () => {
  const sc = W.depthScale(1000, 500);
  it('yOf surface', () => {
    expect(sc.yOf(0)).toEqual(0);
  });
  it('yOf td', () => {
    expect(sc.yOf(1000)).toEqual(500);
  });
  it('metric ticks every 50', () => {
    expect(sc.ticks('m')[1]!.m).toEqual(50);
  });
  it('imperial ticks every 100ft', () => {
    expect(+(sc.ticks('ft')[1]!.m / 0.3048).toFixed(0)).toEqual(100);
  });
  it('tick count capped for absurd td', () => {
    expect(W.depthScale(14472000, 900).ticks('m').length <= 201).toBe(true);
  });
  it('normal td keeps 50m ticks', () => {
    expect(W.depthScale(1000, 900).ticks('m')[1]!.m === 50).toBe(true);
  });
});

// renderer — full fixture (also used by the v3 schema tests below)
const wbFull: W.Wellbore = {
  td: 1500,
  kbElev: 800,
  source: 'manual',
  casings: [
    { name: 'Surface Casing', od_mm: 219, grade: 'J55', top_m: 0, shoe_m: 186, toc_m: 0 },
    { name: 'Production Casing', od_mm: 139.7, top_m: 0, shoe_m: 1450, toc_m: 900 },
  ],
  plugs: [
    { n: 1, top_m: 1400, bottom_m: 1450, sacks: 25, kind: 'cement' },
    { top_m: 1200, bottom_m: 1200, kind: 'cibp' },
  ],
  perforations: [{ top_m: 1300, bottom_m: 1310, status: 'squeezed' }],
  formations: [{ name: 'Nisku', top_m: 1100 }],
  packers: [{ depth_m: 1000 }],
  zones: [{ kind: 'salt', top_m: 600, bottom_m: 700 }],
  openHole: { top_m: 1450, bottom_m: 1500 },
  notes: [{ depth_m: 1400, text: 'felt plug' }],
};

describe('renderer — full fixture', () => {
  const svg = W.renderWellboreSVG(wbFull, { unit: 'm' });
  it('svg root', () => {
    expect(/^<svg[^>]*viewBox="0 0 \d+ \d+"/.test(svg)).toBe(true);
  });
  it('ground surface label', () => {
    expect(svg.includes('Ground Surface')).toBe(true);
  });
  it.each(['casing', 'cement', 'plug', 'perf', 'formation', 'zone', 'packer', 'note', 'openhole'])('kind rendered: %s', (k) => {
    expect(svg.includes(`data-kind="${k}"`)).toBe(true);
  });
  it('formation name shown', () => {
    expect(svg.includes('Nisku')).toBe(true);
  });
  it('aria labels present', () => {
    expect((svg.match(/aria-label=/g) || []).length >= 8).toBe(true);
  });
  it('titles present', () => {
    expect((svg.match(/<title>/g) || []).length >= 8).toBe(true);
  });
  it('KB marker', () => {
    expect(/KB/.test(svg)).toBe(true);
  });

  // unit relabel without geometry change
  const svgFt = W.renderWellboreSVG(wbFull, { unit: 'ft' });
  it('ft axis label', () => {
    expect(svgFt.includes('Depth (ft)')).toBe(true);
  });
  it('same viewBox both units', () => {
    expect(svg.match(/viewBox="[^"]+"/)![0] === svgFt.match(/viewBox="[^"]+"/)![0]).toBe(true);
  });

  // highlight
  it('highlight stroke applied', () => {
    expect(W.renderWellboreSVG(wbFull, { unit: 'm', highlightId: 'plug:0' }).includes('stroke-width="2.5"')).toBe(true);
  });

  // sparse fixtures never throw
  it('td-only renders', () => {
    expect(W.renderWellboreSVG({ td: 900 }, { unit: 'm' }).startsWith('<svg')).toBe(true);
  });
  it('no td → empty string', () => {
    expect(W.renderWellboreSVG({ casings: [] }, { unit: 'm' })).toEqual('');
  });
  it('null → empty string', () => {
    expect(W.renderWellboreSVG(null, { unit: 'm' })).toEqual('');
  });

  // resolvedColors inlined for export (no CSS var() left in output)
  it('resolvedColors inlined', () => {
    expect(!W.renderWellboreSVG(wbFull, { unit: 'm', resolvedColors: { line: '#123456', muted: '#654321', ink: '#ffffff', bg: '#000000' } }).includes('var(--')).toBe(true);
  });
});

// --- fix round: null array entries must never throw (Finding 1) ---
// One pinning test per kind, plus a combined all-kinds fixture. In every
// case the original array index is preserved in data-id for the surviving
// (non-null) entry — nulls are skipped in place, not filtered-and-renumbered.
describe('null array entries never throw', () => {
  it('null casing entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, casings: [null, { top_m: 0, shoe_m: 200 }] }, { unit: 'm' }).includes('data-id="casing:1"')).toBe(true);
  });
  it('null plug entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, plugs: [null, { top_m: 100, bottom_m: 200 }] }, { unit: 'm' }).includes('data-id="plug:1"')).toBe(true);
  });
  it('null perforation entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, perforations: [null, { top_m: 100, bottom_m: 110 }] }, { unit: 'm' }).includes('data-id="perf:1"')).toBe(true);
  });
  it('null formation entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, formations: [null, { name: 'X', top_m: 100 }] }, { unit: 'm' }).includes('data-id="formation:1"')).toBe(true);
  });
  it('null zone entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, zones: [null, { kind: 'salt', top_m: 100, bottom_m: 200 }] }, { unit: 'm' }).includes('data-id="zone:1"')).toBe(true);
  });
  it('null packer entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, packers: [null, { depth_m: 100 }] }, { unit: 'm' }).includes('data-id="packer:1"')).toBe(true);
  });
  it('null note entry tolerated', () => {
    expect(W.renderWellboreSVG({ td: 1500, notes: [null, { depth_m: 100, text: 'x' }] }, { unit: 'm' }).includes('data-id="note:1"')).toBe(true);
  });
  it('all-kinds-with-null fixture never throws', () => {
    expect(
      W.renderWellboreSVG(
        {
          td: 1500,
          casings: [null, { top_m: 0, shoe_m: 200 }],
          plugs: [null, { top_m: 100, bottom_m: 200 }],
          perforations: [null, { top_m: 300, bottom_m: 310 }],
          formations: [null, { name: 'X', top_m: 400 }],
          zones: [null, { kind: 'salt', top_m: 500, bottom_m: 600 }],
          packers: [null, { depth_m: 700 }],
          notes: [null, { depth_m: 800, text: 'y' }],
        },
        { unit: 'm' },
      ).startsWith('<svg'),
    ).toBe(true);
  });
});

// --- fix round: labels must be escaped exactly once (Finding 2) ---
describe('escaping', () => {
  it('no double escaping', () => {
    expect(
      W.renderWellboreSVG({ td: 1000, formations: [{ name: "Driller's Nisku & Wabamun", top_m: 500 }] }, { unit: 'm' }).includes('Driller&#39;s Nisku &amp; Wabamun') === true &&
        !W.renderWellboreSVG({ td: 1000, formations: [{ name: "Driller's Nisku & Wabamun", top_m: 500 }] }, { unit: 'm' }).includes('&amp;amp;'),
    ).toBe(true);
  });
});

// --- task-5 review fix round: canonical field names must survive parsing ---
describe('canonical field names survive parsing', () => {
  // The schema field is `n` (renderer reads p.n; the rows editor's data-wb
  // key is 'n') — a plug header's number must land there as a Number, not as
  // a stray `.num` string.
  it('plug header number lands in n as number', () => {
    expect(W.parseIntervalsText('Plug #3 100–200 m').plugs[0]!.n === 3).toBe(true);
  });
  // A casing's `type` (surface/intermediate/production/conductor) must come
  // through parseCasingText — the rows editor round-trip depends on the
  // parser actually emitting it (task-5-report Finding 1's parser-side half).
  it('parsed casing keeps type', () => {
    expect(W.parseCasingText('9-5/8" surface casing @ 610 m').casings[0]!.type === 'surface').toBe(true);
  });
});

describe('bridge enrichment', () => {
  const wb3 = W.wellboreFrom3D({ td: 1447.2, surfaceCasingDepth: 186, productionCasing: 'None — open hole below surface casing', cementTop: null, plugIntervals: 'No plug records on file', perfIntervals: '', formationPenetrated: 'Wabamun' })!;
  it('bridge td', () => {
    expect(wb3.td).toEqual(1447.2);
  });
  it('bridge surface casing', () => {
    expect([wb3.casings[0]!.top_m, wb3.casings[0]!.shoe_m]).toEqual([0, 186]);
  });
  it('bridge open hole from text', () => {
    expect(!!wb3.openHole && wb3.openHole.bottom_m === 1447.2).toBe(true);
  });
  it('bridge formation noted (no depth)', () => {
    expect(wb3.notes.some((n) => /Wabamun/.test(n.text ?? '')) && (wb3.formations || []).length === 0).toBe(true);
  });
  it('bridge source', () => {
    expect(wb3.source).toEqual('bridge');
  });
  it('bridge open hole top_m uses deepest shoe (Finding 1)', () => {
    expect(wb3.openHole!.top_m).toEqual(186);
  });
  const wb4 = W.wellboreFrom3D({ tvd: 1700, productionCasing: 'Production @ 1699.5 m', cementTop: 900, plugIntervals: 'JET 1677–1679 m (Nordegg)' })!;
  it('bridge fallback tvd', () => {
    expect(wb4.td).toEqual(1700);
  });
  it('bridge TOC on deepest casing', () => {
    expect(wb4.casings.find((c) => c.shoe_m === 1699.5)!.toc_m).toEqual(900);
  });
  it('bridge plug parsed', () => {
    expect(wb4.plugs.length).toEqual(1);
  });
  it('bridge no td → null', () => {
    expect(W.wellboreFrom3D({ operator: 'X' })).toEqual(null);
  });
  it('bridge open hole from intermediate casing (Finding 1)', () => {
    const wb5 = W.wellboreFrom3D({ td: 1447.2, surfaceCasingDepth: 186, intermediateCasing: '7" intermediate @ 800 m', productionCasing: 'None — open hole below intermediate' })!;
    expect(wb5.openHole).toEqual({ top_m: 800, bottom_m: 1447.2 });
  });
  it('bridge open hole with no casings uses 0 (Finding 1)', () => {
    const wb6 = W.wellboreFrom3D({ td: 1000, productionCasing: 'None — open hole' })!;
    expect(wb6.openHole!.top_m).toEqual(0);
  });
  it('bridge warnings surfaced as notes with [bridge] tag (Finding 2)', () => {
    const wb7 = W.wellboreFrom3D({ td: 1000, plugIntervals: 'garbled unparseable text' })!;
    expect(wb7.notes.some((n) => /\[bridge\]/.test(n.text ?? ''))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// v3 additions (not in v2): row provenance and the storage schema.
// ---------------------------------------------------------------------------

type ProvenancedRow = { source?: W.WellboreSource; verbatim?: string };
const reportRows = (wb: W.ParsedReportWellbore): ProvenancedRow[] => [...wb.casings, ...wb.plugs, ...wb.perforations, ...wb.notes];

describe('provenance (v3)', () => {
  it('parseWellboreReport rows carry source "parsed" and verbatim line', () => {
    const plug = W.parseWellboreReport('Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2').wellbore.plugs[0]!;
    expect(plug.source).toBe('parsed');
    expect(plug.verbatim).toContain('1463–1448 m');

    const casing = W.parseWellboreReport('9-5/8" surface casing @ 610 m').wellbore.casings[0]!;
    expect(casing.source).toBe('parsed');
    expect(casing.verbatim).toBe('9-5/8" surface casing @ 610 m');
  });

  it('parseCasingText and parseIntervalsText rows carry source "parsed" and the clause they were read from', () => {
    const casing = W.parseCasingText('9-5/8" surface casing @ 610 m').casings[0]!;
    expect(casing).toMatchObject({ type: 'surface', shoe_m: 610, source: 'parsed', verbatim: '9-5/8" surface casing @ 610 m' });

    const iv = W.parseIntervalsText('JET 1677–1679 m (Nordegg); TREATMENT 1673–1676 m (Fernie)');
    expect(iv.plugs.map((p) => [p.source, p.verbatim])).toEqual([
      ['parsed', 'JET 1677–1679 m (Nordegg)'],
      ['parsed', 'TREATMENT 1673–1676 m (Fernie)'],
    ]);
    expect(iv.notes.map((n) => [n.text, n.source, n.verbatim])).toEqual([
      ['Formation: Nordegg', 'parsed', 'JET 1677–1679 m (Nordegg)'],
      ['Formation: Fernie', 'parsed', 'TREATMENT 1673–1676 m (Fernie)'],
    ]);

    const perf = W.parseIntervalsText('Viking perfs squeezed 831.7–839.7 and 871.5 m (treatment)').perforations;
    expect(perf.length).toBe(2);
    for (const p of perf) expect(p).toMatchObject({ source: 'parsed', verbatim: 'Viking perfs squeezed 831.7–839.7 and 871.5 m (treatment)' });
  });

  it('every array row of a mixed report is "parsed" with a verbatim taken from the input; openHole carries no provenance', () => {
    const text = [
      '8-5/8" J55 35.7 kg/m 0–610 ft TOC 850 ft',
      'None — open hole below surface casing',
      '',
      'Plug #1',
      '1463–1448 m',
      '25 sacks',
      'JET 1677–1679 m (Nordegg)',
      'Viking perfs squeezed 831.7–839.7 and 871.5 m',
      'totally unparseable gibberish line',
    ].join('\n');
    const { wellbore } = W.parseWellboreReport(text);
    const rows = reportRows(wellbore);
    expect(wellbore.casings.length).toBeGreaterThan(0);
    expect(wellbore.plugs.length).toBeGreaterThan(0);
    expect(wellbore.perforations.length).toBeGreaterThan(0);
    expect(wellbore.notes.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe('parsed');
      expect(typeof row.verbatim).toBe('string');
      expect(text.includes(row.verbatim!)).toBe(true);
    }
    // The casing-side open-hole note is read from its own line, not the whole chunk.
    expect(wellbore.notes.find((n) => /^Open hole:/.test(n.text ?? ''))!.verbatim).toBe('None — open hole below surface casing');
    expect(wellbore.notes.find((n) => n.text === 'totally unparseable gibberish line')!.verbatim).toBe('totally unparseable gibberish line');
    expect(wellbore.openHole).toEqual({});
  });

  it('wellboreFrom3D rows carry source "bridge" and keep the parser verbatim', () => {
    const wb = W.wellboreFrom3D({
      td: 1700,
      surfaceCasingDepth: 186,
      productionCasing: 'Production @ 1699.5 m',
      intermediateCasing: 'None — open hole below intermediate',
      cementTop: 900,
      plugIntervals: 'JET 1677–1679 m (Nordegg); garbled unparseable text',
      perfIntervals: 'perfs 1500–1510 m',
      formationPenetrated: 'Wabamun',
    })!;
    expect(wb.source).toBe('bridge');
    const rows: ProvenancedRow[] = [...wb.casings, ...wb.plugs, ...wb.perforations, ...wb.notes, ...wb.zones, ...wb.packers];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.source).toBe('bridge');

    expect(wb.casings.find((c) => c.shoe_m === 1699.5)).toMatchObject({ verbatim: 'Production @ 1699.5 m', toc_m: 900 });
    expect(wb.plugs[0]!.verbatim).toBe('JET 1677–1679 m (Nordegg)');
    expect(wb.perforations[0]!.verbatim).toBe('perfs 1500–1510 m');
    expect(wb.notes.find((n) => n.text === 'Formation: Nordegg')!.verbatim).toBe('JET 1677–1679 m (Nordegg)');
    expect(wb.notes.find((n) => /^Open hole:/.test(n.text ?? ''))!.verbatim).toBe('None — open hole below intermediate');
    // openHole is a plain interval, no provenance fields.
    expect(wb.openHole).toEqual({ top_m: 1699.5, bottom_m: 1700 });
  });
});

describe('wellboreStats null tolerance (v3)', () => {
  it('a null plug entry is skipped instead of throwing', () => {
    const st = W.wellboreStats({ td: 1000, plugs: [null, { top_m: 100, bottom_m: 200 }] });
    expect([st.deepestPlug, st.shallowestPlug, st.pluggedTotal, st.coveragePct]).toEqual([200, 100, 100, 10]);
  });
  it('null and undefined wellbores give empty stats', () => {
    const empty = { td: null, casingCount: 0, plugCount: 0, deepestPlug: null, shallowestPlug: null, longestPlug: null, pluggedTotal: null, coveragePct: null, openHoleLen: null, perfCount: 0, formationCount: 0 };
    expect(W.wellboreStats(null)).toEqual(empty);
    expect(W.wellboreStats(undefined)).toEqual(empty);
  });
});

describe('WellboreSchema (v3)', () => {
  it('drops null row entries and preserves unknown per-row fields', () => {
    const parsed = W.WellboreSchema.parse({ td: 1000, casings: [null, { top_m: 0, shoe_m: 200, legacyFlag: 'x' }] });
    expect(parsed.casings).toEqual([{ top_m: 0, shoe_m: 200, legacyFlag: 'x' }]);
    expect(parsed.casings[0]!.legacyFlag).toBe('x');
  });

  it('a wellbore missing all arrays parses to empty arrays', () => {
    expect(W.WellboreSchema.parse({ td: 900 })).toEqual({
      td: 900,
      casings: [],
      plugs: [],
      perforations: [],
      formations: [],
      packers: [],
      zones: [],
      notes: [],
    });
  });

  it('accepts td and openHole null, the structured open-hole signal {}, and keeps every v2 field', () => {
    expect(W.WellboreSchema.parse({ td: null, openHole: null }).openHole).toBeNull();
    expect(W.WellboreSchema.parse({ openHole: {} }).openHole).toEqual({});
    expect(W.WellboreSchema.parse(wbFull)).toEqual(wbFull);
  });

  it('accepts parser and bridge output as stored construction', () => {
    const { wellbore } = W.parseWellboreReport('Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2\nNone — open hole below surface casing');
    expect(W.WellboreSchema.parse(wellbore)).toMatchObject(wellbore);
    const bridged = W.wellboreFrom3D({ td: 1447.2, surfaceCasingDepth: 186, productionCasing: 'None — open hole below surface casing', formationPenetrated: 'Wabamun' })!;
    expect(W.WellboreSchema.parse(bridged)).toEqual({ ...bridged, formations: [] });
  });

  it('rejects a row source outside parsed/manual/extractor/bridge', () => {
    expect(W.WellboreSchema.safeParse({ plugs: [{ top_m: 1, bottom_m: 2, source: 'guess' }] }).success).toBe(false);
  });
});

// Fix round 1: v2's NUM pattern also matches a lone comma (NaN) and a long
// digit run overflows (Infinity). The parsers treat such a clause as
// unparsed instead of emitting a non-finite depth the schema would reject.
const nonFinite = (x: unknown): number[] => {
  if (typeof x === 'number') return Number.isFinite(x) ? [] : [x];
  if (Array.isArray(x)) return x.flatMap(nonFinite);
  if (x && typeof x === 'object') return Object.values(x).flatMap(nonFinite);
  return [];
};
const storable = (wb: W.ParsedReportWellbore | W.BridgeWellbore): boolean =>
  W.WellboreSchema.safeParse(wb).success && W.WellboreSchema.safeParse(JSON.parse(JSON.stringify(wb))).success;

describe('non-finite numbers are never emitted (v3 fix round 1)', () => {
  const NINES = '9'.repeat(400);
  it.each([
    ['Perf 1200 m, - 1300 m', 'Perf 1200 m, - 1300 m'],
    ['Plug #1 3658 ft, - 3277 ft', 'Plug #1 3658 ft, - 3277 ft'],
    ['foo, - 200 m', 'foo, - 200 m'],
    ['x @ , m casing', 'x @ , m casing'],
    ['casing TOC , m', 'casing TOC , m'],
    ['plug 100–<400 nines> m', `plug 100–${NINES} m`],
    ['casing @ 100 m TOC , m', 'casing @ 100 m TOC , m'],
  ])('%s → no non-finite field, a warning, a note with the clause, storable', (_label, text) => {
    const { wellbore, warnings } = W.parseWellboreReport(text);
    expect(nonFinite(wellbore)).toEqual([]);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(wellbore.notes.some((n) => (n.text ?? '').includes(text))).toBe(true);
    expect(storable(wellbore)).toBe(true);
    expect(() => W.WellboreSchema.parse(JSON.parse(JSON.stringify(wellbore)))).not.toThrow();

    // The parsers the bridge calls directly are covered too.
    expect(nonFinite(W.parseIntervalsText(text))).toEqual([]);
    expect(nonFinite(W.parseIntervalsText(text, 'ft'))).toEqual([]);
    expect(nonFinite(W.parseCasingText(text))).toEqual([]);
    const bridged = W.wellboreFrom3D({ td: 2000, productionCasing: text, intermediateCasing: text, plugIntervals: text, perfIntervals: text })!;
    expect(nonFinite(bridged)).toEqual([]);
    expect(storable(bridged)).toBe(true);
  });

  it('an unreadable range keeps the clause as one note (not three) and emits no plug', () => {
    const text = 'Plug #1 3658 ft, - 3277 ft';
    const { wellbore, warnings } = W.parseWellboreReport(text);
    expect(wellbore.plugs).toEqual([]);
    expect(wellbore.notes).toEqual([{ depth_m: null, text, source: 'parsed', verbatim: text }]);
    expect(warnings).toEqual([`Unparsed interval line: "${text}"`, `Unparsed casing line: "${text}"`]);
  });

  it('a clause unreadable to both parsers is noted once', () => {
    const text = 'x @ , m casing';
    const { wellbore } = W.parseWellboreReport(text);
    expect(wellbore.casings).toEqual([]);
    expect(wellbore.notes).toEqual([{ depth_m: null, text, source: 'parsed', verbatim: text }]);
    expect(W.parseCasingText(text)).toEqual({ casings: [], openHole: null, notes: [text], warnings: [`Unparsed casing line: "${text}"`] });
  });

  it('a casing clause with one unreadable value is unparsed as a whole', () => {
    const c = W.parseCasingText('casing @ 100 m TOC , m');
    expect([c.casings.length, c.notes, c.warnings.length]).toEqual([0, ['casing @ 100 m TOC , m'], 1]);
  });

  it('an unreadable clause inside a plug block does not break the block, like a v2 unparsed line', () => {
    const { wellbore } = W.parseWellboreReport('Plug #1\n1463–1448 m\n1200 m, - 1300 m\n25 sacks');
    expect(wellbore.plugs.map((p) => [p.n, p.top_m, p.bottom_m, p.sacks])).toEqual([[1, 1448, 1463, 25]]);
    expect(wellbore.notes.filter((n) => n.text === '1200 m, - 1300 m')).toHaveLength(1);
  });

  it('an overflowing plug number or sacks count is not emitted', () => {
    const hdr = W.parseIntervalsText(`Plug #${NINES}\n100–200 plug m`);
    expect(nonFinite(hdr)).toEqual([]);
    expect(hdr.notes.some((n) => n.text === `Plug #${NINES}`)).toBe(true);
    expect(hdr.plugs.map((p) => p.n)).toEqual([undefined]);

    const sacks = W.parseIntervalsText(`Plug #1\n100–200 m\n${NINES} sacks`);
    expect(sacks.plugs.map((p) => [p.n, p.sacks])).toEqual([[1, undefined]]);
    expect(sacks.notes.some((n) => n.text === `${NINES} sacks`)).toBe(true);
  });

  // Overflow (Infinity) is covered by the explicit cases above; long digit
  // runs are kept out of the generator because v2's inch-OD regex is slow on them.
  it('property: every report and bridge output from 500 seeded texts with stray commas, dashes and units is storable', () => {
    let seed = 20261020;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const TOKENS = ['1', '12', '100', '1463', '3658.5', '1,463', ',', ', ', ' ,', '-', '–', '—', ' - ', 'm', 'ft', ' m', ' ft', 'mm', '@', 'at', 'and', 'TOC', 'Plug #', 'plug', 'perfs', 'squeezed', 'casing', 'surface', 'sacks', '"', '5/8', 'kg/m', 'J55', 'felt plug', 'CIBP', ';', '\n', '\n\n'];
    const pick = (): string => TOKENS[Math.floor(rnd() * TOKENS.length)]!;
    let clauseNotes = 0;
    let rows = 0;
    for (let i = 0; i < 500; i++) {
      const text = Array.from({ length: 2 + Math.floor(rnd() * 12) }, () => pick()).join(rnd() < 0.5 ? ' ' : '');
      const { wellbore } = W.parseWellboreReport(text);
      expect(nonFinite(wellbore), text).toEqual([]);
      expect(storable(wellbore), text).toBe(true);
      const bridged = W.wellboreFrom3D({ td: 5000, productionCasing: text, plugIntervals: text, perfIntervals: text })!;
      expect(nonFinite(bridged), text).toEqual([]);
      expect(storable(bridged), text).toBe(true);
      clauseNotes += wellbore.notes.filter((n) => n.depth_m === null && n.text === n.verbatim).length;
      rows += wellbore.plugs.length + wellbore.perforations.length + wellbore.casings.length;
    }
    // The generator exercises both the unreadable-clause path and real rows.
    expect(clauseNotes).toBeGreaterThan(50);
    expect(rows).toBeGreaterThan(100);
  });
});
