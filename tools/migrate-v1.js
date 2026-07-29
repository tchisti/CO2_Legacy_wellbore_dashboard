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
