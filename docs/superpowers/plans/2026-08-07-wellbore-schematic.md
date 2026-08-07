# Interactive Wellbore Schematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A professional interactive SVG wellbore schematic (casings/cement/plugs/perfs/formations, tooltips, zoom, unit toggle, export) on the Well Detail tab, fed by a per-well `wellbore` JSON built from 3D-bridge pushes, a paste-report parser, or a structured rows editor.

**Architecture:** All app code in `index.html`. A DOM-free "pure" section (data helpers + parser + stats + SVG-string renderer) sits between literal markers and registers itself on `globalThis.Wellbore`, so `tools/wellbore.test.js` can extract and run it in node. A separate UI section mounts the schematic into the dossier, wires tooltips/click/zoom/units/export, and adds the rows editor to the well form. `mapFrom3D` gains bridge enrichment with a never-overwrite-manual rule.

**Tech Stack:** Vanilla JS in `index.html` (semicolons, 2-space indent), string-built SVG (no DOM in pure code), node built-in test harness style copied from `tools/scoring.test.js` (plain asserts, exit code).

**Spec:** `docs/superpowers/specs/2026-08-07-wellbore-schematic-design.md` — read it first; §2 data shape, §4 parser formats, §5 renderer rules, §6 interactions are the requirements this plan implements.

## Global Constraints

- Working directory: `/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard`
- Files that may change: `index.html`, `tools/wellbore.test.js` (new). Nothing else — `scoring.js`, `methodology.json`, `wells.json`, `3d-reviewer.html` untouched.
- All stored depths in METRES. `ft` is display-only: `mToFt = m => m/0.3048`, `ftToM = ft => ft*0.3048`, display rounding 0.1.
- The pure section MUST be DOM-free (no `document`, no `window` reads) and MUST sit between these exact marker comments, ending with the registry assignment:

```js
/* ===== WELLBORE PURE BEGIN ===== */
// ...all pure functions...
globalThis.Wellbore = { mToFt, ftToM, parseDepth, parseIntervalsText, parseCasingText, parseWellboreReport, wellboreStats, depthScale, renderWellboreSVG, wellboreFrom3D };
/* ===== WELLBORE PURE END ===== */
```

- Field name exactly `wellbore` on well objects; `source` ∈ `'bridge'|'parsed'|'manual'`.
- Test command: `node tools/wellbore.test.js` (must exit 0; prints `ok`/`FAIL` lines like `tools/scoring.test.js`).
- Syntax gate after every index.html edit:

```bash
node -e "
const html = require('fs').readFileSync('index.html','utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
new Function(blocks.join('\n;\n'));
console.log('syntax OK —', blocks.length, 'inline script blocks');
"
```

- Work on the controller-created feature branch; SKIP any `git pull`; do NOT push (controller opens a PR after the human checklist).
- Colors (semantic, colorblind-safe, from spec §5): steel `#8a93a1`, cement `#a8cdea`, plug `#1d6b47`, formation `#e08a2e`, perf `#d4453a`, open-hole hatch `#8a6b4f`; structural strokes/text use `var(--line)`/`var(--muted)`/`var(--ink, currentColor)` in the live DOM. `renderWellboreSVG(..., {resolvedColors})` accepts optional overrides so export can inline computed values.

## Test harness pattern (used by every pure-code task)

`tools/wellbore.test.js` starts with:

```js
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
// ...tests...
// (final line)
process.exit(failures ? 1 : 0);
```

