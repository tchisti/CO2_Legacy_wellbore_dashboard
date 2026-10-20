// v2 → v3 migration (spec §8): the pure conversion (migrateV2Data, in @lwa/engine) run against the
// real v2 register (fixtures/wells.v2.json and methodology.v2.json are copies of the repo-root
// wells.json and methodology.json), the CLI around it (main in migrate-v2.ts), the Enbridge site
// file, and the committed e2e fixture the CLI produced.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProjectExportSchema,
  WellboreSchema,
  migrateV2Data,
  recommend,
  recommendationText,
  wellboreFrom3D,
  type Assessment,
  type MigrateV2Args,
  type SiteConfig,
  type Well,
} from '@lwa/engine';
import { buildSiteConfig, localToLatLon } from './build-enbridge-site';
import { main, type CliIo } from './migrate-v2';

/* ---------- fixtures and helpers ---------- */

const here = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
const fixture = (name: string): string => here(`./fixtures/${name}`);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

type V2Computed = { L: number; C: number; Lr: number; Cr: number; cell: number; riskIndex: number; rankLabel: string };
type V2Well = {
  id: string;
  licence: string;
  reviewer: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  scoredUnder: string;
  scores: Record<string, number | null> | null;
  computed?: V2Computed;
  legacy: { scores: Record<string, number>; total: number };
  [key: string]: unknown;
};

const V2_WELLS = readJson(fixture('wells.v2.json')) as V2Well[];
const V2_METHODOLOGY = readJson(fixture('methodology.v2.json')) as Record<string, unknown>;
const SITE = readJson(fixture('enbridge-site.json')) as SiteConfig;
const E2E_FIXTURE = here('../apps/web/e2e/fixtures/fort-sask.project.json');

const NOW = '2026-10-20T12:00:00.000Z';
const ACTOR = 'Migration Test';
const MANNING = '100/13-06-055-22W4/00';
const PHOENIX = '100/03-17-056-22W4/00'; // the v2 well with an empty reviewer

/** Fresh copies on every call, so a test that edits its inputs cannot leak into another. */
function v2Wells(): V2Well[] {
  return structuredClone(V2_WELLS);
}

function args(overrides: Partial<MigrateV2Args> = {}): MigrateV2Args {
  return {
    wells: v2Wells(),
    methodology: structuredClone(V2_METHODOLOGY),
    site: structuredClone(SITE),
    now: NOW,
    actor: ACTOR,
    ...overrides,
  };
}

function find<T>(xs: readonly T[], pred: (x: T) => boolean, what: string): T {
  const x = xs.find(pred);
  if (x === undefined) throw new Error(`not found: ${what}`);
  return x;
}

const wellOf = (wells: readonly Well[], licence: string): Well => find(wells, (w) => w.licence === licence, licence);
const assessmentOf = (assessments: readonly Assessment[], well: Well): Assessment =>
  find(assessments, (a) => a.wellId === well.id, `assessment for ${well.licence}`);
const v2Of = (licence: string): V2Well => find(V2_WELLS, (w) => w.licence === licence, licence);

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lwa-migrate-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function captureIo(cwd: string, now = NOW): CliIo & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { cwd, now: () => now, out: (line) => stdout.push(line), err: (line) => stderr.push(line), stdout, stderr };
}

/* ---------- the register: wells, assessments, parity ---------- */

