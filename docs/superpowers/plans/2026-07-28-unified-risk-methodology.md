# Unified Risk Methodology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Appendix-D sum-scoring model in both the register (`index.html`) and the 3D Reviewer (`3d-reviewer.html`) with the approved unified AER D065/D020 + EPA Class VI weighted L×C methodology, driven by a shared `scoring.js` engine and an admin-tunable, versioned `methodology.json`.

**Architecture:** A dependency-free `scoring.js` (browser global `WellScoring` + CommonJS export) holds the entire rulebook logic: the baked-in fallback methodology, validation, weighted L/C computation, matrix banding, v1→v2 migration, reviewer-field derivation, and a golden-vector self-test. Both HTML apps include it via `<script src="scoring.js">` and load the live rulebook from `methodology.json` (synced through the existing GitHub-API flow). `wells.json` migrates to schema v2 once, at deploy time, via a Node script.

**Tech Stack:** Vanilla JS (ES2020), no build step, no new CDN dependencies. Chart.js/jsPDF already loaded by `index.html`. Node (any ≥16) only for tests and the migration CLI in `tools/`.

**Spec:** `docs/superpowers/specs/2026-07-28-unified-risk-methodology-design.md` — §2 parameter tables are the normative rulebook content.

## Global Constraints

- No build step; all files are served raw from the repo root (GitHub Pages + `file://` double-click must both work).
- `scoring.js` must never touch the DOM and must work in both browser and Node (`module.exports` + `global.WellScoring`).
- Weights per axis must sum to 1.00 ± 0.001; matrix bands must cover every product value 1–25 exactly once. `validateMethodology` enforces both.
- Methodology revision constants: v1 model = `"1.0.0"`, new rulebook = `"2.0.0"`. Well schema marker: `schema: 2`.
- Unknown parameter score is stored as `null`; the engine substitutes that parameter's `unknownScore` at compute time (spec §8).
- Rounding: `Math.round` (x.5 rounds up) for Lr/Cr; `riskScore = Math.round((riskIndex−1)/24×100)`; `integrity = 100 − riskScore`.
- **The shared register is LIVE** — teammates commit to `wells.json` on `origin/main`. Never push `wells.json` or any branch to origin as part of this plan; the final deploy (Task 11) has an explicit user gate.
- Work on the existing branch `design/unified-risk-methodology`. Keep `.vercel/` and `.gitignore` untouched.
- All work happens in repo root `/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard` (quote the path in shell commands — it contains a space).

## Testing Approach

All *logic* lives in `scoring.js` and gets classic TDD via `node tools/scoring.test.js` (a tiny assert harness, no framework). The two HTML files are *wiring only*; they are verified by (a) grep assertions that dead v1 identifiers are gone, (b) `runSelfTest()` in the browser console of BOTH apps, and (c) the manual checklist in Task 10. Do not attempt DOM unit tests.

## File Structure

- **Create `scoring.js`** (~450 lines) — the entire methodology engine + fallback rulebook + self-test. Single source of truth; zero DOM.
- **Create `tools/scoring.test.js`** — Node test runner asserting golden vectors, validation, migration, derivation, revision bumping.
- **Create `methodology.json`** — live rulebook, generated from `scoring.js`'s fallback (parity enforced by test).
- **Create `tools/migrate-v1.js`** — deploy-time CLI: reads `wells.json` (v1), prints the old-tier → new-rank shift table, writes v2 with `--write`.
- **Modify `index.html`** (1,885 lines) — engine swap, 1–5 form with unknown, L/C/rank displays, matrix/charts/detail/CSV/PDF/bridge updates, methodology admin panel + sync, badges.
- **Modify `3d-reviewer.html`** (24,875 lines; app code = the `// src/*.js` sections, lines ~627–1700 and ~24000–24875) — 11 score fields, `computeRisk` adapter over the shared engine, live methodology page, lossless bridge.
- **Modify `README.md`** — methodology + admin docs.

---

### Task 1: `scoring.js` engine + golden-vector tests

**Files:**
- Create: `scoring.js`
- Test: `tools/scoring.test.js`

**Interfaces:**
- Consumes: nothing (foundation task).
- Produces (exact API used by every later task):
  - `WellScoring.CURRENT_SCHEMA` = `2`; `WellScoring.V1_REVISION` = `'1.0.0'`
  - `WellScoring.FALLBACK_METHODOLOGY` — full rulebook object, `revision: '2.0.0'`
  - `WellScoring.paramsOf(m, axis?)` → param array (`axis` `'L'`|`'C'`|omitted)
  - `WellScoring.validateMethodology(m)` → `{ok, errors: string[]}`
  - `WellScoring.computeWell(scores, m)` → `{L, C, Lr, Cr, cell, riskIndex, rank:{min,max,label,cls,color}, riskScore, integrity}` (`scores` values `1..5` or `null`)
  - `WellScoring.bandFor(cell, m)` → band object
  - `WellScoring.anchorText(param, v)` → string (handles 2, 4, `null`)
  - `WellScoring.scoreLabelToValue(s)` → `1..5 | null`
  - `WellScoring.isV1Well(w)` / `WellScoring.migrateV1(w, m)` / `WellScoring.normalizeWell(w, m)` / `WellScoring.v1TierFor(total)`
  - `WellScoring.deriveScoresFromReviewer(r)` → scores object
  - `WellScoring.bumpRevision(oldM, newM)` → semver string
  - `WellScoring.GOLDEN_VECTORS` / `WellScoring.runSelfTest()` → `{pass, failures: string[], summary}`
  - `WellScoring.loadMethodology(url)` → `Promise<{methodology, source:'remote'|'fallback', error?}>`

- [ ] **Step 1: Write the failing test**

Create `tools/scoring.test.js`:

```js
// Node test harness for scoring.js — run: node tools/scoring.test.js
const path = require('path');
const S = require(path.join(__dirname, '..', 'scoring.js'));
let failures = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failures++; console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`); }
  else console.log(`ok   ${name}`);
};

const M = S.FALLBACK_METHODOLOGY;

// --- methodology sanity ---
eq('fallback revision', M.revision, '2.0.0');
eq('fallback validates', S.validateMethodology(M).ok, true);
eq('11 params', M.params.length, 11);
eq('L weight sum', +S.paramsOf(M,'L').reduce((a,p)=>a+p.weight,0).toFixed(3), 1);
eq('C weight sum', +S.paramsOf(M,'C').reduce((a,p)=>a+p.weight,0).toFixed(3), 1);

// --- validation catches broken input ---
const bad = JSON.parse(JSON.stringify(M)); bad.params[0].weight = 0.5;
eq('bad weights rejected', S.validateMethodology(bad).ok, false);
const badBands = JSON.parse(JSON.stringify(M)); badBands.matrix.bands[0].max = 3;
eq('band gap rejected', S.validateMethodology(badBands).ok, false);

// --- golden vectors (hand-computed in the spec/plan) ---
const all = v => Object.fromEntries(M.params.map(p => [p.key, v]));
const pick = c => ({ L:c.L, C:c.C, Lr:c.Lr, Cr:c.Cr, cell:c.cell, riskIndex:c.riskIndex, rank:c.rank.label, integrity:c.integrity });

eq('V1 best-case', pick(S.computeWell(all(1), M)),
   { L:1, C:1, Lr:1, Cr:1, cell:1, riskIndex:1, rank:'Low', integrity:100 });
eq('V2 worst-case', pick(S.computeWell(all(5), M)),
   { L:5, C:5, Lr:5, Cr:5, cell:25, riskIndex:25, rank:'Very High', integrity:0 });
eq('V3 unknown-heavy', pick(S.computeWell(all(null), M)),
   { L:4.24, C:3.6, Lr:4, Cr:4, cell:16, riskIndex:15.26, rank:'High', integrity:41 });
eq('V5 band-boundary', pick(S.computeWell(all(3), M)),
   { L:3, C:3, Lr:3, Cr:3, cell:9, riskIndex:9, rank:'Moderate', integrity:67 });

// --- V4: migration of a real v1 well (W-W8QB2S from wells.json) ---
const v1well = { id:'W-TEST', licence:'100/13-06-055-22W4/00', klass:'Type 1',
  scores:{ plug:5, barriers:3, cement:5, prox:1, depthR:5, depthC:5, age:5, access:1, data:5 }, total:35 };
eq('isV1Well', S.isV1Well(v1well), true);
const mig = S.migrateV1(v1well, M);
eq('V4 migrated scores', mig.scores,
   { plugQuality:5, cement:5, barriers:3, scvf:null, age:5, complexity:null, data:5,
     penetration:5, plume:1, usdw:null, access:1 });
eq('V4 migrated computed', { L:mig.computed.L, C:mig.computed.C, cell:mig.computed.cell,
   riskIndex:mig.computed.riskIndex, rank:mig.computed.rankLabel, integrity:mig.computed.integrity },
   { L:4.24, C:2.7, cell:12, riskIndex:11.45, rank:'High', integrity:56 });
eq('V4 flags', { schema:mig.schema, scoredUnder:mig.scoredUnder, needsReview:mig.needsReview,
   legacyTotal:mig.legacy.total, totalGone:!('total' in mig) },
   { schema:2, scoredUnder:'1.0.0', needsReview:true, legacyTotal:35, totalGone:true });
eq('v1 tier of 35', S.v1TierFor(35).label, 'High');

// --- normalizeWell passes v2 through and recomputes ---
const norm = S.normalizeWell(mig, M);
eq('normalize keeps v2', norm.scoredUnder, '1.0.0');
eq('normalize recomputes', norm.computed.riskIndex, 11.45);

// --- reviewer derivation ---
eq('derive: modern verified well',
   S.deriveScoresFromReviewer({ pluggingStatus:'Plugged & Verified', cementQuality:'Excellent',
     casingStrings:2, drillingYear:2010, orientation:'Vertical', status:'Abandoned',
     caprockPenetrated:false, reservoirPenetrated:false, distToInjector:5000, distToAorBoundary:-200 }),
   { plugQuality:1, cement:1, barriers:1, scvf:null, age:1, complexity:1, data:1,
     penetration:1, plume:1, usdw:3, access:1 });
eq('derive: unknown orphan',
   S.deriveScoresFromReviewer({ pluggingStatus:'Unknown', cementQuality:'Unknown',
     casingStrings:null, drillingYear:null, orientation:'Deviated', status:'Orphaned',
     caprockPenetrated:true, reservoirPenetrated:true, distToInjector:400, distToAorBoundary:600 }),
   { plugQuality:null, cement:null, barriers:null, scvf:null, age:null, complexity:3, data:5,
     penetration:5, plume:5, usdw:null, access:5 });

// --- anchor text ---
eq('anchorText 2', S.anchorText(M.params[0], 2), 'Judgment call between the 1 and 3 anchors');
eq('anchorText null', S.anchorText(M.params[0], null), 'Unknown — scores as 5');

// --- CSV label parsing ---
eq('labels', ['low','Medium','HIGH','2','4','?','',undefined].map(S.scoreLabelToValue),
   [1,3,5,2,4,null,null,null]);

// --- revision bump ---
const wChange = JSON.parse(JSON.stringify(M)); wChange.params[0].weight = 0.24; wChange.params[1].weight = 0.18;
eq('weight change → minor', S.bumpRevision(M, wChange), '2.1.0');
const tChange = JSON.parse(JSON.stringify(M)); tChange.params[0].anchors[3] = 'reworded';
eq('text change → patch', S.bumpRevision(M, tChange), '2.0.1');

// --- built-in self test agrees ---
eq('runSelfTest passes', S.runSelfTest().pass, true);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASS');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard" && node tools/scoring.test.js`
Expected: FAIL — `Cannot find module '.../scoring.js'`

- [ ] **Step 3: Write `scoring.js`**

Create `scoring.js` in the repo root. Anchor/desc/refs text comes verbatim from spec §2; `wellTypes` is copied from `KLASS_DEFS` in `index.html:487-497`.