(The registry line is re-applied by the harness so tests never depend on the in-file assignment's position; functions not yet implemented simply fail the `new Function` call — that IS the red state.)

---

### Task 1: Pure core — conversions, depth parsing, interval/casing/report parsers, stats

**Files:**
- Modify: `index.html` — add the `/* ===== WELLBORE PURE BEGIN/END ===== */` section as the FIRST content of the main app `<script>` block (immediately after the `<script>` tag that contains the app, before `let state = ...` and everything else; pure functions have no dependencies on app code).
- Create: `tools/wellbore.test.js` (harness above + this task's tests).

**Interfaces:**
- Produces (exact signatures, all pure):
  - `mToFt(m)`, `ftToM(ft)` — numbers.
  - `parseDepth(str, defaultUnit='m') → number|null` — metres; accepts `"1463"`, `"1,463.5"`, `"3219 ft"`, `"850 m"`; bare numbers use `defaultUnit`.
  - `parseIntervalsText(text, defaultUnit='m') → { plugs:[], perforations:[], notes:[], warnings:[] }` (spec §4 plug/perf/JET/TREATMENT/felt-plug rules; interval order normalized top_m<bottom_m; ft converted).
  - `parseCasingText(text) → { casings:[], openHole:null|{...}, notes:[], warnings:[] }` (spec §4 casing shorthand incl. `8⅝"`, `8-5/8"`, `219 mm`, grade tokens like J55/K55/N80, `@ 610 m` shoe, `0–610 ft` range, `TOC 850 m`, `'None — open hole below surface casing'`).
  - `parseWellboreReport(text) → { wellbore: <partial spec-§2 object>, warnings: string[] }` — composes the two above line-by-line; never throws; unparsed lines → notes + warnings.
  - `wellboreStats(wb) → { td, casingCount, plugCount, deepestPlug, shallowestPlug, longestPlug, pluggedTotal, coveragePct, openHoleLen, perfCount, formationCount }` (numbers in metres; nulls when not computable; coveragePct = merged-plug-interval length ÷ td × 100, overlaps merged, 1 decimal).
  - `depthScale(td, pxHeight) → { yOf(m)→px, ticks(unit)→[{m, label}] }` — linear; ticks every 50 m or 100 ft (labels in active unit, integer).

- [ ] **Step 1: Write the failing tests** — append to the harness in `tools/wellbore.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails** — `node tools/wellbore.test.js`. Expected: FAIL (markers not found).
- [ ] **Step 3: Implement the pure section** in `index.html` between the exact markers from Global Constraints, containing ALL functions listed in Interfaces (including stubs `renderWellboreSVG = () => ''` and `wellboreFrom3D = () => null` so the registry line resolves — Tasks 2 and 6 replace them). Implementation notes binding you: interval regex must accept `–` (u2013), `—` (u2014) and `-`; `and <num>` continues an interval list; plug/perf classification — lines containing `perf|squeez` → perforations, `JET|TREATMENT|plug|CIBP|bridge` → plugs (CIBP/bridge set `kind`), a lone `<num>–<num>` after a `Plug #N` header belongs to that plug; formation names in trailing `(...)` become notes `{depth_m: top_m, text: 'Formation: <name>'}`; all depths through `parseDepth`.
- [ ] **Step 4: Run to verify green** — `node tools/wellbore.test.js` → all `ok`, exit 0. Then the syntax gate.
- [ ] **Step 5: Commit** — `git add index.html tools/wellbore.test.js && git commit -m "feat(schematic): pure wellbore core — conversions, report parser, stats, depth scale"`

---

### Task 2: Pure SVG renderer

**Files:**
- Modify: `index.html` (replace the `renderWellboreSVG` stub inside the pure section)
- Test: append to `tools/wellbore.test.js`

**Interfaces:**
- Produces: `renderWellboreSVG(wb, opts) → string`. `opts = { unit:'m'|'ft', width=760, height=920, resolvedColors={}, highlightId=null }`. Returns `''` when `!wb || !(wb.td > 0)` (UI shows empty-state instead). Root: `<svg viewBox="0 0 W H" ...>`; the UI layer (Task 3) owns live viewBox mutation for zoom.
- Drawing contract (each bullet is a requirement Task 3's interactions and this task's tests rely on):
  - Left gutter (~64px) depth axis: tick line + label per `depthScale.ticks(unit)`; axis title `Depth (m)`/`Depth (ft)`.
  - Ground surface: horizontal line at y=0 area labeled `Ground Surface`; KB triangle marker + label when `wb.kbElev` present.
  - Casings sorted by `shoe_m` ascending drawn as nested pairs of vertical steel walls (fill steel color), horizontal width per nesting order (outermost widest); cement fill (cement color, 55% opacity) drawn outside each casing wall: when `toc_m` is a number → cement from `toc_m` down to `shoe_m`; when `toc_m` is null/absent → a "shoe patch" only, from `max(top_m, shoe_m − 0.05·td)` down to `shoe_m` (spec §5: unknown TOC extends to shoe only).
  - Casing shoe: small solid triangle at each shoe depth on both walls.
  - Open hole: from `wb.openHole` (or below deepest shoe to td when absent but td deeper than deepest shoe) drawn with a diagonal-hatch `<pattern>` in open-hole color.
  - Plugs: `kind:'cement'` filled rect across the innermost bore at depth range (plug color, label `P<n>` when n present); `bridge`/`cibp` drawn as the hourglass symbol (two opposed triangles) at `top_m`.
  - Perforations: rows of small outward triangles on both bore walls across the interval (perf color); `status:'squeezed'` at 45% opacity.
  - Formations: dashed horizontal line (formation color) at `top_m` + name text right of the bore.
  - Zones: full-width translucent bands (`salt` pale violet `#b9a7e6` @18%, `hydrocarbon` pale amber `#e6c78a` @18%).
  - Packers: opposed solid black triangles at `depth_m` inside bore. Notes: `ⓘ` text glyph at depth in gutter-right; content in its `<title>`.
  - EVERY component element: `data-kind` (`casing|cement|plug|perf|formation|zone|packer|note|openhole`), `data-id` (`kind:index`), `aria-label` (human summary incl. depths in `opts.unit`), and a child `<title>` with the same summary. Element with `data-id === opts.highlightId` gets `stroke="#3aa0ff" stroke-width="2.5"`.
  - Missing optional fields render as `—` in labels; NEVER throw on sparse data.

- [ ] **Step 1: Write the failing tests** — append:

```js
// renderer — full fixture
const wbFull = { td: 1500, kbElev: 800, source: 'manual',
  casings: [{name:'Surface Casing', od_mm:219, grade:'J55', top_m:0, shoe_m:186, toc_m:0}, {name:'Production Casing', od_mm:139.7, top_m:0, shoe_m:1450, toc_m:900}],
  plugs: [{n:1, top_m:1400, bottom_m:1450, sacks:25, kind:'cement'}, {top_m:1200, bottom_m:1200, kind:'cibp'}],
  perforations: [{top_m:1300, bottom_m:1310, status:'squeezed'}],
  formations: [{name:'Nisku', top_m:1100}],
  packers: [{depth_m:1000}], zones: [{kind:'salt', top_m:600, bottom_m:700}],
  openHole: {top_m:1450, bottom_m:1500}, notes: [{depth_m:1400, text:'felt plug'}] };
const svg = W.renderWellboreSVG(wbFull, {unit:'m'});
ok('svg root', /^<svg[^>]*viewBox="0 0 \d+ \d+"/.test(svg));
ok('ground surface label', svg.includes('Ground Surface'));
for (const k of ['casing','cement','plug','perf','formation','zone','packer','note','openhole'])
  ok('kind rendered: '+k, svg.includes(`data-kind="${k}"`));
ok('formation name shown', svg.includes('Nisku'));
ok('aria labels present', (svg.match(/aria-label=/g)||[]).length >= 8);
ok('titles present', (svg.match(/<title>/g)||[]).length >= 8);
ok('KB marker', /KB/.test(svg));
// unit relabel without geometry change
const svgFt = W.renderWellboreSVG(wbFull, {unit:'ft'});
ok('ft axis label', svgFt.includes('Depth (ft)'));
ok('same viewBox both units', svg.match(/viewBox="[^"]+"/)[0] === svgFt.match(/viewBox="[^"]+"/)[0]);
// highlight
ok('highlight stroke applied', W.renderWellboreSVG(wbFull, {unit:'m', highlightId:'plug:0'}).includes('stroke-width="2.5"'));
// sparse fixtures never throw
ok('td-only renders', W.renderWellboreSVG({td: 900}, {unit:'m'}).startsWith('<svg'));
eq('no td → empty string', W.renderWellboreSVG({casings:[]}, {unit:'m'}), '');
eq('null → empty string', W.renderWellboreSVG(null, {unit:'m'}), '');
```

- [ ] **Step 2: Run to verify the new tests fail** (stub returns `''`).
- [ ] **Step 3: Implement `renderWellboreSVG`** per the drawing contract (string concatenation only; helper `esc()` for text; all coordinates via `depthScale(wb.td, plotHeight)`).
- [ ] **Step 4: Green** — `node tools/wellbore.test.js` all ok; syntax gate.
- [ ] **Step 5: Commit** — `git commit -am "feat(schematic): pure SVG wellbore renderer"`

---

### Task 3: Detail-tab UI — mount, tooltips, click/selection, legend, stats, unit toggle, empty state

**Files:**
- Modify: `index.html` — new `/* ===== WELLBORE UI ===== */` section after the pure section; dossier template in `openDetail` (insert full-width section AFTER the closing `</div>` of the `grid2` block, BEFORE the `actions-row` div); CSS additions next to existing `.grid2` rules.

**Interfaces:**
- Consumes: `Wellbore.renderWellboreSVG`, `Wellbore.wellboreStats`, `Wellbore.mToFt`; `w2.wellbore`; existing `#tooltip` element + `escapeHtml`.
- Produces (Tasks 4 & 7 rely on): `mountWellboreSchematic(host, wb, licence)` — renders card + right panel into `host`, wires everything; module-level `let schemUnit` persisted at key `lwms:schemUnit`; the live SVG element carries id `#wbSvg`; selection state via `data-id` + a `selectWbElement(id)` function; the card's toolbar has container `#wbToolbar` (Task 7 adds export buttons into it).

- [ ] **Step 1: Dossier hook** — in `openDetail`'s template, after the `grid2` closing `</div>` and before `<div class="actions-row"...>`, insert exactly:

```js
    <div id="wbSection" style="margin-top:14px"></div>
```

and AFTER the `panel.innerHTML = \`...\`` assignment completes, add:

```js
  mountWellboreSchematic(document.getElementById('wbSection'), w2.wellbore, w2.licence);
```

- [ ] **Step 2: Implement `mountWellboreSchematic`** in the UI section. Requirements (all in this one function + small helpers):
  - No data (`!wb || !(wb.td>0)`): render `<div class="panel"><h2>Wellbore Schematic</h2><div class="empty">No construction records — paste an abandonment report in Edit, or push this well from the 3D Reviewer.</div></div>`; return.
  - With data: two-column card layout — add CSS:

```css
.wb-grid{display:grid;grid-template-columns:1.4fr .6fr;gap:16px}
@media (max-width:900px){.wb-grid{grid-template-columns:1fr}}
.wb-legend div{display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;border-radius:6px}
.wb-legend .sw{width:14px;height:14px;border-radius:3px;flex:none}
.wb-legend div:hover,.wb-legend div.on{background:var(--field)}
#wbSvg{width:100%;height:auto;display:block;touch-action:none}
```

  - Header row: `<h2>Wellbore Schematic</h2>` + right-aligned toolbar `#wbToolbar` containing the unit toggle (two-button segmented control `m | ft`; active gets class `on`; persists to `localStorage['lwms:schemUnit']`; toggling re-renders the SVG + stats + tooltips in the new unit, preserving the current viewBox).
  - Left: the SVG from `renderWellboreSVG(wb, {unit: schemUnit})` injected via `innerHTML`, root given `id="wbSvg"`.
  - Right: Legend card (one row per component kind PRESENT in the data, swatch in the kind's color; hover/click on a row toggles class `on` and dims all SVG elements of other kinds via opacity), Statistics card (all §6 stats via `wellboreStats`, formatted in the active unit + `%`), Selection card (`#wbSel`, initially "Click a component…").
  - Tooltips: `mouseover`/`mousemove` on `#wbSvg` — if `event.target.closest('[data-id]')`, show the existing `#tooltip` element with the element's `aria-label` text; hide on `mouseout`. (Native `<title>` remains as fallback/a11y.)
  - Click: `selectWbElement(id)` — re-render SVG with `highlightId:id` (preserving viewBox), fill `#wbSel` with a definition list of ALL fields of the underlying object (resolve `kind:index` → the array item; depths shown in active unit, missing fields as `—`). Clicking blank SVG space clears selection.
- [ ] **Step 3: Syntax gate + node tests still green** (`node tools/wellbore.test.js` — pure section untouched but markers must still match).
- [ ] **Step 4: Commit** — `git commit -am "feat(schematic): dossier mount — layout, legend, stats, selection, tooltips, unit toggle"`

---

### Task 4: Zoom, pan, jump-to-depth, keyboard, ARIA

**Files:**
- Modify: `index.html` (inside `mountWellboreSchematic` / UI section)

**Interfaces:**
- Consumes: `#wbSvg` (Task 3), its original `viewBox="0 0 W H"`.
- Produces: wheel zoom, drag pan, dblclick reset, `#wbJump` depth input in the toolbar; keyboard support.

- [ ] **Step 1: Implement viewBox interactions** — exact math (vb = `[x,y,w,h]` array mirrored to the attribute):

```js
  let vb = [0, 0, VBW, VBH];               // VBW/VBH parsed from the rendered root once
  const applyVB = () => svgEl.setAttribute('viewBox', vb.join(' '));
  svgEl.addEventListener('wheel', e => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 0.85 : 1/0.85;
    const r = svgEl.getBoundingClientRect();
    const mx = vb[0] + (e.clientX - r.left) / r.width * vb[2];
    const my = vb[1] + (e.clientY - r.top) / r.height * vb[3];
    vb = [mx - (mx - vb[0]) * f, my - (my - vb[1]) * f, vb[2] * f, vb[3] * f];
    applyVB();
  }, { passive: false });
  let pan = null;
  svgEl.addEventListener('pointerdown', e => { pan = { x: e.clientX, y: e.clientY, vb: [...vb] }; svgEl.setPointerCapture(e.pointerId); });
  svgEl.addEventListener('pointermove', e => {
    if (!pan) return;
    const r = svgEl.getBoundingClientRect();
    vb[0] = pan.vb[0] - (e.clientX - pan.x) / r.width * vb[2];
    vb[1] = pan.vb[1] - (e.clientY - pan.y) / r.height * vb[3];
    applyVB();
  });
  svgEl.addEventListener('pointerup', e => {
    const moved = pan && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) > 5;
    pan = null;
    if (moved) suppressNextClick = true;   // drag must not trigger selection click
  });
  svgEl.addEventListener('pointercancel', () => { pan = null; });
  svgEl.addEventListener('dblclick', () => { vb = [0, 0, VBW, VBH]; applyVB(); });
```

  Selection `click` handler (Task 3) gains `if (suppressNextClick) { suppressNextClick = false; return; }` at its top. Re-renders (unit toggle, highlight) re-apply the current `vb` after swapping the SVG.
- [ ] **Step 2: Jump-to-depth** — toolbar input `#wbJump` (placeholder `Go to depth…`); on Enter: parse number in active unit → metres → `yTarget = depthScale.yOf(m)` in original coords → set `vb[1] = yTarget - vb[3]/2` (clamped to `[0, VBH - vb[3]]`), keep zoom; `applyVB()`.
- [ ] **Step 3: Keyboard + ARIA** — `svgEl.tabIndex = 0; svgEl.setAttribute('role','group'); svgEl.setAttribute('aria-label', 'Interactive wellbore schematic for ' + licence)`; keydown: arrows pan by `vb[3]*0.1` (preventDefault), `+`/`-` zoom about center ×0.85, `0` reset. Legend rows get `tabindex="0"` + Enter toggles. Visible focus: CSS `#wbSvg:focus{outline:2px solid var(--accent, #3aa0ff);outline-offset:2px}`.
- [ ] **Step 4: Syntax gate; commit** — `git commit -am "feat(schematic): zoom/pan/jump-to-depth + keyboard and ARIA"`

---

### Task 5: Rows editor + paste-parse in the well form

**Files:**
- Modify: `index.html` — form markup after the Recommended Action block (added 2026-08-07, `#f_recAction`); UI-section functions; `readForm`, `editWell`, `resetForm`.

**Interfaces:**
- Consumes: `Wellbore.parseWellboreReport`; existing form flow (`readForm` builds `w`, `editWell` prefials, `resetForm` clears).
- Produces: `w.wellbore` on save (absent when the section is empty); form section container `#wbEditor`; functions `wbEditorLoad(wb)`, `wbEditorRead() → wellbore|null`.

- [ ] **Step 1: Markup** — after the Recommended Action div in the form grid:

```html
        <div style="grid-column:1/-1"><details id="wbEditorWrap"><summary style="cursor:pointer;font-weight:700">Wellbore Construction (schematic)</summary>
          <div id="wbEditor" style="margin-top:8px"></div>
          <label style="margin-top:10px">Paste abandonment report…</label>
          <textarea id="wbPaste" rows="4" placeholder="Plug #1  3658–3277 ft  170 sacks cement  2% CaCl2 …"></textarea>
          <div class="row" style="gap:8px;margin-top:6px"><button type="button" class="ghost" onclick="wbParsePaste()">Parse into rows</button><span id="wbParseWarn" style="font-size:11px;color:var(--muted)"></span></div>
        </details></div>
```

- [ ] **Step 2: Implement the editor** (UI section). `wbEditorLoad(wb)` renders into `#wbEditor`: TD + KB number inputs; then one repeatable-rows block per list — casings (name/OD mm/grade/weight kg·m/top/shoe/TOC), plugs (#/kind select cement·bridge·cibp/top/bottom/sacks/additives/notes), perforations (top/bottom/status), formations (name/top), packers (depth), zones (kind select salt·hydrocarbon/top/bottom) — each block titled, each row ending in a `✕` remove button, each block ending in `+ Add <thing>`. All inputs `data-wb` attributes so `wbEditorRead()` can serialize generically. `wbEditorRead()`: returns `null` when TD empty and every list empty; otherwise the §2 object — numeric coercion, drop rows with no numeric depth (count them into an inline warning span), swap top/bottom when inverted, set `source` per the tracked flag (`'parsed'` set by `wbParsePaste`, flipped to `'manual'` by any `input` event inside `#wbEditor`).
  `wbParsePaste()`: runs `parseWellboreReport(#wbPaste.value)`; if the editor already has rows → `confirm('Replace the current construction rows with the parsed report?')`; loads result via `wbEditorLoad`, shows `warnings.length` summary + first 3 warnings in `#wbParseWarn`.
- [ ] **Step 3: Wire the form flow** — `editWell`: `wbEditorLoad(w.wellbore || null)` (and `#wbPaste.value=''`); `resetForm`: `wbEditorLoad(null)`; `readForm`: after the `recActionOverride` lines add:

```js
  const wb = wbEditorRead();
  if (wb) w.wellbore = wb; else delete w.wellbore;
```

  Preserve-on-untouched: when the editor was loaded from `w.wellbore` and no `input` event fired inside `#wbEditor`, `wbEditorRead()` must return a deep-equal object (same field values) — achieved naturally by serializing the rows; verify by trace, no special-case code.
- [ ] **Step 4: Syntax gate; node tests green; commit** — `git commit -am "feat(schematic): wellbore construction rows editor + paste-report parsing in well form"`

---

### Task 6: 3D-bridge enrichment (`wellboreFrom3D` + mapFrom3D hook)

**Files:**
- Modify: `index.html` — replace the `wellboreFrom3D` stub in the PURE section; one hook in `mapFrom3D`.
- Test: append to `tools/wellbore.test.js`.

**Interfaces:**
- Consumes: `parseCasingText`, `parseIntervalsText` (Task 1).
- Produces: `wellboreFrom3D(r) → wellbore|null` — pure mapping from a 3D-push row (`r.td`, `r.tvd`, `r.surfaceCasingDepth`, `r.intermediateCasing`, `r.productionCasing`, `r.cementTop`, `r.plugIntervals`, `r.perfIntervals`, `r.formationPenetrated`), `source:'bridge'`; `null` when no positive td/tvd.

- [ ] **Step 1: Failing tests** — append:

```js
// bridge enrichment
const wb3 = W.wellboreFrom3D({ td: 1447.2, surfaceCasingDepth: 186, productionCasing: 'None — open hole below surface casing', cementTop: null, plugIntervals: 'No plug records on file', perfIntervals: '', formationPenetrated: 'Wabamun' });
eq('bridge td', wb3.td, 1447.2);
eq('bridge surface casing', [wb3.casings[0].top_m, wb3.casings[0].shoe_m], [0, 186]);
ok('bridge open hole from text', !!wb3.openHole && wb3.openHole.bottom_m === 1447.2);
ok('bridge formation noted (no depth)', wb3.notes.some(n => /Wabamun/.test(n.text)) && (wb3.formations||[]).length === 0);
eq('bridge source', wb3.source, 'bridge');
const wb4 = W.wellboreFrom3D({ tvd: 1700, productionCasing: 'Production @ 1699.5 m', cementTop: 900, plugIntervals: 'JET 1677–1679 m (Nordegg)' });
eq('bridge fallback tvd', wb4.td, 1700);
eq('bridge TOC on deepest casing', wb4.casings.find(c=>c.shoe_m===1699.5).toc_m, 900);
eq('bridge plug parsed', wb4.plugs.length, 1);
eq('bridge no td → null', W.wellboreFrom3D({ operator:'X' }), null);
```

- [ ] **Step 2: Red** — run; the stub returns null for everything → several FAILs.
- [ ] **Step 3: Implement `wellboreFrom3D`** per spec §3 (surface casing from depth; intermediate/production through `parseCasingText`; open-hole text → openHole from surface shoe (or 0) to td; `cementTop` → `toc_m` on the deepest casing; intervals through `parseIntervalsText`; `formationPenetrated` → note).
- [ ] **Step 4: Hook mapFrom3D** — in the returned object of `mapFrom3D` (next to `recActionOverride: prev?.recActionOverride || '',`) add:

```js
    wellbore: (prev?.wellbore && prev.wellbore.source !== 'bridge') ? prev.wellbore : (Wellbore.wellboreFrom3D(r) || prev?.wellbore),
```

  (Manual/parsed data always wins; bridge data refreshes bridge data; a push with no construction data keeps whatever existed.)
- [ ] **Step 5: Green + gate; commit** — `git commit -am "feat(schematic): 3D-bridge enrichment builds wellbore data; manual edits never overwritten"`

---

### Task 7: Export SVG / PNG / Print

**Files:**
- Modify: `index.html` (UI section; toolbar `#wbToolbar`; print CSS)

**Interfaces:**
- Consumes: current `wb`, `schemUnit`, existing `download(name, text, mime)` helper (io section), licence string.

- [ ] **Step 1: Toolbar buttons** — into `#wbToolbar` (after the unit toggle): `SVG`, `PNG`, `Print` ghost buttons.
- [ ] **Step 2: Implement** —

```js
  function wbExportSvgText(){
    const colors = getComputedStyle(document.documentElement);
    const resolved = { line: colors.getPropertyValue('--line').trim() || '#26334a', muted: colors.getPropertyValue('--muted').trim() || '#9fb0cf', ink: colors.getPropertyValue('--ink').trim() || '#e7eefc', bg: colors.getPropertyValue('--panel').trim() || '#0e1830' };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + renderWellboreSVG(wb, { unit: schemUnit, resolvedColors: resolved });
  }
  // SVG button: download(`wellbore-${licence}.svg`, wbExportSvgText(), 'image/svg+xml')
  // PNG button:
  function wbExportPng(){
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width * 2; c.height = img.height * 2;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png'); a.download = `wellbore-${licence}.png`; a.click();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wbExportSvgText());
  }
```

  `renderWellboreSVG` (already accepting `resolvedColors`) must substitute them for the `var(--…)` structural colors when provided — verify Task 2 implemented that; if it ignored `resolvedColors`, fix it here and extend a renderer test: `ok('resolvedColors inlined', !W.renderWellboreSVG(wbFull,{unit:'m',resolvedColors:{line:'#123456'}}).includes('var(--'))`.
  Print: button calls `window.print()`; CSS `@media print { body > *:not(#tab-detail){display:none!important} #tab-detail *{visibility:hidden} #wbSection, #wbSection *{visibility:visible} #wbSection{position:absolute;top:0;left:0;width:100%} }`.
- [ ] **Step 3: Gate + tests green; commit** — `git commit -am "feat(schematic): export SVG/PNG and print stylesheet"`

---

### Task 8: Human checklist, PR

- [ ] **Step 1: Full local run** — `node tools/wellbore.test.js` green; `node tools/scoring.test.js` still green; syntax gate green.
- [ ] **Step 2: Human checklist (local file, Load Demo + one 3D push if possible)** — spec §12 items: bridged well renders; paste→rows→save round-trip; rows editor add/edit/remove; empty state; tooltips/click/legend dim; zoom/pan/dblclick/jump; unit toggle consistency; dark mode; export PNG/SVG/print; second-profile sync carries `wellbore`; wells without data unchanged; existing dossier features (score breakdown, recommended action, PDF) untouched.
- [ ] **Step 3 (controller): push branch, open PR** — user merges; merge auto-deploys.