describe('migrateV2Data on the v2 register', () => {
  it('migrates 5 wells; each assessment is final and its computed {L,C,cell,riskIndex,rank} equals the v2 computed block', () => {
    const r = migrateV2Data(args());
    expect(r.export.wells).toHaveLength(5);
    expect(r.export.assessments).toHaveLength(5);
    for (const v2 of V2_WELLS) {
      const a = assessmentOf(r.export.assessments, wellOf(r.export.wells, v2.licence));
      expect(a.status).toBe('final');
      const c = a.computed;
      expect(c && { L: c.L, C: c.C, cell: c.cell, riskIndex: c.riskIndex, rank: c.rank }).toEqual({
        L: v2.computed?.L,
        C: v2.computed?.C,
        cell: v2.computed?.cell,
        riskIndex: v2.computed?.riskIndex,
        rank: v2.computed?.rankLabel,
      });
    }
    expect(r.parity.map((p) => [p.licence, p.status])).toEqual(V2_WELLS.map((w) => [w.licence, 'ok']));
    expect(r.mismatches).toEqual([]);
  });

  it('W-LX242Q keeps methodologyRevision "1.0.0" and legacyV1.total 11', () => {
    const r = migrateV2Data(args());
    const well = find(r.export.wells, (w) => w.id === 'wel_v2_W-LX242Q', 'W-LX242Q');
    expect(assessmentOf(r.export.assessments, well).methodologyRevision).toBe('1.0.0');
    expect(well.legacyV1?.total).toBe(11);
    expect(well.legacyV1?.scores).toEqual(v2Of(well.licence).legacy.scores);
  });

  it('a v2 well with an empty reviewer (100/03-17-056-22W4/00) gets reviewerName "Unknown (v2)"', () => {
    expect(v2Of(PHOENIX).reviewer).toBe('');
    const r = migrateV2Data(args());
    expect(assessmentOf(r.export.assessments, wellOf(r.export.wells, PHOENIX)).reviewerName).toBe('Unknown (v2)');
  });

  it('every well has name and td_m from enbridge-site wellsByUwi (e.g. 100/13-06-055-22W4/00 → "MANNING 13-6 WILDCAT", 1447.2)', () => {
    const r = migrateV2Data(args());
    const manning = wellOf(r.export.wells, MANNING);
    expect([manning.name, manning.td_m]).toEqual(['MANNING 13-6 WILDCAT', 1447.2]);
    for (const w of r.export.wells) {
      const site = SITE.wellsByUwi[w.licence];
      expect(site, w.licence).toBeDefined();
      expect([w.name, w.td_m]).toEqual([site?.name, site?.td_m]);
    }
  });

  it('without a site file, name is "" and td_m is null, and the project has no injectors or formations', () => {
    const r = migrateV2Data(args({ site: null }));
    expect(r.export.wells.map((w) => [w.name, w.td_m])).toEqual(V2_WELLS.map(() => ['', null]));
    expect([r.export.project.injectors, r.export.project.formations]).toEqual([[], []]);
  });

  it('assessment reviewerName = v2 reviewer, assessedAt = v2 updatedAt, justifications {}', () => {
    const r = migrateV2Data(args());
    for (const v2 of V2_WELLS) {
      const a = assessmentOf(r.export.assessments, wellOf(r.export.wells, v2.licence));
      expect(a.reviewerName).toBe(v2.reviewer || 'Unknown (v2)');
      expect([a.assessedAt, a.createdAt, a.updatedAt]).toEqual([v2.updatedAt, v2.updatedAt, v2.updatedAt]);
      expect(a.justifications).toEqual({});
      expect(a.suggestions).toEqual({});
      expect([a.supersedesId, a.approvedByName, a.approvedAt]).toEqual([null, null, null]);
      expect(a.methodologyRevision).toBe(v2.scoredUnder);
      expect(a.scores).toEqual(v2.scores);
    }
  });

  it('recommendedAction.auto is the engine text for the scores; override is the trimmed v2 recActionOverride or null', () => {
    const wells = v2Wells();
    const target = find(wells, (w) => w.licence === MANNING, MANNING);
    target.recActionOverride = '  Re-enter and re-abandon.  ';
    const r = migrateV2Data(args({ wells }));
    const methodology = r.export.methodologies[0]?.methodology;
    if (!methodology) throw new Error('no methodology record');
    for (const w of r.export.wells) {
      const a = assessmentOf(r.export.assessments, w);
      expect(a.recommendedAction.auto).toBe(recommendationText(recommend(a.scores, methodology)));
      expect(a.recommendedAction.override).toBe(w.licence === MANNING ? 'Re-enter and re-abandon.' : null);
    }
  });

  it('maps every v2 well field (rule 5)', () => {
    const r = migrateV2Data(args());
    const v2 = v2Of(MANNING);
    expect(wellOf(r.export.wells, MANNING)).toEqual({
      id: 'wel_v2_W-W8QB2S',
      projectId: r.export.project.id,
      licence: MANNING,
      name: 'MANNING 13-6 WILDCAT',
      operator: 'Fred M. Manning Ltd.',
      lat: 53.728872,
      lon: -113.269667,
      spudYear: 1949,
      type: 'Unknown',
      trajectory: 'Vertical',
      status: 'Abandoned (P&A)',
      classification: 'Type 4',
      td_m: 1447.2,
      notes: v2.notes,
      construction: null,
      legacyV1: v2.legacy,
      createdAt: v2.createdAt,
      createdBy: 'Tahir Chisti',
      updatedAt: v2.updatedAt,
      updatedBy: 'Tahir Chisti',
    });
  });

  it('values outside the v3 enums fall back: classification to "Type 1" with a warning naming the licence', () => {
    const wells = v2Wells();
    const target = find(wells, (w) => w.licence === MANNING, MANNING);
    Object.assign(target, { klass: 'Type 12', type: 'Wildcat', traj: 'Slant', status: 'Dormant', year: 1700, lat: 123 });
    const r = migrateV2Data(args({ wells }));
    const well = wellOf(r.export.wells, MANNING);
    expect([well.classification, well.type, well.trajectory, well.status, well.spudYear, well.lat]).toEqual([
      'Type 1',
      'Unknown',
      'Unknown',
      'Unknown',
      null,
      null,
    ]);
    expect(r.warnings.some((w) => w.includes(MANNING) && w.includes('Type 1'))).toBe(true);
  });

  it('a v2 wellbore becomes construction; one that fails the schema becomes null with a warning, never an abort', () => {
    const wells = v2Wells();
    const [first, second] = wells;
    if (!first || !second) throw new Error('fixture has fewer than 2 wells');
    first.wellbore = { td: 1447.2, casings: [{ type: 'surface', top_m: 0, shoe_m: 186.5, source: 'manual' }], plugs: [null] };
    second.wellbore = { td: 'deep', casings: 'none' };
    const r = migrateV2Data(args({ wells }));
    expect(wellOf(r.export.wells, first.licence).construction).toEqual(WellboreSchema.parse(first.wellbore));
    expect(wellOf(r.export.wells, second.licence).construction).toBeNull();
    expect(r.warnings.some((w) => w.includes(second.licence) && /construction|wellbore/i.test(w))).toBe(true);
  });

  it('a v2 well without scores gets no assessment and parity status "unscored"', () => {
    const wells = v2Wells();
    const target = find(wells, (w) => w.licence === PHOENIX, PHOENIX);
    target.scores = null;
    delete target.computed;
    const r = migrateV2Data(args({ wells }));
    expect(r.export.wells).toHaveLength(5);
    expect(r.export.assessments).toHaveLength(4);
    expect(r.export.assessments.some((a) => a.wellId === wellOf(r.export.wells, PHOENIX).id)).toBe(false);
    expect(find(r.parity, (p) => p.licence === PHOENIX, PHOENIX)).toMatchObject({ status: 'unscored', v2: null, v3: null });
    expect(r.mismatches).toEqual([]);
  });

  it('a v2 score that is not a whole number migrates as unknown, with a warning, and fails parity', () => {
    const wells = v2Wells();
    const target = find(wells, (w) => w.licence === MANNING, MANNING);
    if (!target.scores) throw new Error('fixture well has no scores');
    target.scores.age = 3.5;
    const r = migrateV2Data(args({ wells }));
    expect(assessmentOf(r.export.assessments, wellOf(r.export.wells, MANNING)).scores.age).toBeNull();
    expect(r.warnings).toContain(`${MANNING}: age not a whole score 1-5; migrated as unknown`);
    expect(r.mismatches.map((p) => p.licence)).toEqual([MANNING]);
  });

  it('dry run with a forced mismatch returns mismatches and writes nothing', () => {
    const wells = v2Wells();
    const target = find(wells, (w) => w.licence === MANNING, MANNING);
    if (!target.computed) throw new Error('fixture well has no computed block');
    target.computed.cell = 99;
    const r = migrateV2Data(args({ wells }));
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({ licence: MANNING, status: 'mismatch', v2: { cell: 99 }, v3: { cell: 4 } });

    // The CLI refuses --write (exit 1) and a dry run writes nothing either.
    const dir = tempDir();
    writeFileSync(join(dir, 'wells.json'), JSON.stringify(wells));
    const out = join(dir, 'out', 'project.json');
    const io = captureIo(dir);
    expect(main(['--wells', 'wells.json', '--methodology', fixture('methodology.v2.json'), '--write', out], io)).toBe(1);
    expect(existsSync(out)).toBe(false);
    expect(io.stdout.join('\n')).toContain('mismatch');
    expect(io.stderr.join('\n')).toMatch(/refusing to write/i);
    expect(main(['--wells', 'wells.json', '--methodology', fixture('methodology.v2.json')], captureIo(dir))).toBe(1);
    expect(readdirSync(dir)).toEqual(['wells.json']);
  });
});