```js
/* scoring.js — Unified legacy-well risk engine (shared by index.html and 3d-reviewer.html).
   Zero dependencies, no DOM. Browser: window.WellScoring. Node: module.exports.
   Normative methodology: docs/superpowers/specs/2026-07-28-unified-risk-methodology-design.md §2. */
(function (global) {
'use strict';

const CURRENT_SCHEMA = 2;
const V1_REVISION = '1.0.0';

const FALLBACK_METHODOLOGY = {
  revision: '2.0.0',
  updatedBy: 'Tahir Chisti',
  updatedAt: '2026-07-28T00:00:00Z',
  params: [
    { key:'plugQuality', name:'Abandonment & Plug Quality', axis:'L', weight:0.22,
      desc:'Verified modern plugs vs. missing/unverifiable',
      anchors:{ 1:'Abandoned to current D020 / Class VI standard; verified plugs across storage complex',
                3:'Era-standard abandonment; plugs present but unverified (no tag/log)',
                5:'Improper abandonment; bridge-plug-only / welded-cap era; plugs missing' },
      unknownScore:5, refs:['AER D020 §3','40 CFR 146.84(c)','Arbad et al. 2024'] },
    { key:'cement', name:'Cement Coverage & Quality', axis:'L', weight:0.20,
      desc:'TOC and cement quality vs. seals and BGWP/USDW base',
      anchors:{ 1:'Returns/CBL confirm coverage across primary seal and to surface-casing shoe',
                3:'TOC below a required seal, or quality unverified (no CBL/VDL)',
                5:'Known uncemented interval across a seal or across BGWP/USDW base; no cement records' },
      unknownScore:5, refs:['AER D020','40 CFR 146.84(c)','Watson & Bachu 2009'] },
    { key:'barriers', name:'Barriers Across Flow Zones', axis:'L', weight:0.12,
      desc:'Independent permanent barriers per flow zone',
      anchors:{ 1:'≥2 independent verified barriers per flow zone',
                3:'Single barrier somewhere',
                5:'No barrier across ≥1 flow zone' },
      unknownScore:3, refs:['AER D020','CSA Z741'] },
    { key:'scvf', name:'SCVF / Gas Migration History', axis:'L', weight:0.16,
      desc:'Surface casing vent flow / gas migration test history',
      anchors:{ 1:'Tested; none reported',
                3:'Historical SCVF/GM repaired & verified, or never tested',
                5:'Active or unrepaired SCVF/GM' },
      unknownScore:3, refs:['Watson & Bachu 2009 (top predictor)','AER ID 2003-01'] },
    { key:'age', name:'Well Age & Regulatory Era', axis:'L', weight:0.10,
      desc:'Drilling year as a proxy for cementing/abandonment practice vintage',
      anchors:{ 1:'Post-1995',
                3:'1965–1995',
                5:'Pre-1965 or unknown spud date' },
      unknownScore:5, refs:['Watson & Bachu 2009 era analysis','Arbad et al. 2024'] },
    { key:'complexity', name:'Wellbore Complexity & Condition', axis:'L', weight:0.10,
      desc:'Deviation, sour/oil service history, casing condition',
      anchors:{ 1:'Vertical, sweet, simple completion',
                3:'Deviated, or sour/oil-producer history, or suspected casing issues',
                5:'Multiple factors, or known casing failure/corrosion' },
      unknownScore:3, refs:['Watson & Bachu 2009','AER D065 wellbore review'] },
    { key:'data', name:'Data Confidence', axis:'L', weight:0.10,
      desc:'Completeness of drilling/completion/abandonment records',
      anchors:{ 1:'Complete records incl. logs',
                3:'Partial / incomplete',
                5:'None or analog only' },
      unknownScore:5, refs:['40 CFR 146.84(c)','Arbad public-data method'] },
    { key:'penetration', name:'Penetration vs Storage Complex', axis:'C', weight:0.30,
      desc:'Deepest penetration relative to primary seal and storage reservoir',
      anchors:{ 1:'Does not reach primary seal (Types 8–9)',
                3:'Penetrates primary seal, not reservoir (Types 4–7)',
                5:'Intersects storage reservoir (Types 1–3)' },
      unknownScore:5, refs:['Type classification (GD-40 / Arbad)','40 CFR 146.84','AER D065 AOR'] },
    { key:'plume', name:'Position vs Plume & Pressure Front', axis:'C', weight:0.25,
      desc:'Position relative to the modeled CO₂ plume and pressure front (AoR)',
      anchors:{ 1:'Outside modeled pressure front (AoR). No model yet: > 3.2 km from injector',
                3:'Inside pressure front, outside plume. No model yet: 1.6 – 3.2 km',
                5:'Inside modeled CO₂ plume extent. No model yet: < 1.6 km' },
      unknownScore:3, refs:['40 CFR 146.84(a) AoR modeling','AER D065'] },
    { key:'usdw', name:'Groundwater (USDW/BGWP) Isolation', axis:'C', weight:0.25,
      desc:'Barrier status across the protected groundwater interval',
      anchors:{ 1:'Verified isolation across BGWP/USDW base (surface casing + cement, or plugs)',
                3:'Unverified',
                5:'Known open pathway at the groundwater interval' },
      unknownScore:3, refs:['AER D020 non-saline protection','EPA USDW mandate'] },
    { key:'access', name:'Corrective-Action Accessibility', axis:'C', weight:0.20,
      desc:'Feasibility of re-entry / re-abandonment if intervention is needed',
      anchors:{ 1:'Licensee active; surface access; re-entry feasible',
                3:'Suspended / no marker / constrained access',
                5:'Orphaned, unknown location, or re-entry infeasible' },
      unknownScore:3, refs:['40 CFR 146.84(d) corrective action','AER orphan registry'] },
  ],
  matrix: { bands: [
    { min:1,  max:4,  label:'Low',       cls:'low',  color:'#1fbf75' },
    { min:5,  max:9,  label:'Moderate',  cls:'mod',  color:'#f0a93b' },
    { min:10, max:16, label:'High',      cls:'high', color:'#e85a4f' },
    { min:17, max:25, label:'Very High', cls:'crit', color:'#a8324a' },
  ]},
  wellTypes: {
    'Type 1': {short:'No records — undocumented construction', desc:'No documentation available, minimal or no records; only drilling is known. Construction details are absent, so schematics cannot be produced.', prot:'Unknown'},
    'Type 2': {short:'Thru seal + reservoir — nothing protected', desc:'Penetrates both the primary geologic seal and storage reservoir.', prot:'No protection for groundwater/USDWs, primary geologic seal, or storage reservoir.'},
    'Type 3': {short:'Thru seal + reservoir — groundwater only', desc:'Penetrates both the primary geologic seal and storage reservoir.', prot:'Protection for groundwater/USDWs only; no protection for primary geologic seal or storage reservoir.'},
    'Type 4': {short:'Thru seal + reservoir — groundwater + seal', desc:'Penetrates both the primary geologic seal and storage reservoir.', prot:'Protection for groundwater/USDWs and primary geologic seal; storage reservoir not protected.'},
    'Type 5': {short:'Thru seal only — nothing protected', desc:'Penetrates only the primary geologic seal.', prot:'No protection for groundwater/USDWs or primary geologic seal.'},
    'Type 6': {short:'Thru seal only — groundwater protected', desc:'Penetrates only the primary geologic seal.', prot:'Protection for groundwater/USDWs; primary geologic seal not protected.'},
    'Type 7': {short:'Thru seal + reservoir — fully protected', desc:'Penetrates both the primary geologic seal and storage reservoir.', prot:'Protection for groundwater/USDWs, primary geologic seal, and storage reservoir.'},
    'Type 8': {short:'Thru seal only — groundwater + seal', desc:'Penetrates only the primary geologic seal.', prot:'Protection for groundwater/USDWs and primary geologic seal.'},
    'Type 9': {short:'Above seal & reservoir — lowest risk', desc:'Does not penetrate either the primary geologic seal or storage reservoir.', prot:'Dependent on confining-zone integrity; if the confining zone is intact, represents the lowest level of risk.'},
  },
};

const V1_TIERS = [
  { min:9,  max:18, label:'Low',       cls:'low'  },
  { min:19, max:30, label:'Moderate',  cls:'mod'  },
  { min:31, max:40, label:'High',      cls:'high' },
  { min:41, max:45, label:'Very High', cls:'crit' },
];
function v1TierFor(total){ return V1_TIERS.find(t=>total>=t.min && total<=t.max) || V1_TIERS[0]; }

function paramsOf(m, axis){ return m.params.filter(p => !axis || p.axis === axis); }

function validateMethodology(m){
  const errors = [];
  if (!m || typeof m !== 'object' || !Array.isArray(m.params))
    return { ok:false, errors:['methodology is not a valid object'] };
  if (!/^\d+\.\d+\.\d+$/.test(String(m.revision||''))) errors.push('revision must be semver (e.g. 2.0.0)');
  const wantKeys = FALLBACK_METHODOLOGY.params.map(p=>p.key);
  const haveKeys = m.params.map(p=>p.key);
  for (const k of wantKeys) if (!haveKeys.includes(k)) errors.push('missing param: '+k);
  for (const axis of ['L','C']) {
    const sum = paramsOf(m, axis).reduce((a,p)=>a+(+p.weight||0), 0);
    if (Math.abs(sum-1) > 0.001) errors.push(axis+' weights sum to '+sum.toFixed(3)+' — must be 1.00');
  }
  for (const p of m.params) {
    if (!(p.anchors && p.anchors[1] && p.anchors[3] && p.anchors[5])) errors.push(p.key+': anchors for 1/3/5 are required');
    if (![1,2,3,4,5].includes(p.unknownScore)) errors.push(p.key+': unknownScore must be 1–5');
  }
  const bands = (m.matrix && m.matrix.bands) || [];
  const covered = new Array(26).fill(0);
  for (const b of bands) for (let v = b.min; v <= b.max; v++) if (v>=1 && v<=25) covered[v]++;
  for (let v = 1; v <= 25; v++) if (covered[v] !== 1) {
    errors.push('matrix bands must cover 1–25 exactly once (value '+v+' covered '+covered[v]+'×)');
    break;
  }
  return { ok: errors.length === 0, errors };
}

function resolveScore(p, v){ return (typeof v === 'number' && v >= 1 && v <= 5) ? v : p.unknownScore; }

function axisScore(scores, m, axis){
  return paramsOf(m, axis).reduce((a,p)=>a + p.weight * resolveScore(p, scores ? scores[p.key] : null), 0);
}

function bandFor(cell, m){
  return m.matrix.bands.find(b => cell >= b.min && cell <= b.max) || m.matrix.bands[m.matrix.bands.length-1];
}

function computeWell(scores, m){
  const rawL = axisScore(scores, m, 'L'), rawC = axisScore(scores, m, 'C');
  const Lr = Math.round(rawL), Cr = Math.round(rawC);
  const cell = Lr * Cr;
  const riskIndex = +(rawL * rawC).toFixed(2);
  const rank = bandFor(cell, m);
  const riskScore = Math.round((riskIndex - 1) / 24 * 100);
  return { L:+rawL.toFixed(2), C:+rawC.toFixed(2), Lr, Cr, cell, riskIndex, rank, riskScore, integrity:100-riskScore };
}

function anchorText(p, v){
  if (v === null || v === undefined) return 'Unknown — scores as ' + p.unknownScore;
  if (p.anchors[v]) return p.anchors[v];
  return v === 2 ? 'Judgment call between the 1 and 3 anchors'
                 : 'Judgment call between the 3 and 5 anchors';
}

function scoreLabelToValue(s){
  if (s === null || s === undefined) return null;
  const v = String(s).trim().toLowerCase();
  if (!v || v === '?' || v === 'unknown' || v === 'u') return null;
  if (v === '1' || v === 'low' || v === 'l' || v.startsWith('1')) return 1;
  if (v === '2' || v.startsWith('2')) return 2;
  if (v === '3' || v === 'med' || v === 'medium' || v === 'moderate' || v === 'm' || v.startsWith('3')) return 3;
  if (v === '4' || v.startsWith('4')) return 4;
  if (v === '5' || v === 'high' || v === 'h' || v === 'critical' || v.startsWith('5')) return 5;
  return null;
}

/* ---------- v1 → v2 migration (spec §6) ---------- */
const V1_MAP = { plug:'plugQuality', cement:'cement', barriers:'barriers',
                 age:'age', data:'data', access:'access', prox:'plume' };

function isV1Well(w){ return !!(w && w.scores && Object.prototype.hasOwnProperty.call(w.scores, 'plug')); }

function computedBlock(scores, m){
  const c = computeWell(scores, m);
  return { L:c.L, C:c.C, Lr:c.Lr, Cr:c.Cr, cell:c.cell, riskIndex:c.riskIndex,
           rankLabel:c.rank.label, integrity:c.integrity };
}

function migrateV1(w, m){
  const meth = m || FALLBACK_METHODOLOGY;
  const s = w.scores || {};
  const scores = {};
  for (const p of meth.params) scores[p.key] = null;   // new params start unknown (engine applies unknownScore)
  for (const oldK of Object.keys(V1_MAP)) if (typeof s[oldK] === 'number') scores[V1_MAP[oldK]] = s[oldK];
  const dr = typeof s.depthR === 'number' ? s.depthR : null;
  const dc = typeof s.depthC === 'number' ? s.depthC : null;
  if (dr !== null || dc !== null) scores.penetration = Math.max(dr ?? 1, dc ?? 1);
  const out = { ...w, schema:CURRENT_SCHEMA, scores,
    computed: computedBlock(scores, meth),
    scoredUnder: V1_REVISION, needsReview: true,
    legacy: { scores: { ...s }, total: w.total } };
  delete out.total;
  return out;
}

function normalizeWell(w, m){
  const meth = m || FALLBACK_METHODOLOGY;
  if (isV1Well(w)) return migrateV1(w, meth);
  if (w && w.scores) return { ...w, schema:CURRENT_SCHEMA, computed: computedBlock(w.scores, meth) };
  return w;
}

/* ---------- 3D-Reviewer field derivation (spec §7; one mapping for both apps) ---------- */
function deriveScoresFromReviewer(r){
  const plugMap = { 'Plugged & Verified':1, 'Plugged':3, 'Partially Plugged':4, 'Unplugged':5 };
  const cemMap  = { 'Excellent':1, 'Good':2, 'Fair':3, 'Poor':5 };
  const num = v => (typeof v === 'number' && !Number.isNaN(v)) ? v : null;
  const cs = num(r.casingStrings), yr = num(r.drillingYear);
  const dInj = num(r.distToInjector), dAor = num(r.distToAorBoundary);
  const cemUnknown = r.cementQuality === 'Unknown' || !r.cementQuality;
  const plugUnknown = r.pluggingStatus === 'Unknown' || !r.pluggingStatus;
  let plume;
  if (dAor !== null) plume = dAor > 0 ? ((dInj !== null && dInj < 1600) ? 5 : 3) : 1;
  else if (dInj !== null) plume = dInj < 1600 ? 5 : (dInj <= 3200 ? 3 : 1);
  else plume = null;
  return {
    plugQuality: plugMap[r.pluggingStatus] ?? null,
    cement:      cemMap[r.cementQuality] ?? null,
    barriers:    cs === null ? null : (cs >= 2 ? 1 : (cs === 1 ? 3 : 5)),
    scvf:        null,                                   // no reviewer field — unknown
    age:         yr === null ? null : (yr >= 1995 ? 1 : (yr >= 1965 ? 3 : 5)),
    complexity:  r.orientation === 'Vertical' ? 1 : 3,
    data:        (cemUnknown && plugUnknown) ? 5 : ((cemUnknown || plugUnknown) ? 3 : 1),
    penetration: r.reservoirPenetrated ? 5 : (r.caprockPenetrated ? 3 : 1),
    plume,
    usdw:        (cs !== null && cs > 0) ? 3 : null,     // casing exists → unverified; else unknown
    access:      /orphan/i.test(r.status || '') ? 5 : (/suspend|unknown/i.test(r.status || '') ? 3 : 1),
  };
}

/* ---------- admin revision bump: weights/bands/unknownScore → minor, text → patch ---------- */
function bumpRevision(oldM, newM){
  const sig = m => JSON.stringify(m.params.map(p=>[p.key, p.weight, p.unknownScore]))
                 + JSON.stringify(m.matrix.bands.map(b=>[b.min, b.max]));
  const parts = String(oldM.revision || '2.0.0').split('.').map(n=>parseInt(n,10)||0);
  return sig(oldM) !== sig(newM)
    ? parts[0]+'.'+(parts[1]+1)+'.0'
    : parts[0]+'.'+parts[1]+'.'+(parts[2]+1);
}

/* ---------- golden vectors + self test (spec §9) ---------- */
const GOLDEN_VECTORS = [
  { name:'best-case',      scores:'all-1',    want:{ L:1,    C:1,   cell:1,  riskIndex:1,     rank:'Low',       integrity:100 } },
  { name:'worst-case',     scores:'all-5',    want:{ L:5,    C:5,   cell:25, riskIndex:25,    rank:'Very High', integrity:0   } },
  { name:'unknown-heavy',  scores:'all-null', want:{ L:4.24, C:3.6, cell:16, riskIndex:15.26, rank:'High',      integrity:41  } },
  { name:'band-boundary',  scores:'all-3',    want:{ L:3,    C:3,   cell:9,  riskIndex:9,     rank:'Moderate',  integrity:67  } },
  { name:'migrated-legacy',
    v1: { scores:{ plug:5, barriers:3, cement:5, prox:1, depthR:5, depthC:5, age:5, access:1, data:5 }, total:35 },
    want:{ L:4.24, C:2.7, cell:12, riskIndex:11.45, rank:'High', integrity:56 } },
];

function runSelfTest(m){
  const meth = m || FALLBACK_METHODOLOGY;
  const failures = [];
  const val = validateMethodology(meth);
  if (!val.ok) failures.push('methodology invalid: ' + val.errors.join('; '));
  for (const v of GOLDEN_VECTORS) {
    let c;
    if (v.v1) c = migrateV1({ ...v.v1 }, meth).computed;
    else {
      const fill = v.scores === 'all-1' ? 1 : v.scores === 'all-5' ? 5 : v.scores === 'all-3' ? 3 : null;
      c = computedBlock(Object.fromEntries(meth.params.map(p=>[p.key, fill])), meth);
    }
    const got = { L:c.L, C:c.C, cell:c.cell, riskIndex:c.riskIndex, rank:c.rankLabel, integrity:c.integrity };
    if (JSON.stringify(got) !== JSON.stringify(v.want))
      failures.push(v.name + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(v.want));
  }
  return { pass: failures.length === 0, failures,
           summary: failures.length ? failures.length + ' golden-vector failure(s)' : 'all ' + GOLDEN_VECTORS.length + ' golden vectors pass (rev ' + meth.revision + ')' };
}

/* ---------- live rulebook loader (browser) ---------- */
function loadMethodology(url){
  return fetch(url || 'methodology.json', { cache:'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(m => {
      const val = validateMethodology(m);
      if (!val.ok) throw new Error('invalid methodology: ' + val.errors.join('; '));
      return { methodology: m, source: 'remote' };
    })
    .catch(err => ({ methodology: FALLBACK_METHODOLOGY, source: 'fallback', error: String(err && err.message || err) }));
}

const api = { CURRENT_SCHEMA, V1_REVISION, FALLBACK_METHODOLOGY,
  paramsOf, validateMethodology, resolveScore, axisScore, bandFor, computeWell,
  anchorText, scoreLabelToValue, isV1Well, migrateV1, normalizeWell, v1TierFor,
  deriveScoresFromReviewer, bumpRevision, GOLDEN_VECTORS, runSelfTest, loadMethodology };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.WellScoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard" && node tools/scoring.test.js`
