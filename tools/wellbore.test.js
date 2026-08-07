// Node test harness for the wellbore pure section — run: node tools/wellbore.test.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/\/\* ===== WELLBORE PURE BEGIN ===== \*\/([\s\S]*?)\/\* ===== WELLBORE PURE END ===== \*\//);
if (!m) { console.error('FAIL: wellbore pure-section markers not found in index.html'); process.exit(1); }
new Function(m[1] + '\nglobalThis.Wellbore = { mToFt, ftToM, parseDepth, parseIntervalsText, parseCasingText, parseWellboreReport, wellboreStats, depthScale, renderWellboreSVG, wellboreFrom3D };')();
const W = globalThis.Wellbore;
let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
  else console.log(`ok   ${name}`);
};
const ok = (name, cond) => { if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

// conversions
ok('m→ft→m round trip', Math.abs(W.ftToM(W.mToFt(1234.5)) - 1234.5) < 1e-9);
eq('parseDepth m', W.parseDepth('850 m'), 850);
eq('parseDepth ft', W.parseDepth('3219 ft'), +(3219*0.3048).toFixed(1));
eq('parseDepth bare uses default', W.parseDepth('610', 'ft'), +(610*0.3048).toFixed(1));
eq('parseDepth junk', W.parseDepth('unknown'), null);

// intervals — real Enbridge strings
const iv1 = W.parseIntervalsText('JET 1677–1679 m (Nordegg); TREATMENT 1673–1676 m (Fernie)');
eq('JET plug parsed', [iv1.plugs[0].top_m, iv1.plugs[0].bottom_m], [1677, 1679]);
ok('JET formation noted', iv1.notes.some(n => /Nordegg/.test(n.text)));
const iv2 = W.parseIntervalsText('Viking perfs squeezed 831.7–839.7 and 871.5 m (treatment)');
ok('squeezed perf parsed', iv2.perforations.length >= 1 && iv2.perforations[0].status === 'squeezed');
const iv3 = W.parseIntervalsText('Plug #1 3658-3277 ft 170 sacks cement 2% CaCl2 felt plug at 3219 ft', 'ft');
eq('ft plug converted+ordered', [iv3.plugs[0].top_m, iv3.plugs[0].bottom_m], [+(3277*0.3048).toFixed(1), +(3658*0.3048).toFixed(1)]);
eq('sacks captured', iv3.plugs[0].sacks, 170);
ok('additive captured', /CaCl2/i.test(iv3.plugs[0].additives || ''));
ok('felt plug note', iv3.notes.some(n => /felt plug/i.test(n.text)));
const iv4 = W.parseIntervalsText('No plug records on file');
eq('no-records → nothing + warning', [iv4.plugs.length, iv4.warnings.length >= 1], [0, true]);
ok('bridge plug kind', W.parseIntervalsText('CIBP at 1200 m').plugs[0].kind === 'cibp');

// casing text
const c1 = W.parseCasingText('Production @ 1699.5 m');
eq('casing shoe', c1.casings[0].shoe_m, 1699.5);
const c2 = W.parseCasingText('None — open hole below surface casing');
eq('open-hole text', [c2.casings.length, !!c2.openHole || c2.notes.length >= 1], [0, true]);
const c3 = W.parseCasingText('8-5/8" J55 35.7 kg/m 0–610 ft TOC 850 ft');
ok('casing od from inches', Math.abs(c3.casings[0].od_mm - 8.625*25.4) < 0.5);
eq('casing grade', c3.casings[0].grade, 'J55');
eq('casing shoe ft→m', c3.casings[0].shoe_m, +(610*0.3048).toFixed(1));

// full report — never throws, warnings for junk
const rep = W.parseWellboreReport('Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2\ntotally unparseable gibberish line');
ok('report plug found', rep.wellbore.plugs.length === 1);
ok('report warning kept', rep.warnings.length >= 1);

// --- review-fix regression tests (task-1 report review) ---

// Finding 1 — a plug's own depth line must not spawn a phantom casing, and
// must remain min/max-normalized like every other plug.
const repPhantom = W.parseWellboreReport('Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2');
eq('no phantom casing from bare plug depth line', repPhantom.wellbore.casings.length, 0);
eq('plug from phantom-probe still normalized top<bottom', [repPhantom.wellbore.plugs[0].top_m, repPhantom.wellbore.plugs[0].bottom_m], [1448, 1463]);
// casing shoe/top ranges are still recognized AND normalized when real
// casing context is present.
const cNeg = W.parseCasingText('Casing 850–200 m');
eq('casing range with context is min/max-normalized', [cNeg.casings[0].top_m, cNeg.casings[0].shoe_m], [200, 850]);

// Finding 2 — open-hole prose must survive as a structured signal AND as a
// note, end-to-end through parseWellboreReport (not silently dropped).
const c2b = W.parseCasingText('None — open hole below surface casing');
eq('parseCasingText open-hole structured signal', c2b.openHole, {});
const repOpenHole = W.parseWellboreReport('None — open hole below surface casing');
ok('open-hole flag survives to wellbore.openHole', !!repOpenHole.wellbore.openHole);
ok('open-hole note survives to wellbore.notes', repOpenHole.wellbore.notes.some(n => n.depth_m === null && /open hole/i.test(n.text)));

// Finding 3 — sacks/additives on lines AFTER the depth range (multi-line
// plug record) must attach to that plug, not vanish as unparsed noise.
eq('multi-line sacks attach to the plug', repPhantom.wellbore.plugs[0].sacks, 25);
ok('multi-line additive attaches to the plug', /CaCl2/i.test(repPhantom.wellbore.plugs[0].additives || ''));

// Finding 4 — a number's own inline unit wins over the line-level fallback
// unit (and over defaultUnit); a dash-less mixed-unit sentence is grammar
// we intentionally don't guess at, so it must be left unparsed rather than
// silently misconverted.
const iv5 = W.parseIntervalsText('plug 3658–3277 ft', 'm');
eq('per-number unit overrides line fallback + defaultUnit', [iv5.plugs[0].top_m, iv5.plugs[0].bottom_m], [+(3277*0.3048).toFixed(1), +(3658*0.3048).toFixed(1)]);
const ivMixed = W.parseIntervalsText('from 100 m to 400 ft');
eq('dash-less mixed-unit prose left unparsed, not misconverted', [ivMixed.plugs.length, ivMixed.perforations.length, ivMixed.warnings.length >= 1], [0, 0, true]);

// Finding 5 — a line genuinely unparsed by BOTH the interval and casing
// parsers must land in wellbore.notes as well as warnings.
ok('report gibberish line also noted', rep.wellbore.notes.some(n => n.depth_m === null && n.text === 'totally unparseable gibberish line'));
const repGibberish = W.parseWellboreReport('totally unparseable gibberish line');
ok('standalone gibberish line warns', repGibberish.warnings.length >= 1);
ok('standalone gibberish line also notes', repGibberish.wellbore.notes.some(n => n.depth_m === null && n.text === 'totally unparseable gibberish line'));

// Finding 6 — casing warnings must not be suppressed wholesale just because
// the same chunk also contains a plug/perforation.
ok('casing warnings survive alongside a found plug', repPhantom.warnings.some(w => /Unparsed casing line/.test(w)));

// stats
const wbFix = { td: 1000, casings: [{top_m:0, shoe_m:200}], plugs: [{top_m:100, bottom_m:200}, {top_m:150, bottom_m:300}], perforations: [{top_m:900, bottom_m:910}], formations: [{name:'X', top_m:800}], openHole: {top_m:200, bottom_m:1000} };
const st = W.wellboreStats(wbFix);
eq('stats plugged merged overlap', st.pluggedTotal, 200);   // 100–300 merged
eq('stats coverage', st.coveragePct, 20);
eq('stats deepest plug', st.deepestPlug, 300);
eq('stats openHole len', st.openHoleLen, 800);

// depth scale
const sc = W.depthScale(1000, 500);
eq('yOf surface', sc.yOf(0), 0);
eq('yOf td', sc.yOf(1000), 500);
eq('metric ticks every 50', sc.ticks('m')[1].m, 50);
eq('imperial ticks every 100ft', +(sc.ticks('ft')[1].m/0.3048).toFixed(0), 100);

process.exit(failures ? 1 : 0);
