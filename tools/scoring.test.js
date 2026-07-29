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

// --- methodology.json ↔ fallback parity (anti-drift) ---
const fs = require('fs');
const mjPath = path.join(__dirname, '..', 'methodology.json');
eq('methodology.json exists', fs.existsSync(mjPath), true);
if (fs.existsSync(mjPath)) {
  const live = JSON.parse(fs.readFileSync(mjPath, 'utf8'));
  eq('methodology.json validates', S.validateMethodology(live).ok, true);
  eq('methodology.json parity with fallback', live, S.FALLBACK_METHODOLOGY);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL TESTS PASS');
process.exit(failures ? 1 : 0);