Expected: `ALL TESTS PASS`, exit 0. If a golden vector fails, the bug is in the implementation, NOT the vector — the vectors are hand-computed from spec weights (L: .22/.20/.12/.16/.10/.10/.10 · C: .30/.25/.25/.20).

- [ ] **Step 5: Commit**

```bash
cd "/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard"
git add scoring.js tools/scoring.test.js
git commit -m "feat: shared WellScoring engine with golden-vector self-test"
```

---

### Task 2: `methodology.json` generated from the fallback + parity test

**Files:**
- Create: `methodology.json`
- Modify: `tools/scoring.test.js` (append parity assertion)

**Interfaces:**
- Consumes: `WellScoring.FALLBACK_METHODOLOGY` (Task 1).
- Produces: `methodology.json` at repo root — fetched by both apps at runtime; edited/committed by the admin panel (Task 7).

- [ ] **Step 1: Append the failing parity test**

Append to the end of `tools/scoring.test.js`, just BEFORE the final `console.log(failures ? ...)` line:

```js
// --- methodology.json ↔ fallback parity (anti-drift) ---
const fs = require('fs');
const mjPath = path.join(__dirname, '..', 'methodology.json');
eq('methodology.json exists', fs.existsSync(mjPath), true);
if (fs.existsSync(mjPath)) {
  const live = JSON.parse(fs.readFileSync(mjPath, 'utf8'));
  eq('methodology.json validates', S.validateMethodology(live).ok, true);
  eq('methodology.json parity with fallback', live, S.FALLBACK_METHODOLOGY);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tools/scoring.test.js`
Expected: FAIL — `methodology.json exists` got `false`.

- [ ] **Step 3: Generate `methodology.json` from the engine**

```bash
cd "/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard"
node -e "const S=require('./scoring.js');require('fs').writeFileSync('methodology.json', JSON.stringify(S.FALLBACK_METHODOLOGY, null, 2) + '\n')"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tools/scoring.test.js`
Expected: `ALL TESTS PASS`. (Future rule, enforced by this test forever: whenever the fallback in `scoring.js` changes, regenerate `methodology.json` the same way — except revision bumps made by the admin panel, which intentionally advance `methodology.json` ahead of the fallback; in that case the fallback should be resynced at the next code commit.)

- [ ] **Step 5: Commit**

```bash
git add methodology.json tools/scoring.test.js
git commit -m "feat: live methodology.json rulebook (parity-tested against engine fallback)"
```

---

### Task 3: migration CLI + preview run on the real register