/* ---------- project, methodology, audit ---------- */

describe('migrateV2Data project, methodology record and audit trail', () => {
  it('project has 3 injectors and 9 formations with Calmar role seal and Nisku role reservoir', () => {
    const p = migrateV2Data(args()).export.project;
    expect(p.injectors.map((i) => i.id)).toEqual(['INJ-PINE', 'INJ-OAK', 'INJ-CEDAR']);
    expect(p.injectors.every((i) => i.aorRadius_m === 5000)).toBe(true);
    expect(p.formations).toHaveLength(9);
    expect(find(p.formations, (f) => f.id === 'fm-calmar', 'Calmar').role).toBe('seal');
    expect(find(p.formations, (f) => f.id === 'fm-nisku', 'Nisku').role).toBe('reservoir');
    expect(p.formations.filter((f) => f.role === 'other')).toHaveLength(7);
    expect(p.formations.map((f) => f.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const tops = p.formations.map((f) => f.top_m);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  it('project defaults to "Fort Saskatchewan / Wabamun Hub AOR" (AER, no approval); projectName overrides name and id', () => {
    const p = migrateV2Data(args()).export.project;
    expect(p).toMatchObject({
      id: 'prj_v2_fort-saskatchewan-wabamun-hub-aor',
      name: 'Fort Saskatchewan / Wabamun Hub AOR',
      jurisdiction: 'AER',
      description: '',
      requireApproval: false,
    });
    const named = migrateV2Data(args({ projectName: 'Nisku Enbridge POC AOR' })).export;
    expect([named.project.id, named.project.name]).toEqual(['prj_v2_nisku-enbridge-poc-aor', 'Nisku Enbridge POC AOR']);
    expect(named.wells.every((w) => w.projectId === named.project.id)).toBe(true);
  });

  it('one methodology record for the v2 methodology, noted "migrated from v2"', () => {
    const { methodologies } = migrateV2Data(args()).export;
    expect(methodologies).toEqual([
      {
        revision: '2.0.0',
        methodology: V2_METHODOLOGY,
        note: 'migrated from v2',
        publishedAt: V2_METHODOLOGY.updatedAt,
        publishedBy: V2_METHODOLOGY.updatedBy,
      },
    ]);
  });

  it('one import audit event per well, by the actor, at the v2 updatedAt, with the well as diff.after', () => {
    const { project, wells, auditEvents } = migrateV2Data(args()).export;
    expect(auditEvents).toHaveLength(wells.length);
    for (const well of wells) {
      expect(find(auditEvents, (e) => e.entityId === well.id, well.licence)).toEqual({
        id: `aud_v2_${well.id.slice('wel_v2_'.length)}_${Date.parse(well.updatedAt)}`,
        at: well.updatedAt,
        actorName: ACTOR,
        projectId: project.id,
        entity: 'well',
        entityId: well.id,
        action: 'import',
        diff: { before: null, after: well },
      });
    }
  });

  it('is deterministic: two runs at different times differ only in exportedAt', () => {
    const a = migrateV2Data(args({ now: '2026-10-20T12:00:00.000Z' })).export;
    const b = migrateV2Data(args({ now: '2027-01-01T00:00:00.000Z' })).export;
    const { exportedAt: atA, ...restA } = a;
    const { exportedAt: atB, ...restB } = b;
    expect([atA, atB]).toEqual(['2026-10-20T12:00:00.000Z', '2027-01-01T00:00:00.000Z']);
    expect(restA).toEqual(restB);
    expect(a.wells.map((w) => w.id)).toEqual(V2_WELLS.map((w) => `wel_v2_${w.id}`));
    expect(a.assessments.map((x) => x.id)).toEqual(V2_WELLS.map((w) => `asm_v2_${w.id}_${Date.parse(w.updatedAt)}`));
    expect(a.auditEvents.map((e) => e.id)).toEqual(V2_WELLS.map((w) => `aud_v2_${w.id}_${Date.parse(w.updatedAt)}`));
  });

  it('the export envelope parses as a ProjectExport', () => {
    const exp = migrateV2Data(args()).export;
    expect(ProjectExportSchema.parse(exp)).toEqual(exp);
    expect(exp).toMatchObject({ format: 'lwa-project', version: 1, exportedAt: NOW, exportedBy: ACTOR });
  });

  it('rejects an invalid v2 methodology with a readable error', () => {
    expect(() => migrateV2Data(args({ methodology: { ...V2_METHODOLOGY, revision: 'two' } }))).toThrow(
      /methodology.*revision must be semver/i,
    );
  });
});

/* ---------- browser exports ---------- */

describe('migrateV2Data with browser exports', () => {
  it('a browser export with a licence not in wells.json is added and listed in parity as "browser-only"', () => {
    const extra = { ...v2Wells()[0], id: 'W-BROWSER', licence: '100/01-01-055-22W4/00', updatedAt: '2026-09-01T00:00:00.000Z' };
    const r = migrateV2Data(args({ browserExports: [[extra]] }));
    expect(r.export.wells).toHaveLength(6);
    expect(r.export.assessments).toHaveLength(6);
    expect(wellOf(r.export.wells, extra.licence)).toMatchObject({ id: 'wel_v2_W-BROWSER', name: '', td_m: null });
    expect(find(r.parity, (p) => p.licence === extra.licence, extra.licence).status).toBe('browser-only');
    expect(r.mismatches).toEqual([]);
  });

  it('a well in both is matched by licence (trim/upper/no whitespace) and the newest updatedAt wins', () => {
    const [manning, zvx] = v2Wells();
    if (!manning || !zvx) throw new Error('fixture has fewer than 2 wells');
    const newer = { ...manning, licence: ' 100/13-06-055-22w4/00', notes: 'edited in a browser', updatedAt: '2026-09-01T00:00:00.000Z' };
    const older = { ...zvx, notes: 'stale browser copy', updatedAt: '2026-01-01T00:00:00.000Z' };
    const r = migrateV2Data(args({ browserExports: [[newer, older]] }));
    expect(r.export.wells).toHaveLength(5);
    const byId = (id: string): Well => find(r.export.wells, (w) => w.id === id, id);
    expect(byId('wel_v2_W-W8QB2S')).toMatchObject({ notes: 'edited in a browser', updatedAt: newer.updatedAt });
    expect(byId('wel_v2_W-ZVX8JD').notes).toBe(zvx.notes);
    expect(r.parity.map((p) => p.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(r.parity[0]?.note).toBe('newer copy from browser export 1');
  });

  it('a v1-shaped browser well is normalised (scores mapped, scoredUnder 1.0.0, legacy kept)', () => {
    const v1 = {
      id: 'W-V1ONLY',
      licence: '100/02-02-055-22W4/00',
      klass: 'Type 3',
      reviewer: 'Old Reviewer',
      scores: { plug: 5, barriers: 3, cement: 5, prox: 1, depthR: 5, depthC: 5, age: 5, access: 1, data: 5 },
      total: 35,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
    };
    const r = migrateV2Data(args({ browserExports: [[v1]] }));
    const well = wellOf(r.export.wells, v1.licence);
    expect(well.legacyV1).toEqual({ scores: v1.scores, total: 35 });
    const a = assessmentOf(r.export.assessments, well);
    expect(a.methodologyRevision).toBe('1.0.0');
    expect(a.scores).toMatchObject({ plugQuality: 5, cement: 5, barriers: 3, penetration: 5, scvf: null });
    expect(a.computed).toMatchObject({ cell: 12, rank: 'High' }); // the migrated-legacy golden vector
    expect(find(r.parity, (p) => p.licence === v1.licence, v1.licence).status).toBe('browser-only');
  });

  it('a 3D reviewer export adds new UWIs as wells with a draft assessment and skips UWIs the register has', () => {
    const fresh = {
      id: 'usr-1',
      uwi: '100/16-30-055-22W4/00',
      wellName: 'TEST 16-30',
      operator: 'Test Oil Ltd.',
      surfaceLat: 53.79,
      surfaceLon: -113.25,
      drillingYear: 1958,
      orientation: 'Vertical',
      status: 'Abandoned Oil',
      wellType: 'Oil',
      td: 1200,
      surfaceCasingDepth: 180,
      productionCasing: 'None — open hole below surface casing',
      intermediateCasing: '',
      cementTop: null,
      plugIntervals: 'No plug records on file',
      perfIntervals: '',
      formationPenetrated: 'Nisku',
      notes: 'added in the 3D viewer',
      s_plugQuality: 4,
      s_cement: 5,
      s_age: 4,
      s_data: 2.5, // not a whole score: ignored
      s_usdw: '3', // not numeric: ignored
      createdAt: 1753200000000,
      updatedAt: 1753300000000,
    };
    const inRegister = { ...fresh, id: 'enb-01', uwi: MANNING, wellName: 'MANNING (3D copy)', updatedAt: Date.parse('2027-01-01T00:00:00Z') };
    const r = migrateV2Data(args({ browserExports: [{ schemaVersion: 1, exportedAt: NOW, wells: [inRegister, fresh] }] }));

    expect(r.export.wells).toHaveLength(6);
    expect(wellOf(r.export.wells, MANNING).name).toBe('MANNING 13-6 WILDCAT'); // the register wins
    const well = wellOf(r.export.wells, fresh.uwi);
    expect(well).toMatchObject({
      name: 'TEST 16-30',
      operator: 'Test Oil Ltd.',
      lat: 53.79,
      lon: -113.25,
      spudYear: 1958,
      type: 'Oil Producer',
      trajectory: 'Vertical',
      status: 'Abandoned (P&A)',
      classification: 'Type 1',
      td_m: 1200,
      notes: 'added in the 3D viewer',
      legacyV1: null,
      createdAt: new Date(fresh.createdAt).toISOString(),
      updatedAt: new Date(fresh.updatedAt).toISOString(),
    });
    expect(well.construction).toEqual(WellboreSchema.parse(wellboreFrom3D(fresh)));
    expect(r.warnings.some((w) => w.includes(fresh.uwi) && w.includes('Type 1'))).toBe(true);
    expect(r.warnings).toContain(`${fresh.uwi}: data, usdw not a whole score 1-5; migrated as unknown`);

    const draft = assessmentOf(r.export.assessments, well);
    expect(draft).toMatchObject({
      status: 'draft',
      computed: null,
      assessedAt: null,
      reviewerName: 'Unknown (3D)',
      methodologyRevision: '2.0.0',
      justifications: {},
    });
    expect(draft.scores).toEqual({
      plugQuality: 4,
      cement: 5,
      barriers: null,
      scvf: null,
      age: 4,
      complexity: null,
      data: null,
      penetration: null,
      plume: null,
      usdw: null,
      access: null,
    });

    expect(r.parity.filter((p) => p.licence === MANNING).map((p) => p.status)).toEqual(['ok', '3d-skipped (register wins)']);
    expect(find(r.parity, (p) => p.licence === fresh.uwi, fresh.uwi).status).toBe('browser-only (3D, draft)');
    expect(r.mismatches).toEqual([]);
    expect(ProjectExportSchema.parse(r.export)).toEqual(r.export);
  });

  it('maps 3D status and well-type text onto the v3 enums', () => {
    const statuses = ['Orphan', 'Suspended Oil', 'Abandoned Gas', 'Producing Gas', 'Active', 'Potential Water Disposal'];
    const types = ['Oil', 'Gas', 'Injector', 'Water Disposal', 'Observation', 'Abandoned'];
    const wells = statuses.map((status, i) => ({
      uwi: `100/0${i + 1}-01-060-22W4/00`,
      status,
      wellType: types[i],
      createdAt: 1753200000000,
      updatedAt: 1753200000000,
    }));
    const r = migrateV2Data(args({ browserExports: [{ schemaVersion: 1, wells }] }));
    const migrated = wells.map((w) => wellOf(r.export.wells, w.uwi));
    expect(migrated.map((w) => w.status)).toEqual(['Orphaned', 'Suspended', 'Abandoned (P&A)', 'Active', 'Active', 'Unknown']);
    expect(migrated.map((w) => w.type)).toEqual(['Oil Producer', 'Gas Producer', 'Injection', 'Disposal', 'Observation', 'Unknown']);
    // No explicit scores: no draft.
    expect(r.export.assessments).toHaveLength(5);
  });

  it('rejects a browser export it does not recognise, with a readable error', () => {
    expect(() => migrateV2Data(args({ browserExports: [{ wells: 'nope' }] }))).toThrow(/browser export 1.*not recognised/i);
  });
});

/* ---------- CLI ---------- */

describe('migrate-v2 CLI', () => {
  it('--write writes exactly the export migrateV2Data builds; a dry run writes nothing', () => {
    const dir = tempDir();
    const out = join(dir, 'nested', 'fort-sask.project.json');
    const base = ['--wells', fixture('wells.v2.json'), '--methodology', fixture('methodology.v2.json'), '--site', fixture('enbridge-site.json'), '--actor', ACTOR];

    const dry = captureIo(dir);
    expect(main(['--', ...base], dry)).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
    expect(dry.stdout.join('\n')).toContain(MANNING);

    const io = captureIo(dir);
    expect(main(['--', ...base, '--write', out], io)).toBe(0);
    expect(readJson(out)).toEqual(migrateV2Data(args()).export);
  });

  it('exits 2 with usage on a missing required flag or an unknown flag', () => {
    const dir = tempDir();
    const io = captureIo(dir);
    expect(main(['--methodology', fixture('methodology.v2.json')], io)).toBe(2);
    expect(io.stderr.join('\n')).toMatch(/--wells/);
    expect(main(['--wells', fixture('wells.v2.json'), '--methodology', fixture('methodology.v2.json'), '--bogus'], captureIo(dir))).toBe(2);
  });
});

/* ---------- Enbridge site file ---------- */

describe('enbridge-site.json', () => {
  const ORIGIN = { lat: 53.71, lon: -113.36 };

  it('the local-frame formula puts Manning 13-6 (x 5952, y 2101) within 0.0005° of its stored surface location', () => {
    const { lat, lon } = localToLatLon(5952, 2101, ORIGIN);
    expect(Math.abs(lat - 53.728872)).toBeLessThan(0.0005);
    expect(Math.abs(lon - -113.269667)).toBeLessThan(0.0005);
  });

  it('holds the Pine/Oak/Cedar injectors converted from their local x/y with that formula', () => {
    const xy: Record<string, [number, number]> = { 'INJ-PINE': [7313, 8794], 'INJ-OAK': [7313, 7180], 'INJ-CEDAR': [5706, 5566] };
    for (const inj of SITE.injectors) {
      const point = xy[inj.id];
      if (!point) throw new Error(`unexpected injector ${inj.id}`);
      expect({ lat: inj.lat, lon: inj.lon }).toEqual(localToLatLon(point[0], point[1], ORIGIN));
    }
  });

  it('buildSiteConfig maps roles (caprock → seal, reservoir → reservoir, else other) and orders formations by top', () => {
    const site = buildSiteConfig(
      {
        name: 'Test site',
        origin: ORIGIN,
        aor: { radius_m: 4000 },
        injectors: [{ id: 'INJ-A', name: 'A', x: 0, y: 0 }],
        formations: [
          { id: 'fm-res', name: 'Res', top_m: 1080, base_m: 1160, role: 'reservoir' },
          { id: 'fm-cap', name: 'Cap', top_m: 1050, base_m: 1080, role: 'caprock' },
          { id: 'fm-top', name: 'Top', top_m: 290, base_m: 450, role: '' },
        ],
      },
      [{ uwi: '100/01-01-001-01W4/00', wellName: 'ONE', td: 900 }],
    );
    expect(site.injectors).toEqual([{ id: 'INJ-A', name: 'A', lat: 53.71, lon: -113.36, aorRadius_m: 4000 }]);
    expect(site.formations.map((f) => [f.id, f.role, f.order])).toEqual([
      ['fm-top', 'other', 0],
      ['fm-cap', 'seal', 1],
      ['fm-res', 'reservoir', 2],
    ]);
    expect(site.wellsByUwi).toEqual({ '100/01-01-001-01W4/00': { name: 'ONE', td_m: 900 } });
  });
});

/* ---------- committed e2e fixture ---------- */

describe('apps/web/e2e/fixtures/fort-sask.project.json', () => {
  it('parses as a ProjectExport with 5 wells and 5 final assessments, and matches a fresh migration', () => {
    const exp = ProjectExportSchema.parse(readJson(E2E_FIXTURE));
    expect(exp.wells).toHaveLength(5);
    expect(exp.assessments.filter((a) => a.status === 'final')).toHaveLength(5);
    const fresh = migrateV2Data(args({ now: exp.exportedAt, actor: exp.exportedBy })).export;
    expect(exp).toEqual(fresh);
  });
});
