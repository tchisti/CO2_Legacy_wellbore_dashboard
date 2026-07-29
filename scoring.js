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