**Files:**
- Create: `tools/migrate-v1.js`
- Test: `tools/scoring.test.js` (migration already covered by V4 vector; this task's test is the CLI dry-run itself)

**Interfaces:**
- Consumes: `WellScoring.isV1Well`, `migrateV1`, `v1TierFor`, `validateMethodology` (Task 1).
- Produces: `tools/migrate-v1.js` CLI — `node tools/migrate-v1.js` (dry-run shift table) / `node tools/migrate-v1.js --write` (rewrites `wells.json` in place). Task 11 re-runs this on fresh origin data at deploy time.

- [ ] **Step 1: Write the CLI**

Create `tools/migrate-v1.js`:

```js
#!/usr/bin/env node
/* v1 → v2 register migration. Dry-run by default; --write rewrites wells.json.
   Prints the old-tier → new-rank shift table required by spec §6 before any commit. */
const fs = require('fs'), path = require('path');
const S = require(path.join(__dirname, '..', 'scoring.js'));

const wellsPath = path.join(__dirname, '..', 'wells.json');
const methPath  = path.join(__dirname, '..', 'methodology.json');
const write = process.argv.includes('--write');

const meth = JSON.parse(fs.readFileSync(methPath, 'utf8'));
const val = S.validateMethodology(meth);
if (!val.ok) { console.error('methodology.json invalid:\n  ' + val.errors.join('\n  ')); process.exit(1); }

const wells = JSON.parse(fs.readFileSync(wellsPath, 'utf8'));
if (!Array.isArray(wells)) { console.error('wells.json is not an array'); process.exit(1); }

const rows = []; let migrated = 0, alreadyV2 = 0;
const out = wells.map(w => {
  if (!S.isV1Well(w)) { alreadyV2++; rows.push([w.licence, '(already v2)', '', w.computed ? w.computed.rankLabel : '?', '']); return w; }
  migrated++;
  const v1Tier = S.v1TierFor(w.total).label;
  const m = S.migrateV1(w, meth);
  const shift = v1Tier === m.computed.rankLabel ? '=' : (v1Tier + ' → ' + m.computed.rankLabel);
  rows.push([w.licence, v1Tier + ' (' + w.total + '/45)', m.computed.L + ' × ' + m.computed.C, m.computed.rankLabel + ' (cell ' + m.computed.cell + ')', shift]);
  return m;
});

const widths = [30, 20, 14, 22, 24];
const fmt = r => r.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' ');
console.log(fmt(['LICENCE', 'V1 TIER (TOTAL)', 'V2 L × C', 'V2 RANK', 'SHIFT']));
console.log('-'.repeat(widths.reduce((a, b) => a + b + 1, 0)));
rows.forEach(r => console.log(fmt(r)));
console.log('\n' + migrated + ' migrated, ' + alreadyV2 + ' already v2, ' + wells.length + ' total.');

const implausible = rows.filter(r => /High.*→.*Low|Very High.*→.*(Low|Moderate)/.test(r[4]));
if (implausible.length) console.log('⚠ IMPLAUSIBLE SHIFTS — review before writing:\n' + implausible.map(r => '  ' + r[0]).join('\n'));

if (write) {
  fs.writeFileSync(wellsPath, JSON.stringify(out, null, 2) + '\n');
  console.log('\nWROTE ' + wellsPath);
} else {
  console.log('\nDry run — re-run with --write to rewrite wells.json.');
}
```

- [ ] **Step 2: Dry-run against the real register and eyeball the shift table**

Run: `node tools/migrate-v1.js`
Expected: a 32-row table, `32 migrated, 0 already v2`, and NO "IMPLAUSIBLE SHIFTS" block. (Directional sanity: v1 High wells should land High/Very High; the three new unknown-defaulted parameters generally push L up slightly.) If implausible shifts appear, STOP and report them — do not "fix" the engine to make them disappear.

- [ ] **Step 3: Write the migrated register (branch-local preview)**

Run: `node tools/migrate-v1.js --write`
Then verify: `node -e "const w=require('./wells.json');const bad=w.filter(x=>x.schema!==2||!x.legacy||x.needsReview!==true||x.scoredUnder!=='1.0.0');console.log(w.length,'wells,',bad.length,'bad');process.exit(bad.length?1:0)"`
Expected: `32 wells, 0 bad`, exit 0. This commit is a branch-local preview; Task 11 regenerates it from fresh origin data before any deploy.

- [ ] **Step 4: Run the full test suite (regression)**

Run: `node tools/scoring.test.js`
Expected: `ALL TESTS PASS`.

- [ ] **Step 5: Commit**

```bash
git add tools/migrate-v1.js wells.json
git commit -m "feat: v1→v2 register migration CLI + migrated register preview"
```

---
### Task 4: index.html — engine swap (methodology state, 1–5 form, live L/C/rank, v2 save/normalize)

**Files:**
- Modify: `index.html` (regions noted per step; line numbers are pre-edit anchors — always locate by the quoted code, not the number)

**Interfaces:**
- Consumes: `scoring.js` API (Task 1), `methodology.json` (Task 2).
- Produces (used by Tasks 5–8):
  - Global `METHODOLOGY` (current rulebook object) and `METHODOLOGY_SOURCE` (`'remote'|'fallback'`)
  - `PARAMS` redefined as a getter over `METHODOLOGY.params` so untouched read-sites keep working during the transition
  - `computeFor(scores)` → `WellScoring.computeWell(scores, METHODOLOGY)`
  - v2 well shape saved by `readForm()`: `{ ...identity fields, schema:2, scores:{11 keys, 1..5|null}, computed:{L,C,Lr,Cr,cell,riskIndex,rankLabel,integrity}, scoredUnder:METHODOLOGY.revision, needsReview:false, legacy? }`
  - `rankOf(w)` → band object for a v2 well (replaces `tierFor(w.total)` at all display sites)

- [ ] **Step 1: Include the engine and boot the methodology**

In `index.html`, immediately BEFORE the existing `<script>` tag that opens the app code (search `/* ============ SCORING MODEL`), add:

```html
<script src="scoring.js"></script>
```

Then, inside the app script, replace the `const PARAMS = [ ... ];` block (lines 505–524, the whole 9-entry array) and the `const TIERS = [...]` + `tierFor` block (lines 526–533) with:

```js
/* Unified methodology — single source of truth is methodology.json / WellScoring.FALLBACK_METHODOLOGY.
   METHODOLOGY is swapped live when the remote rulebook loads or the admin panel saves. */
let METHODOLOGY = WellScoring.FALLBACK_METHODOLOGY;
let METHODOLOGY_SOURCE = 'fallback';
Object.defineProperty(window, 'PARAMS', { get: () => METHODOLOGY.params });
function computeFor(scores){ return WellScoring.computeWell(scores, METHODOLOGY); }
function rankOf(w){
  const c = w.computed || WellScoring.normalizeWell(w, METHODOLOGY).computed;
  return WellScoring.bandFor(c.cell, METHODOLOGY);
}
function methodologyBanner(){
  const el = document.getElementById('methBanner');
  if (!el) return;
  el.style.display = METHODOLOGY_SOURCE === 'fallback' ? 'block' : 'none';
}
function applyMethodology(m, source){
  METHODOLOGY = m; METHODOLOGY_SOURCE = source;
  state.wells = state.wells.map(w => WellScoring.normalizeWell(w, METHODOLOGY));
  methodologyBanner();
  if (document.getElementById('scoring')) buildScoring();
  render();
}
```

Also update `KLASS_DEFS` (lines 487–497): delete the whole `const KLASS_DEFS = {...};` literal and replace with:

```js
const KLASS_DEFS = WellScoring.FALLBACK_METHODOLOGY.wellTypes;
```

(`updateClassHint` at line 498 keeps working unchanged.)

- [ ] **Step 2: New-well defaults + form scores allow unknown**

Replace `defaultScores()` (line 538):

```js
function defaultScores(){ const o={}; PARAMS.forEach(p=>o[p.key]=null); return o; }  // new wells start Unknown
```

- [ ] **Step 3: Rebuild the scoring form — six segments (?, 1–5) per parameter**

Replace the body of `buildScoring()` (line 549) so each parameter row renders an Unknown segment plus 1–5 (keep the existing `.score-row` / `.seg` DOM classes and container lookup exactly as found — only the segment generation and labels change):

```js
function buildScoring(){
  const host = document.getElementById('scoring'); host.innerHTML='';
  PARAMS.forEach(p=>{
    const row = document.createElement('div'); row.className='score-row';
    const axis = p.axis==='L' ? 'Likelihood' : 'Consequence';
    row.innerHTML = `
      <div class="name">${p.name} <span class="score-pill" style="font-size:9px">${axis} · w ${p.weight.toFixed(2)}</span>
        <small>${p.desc}</small></div>
      <div class="seg" id="seg_${p.key}">
        ${['?',1,2,3,4,5].map(v=>{
          const val = v==='?' ? 'null' : v;
          return `<button type="button" data-v="${val}" title="${escapeHtml(WellScoring.anchorText(p, v==='?'?null:v))}"
            onclick="setScore('${p.key}', ${val})">${v}</button>`;
        }).join('')}
      </div>
      <div class="pts" id="pts_${p.key}"></div>`;
    host.appendChild(row);
  });
  updateAllSegs(); updateLiveTotal();
}
function setScore(key, v){ state.currentForm[key] = v; updateSeg(key); updateLiveTotal(); }
```

Replace `updateSeg(key)` (line 574) with:

```js
function updateSeg(key){
  const p = PARAMS.find(x=>x.key===key); if(!p) return;
  const v = state.currentForm[key];
  document.querySelectorAll(`#seg_${key} button`).forEach(b=>{
    const bv = b.dataset.v==='null' ? null : +b.dataset.v;
    b.classList.toggle('active', bv===v);
  });
  const eff = WellScoring.resolveScore(p, v);
  const pts = document.getElementById('pts_'+key);
  if (pts) pts.textContent = (v===null?'?':v) + ' → ' + (p.weight*eff).toFixed(2);
}
```

(If the original `buildScoring`/`updateSeg` used different element ids or an `onclick` helper name, keep the original ids/handler-name and graft this logic into them — the contract is: six segments, `null` for `?`, tooltip = `anchorText`, weighted contribution shown per row.)

- [ ] **Step 4: Live readout becomes L / C / rank**

Replace `updateLiveTotal()` (lines 588–594):

```js
function updateLiveTotal(){
  const c = computeFor(state.currentForm);
  document.getElementById('liveTotal').innerHTML =
    `${c.L.toFixed(2)} × ${c.C.toFixed(2)} <span style="font-size:14px;color:var(--muted)">= ${c.riskIndex}</span>`;
  document.getElementById('liveBadge').innerHTML =
    `<span class="tag ${c.rank.cls}">${c.rank.label} · cell ${c.cell}</span>`;
}
```

And update the static HTML around `id="liveTotal"` (line ~243): change the label `Total Risk Score` to `L × C — Risk Index` and the seeded content `9` to `—` (it is overwritten on first render). Update the form header copy at line ~236 from `Score each parameter: Low (1) · Medium (3) · High (5)` to `Score each parameter 1–5 (anchors at 1/3/5 · ? = unknown, scored conservatively per parameter)`.

- [ ] **Step 5: `readForm()` emits v2 wells; `saveWell`/`editWell` carry the new fields**

In `readForm()` (line 595), replace the two lines

```js
    scores: {...state.currentForm},
    total: PARAMS.reduce((a,p)=>a+state.currentForm[p.key],0),
```

with:

```js
    schema: WellScoring.CURRENT_SCHEMA,
    scores: {...state.currentForm},
    computed: (({L,C,Lr,Cr,cell,riskIndex,rank,integrity}) =>
      ({L,C,Lr,Cr,cell,riskIndex,rankLabel:rank.label,integrity}))(computeFor(state.currentForm)),
    scoredUnder: METHODOLOGY.revision,
    needsReview: false,                       // a human just scored it
    legacy: prev?.legacy,                     // preserve the v1 audit block across edits
```

In `editWell(id)` (line 658): before copying scores into the form, normalize — replace `state.currentForm = {...w.scores};` with:

```js
  const nw = WellScoring.normalizeWell(w, METHODOLOGY);
  state.currentForm = {...nw.scores};
```

- [ ] **Step 6: Normalize at every data boundary**

Wells can arrive as v1 from stale clients/files. Add one normalization choke-point and call it in all four places:

```js
function normalizeAll(list){ return (list||[]).map(w => WellScoring.normalizeWell(w, METHODOLOGY)); }
```

1. `load()` (line 544): wrap the parsed localStorage array → `state.wells = normalizeAll(parsed);`
2. `importJSON` (line 1097): `state.wells = normalizeAll(d);`
3. `mergeWells(local, remote)` (line 1723): first line becomes `local = normalizeAll(local); remote = normalizeAll(remote);`
4. `pullRemote` (line 1750): wherever the fetched array is assigned to `state.wells`, wrap with `normalizeAll(...)`.

- [ ] **Step 7: Boot sequence loads the live rulebook**

In `initSync()` (line 1866), add as the FIRST statement:

```js
  WellScoring.loadMethodology('methodology.json').then(r => applyMethodology(r.methodology, r.source));
```

And add the fallback banner element in the HTML, directly under the toolbar (near the KPI row, line ~178):

```html
<div id="methBanner" style="display:none;background:#5a3b12;border:1px solid #f0a93b;color:#ffe3b0;border-radius:8px;padding:8px 12px;margin:8px 0;font-size:12px">
  ⚠ Live methodology unavailable — using the built-in fallback rulebook (rev <span id="methBannerRev"></span>). Scores shown are computed against the fallback.
</div>
```

In `methodologyBanner()`, also set `document.getElementById('methBannerRev').textContent = METHODOLOGY.revision;`

- [ ] **Step 8: Grep regression checks**

```bash
grep -c "w.total" index.html          # remaining read-sites — Task 5 clears these; note the count
grep -n "TIERS" index.html            # expected: no matches
grep -n "tierFor" index.html          # expected: matches only inside Task-5 regions not yet edited (openDetail/recommend/render/drawCharts/exportPDF/sendRegisterTo3D)
node tools/scoring.test.js            # ALL TESTS PASS
```

Open `index.html` via `python3 -m http.server 8080` → the form renders 11 parameters with ?/1–5 segments, live L×C updates, no console errors, and `WellScoring.runSelfTest()` in the console returns `pass: true`.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: register runs on shared WellScoring engine (v2 wells, 1-5 form, live LxC)"
```

---

### Task 5: index.html — displays (KPIs, table, charts, matrix, detail, recommend, reference, PDF, demo)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `rankOf(w)`, `computeFor`, `METHODOLOGY`, v2 well shape (Task 4).
- Produces: all display surfaces read ONLY `w.computed.*` and `rankOf(w)` — `w.total` no longer exists anywhere.

- [ ] **Step 1: KPI cards** (HTML lines 179–181 + the counting code in `render()`/`drawCharts()`)

Replace the three KPI card sublabels: `Score 9 – 18` → `Cell 1 – 4`, `Score 19 – 30` → `Cell 5 – 9`, `Score 31 – 45` → `Cell 10 – 25`. Add a fourth card after them:

```html
<div class="kpi"><div class="label">Needs Re-review</div><div class="val" id="kReview">0</div><div class="sub">Migrated / stale revision</div></div>
```

Where the old code bucketed by `w.total` ranges, count by band + review state:

```js
  const counts = { low:0, mod:0, highPlus:0, review:0 };
  for (const w of state.wells) {
    const cls = rankOf(w).cls;
    if (cls==='low') counts.low++; else if (cls==='mod') counts.mod++; else counts.highPlus++;
    if (w.needsReview || w.scoredUnder !== METHODOLOGY.revision) counts.review++;
  }
  document.getElementById('kLow').textContent = counts.low;
  document.getElementById('kMod').textContent = counts.mod;
  document.getElementById('kHigh').textContent = counts.highPlus;
  document.getElementById('kReview').textContent = counts.review;
```

- [ ] **Step 2: Wells table** (`render()` lines 690–755)

- Header row (line ~297): `<th>Score</th>` → `<th>L × C</th><th>Index</th>`.
- Age cell (line 714): the old `w.scores.age===1?'<30y':...` ternary → `w.year || '—'`.
- Score pill (line 721): `${w.total}` → `${w.computed.L.toFixed(1)}×${w.computed.C.toFixed(1)}</span></td><td><span class="score-pill">${w.computed.riskIndex}`.
- Category tag: `tierFor(w.total)` → `rankOf(w)`.
- Progress bar (line 739): `((w.total-9)/(45-9))*100` → `((w.computed.riskIndex-1)/24)*100`.
- Row badge: append after the category tag:
  `${(w.needsReview || w.scoredUnder !== METHODOLOGY.revision) ? '<span class="tag" style="background:#3a2f12;color:#f0c96b;margin-left:4px" title="Scored under rev '+escapeHtml(w.scoredUnder||'?')+' — current '+METHODOLOGY.revision+'">re-review</span>' : ''}`
- Card view / sort sites in the same function: sort by `w.computed.riskIndex` desc wherever `w.total` was the sort key; the `${w.total}/45` display (line 741) → `${w.computed.riskIndex}/25`.
- Add a needs-review filter chip: next to the existing search input (line ~195 toolbar area) add
  `<label style="font-size:11px;display:inline-flex;align-items:center;gap:4px"><input type="checkbox" id="fltReview" onchange="render()"> needs re-review only</label>`
  and in the row filter (where `q` is applied, line ~705) add `if(document.getElementById('fltReview')?.checked && !(w.needsReview || w.scoredUnder!==METHODOLOGY.revision)) return false;` (adapt to the filter's actual structure — `.filter(...)` or a loop `continue`).

- [ ] **Step 3: Charts** (`drawCharts()` lines 756–792)

- Distribution chart: labels/colors from `METHODOLOGY.matrix.bands` (`bands.map(b=>b.label)` / `b.color`); counts via `rankOf(w).label`.
- Driver heatmap (line 773): average WEIGHTED contribution — replace the per-param average with:

```js
  const avgs = PARAMS.map(p =>
    state.wells.reduce((a,w)=>a + p.weight * WellScoring.resolveScore(p, w.scores[p.key]), 0) / Math.max(1, state.wells.length));
```

  Chart labels stay `PARAMS.map(p=>p.name)`; retitle the panel heading (line 274) to `Driver Heatmap — Avg weighted contribution (w × s)`.
- Top Risk Wells list (line 279 region): sort by `w.computed.riskIndex` desc, display `riskIndex` and `rankOf(w)` tag.

- [ ] **Step 4: Matrix** (`matrixGrid`/`drawMatrix` lines 793–823)

Replace `matrixGrid` entirely — wells now carry their rounded coordinates:

```js
function matrixGrid(list){
  const grid = Array.from({length:5},()=>Array(5).fill(0));
  for(const w of list){
    const c = w.computed; if(!c) continue;
    grid[5-c.Lr][c.Cr-1]++;
  }
  return grid;
}
```

In `drawMatrix` (line 815), the cell class comes from the live bands instead of hard-coded cutoffs:

```js
      const score = (5-r)*(c+1); // L * C
      const band = WellScoring.bandFor(score, METHODOLOGY);
      const cls = band.cls==='low'?'lo':band.cls==='mod'?'mo':band.cls==='high'?'hi':'cr';
```

- [ ] **Step 5: Detail dossier** (`openDetail` lines 831–898)

- `const t = tierFor(w.total);` → `const w2 = WellScoring.normalizeWell(w, METHODOLOGY); const t = rankOf(w2);` and use `w2` below.
- Score breakdown rows: iterate `PARAMS`, value `const v = w2.scores[p.key];` — display `(v===null?'?':v)`, level text `WellScoring.anchorText(p, v)`, color `v===null||v>=4?'#e85a4f':v>=3?'#f0a93b':'#1fbf75'`, and a 4th cell `+(p.weight*WellScoring.resolveScore(p,v)).toFixed(2)`.
- Headline number: `${w.total}<span ...>/45</span>` → `${w2.computed.riskIndex}<span style="color:var(--muted);font-size:16px">/25</span>` plus a second line `<div class="muted" style="font-size:12px">L ${w2.computed.L} · C ${w2.computed.C} · cell ${w2.computed.cell} · rev ${escapeHtml(w2.scoredUnder||'—')}</div>`.
- Add below the tag: `${w2.legacy ? '<div class="muted" style="font-size:11px">v1 archive: '+w2.legacy.total+'/45</div>' : ''}`.

- [ ] **Step 6: Recommendation engine** (`recommend` lines 899–924)

Keep the §8 action text but re-key the drivers to v2 (threshold ≥4 instead of ===5, unknowns count as drivers when they resolve ≥4):

```js
function recommend(w){
  const w2 = WellScoring.normalizeWell(w, METHODOLOGY);
  const s = w2.scores; const T = rankOf(w2);
  const eff = k => WellScoring.resolveScore(PARAMS.find(p=>p.key===k), s[k]);
  const drivers = PARAMS.filter(p=>eff(p.key)>=4).map(p=>p.name);
  if(T.cls==='crit' || T.cls==='high'){
    let body = `<b>Tier ${T.label}</b> — re-entry diagnostics + mitigation candidate. Key drivers: ${drivers.join(', ')||'none flagged'}.<br>`;
    const actions = [];
    if(eff('plugQuality')>=4 || eff('barriers')>=4) actions.push('Pressure-test surface casing vent + annular buildup (§ 8.1); if leak confirmed → squeeze cement or full re-abandonment (§ 8.2).');
    if(eff('cement')>=4) actions.push('Run CBL/VDL or ultrasonic imaging across caprock interval; top-up annular cement via perforate-and-squeeze if TOC is below caprock.');
    if(eff('scvf')>=4) actions.push('Active/unrepaired SCVF-GM: bubble test + vent-flow measurement per AER ID 2003-01; repair before injection start-up.');
    if(eff('plume')>=4 || eff('penetration')>=4) actions.push('Stage dedicated monitoring well + soil-gas + satellite CO₂ surveillance — well is inside high-consequence corridor.');
    if(eff('usdw')>=4) actions.push('Confirm BGWP/USDW isolation: surface-casing records + cement returns; if open pathway confirmed, prioritize corrective action per 40 CFR 146.84(d).');
    if(eff('access')>=4) actions.push('Engage Orphan Well Association / regulator (§ 9–10); if inaccessible, default to long-term flux + satellite monitoring (§ 8.3).');
    if(eff('age')>=4) actions.push('Treat all pre-1976 tubulars as analog to API 5L pre-NACE; assume corrosion-prone carbon steel and de-rate barrier credit.');
    if(eff('data')>=4) actions.push('Flag as "Undocumented / Unverified abandonment" (§ 6.6) and carry conservative analog assumptions until logged.');
    body += '<ul style="margin:6px 0 0 18px;padding:0">'+actions.map(a=>`<li style="margin:4px 0">${a}</li>`).join('')+'</ul>';
    return {title:'Re-entry + Mitigation Required', body,
      warn:'Per CSA Z741 § 9 / EPA Class VI 40 CFR 146.84(d), high-risk wells inside AoR require corrective action plan before injection authorization.'};
  }
  if(T.cls==='mod'){
    return {title:'Targeted Diagnostics + Watchlist',
      body:`<b>Moderate Tier.</b> Add to MMV watchlist (§ 8.3). Recommended diagnostics: SCVF pressure test, annular surveillance, CBL across caprock if cement data is partial. Re-score on every MMV re-evaluation (3-year AER / 5-year EPA cadence). Drivers worth closing: ${drivers.join(', ')||'data gaps only'}.`};
  }
  return {title:'No Further Action — Monitor at MMV Cycle',
    body:`<b>Low Tier.</b> Well is adequately documented and unlikely to act as a migration pathway. Carry through as background population; re-evaluate on AoR refresh or if plume forecast shifts.`};
}
```

- [ ] **Step 7: Reference tab** (`renderRef` lines 925–939 + static copy)

Extend the generated rows with axis/weight/refs and an unknown column (also add matching `<th>`s to the reference table header at line ~339: `Axis · Weight`, `Unknown`, `Basis`):

```js
function renderRef(){
  const body = document.getElementById('refBody');
  body.innerHTML = PARAMS.map(p=>`<tr>
    <td><b>${p.name}</b><br><small style="color:var(--muted)">${p.desc}</small></td>
    <td style="white-space:nowrap">${p.axis==='L'?'Likelihood':'Consequence'} · ${p.weight.toFixed(2)}</td>
    <td>${p.anchors[1]}</td><td>${p.anchors[3]}</td><td>${p.anchors[5]}</td>
    <td style="text-align:center">${p.unknownScore}</td>
    <td><small>${(p.refs||[]).join(' · ')}</small></td>
  </tr>`).join('');
  const kb = document.getElementById('klassBody');
  if(kb) kb.innerHTML = Object.entries(KLASS_DEFS).map(([t,d])=>`<tr>
    <td style="white-space:nowrap"><b>${t}</b><br><small style="color:var(--muted)">${escapeHtml(d.short)}</small></td>
    <td>${escapeHtml(d.desc)}</td>
    <td>${escapeHtml(d.prot)}</td>
  </tr>`).join('');
}
```

Update the tiering note (line 343): replace the sentence beginning `Risk Ranking = Likelihood × Consequence` through `normalized to a 9-parameter scale.` with:
`<b>Risk Rank = matrix cell (round L × round C)</b> — L and C are weighted sums (Σ wᵢ·sᵢ, weights sum to 1.00 per axis). Continuous Risk Index = L × C (1–25) breaks ties. Bands: Low 1–4 · Moderate 5–9 · High 10–16 · Very High 17–25 (rev <span id="refRev"></span>).` and set `document.getElementById('refRev').textContent = METHODOLOGY.revision;` at the end of `renderRef()`.
Update the header strapline (line 155) to `Unified Risk Methodology · AER D065/D020 + EPA Class VI §146.84 · Weighted L×C Matrix` and the Type→C1 hint: in the classification `<select>` help area (near `updateClassHint`), append to the hint string: `Types 8–9 suggest Penetration=1 · 4–7 → 3 · 1–3 → 5.`

- [ ] **Step 8: Type → C1 auto-suggest** (spec §3)

In `updateClassHint()` (line 498), after the existing hint logic add:

```js
  const sugg = {'Type 1':5,'Type 2':5,'Type 3':5,'Type 4':3,'Type 5':3,'Type 6':3,'Type 7':3,'Type 8':1,'Type 9':1}[v];
  if (sugg !== undefined && state.currentForm.penetration === null) {
    state.currentForm.penetration = sugg;
    updateSeg('penetration'); updateLiveTotal();
  }
```

(Only fills when Penetration is still Unknown — never overrides a reviewer's explicit score.)

- [ ] **Step 9: PDF export** (lines 1548 and 1589 inside `exportPDF`)

- Line 1548 (methodology reference table): `body: PARAMS.map(p=>[pdfSafe(p.name), pdfSafe(p.levels[1]), pdfSafe(p.levels[3]), pdfSafe(p.levels[5])]),` → `body: PARAMS.map(p=>[pdfSafe(p.name+' ('+p.axis+' w'+p.weight.toFixed(2)+')'), pdfSafe(p.anchors[1]), pdfSafe(p.anchors[3]), pdfSafe(p.anchors[5])]),`
- Line 1589 (per-well breakdown): `body: PARAMS.map(p=>[pdfSafe(p.name), pdfSafe(p.levels[w.scores[p.key]]), String(w.scores[p.key])]),` → first ensure `const w2 = WellScoring.normalizeWell(w, METHODOLOGY);` is in scope, then `body: PARAMS.map(p=>[pdfSafe(p.name), pdfSafe(WellScoring.anchorText(p, w2.scores[p.key])), w2.scores[p.key]===null?'?':String(w2.scores[p.key])]),`
- Any `w.total` / `tierFor` in the PDF body (search within `exportPDF`) → `w2.computed.riskIndex` (display `/25`) and `rankOf(w2)`.

- [ ] **Step 10: Demo data** (`loadDemo` lines 1065–1092)

Rewrite the six demo wells' `scores` in v2 keys and drop `total` (readding is unnecessary — pass each through the engine). Replace the whole `state.wells = [ ... ];` array assignment with:

```js
  const V = (o)=>{ const scores = { plugQuality:null,cement:null,barriers:null,scvf:null,age:null,complexity:null,data:null,penetration:null,plume:null,usdw:null,access:null, ...o };
    const c = computeFor(scores);
    return { schema:2, scores, computed:{L:c.L,C:c.C,Lr:c.Lr,Cr:c.Cr,cell:c.cell,riskIndex:c.riskIndex,rankLabel:c.rank.label,integrity:c.integrity},
             scoredUnder:METHODOLOGY.revision, needsReview:false }; };
  state.wells = [
    mk({licence:'100/04-20-046-25W4',operator:'Orphan Well Assoc.',lat:53.4123,lon:-113.5421,year:1958,type:'Oil Producer',traj:'Vertical',status:'Orphaned',klass:'Type 2',
     notes:'Worst-case orphan: no surface marker, no records, no licensee. Inside modeled plume.',
     ...V({plugQuality:5,cement:5,barriers:5,scvf:3,age:5,complexity:3,data:5,penetration:5,plume:5,usdw:5,access:5})}),
    mk({licence:'102/11-08-046-26W4',operator:'Cenovus Energy',lat:53.4501,lon:-113.6011,year:1998,type:'Gas Producer',traj:'Vertical',status:'Abandoned (P&A)',klass:'Type 7',
     notes:'Modern P&A, CBL verified to top of caprock, two cement plugs, SCVF tested clear.',
     ...V({plugQuality:1,cement:1,barriers:1,scvf:1,age:1,complexity:1,data:1,penetration:5,plume:3,usdw:1,access:1})}),
    mk({licence:'07-22-045-25W4',operator:'CNRL',lat:53.3811,lon:-113.5200,year:1985,type:'Disposal',traj:'Deviated',status:'Suspended',klass:'Type 4',
     notes:'Suspended disposal well; partial cement data; SCVF repair verified 2019; pressure test pending under MMV cycle.',
     ...V({plugQuality:3,cement:3,barriers:3,scvf:3,age:3,complexity:3,data:3,penetration:5,plume:3,usdw:3,access:3})}),
    mk({licence:'14-31-047-25W4',operator:'Unknown',lat:53.4921,lon:-113.4805,year:null,type:'Unknown',traj:'Unknown',status:'Unknown',klass:'Type 1',
     notes:'Undocumented well discovered via legacy aerial survey; default to analog assumptions until logged.',
     ...V({})}),
    mk({licence:'06-15-046-25W4',operator:'Imperial Oil',lat:53.4250,lon:-113.5108,year:2010,type:'Strat Test',traj:'Vertical',status:'Abandoned (P&A)',klass:'Type 9',
     notes:'Strat test with full log suite, modern materials, far above caprock — background population.',
     ...V({plugQuality:1,cement:1,barriers:1,scvf:1,age:1,complexity:1,data:1,penetration:1,plume:1,usdw:1,access:1})}),
    mk({licence:'09-27-046-25W4',operator:'Husky / Cenovus',lat:53.4402,lon:-113.5320,year:1972,type:'Injection',traj:'Vertical',status:'Suspended',klass:'Type 5',
     notes:'Pre-NACE carbon steel tubulars; cement coverage absent above caprock; re-entry diagnostics scheduled.',
     ...V({plugQuality:3,cement:5,barriers:3,scvf:3,age:3,complexity:1,data:3,penetration:5,plume:5,usdw:3,access:3})}),
  ];
```

- [ ] **Step 11: Grep + browser verification**

```bash
grep -n "w\.total\|\.levels\[\|tierFor\|TIERS" index.html   # expected: no matches
node tools/scoring.test.js                                   # ALL TESTS PASS
```

Browser (http.server): KPI cards, table with L×C + Index columns, re-review badges on all 32 migrated wells, matrix populated from `computed.Lr/Cr`, detail dossier with weighted breakdown + v1 archive line, Load Demo works, per-well PDF downloads without errors.

- [ ] **Step 12: Commit**

```bash
git add index.html
git commit -m "feat: all register displays on weighted LxC (KPIs, table, charts, matrix, dossier, PDF, demo)"
```

---

### Task 6: index.html — CSV v2 + v1 auto-detect

**Files:**
- Modify: `index.html` (`CSV_COLS` definition — locate with `grep -n "CSV_COLS" index.html`; plus `parseScoreCell` line 1179, `downloadCSVTemplate` 1193, `exportCSV` 1229, `importCSV` 1257)

**Interfaces:**
- Consumes: `WellScoring.scoreLabelToValue`, `normalizeAll`, `computeFor`, v2 well shape (Task 4).
- Produces: CSV round-trip in v2 columns (`sc_plugQuality` … `sc_access`); v1-format CSVs import transparently via header aliases + `migrateV1` semantics.

- [ ] **Step 1: Locate `CSV_COLS`**

The literal is at `index.html:1119–1145`. Identity columns — licence/operator/lat/lon/year/type/traj/status/klass/reviewer/notes — keep their existing `key`/`hdr`/`sample`/`enum` entries verbatim (note `notes` is the LAST entry, after the score columns — keep that ordering).

- [ ] **Step 2: Replace the score-column entries**

Replace the nine `sc_*` entries (lines 1135–1143) with eleven v2 entries. Each `aliases` array holds the exact v1 header(s) that map onto that parameter; `sc_penetration` takes BOTH depth headers and imports the worse value:

```js
  // 11 scoring parameters — 1-5, ? = unknown (Low/Med/High still accepted for v1 files)
  {key:'sc_plugQuality', hdr:'Abandonment & Plug Quality (1-5 or ?)',     sample:'5', score:'plugQuality', aliases:['Plug Quality (Low/Med/High)']},
  {key:'sc_cement',      hdr:'Cement Coverage & Quality (1-5 or ?)',      sample:'5', score:'cement',      aliases:['Cement Coverage (Low/Med/High)']},
  {key:'sc_barriers',    hdr:'Barriers Across Flow Zones (1-5 or ?)',     sample:'3', score:'barriers',    aliases:['Number of Barriers (Low/Med/High)']},
  {key:'sc_scvf',        hdr:'SCVF / GM History (1-5 or ?)',              sample:'?', score:'scvf',        aliases:[]},
  {key:'sc_age',         hdr:'Well Age & Regulatory Era (1-5 or ?)',      sample:'5', score:'age',         aliases:['Well Age (Low/Med/High)']},
  {key:'sc_complexity',  hdr:'Wellbore Complexity (1-5 or ?)',            sample:'?', score:'complexity',  aliases:[]},
  {key:'sc_data',        hdr:'Data Confidence (1-5 or ?)',                sample:'5', score:'data',        aliases:['Data Availability (Low/Med/High)']},
  {key:'sc_penetration', hdr:'Penetration vs Storage Complex (1-5 or ?)', sample:'5', score:'penetration', aliases:['Depth vs Reservoir (Low/Med/High)','Depth vs Storage Complex (Low/Med/High)']},
  {key:'sc_plume',       hdr:'Position vs Plume / AoR (1-5 or ?)',        sample:'1', score:'plume',       aliases:['Proximity to CO2 Plume (Low/Med/High)']},
  {key:'sc_usdw',        hdr:'USDW-BGWP Isolation (1-5 or ?)',            sample:'?', score:'usdw',        aliases:[]},
  {key:'sc_access',      hdr:'Corrective-Action Accessibility (1-5 or ?)', sample:'1', score:'access',     aliases:['Access & Ownership (Low/Med/High)']},
```

- [ ] **Step 3: Importer honors aliases, 1–5, `?`, and worst-of for penetration**

- Replace `parseScoreCell` (line 1179) body with `return WellScoring.scoreLabelToValue(v);` (Low/Medium/High still map 1/3/5; `2`/`4` now valid; blank/`?` → null).
- In `importCSV`'s header-matching loop, extend matching to aliases: where it does `const idx = headerRow.findIndex(h => norm(h)===target);`, change to:

```js
        const names = [c.hdr, ...(c.aliases||[])].map(norm);
        const idx = headerRow.findIndex(h => names.includes(norm(h)));
```

- Where imported score cells are collected (line ~1309 `if(v!==null) scores[c.score] = v;`), change to keep the worse value when two columns map to the same key (covers depthR+depthC → penetration):

```js
          if(v!==null) scores[c.score] = Math.max(scores[c.score] ?? 0, v);
```

  and initialize `const scores = {};` → after the loop, fill in the well as v2: replace the old `const total = PARAMS.reduce(...)` line (1311) and the well-object assembly with:

```js
          const fullScores = {}; PARAMS.forEach(p => fullScores[p.key] = (p.key in scores) ? scores[p.key] : null);
          const c2 = computeFor(fullScores);
          // ...into the imported well object:
          schema:2, scores: fullScores,
          computed:{L:c2.L,C:c2.C,Lr:c2.Lr,Cr:c2.Cr,cell:c2.cell,riskIndex:c2.riskIndex,rankLabel:c2.rank.label,integrity:c2.integrity},
          scoredUnder: METHODOLOGY.revision,
          needsReview: false,
```

  If the header row matched ANY v1 alias (track a boolean while matching), set `needsReview: true` on every imported well instead, and show it in the import confirmation message (`"v1-format CSV detected — imported wells flagged for re-review"`).

- [ ] **Step 4: Exporter writes v2**

In `exportCSV` (line 1229): `const scoreLabel = v=> v===1?'Low':...` → `const scoreLabel = v => v===null||v===undefined ? '?' : String(v);` (numbers out; `?` for unknown). Everything else follows from `CSV_COLS`.
In `downloadCSVTemplate` (line 1193): update `sampleB`'s switch cases from the old `sc_plug`… keys to the new keys with 1–5/`?` sample values (e.g. `case 'sc_plugQuality': return '1';` … `case 'sc_scvf': return '?';`).

- [ ] **Step 5: Round-trip verification**

Browser: Export CSV → clear register (or use a scratch browser profile) → Import the same file → identical L×C/Index for every well; then import a v1-era CSV (make one by hand-editing an exported file's headers back to the v1 names listed in Step 2's aliases, with Low/Medium/High values) → wells import with re-review flags and the "v1-format CSV detected" notice.

```bash
grep -n "sc_plug'" index.html        # expected: no matches (old key gone)
node tools/scoring.test.js           # ALL TESTS PASS
```

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: CSV v2 columns with v1 auto-detect import"
```

---
### Task 7: index.html — methodology sync + admin panel

**Files:**
- Modify: `index.html` (SYNC block lines 1679–1885; new modal HTML next to the existing `syncModal`; toolbar button)

**Interfaces:**
- Consumes: `applyMethodology`, `METHODOLOGY`, `WellScoring.validateMethodology`, `bumpRevision` (Tasks 1, 4); existing sync plumbing: `SYNC`, `apiHeaders()`, `b64encode/b64decode`, `setSyncStatus`, `syncToken()`, `syncName()`.
- Produces:
  - `SYNC.methodologyPath = 'methodology.json'`, `SYNC.methodologySha` (state)
  - `fetchMethodologyRemote()` → `Promise<{m, sha} | null>`; `pushMethodologyRemote(newM)` → `Promise<boolean>` (SHA-retry like `pushRemote`)
  - `openMethodologyModal()` / `saveMethodologyEdits()` — admin UI entry points (Task 9's reviewer page does NOT edit; edits happen only here)

- [ ] **Step 1: Extend the SYNC config + fetch**

At the `const SYNC = {` literal (line 1679) add two properties: `methodologyPath: 'methodology.json', methodologySha: null,`.

After `fetchRemote` (line 1733), add:

```js
async function fetchMethodologyRemote(){
  try {
    const res = await fetch(`https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.methodologyPath}`, { headers: apiHeaders(), cache:'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    SYNC.methodologySha = j.sha;
    const m = JSON.parse(b64decode(j.content));
    if (!WellScoring.validateMethodology(m).ok) return null;
    return { m, sha: j.sha };
  } catch(e){ return null; }
}
async function pushMethodologyRemote(newM){
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { message: 'Methodology ' + newM.revision + ' — ' + (syncName()||'unknown'),
      content: b64encode(JSON.stringify(newM, null, 2) + '\n'), branch: 'main' };
    if (SYNC.methodologySha) body.sha = SYNC.methodologySha;
    const res = await fetch(`https://api.github.com/repos/${SYNC.owner}/${SYNC.repo}/contents/${SYNC.methodologyPath}`,
      { method:'PUT', headers: apiHeaders(), body: JSON.stringify(body) });
    if (res.ok) { const j = await res.json(); SYNC.methodologySha = j.content.sha; return true; }
    if (res.status === 409 || res.status === 422) { await fetchMethodologyRemote(); continue; }  // SHA collision → refetch, retry once
    return false;
  }
  return false;
}
```

(Mirror the exact header/base64/branch conventions found in `pushRemote` at line 1779 — if `pushRemote` targets a different branch var or uses extra headers, copy that, not this sketch's assumptions.)

- [ ] **Step 2: Poll the rulebook on the existing cycle**

In `startPolling` (line 1862) and the focus-regain handler (search `visibilitychange` or `focus` near `initSync`), alongside the existing wells pull add:

```js
  fetchMethodologyRemote().then(r => {
    if (r && r.m.revision !== METHODOLOGY.revision) applyMethodology(r.m, 'remote');
  });
```

Also in the boot path (Task 4 Step 7 already loads via `loadMethodology` fetch — keep both: `loadMethodology` covers tokenless/Pages loads, `fetchMethodologyRemote` covers SHA tracking once a token exists).

- [ ] **Step 3: Admin modal HTML**

Duplicate the structure of the existing `syncModal` (search `id="syncModal"`, line ~440-475 region) as a sibling modal:

```html
<div class="modal" id="methModal">
  <div class="modal-card" style="max-width:860px">
    <div class="row spread"><h2>Methodology — rev <span id="mmRev"></span></h2>
      <button class="ghost" onclick="closeMethodologyModal()">✕</button></div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">
      Edits commit <code>methodology.json</code> to the shared repo (needs the same token as well saves).
      Weight/band/unknown changes bump the minor version; wording changes bump the patch.
      Wells scored under older revisions are flagged for re-review — scores are never rewritten silently.
    </div>
    <div id="mmParams"></div>
    <h2 style="margin-top:12px">Matrix bands (cell = round L × round C, 1–25)</h2>
    <div id="mmBands"></div>
    <div id="mmValidation" style="margin-top:10px;font-size:12px"></div>
    <div class="actions-row" style="margin-top:14px">
      <button class="ghost" onclick="closeMethodologyModal()">Cancel</button>
      <button class="primary" id="mmSave" onclick="saveMethodologyEdits()" disabled>Save &amp; Commit</button>
    </div>
  </div>
</div>
```

Toolbar: next to the sync pill / gear button (search the toolbar HTML near line 160–178), add `<button class="ghost" onclick="openMethodologyModal()" title="View or edit the scoring rulebook">⚖ Methodology</button>`.

- [ ] **Step 4: Admin modal JS**

Add after the sync-modal functions (line ~1828):

```js
let mmDraft = null;
function openMethodologyModal(){
  mmDraft = JSON.parse(JSON.stringify(METHODOLOGY));
  const host = document.getElementById('mmParams');
  host.innerHTML = ['L','C'].map(axis => `
    <h2 style="margin-top:10px">${axis==='L'?'Likelihood':'Consequence'} <span class="score-pill" id="mmSum${axis}"></span></h2>
    ${mmDraft.params.map((p,i)=>({p,i})).filter(x=>x.p.axis===axis).map(({p,i})=>`
      <div class="score-row" style="grid-template-columns:1.2fr 90px 70px 2.4fr">
        <div class="name">${p.name}<small>${p.desc}</small></div>
        <div><input type="number" step="0.01" min="0" max="1" value="${p.weight}" style="width:70px"
             onchange="mmSet(${i},'weight',parseFloat(this.value))"> w</div>
        <div><select onchange="mmSet(${i},'unknownScore',parseInt(this.value,10))">
          ${[1,2,3,4,5].map(v=>`<option ${v===p.unknownScore?'selected':''}>${v}</option>`).join('')}
        </select> ?</div>
        <div>${[1,3,5].map(a=>`<textarea rows="1" style="width:100%;font-size:11px;margin:1px 0"
             onchange="mmSetAnchor(${i},${a},this.value)">${escapeHtml(p.anchors[a])}</textarea>`).join('')}</div>
      </div>`).join('')}`).join('');
  const bh = document.getElementById('mmBands');
  bh.innerHTML = mmDraft.matrix.bands.map((b,i)=>`
    <span class="tag ${b.cls}" style="margin-right:8px">${b.label}
      <input type="number" min="1" max="25" value="${b.min}" style="width:48px" onchange="mmSetBand(${i},'min',parseInt(this.value,10))"> –
      <input type="number" min="1" max="25" value="${b.max}" style="width:48px" onchange="mmSetBand(${i},'max',parseInt(this.value,10))">
    </span>`).join('');
  mmValidate();
  document.getElementById('methModal').classList.add('open');
}
function closeMethodologyModal(){ document.getElementById('methModal').classList.remove('open'); mmDraft=null; }
function mmSet(i,k,v){ mmDraft.params[i][k]=v; mmValidate(); }
function mmSetAnchor(i,a,v){ mmDraft.params[i].anchors[a]=v; mmValidate(); }
function mmSetBand(i,k,v){ mmDraft.matrix.bands[i][k]=v; mmValidate(); }
function mmValidate(){
  const val = WellScoring.validateMethodology(mmDraft);
  for (const axis of ['L','C']) {
    const sum = WellScoring.paramsOf(mmDraft, axis).reduce((a,p)=>a+(+p.weight||0),0);
    const el = document.getElementById('mmSum'+axis);
    if (el){ el.textContent = 'Σw = '+sum.toFixed(2); el.style.color = Math.abs(sum-1)>0.001 ? '#e85a4f' : '#1fbf75'; }
  }
  document.getElementById('mmValidation').innerHTML =
    val.ok ? '<span style="color:#1fbf75">Valid — next revision: '+WellScoring.bumpRevision(METHODOLOGY, mmDraft)+'</span>'
           : '<span style="color:#e85a4f">'+val.errors.map(escapeHtml).join('<br>')+'</span>';
  document.getElementById('mmSave').disabled = !val.ok || !syncToken();
  if (!syncToken() && val.ok) document.getElementById('mmValidation').innerHTML += '<br><span class="muted">Connect a token (sync pill) to commit changes.</span>';
}
async function saveMethodologyEdits(){
  const rev = WellScoring.bumpRevision(METHODOLOGY, mmDraft);
  if (rev === METHODOLOGY.revision + '' && JSON.stringify(mmDraft) === JSON.stringify(METHODOLOGY)) { closeMethodologyModal(); return; }
  mmDraft.revision = rev;
  mmDraft.updatedBy = syncName() || 'unknown';
  mmDraft.updatedAt = new Date().toISOString();
  document.getElementById('mmSave').disabled = true;
  const ok = await pushMethodologyRemote(mmDraft);
  if (ok) { applyMethodology(mmDraft, 'remote'); closeMethodologyModal(); setSyncStatus('live', 'Methodology '+rev+' committed'); }
  else { document.getElementById('mmValidation').innerHTML = '<span style="color:#e85a4f">Commit failed — check token permissions / rate limit, then retry.</span>'; document.getElementById('mmSave').disabled = false; }
}
```

- [ ] **Step 5: Verify**

Browser: ⚖ Methodology opens the modal showing all 11 params; nudging a weight turns Σw red and disables Save; restoring turns it green and shows `next revision: 2.1.0`; without a token Save stays disabled with the hint. (Actual commit is exercised in Task 10's checklist with a real token — do NOT commit a methodology bump to origin during development.)

```bash
node tools/scoring.test.js    # ALL TESTS PASS
```

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: methodology admin panel with validated GitHub-commit save + live polling"
```

---

### Task 8: index.html — lossless bridge

**Files:**
- Modify: `index.html` (`sendRegisterTo3D` 952–980, `mapFrom3D` 1001–1031, embed note line ~436)

**Interfaces:**
- Consumes: v2 well shape, `computeFor`, `WellScoring.deriveScoresFromReviewer` (Tasks 1, 4).
- Produces: bridge message rows now carry `scores` (the 11-key v2 object) and `scoredUnder` in BOTH directions. Task 9's reviewer sends `scores` back on push; register uses them verbatim.

- [ ] **Step 1: Send native scores to the 3D viewer**

In `sendRegisterTo3D` (line 952), inside the `rows = state.wells.map(w => ({...}))` literal:
- Replace the `integrityScore:` line (the `100 - (w.total - 9) * (100/36)` expression) with:

```js
    integrityScore: w.computed ? w.computed.integrity : null,
    scores: w.scores || null,
    scoredUnder: w.scoredUnder || null,
```

- In the `notes:` line, replace `(typeof w.total === 'number' ? ', score ' + w.total + '/45' : '')` with `(w.computed ? ', index ' + w.computed.riskIndex + '/25 (' + w.computed.rankLabel + ')' : '')`.

- [ ] **Step 2: Receive native scores from the 3D viewer**

Replace `mapFrom3D(r, prev)` (lines 1001–1031) with a version that prefers native v2 scores and falls back to the shared derivation (the old inline 9-key derivation is deleted — the ONE mapping now lives in `scoring.js`):

```js
function mapFrom3D(r, prev){
  const now = new Date().toISOString();
  const native = r.scores && typeof r.scores === 'object' && 'plugQuality' in r.scores;
  const raw = native ? r.scores : WellScoring.deriveScoresFromReviewer(r);
  const scores = {}; PARAMS.forEach(p => scores[p.key] = (typeof raw[p.key]==='number' ? raw[p.key] : null));
  const c = computeFor(scores);
  const typeMap = t => t==='Oil' ? 'Oil Producer' : t==='Gas' ? 'Gas Producer' : t==='Injector' ? 'Injection' : t==='Water Disposal' ? 'Disposal' : t==='Observation' ? 'Observation' : 'Unknown';
  return {
    id: prev?.id || uid(),
    licence: String(r.uwi||r.licenseNumber||'UNNAMED'),
    operator: r.operator || 'Unknown',
    lat: (typeof r.surfaceLat==='number') ? r.surfaceLat : null,
    lon: (typeof r.surfaceLon==='number') ? r.surfaceLon : null,
    year: (typeof r.drillingYear==='number') ? r.drillingYear : null,
    type: typeMap(r.wellType),
    traj: r.orientation==='Deviated' ? 'Deviated' : r.orientation==='Horizontal' ? 'Horizontal' : 'Vertical',
    status: r.status || 'Unknown',
    klass: prev?.klass || deriveKlass(r),
    reviewer: r.reviewer || '',
    notes: ((r.notes||'') + ' [From 3D Reviewer' + (native ? ' — native scores' : ' — scores derived from well data; verify') + ']').trim(),
    schema: WellScoring.CURRENT_SCHEMA,
    scores,
    computed: {L:c.L,C:c.C,Lr:c.Lr,Cr:c.Cr,cell:c.cell,riskIndex:c.riskIndex,rankLabel:c.rank.label,integrity:c.integrity},
    scoredUnder: METHODOLOGY.revision,
    needsReview: !native,                       // native pushes are already scored on the same rulebook
    legacy: prev?.legacy,
    createdAt: prev?.createdAt || now, updatedAt: now,
    updatedBy: (syncName() ? syncName() + ' ' : '') + '(3D Reviewer)',
  };
}
```

Also soften the receive-confirm text in the `message` listener (line ~1049): `'Subscores are derived — verify Classification/Access/Data after import.'` → `'Wells with native scores import losslessly; derived wells are flagged for re-review.'`
Update the embed note (line ~436): replace the sentence about the 9–45 ↔ Integrity translation and the "verify Classification, Access and Data" caveat with: `Both apps score on the same methodology (methodology.json) — pushes in either direction carry the 11 parameter scores losslessly.`

- [ ] **Step 3: Verify + commit**

`deriveKlass` (983) is intentionally unchanged. Browser check happens end-to-end in Task 10 (needs Task 9 first).

```bash
grep -n "100/36\|(w.total - 9)" index.html    # expected: no matches
git add index.html
git commit -m "feat: lossless register-3D bridge carrying native v2 scores"
```

---

### Task 9: 3d-reviewer.html — unified engine, score fields, live methodology page

**Files:**
- Modify: `3d-reviewer.html` — ONLY these app-code regions (never touch the bundled Three.js between lines ~1700 and ~23500):
  - `<head>`/top: add the script include
  - `// src/schema.js` section (lines 949–1036): FIELDS additions
  - `// src/risk.js` section (lines 1037–1118): `computeRisk` + `classifyScore`
  - `// src/methodology.js` section (lines 24244–24340): live rulebook rendering
  - `// src/main.js` push handler (lines 24729–24745): include scores in rows

**Interfaces:**
- Consumes: `WellScoring` global (script include), `methodology.json`.
- Produces: `w._risk = { score:0-100, class:'low'|'medium'|'high'|'critical', factors:[{label,pts}], overridden, L, C, cell, riskIndex, rankLabel, integrity }` — same shape consumers (`computeKpis` 1087, list/panel/scene colorers) already read, plus the new unified fields; `resolveWellScores(w)` exposed beside `computeRisk`; push rows carry `scores` + `scoredUnder`.

- [ ] **Step 1: Include the engine + boot the rulebook**

`3d-reviewer.html` has its own `<head>`. Immediately before the app's main `<script>` bundle tag (locate the `<script>` that contains `// src/config.js`), insert:

```html
<script src="scoring.js"></script>
```

At the very top of the `// src/risk.js` section (line 1037, before `var CEMENT_PTS`), add:

```js
  var UNIFIED_METH = WellScoring.FALLBACK_METHODOLOGY;
  var UNIFIED_SOURCE = "fallback";
  WellScoring.loadMethodology("methodology.json").then((r) => {
    UNIFIED_METH = r.methodology; UNIFIED_SOURCE = r.source;
    if (typeof store !== "undefined" && store.state) store.dispatch({ type: "wells/recompute" });
  });
```

(`wells/recompute` — check `// src/store.js` (line 1202+) for the action vocabulary; if no recompute-style action exists, dispatch whatever no-op update triggers `computeRisk` re-runs — e.g. re-dispatch the current wells via the existing `wells/import` with `mode:"updateByUwi"` — or simply leave it: scores recompute on every edit/render pass anyway, and the fallback→remote delta is nil while both are at 2.0.0.)

- [ ] **Step 2: Eleven score fields in the schema**

In `// src/schema.js`, inside the `FIELDS` array's `risk` group (before the `leakageRiskOverride` entry at `key: "leakageRiskOverride"`), insert eleven number fields — key convention `s_<paramKey>`:

```js
    { key: "s_plugQuality", label: "Score: Abandonment & Plug Quality (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_cement", label: "Score: Cement Coverage & Quality (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_barriers", label: "Score: Barriers Across Flow Zones (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_scvf", label: "Score: SCVF / GM History (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_age", label: "Score: Well Age & Era (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_complexity", label: "Score: Wellbore Complexity (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_data", label: "Score: Data Confidence (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_penetration", label: "Score: Penetration vs Storage Complex (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_plume", label: "Score: Position vs Plume / AoR (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_usdw", label: "Score: USDW-BGWP Isolation (1-5)", group: "risk", type: "number", min: 1, max: 5 },
    { key: "s_access", label: "Score: Corrective-Action Accessibility (1-5)", group: "risk", type: "number", min: 1, max: 5 },
```

`TYPE_DEFAULTS.number` is already `null`, so `blankWell()` gives every new field `null` (= unscored → derived/unknown) with NO change — and old autosaved sites load with these keys `undefined`, which the resolver below treats identically. That satisfies spec §5/§7's "reviewer site data migrates on first open" with zero destructive rewriting. On `integrityScore`'s FIELDS entry, add `derived: true` (it becomes a computed display like `distToInjector`).

- [ ] **Step 3: Replace the risk model**

In `// src/risk.js`, DELETE `var CEMENT_PTS = ...` and `var PLUG_PTS = ...` (lines 1040–1041) — `renderMethodology` references to them are removed in Step 5. Replace the bodies of `classifyScore` (1060) and `computeRisk` (1063) with:

```js
  var RANK_TO_CLASS = { "Low": "low", "Moderate": "medium", "High": "high", "Very High": "critical" };
  function classifyScore(s) {
    return s >= 75 ? "critical" : s >= 50 ? "high" : s >= 25 ? "medium" : "low";
  }
  function resolveWellScores(w) {
    const derived = WellScoring.deriveScoresFromReviewer(w);
    const scores = {}, source = {};
    for (const p of UNIFIED_METH.params) {
      const explicit = w["s_" + p.key];
      if (typeof explicit === "number" && explicit >= 1 && explicit <= 5) { scores[p.key] = explicit; source[p.key] = "scored"; }
      else if (typeof derived[p.key] === "number") { scores[p.key] = derived[p.key]; source[p.key] = "derived"; }
      else { scores[p.key] = null; source[p.key] = "unknown"; }
    }
    return { scores, source };
  }
  function computeRisk(w, site2) {
    const { scores, source } = resolveWellScores(w);
    const c = WellScoring.computeWell(scores, UNIFIED_METH);
    const factors = UNIFIED_METH.params.map((p) => ({
      label: p.name + " = " + (scores[p.key] === null ? "? (" + p.unknownScore + ")" : scores[p.key]) + " [" + source[p.key] + "]",
      pts: +(p.weight * WellScoring.resolveScore(p, scores[p.key])).toFixed(2)
    }));
    let cls = RANK_TO_CLASS[c.rank.label] || "low", overridden = false;
    const ov = String(w.leakageRiskOverride || "Auto").toLowerCase();
    const ovKey = ov === "very high" ? "critical" : ov;
    if (ovKey !== "auto" && RISK_ORDER.includes(ovKey)) { cls = ovKey; overridden = true; }
    return { score: c.riskScore, class: cls, factors, overridden,
             L: c.L, C: c.C, cell: c.cell, riskIndex: c.riskIndex, rankLabel: c.rank.label, integrity: c.integrity, scores };
  }
```

Then update `computeKpis` (1087): the two `w.integrityScore` reads (`const integ = isNum2(w.integrityScore) ? ... : 0;` and the avg accumulation) become `const integ = (w._risk && isNum2(w._risk.integrity)) ? w._risk.integrity : 0;` — derived integrity, not the stored field. Search the panel/list sections (`// src/panel.js` 1637+, `// src/list.js` 1567+) for other `integrityScore` reads used for DISPLAY and point them at `w._risk.integrity` the same way (imports/CSV mapping keep writing the stored field; it is simply no longer an input).

- [ ] **Step 4: Push rows carry native scores**

In the push handler (line 24741), the row mapper currently reads:

```js
      const rows = wells.map(({ _risk, ...w }) => ({ ...w, riskScore: _risk?.score, riskClass: RISK_LABELS[_risk?.class] ?? _risk?.class }));
```

Replace with:

```js
      const rows = wells.map(({ _risk, ...w }) => ({ ...w,
        riskScore: _risk?.score, riskClass: RISK_LABELS[_risk?.class] ?? _risk?.class,
        scores: _risk?.scores ?? null, scoredUnder: UNIFIED_METH.revision }));
```

- [ ] **Step 5: Live methodology page**

In `// src/methodology.js` (24244–24340): keep `REFS` and the surrounding page scaffold; DELETE the static `factorRows` array and, inside `renderMethodology`, replace the old score-composition content (the `factorRows` table plus the worst-case/modern `computeRisk` demo paragraphs that referenced `CEMENT_PTS`/`PLUG_PTS`) with a table generated from the live rulebook (`el(...)` is this file's existing hyperscript helper — reuse it exactly as the surrounding code does):

```js
    const paramRows = UNIFIED_METH.params.map((p) => [
      p.name + " (" + (p.axis === "L" ? "Likelihood" : "Consequence") + ")",
      "w = " + p.weight.toFixed(2),
      "1: " + p.anchors[1] + " · 3: " + p.anchors[3] + " · 5: " + p.anchors[5],
      "Unknown → " + p.unknownScore
    ]);
```

and render it with the same `el("table", ...)` pattern the old `factorRows` used, preceded by:

```js
      el("p", {}, "Unified weighted L×C model, revision " + UNIFIED_METH.revision +
        (UNIFIED_SOURCE === "fallback" ? " (built-in fallback — live methodology.json unavailable)" : " (live)") +
        ". L = Σ wᵢ·sᵢ over 7 likelihood parameters; C over 4 consequence parameters; " +
        "matrix cell = round(L) × round(C); bands: " +
        UNIFIED_METH.matrix.bands.map((b) => b.label + " " + b.min + "–" + b.max).join(" · ") +
        ". Governed by the shared register — edits happen in the dashboard's ⚖ Methodology panel."),
```

Update the page's §1/§2 prose references to "additive 0–100 index" to "weighted L×C matrix, displayed as a 0–100 risk score for continuity".

- [ ] **Step 6: Verify**

```bash
grep -n "CEMENT_PTS\|PLUG_PTS\|factorRows" 3d-reviewer.html   # expected: no matches
node tools/scoring.test.js                                     # ALL TESTS PASS (engine untouched)
```

Browser — open `http://localhost:8080/3d-reviewer.html` standalone: scene renders, wells recolor per unified classes, side panel shows the factors breakdown with `[scored]/[derived]/[unknown]` tags, Methodology page shows revision 2.0.0 with 11 parameters, console `WellScoring.runSelfTest()` → `pass: true`. Then open the register's 3D tab (embedded): "⇧ Push to Register" round-trips a well and the register receives identical scores (no re-review flag on native pushes).

- [ ] **Step 7: Commit**

```bash
git add 3d-reviewer.html
git commit -m "feat: 3D Reviewer scores on the shared unified methodology"
```

---
### Task 10: README + full manual verification checklist

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing docs; a completed checklist (paste results into the task report).

- [ ] **Step 1: README updates**

- Line 3 (`Appendix D / § 7.2 scoring`): change to `unified AER D065/D020 + EPA Class VI §146.84 weighted L×C scoring (see methodology.json)`.
- After the "How it works" bullet list, add:

```markdown
## Risk methodology (v2)

- Wells are scored 1–5 on **11 parameters** (7 Likelihood, 4 Consequence); `?` = unknown, which scores
  conservatively per parameter. Weighted sums give **L** and **C** (1.00–5.00); the well's official rank is
  its **5×5 matrix cell** (round L × round C): Low 1–4 · Moderate 5–9 · High 10–16 · Very High 17–25.
  The continuous **Risk Index = L × C** breaks ties.
- The rulebook lives in [`methodology.json`](methodology.json) — weights, anchors, unknown policy, bands,
  and a semver revision. Both the register and the 3D Reviewer load it; each well records the revision it
  was scored under and is flagged **re-review** when the rulebook moves on.
- **Editing the rulebook:** ⚖ Methodology in the dashboard toolbar (needs a save token). Every change is
  a Git commit of `methodology.json` — the file's History is the audit trail.
- Wells scored under the old 9–45 model were migrated mechanically (`tools/migrate-v1.js`) with their v1
  scores archived per-well under `legacy`; every migrated well carries `needsReview` until a human
  re-confirms its scores. Console `WellScoring.runSelfTest()` verifies the engine in either app.
```

- In the "3D Legacy Well Reviewer" section, replace the "Transparent additive risk model…" bullet with `Scores on the same unified methodology as the register (shared scoring.js + methodology.json); the Risk Model & Methodology page renders the live rulebook` and replace the **Bridge** paragraph's translation/caveat sentences with `The bridge is lossless in both directions — the 11 parameter scores travel with each well.`

- [ ] **Step 2: Full manual checklist (run every line; record pass/fail)**

Serve: `cd "/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard" && python3 -m http.server 8080`

1. `http://localhost:8080/` loads; no console errors; `WellScoring.runSelfTest().pass === true`.
2. All 32 migrated wells show **re-review** badges; Needs Re-review KPI = 32; filter chip isolates them.
3. Add a new well: form starts all-`?`; picking Type 8 auto-fills Penetration = 1; live L×C updates; Save → appears in table with rank; edit round-trips scores incl. `?`.
4. Matrix tab: counts sum to well count; cell colors follow bands.
5. Detail dossier: weighted breakdown, `v1 archive: N/45` line on a migrated well, PDF downloads and shows the 11-param table.
6. CSV: export → re-import → identical Risk Index per well. v1-header CSV imports with re-review flags.
7. ⚖ Methodology: weight nudge → Σw red, Save disabled; restore → green, `next revision 2.1.0`; tokenless Save disabled with hint.
8. Rename `methodology.json` → reload → fallback banner appears in register AND reviewer methodology page says "built-in fallback"; rename back.
9. `http://localhost:8080/3d-reviewer.html` standalone: `runSelfTest().pass === true`; factors show `[scored]/[derived]/[unknown]`; setting `s_plugQuality` on a well changes its class live.
10. Embedded 3D tab: Send register wells → 3D (wells arrive, integrity = register's derived integrity); edit nothing; ⇧ Push to Register → confirm dialog → register wells update with **no** re-review flags and identical L×C (lossless round-trip).
11. With a real token on a **test** basis: connect sync; verify wells save still works (schema v2 hits `wells.json` on main — do this ONLY on the deploy branch at Task 11, or point SYNC at a fork; otherwise skip and note it).
12. `file://` double-click `index.html`: app boots on fallback methodology + local cache (no fetch); banner visible.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v2 methodology, admin panel, migration notes"
```

---

### Task 11: Deploy gate — fresh-data migration + USER APPROVAL required

**Files:**
- Modify: `wells.json` (regenerated), possibly merge `origin/main`

This task is the ONLY one that touches shared/live state. **It requires explicit user approval at Step 3 — never push without it.**

- [ ] **Step 1: Rebase onto the latest live data**

```bash
cd "/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard"
git fetch origin
git checkout design/unified-risk-methodology
git checkout origin/main -- wells.json     # take the CURRENT live register (teammates may have edited it)
node tools/migrate-v1.js                   # dry-run: fresh shift table
```

- [ ] **Step 2: Regenerate the migration**

```bash
node tools/migrate-v1.js --write
node tools/scoring.test.js                 # ALL TESTS PASS
git add wells.json
git commit -m "feat: migrate live register to schema v2 (deploy snapshot)"
```

- [ ] **Step 3: STOP — present to the user**

Show the user: (a) the full shift table from Step 1, (b) the checklist results from Task 10, (c) the branch commit list (`git log --oneline origin/main..HEAD`). Ask explicitly whether to (i) push the branch and open a PR, (ii) merge to main and push (this DEPLOYS to GitHub Pages and switches the whole team to v2 — anyone mid-edit on v1 will have their next save normalized by the merge path), or (iii) hold. **Do not run any `git push` until the user answers.** Remind them the pre-migration register remains recoverable from Git history, and that the separate Vercel deployment is untouched (deploy flow per `vercel deploy --prod` memory is a separate, manual decision).

---

## Plan Self-Review Notes (already applied)

- **Spec coverage:** §2 params/anchors/weights → Task 1 FALLBACK; §3 mechanics incl. Type→C1 suggest → Tasks 1, 4, 5(Step 8); §4 methodology.json + validation → Tasks 2, 7; §5 admin panel + badges → Tasks 5, 7; §6 migration + shift table + CSV v1 detect → Tasks 3, 6, 11; §7 scoring.js + reviewer + lossless bridge → Tasks 1, 8, 9; §8 error handling (fallback banner Task 4, invalid-reject Tasks 1/7, SHA retry Task 7, revision-skew badges Task 5, unknown policy Task 1); §9 golden vectors + runSelfTest both apps → Tasks 1, 9, 10; §10 out-of-scope respected (no hosting/merge-semantics changes; Vercel untouched).
- **Known judgment calls encoded above** (all consistent with the approved spec): new wells default to Unknown (`null`) rather than v1's all-1s; migrated wells store `null` for the three new parameters (engine applies the spec's unknown defaults 3/3/3 — computed results identical to storing 3 literally, plus honesty about what was never assessed); reviewer score fields are flat `s_<key>` numbers so the existing FIELDS form/CSV machinery renders them for free.
- **Line numbers are pre-edit anchors.** Executors MUST locate edits by the quoted code snippets; numbers drift as earlier tasks land.

