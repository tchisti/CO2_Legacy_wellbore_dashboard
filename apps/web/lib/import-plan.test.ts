import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_METHODOLOGY,
  PARAM_KEYS,
  ProjectExportSchema,
  emptyScores,
  migrateV2Data,
  type Project,
  type ProjectExport,
  type Scores,
} from '@lwa/engine';
import { CSV_COLUMNS, toCsv, type CsvColumnKey } from '@/lib/csv';
import {
  MISSING_LICENCE_MESSAGE,
  carryStoredFields,
  migrateV2Into,
  planCsvImport,
  readImportJson,
  retargetExport,
  runCsvImport,
  type RegisterSnapshot,
} from '@/lib/import-plan';
import { loadRegister } from '@/lib/use-register';
import { createLocalStore } from '@/lib/store/local-store';
import type { Store } from '@/lib/store/store';

const FIXTURE_TEXT = readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8');
const FIXTURE_PROJECT_ID = 'prj_v2_fort-saskatchewan-wabamun-hub-aor';
const V2_WELLS: unknown[] = JSON.parse(readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'v2-wells.json'), 'utf8')) as unknown[];

const HEADER = CSV_COLUMNS.map((c) => c.hdr);
const FIRST = '100/07-21-055-22W4/00'; // fixture: final with scores plugQuality 1 … access 2

let dbCount = 0;
function newStore(): Store {
  dbCount += 1;
  return createLocalStore({
    dbName: `lwa-import-plan-${dbCount}`,
    actor: () => 'T. Chisti',
    now: () => '2026-10-21T09:00:00.000Z',
  });
}

async function fixtureStore(): Promise<Store> {
  const store = newStore();
  await store.importProject(JSON.parse(FIXTURE_TEXT), 'merge');
  return store;
}

const register = (store: Store, projectId = FIXTURE_PROJECT_ID): Promise<RegisterSnapshot> => loadRegister(store, projectId);

/** A CSV with the template header and the given rows (cells by key). */
function csv(...rows: Partial<Record<CsvColumnKey, string>>[]): string {
  return toCsv([HEADER, ...rows.map((cells) => CSV_COLUMNS.map((c) => cells[c.key] ?? ''))]);
}

/** Score cells for every parameter from a Scores record ('?' for null). */
function scoreCells(scores: Scores): Partial<Record<CsvColumnKey, string>> {
  return Object.fromEntries(
    CSV_COLUMNS.filter((c) => c.score).map((c) => [c.key, String(scores[c.score!] ?? '?')]),
  ) as Partial<Record<CsvColumnKey, string>>;
}

function planOf(text: string, snapshot: RegisterSnapshot) {
  const result = planCsvImport(text, snapshot, { currentYear: 2026 });
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

/* ---------- CSV ---------- */

describe('planCsvImport', () => {
  const EMPTY: RegisterSnapshot = { wells: [], drafts: new Map(), current: new Map() };

  it('refuses a file without the "Well ID / Licence" column, with the v2 message', () => {
    expect(planCsvImport('Operator,Latitude\nA,53\n', EMPTY)).toEqual({ ok: false, message: MISSING_LICENCE_MESSAGE });
    expect(MISSING_LICENCE_MESSAGE).toBe(
      'CSV is missing required header "Well ID / Licence". Please download the CSV Template and edit it.',
    );
  });

  it('refuses a file with no data rows', () => {
    expect(planCsvImport(`${HEADER.join(',')}\r\n`, EMPTY)).toEqual({
      ok: false,
      message: 'CSV appears empty. Please use the CSV Template.',
    });
  });

  it('counts rows to create, update and skip, and notes the Reviewer column', async () => {
    const store = await fixtureStore();
    const plan = planOf(
      csv({ licence: 'NEW-1', reviewer: 'T. Khan' }, { licence: FIRST, operator: 'Imperial' }, { licence: 'BAD', lat: '95' }),
      await register(store),
    );
    expect(plan.counts).toEqual({ create: 1, update: 1, errors: 1, drafts: 0 });
    expect(plan.inputs.map((i) => i.licence)).toEqual(['NEW-1', FIRST]);
    expect(plan.reviewerColumn).toBe(true);
    expect(plan.v1Detected).toBe(false);
  });

  it('existing draft → scores skipped with the warning "has a draft in progress; scores not imported"', async () => {
    const store = await fixtureStore();
    const well = (await store.wells.list(FIXTURE_PROJECT_ID)).find((w) => w.licence === FIRST)!;
    await store.assessments.saveDraft(well.id, {
      scores: { ...emptyScores(), cement: 2 },
      justifications: {},
      override: null,
      suggestions: {},
    });
    const plan = planOf(csv({ licence: FIRST, sc_plugQuality: '4' }), await register(store));
    expect(plan.rows[0]).toMatchObject({ status: 'updated', draft: 'kept' });
    expect(plan.rows[0]!.warnings).toEqual(['has a draft in progress; scores not imported']);
    expect(plan.drafts).toEqual([]);
  });

  it('a well with a current final gets a re-assessment draft; scores equal to the final make none', async () => {
    const store = await fixtureStore();
    const snapshot = await register(store);
    const well = snapshot.wells.find((w) => w.licence === FIRST)!;
    const finalScores = snapshot.current.get(well.id)!.scores;

    const changed = planOf(csv({ licence: FIRST, ...scoreCells({ ...finalScores, plugQuality: 4 }) }), snapshot);
    expect(changed.rows[0]).toMatchObject({ draft: 'reassessment', scored: 11 });
    expect(changed.drafts).toMatchObject([{ key: FIRST, scores: { ...finalScores, plugQuality: 4 }, reassessment: true }]);

    const same = planOf(csv({ licence: FIRST, ...scoreCells(finalScores) }), snapshot);
    expect(same.rows[0]).toMatchObject({ draft: 'same' });
    expect(same.drafts).toEqual([]);
  });
});

/* ---------- CSV scores over a current final (fix round 1, C1) ---------- */

const FINAL_SCORES: Scores = {
  plugQuality: 1,
  cement: 2,
  barriers: 1,
  scvf: null,
  age: 4,
  complexity: 3,
  data: 1,
  penetration: 4,
  plume: 3,
  usdw: 1,
  access: 2,
};
const FINAL_JUSTIFICATIONS = Object.fromEntries(
  PARAM_KEYS.filter((k) => FINAL_SCORES[k] !== null).map((k) => [k, `Reason for ${k}`]),
) as Record<string, string>;
const OVERRIDE = 'Re-enter and re-plug across the Calmar';

/** The final's justifications without `drop`. */
const justificationsWithout = (...drop: string[]) =>
  Object.fromEntries(Object.entries(FINAL_JUSTIFICATIONS).filter(([k]) => !drop.includes(k)));

/** A project with one well (F-1) finalised with FINAL_SCORES, a justification for every score and an override. */
async function finalisedWell() {
  const store = newStore();
  const project = await store.projects.create({ name: 'Final AOR' });
  const well = await store.wells.create(project.id, { licence: 'F-1', classification: 'Type 3' });
  const draft = await store.assessments.saveDraft(well.id, {
    scores: FINAL_SCORES,
    justifications: FINAL_JUSTIFICATIONS,
    override: OVERRIDE,
    suggestions: {},
  });
  const final = await store.assessments.finalise(draft.id);
  return { store, project, well, final };
}

describe('CSV scores over a current final', () => {
  it('a partial-score CSV keeps the other 10 scores, their justifications and the override', async () => {
    const { store, project, well, final } = await finalisedWell();
    const plan = planOf(csv({ licence: 'F-1', sc_plugQuality: '5' }), await register(store, project.id));
    expect(plan.rows[0]).toMatchObject({ status: 'updated', draft: 'reassessment', scoreChanges: ['Plug quality 1→5'] });
    expect(plan.drafts).toEqual([
      {
        key: 'F-1',
        scores: { ...FINAL_SCORES, plugQuality: 5 },
        justifications: justificationsWithout('plugQuality'),
        override: OVERRIDE,
        reassessment: true,
      },
    ]);

    await runCsvImport(store, project.id, plan);
    expect(await store.assessments.draft(well.id)).toMatchObject({
      status: 'draft',
      scores: { ...FINAL_SCORES, plugQuality: 5 },
      justifications: justificationsWithout('plugQuality'),
      recommendedAction: { auto: '', override: OVERRIDE },
    });
    expect(await store.assessments.current(well.id)).toEqual(final);
  });

  it('a partial CSV that matches the final plans "same": no draft', async () => {
    const { store, project, well } = await finalisedWell();
    const text = toCsv([
      ['Well ID / Licence', 'Abandonment & Plug Quality (1-5 or ?)', 'Cement Coverage & Quality (1-5 or ?)', 'SCVF / GM History (1-5 or ?)'],
      ['F-1', '1', '', '?'],
    ]);
    const plan = planOf(text, await register(store, project.id));
    expect(plan.rows[0]).toMatchObject({ draft: 'same', scoreChanges: [] });
    expect(plan.drafts).toEqual([]);
    await runCsvImport(store, project.id, plan);
    expect(await store.assessments.draft(well.id)).toBeNull();
  });

  it('"?" over a known score makes it Unknown (null) and drops that parameter\'s justification', async () => {
    const { store, project } = await finalisedWell();
    const plan = planOf(csv({ licence: 'F-1', sc_cement: '?' }), await register(store, project.id));
    expect(plan.rows[0]).toMatchObject({ draft: 'reassessment', scoreChanges: ['Cement 2→?'] });
    expect(plan.drafts[0]).toMatchObject({
      scores: { ...FINAL_SCORES, cement: null },
      justifications: justificationsWithout('cement'),
    });
  });

  it('rows of one licence list their changes against what the rows before left; an explicit "?" survives the merge', async () => {
    const { store, project } = await finalisedWell();
    const plan = planOf(
      csv({ licence: 'F-1', sc_plugQuality: '5' }, { licence: 'F-1', sc_plugQuality: '?', sc_cement: '3', sc_age: '' }),
      await register(store, project.id),
    );
    expect(plan.rows.map((r) => r.scoreChanges)).toEqual([['Plug quality 1→5'], ['Plug quality 5→?', 'Cement 2→3']]);
    expect(plan.drafts[0]!.scores).toEqual({ ...FINAL_SCORES, plugQuality: null, cement: 3 });
    expect(plan.drafts[0]!.justifications).toEqual(justificationsWithout('plugQuality', 'cement'));
  });

  it('a well without a final keeps the first-assessment rule: "?" cells alone make no draft', async () => {
    const store = newStore();
    const project = await store.projects.create({ name: 'Unscored AOR' });
    await store.wells.create(project.id, { licence: 'U-1' });
    const plan = planOf(csv({ licence: 'U-1', sc_plugQuality: '?', sc_cement: '?' }), await register(store, project.id));
    expect(plan.rows[0]).toMatchObject({ draft: null, scoreChanges: [] });
    expect(plan.drafts).toEqual([]);
  });
});

describe('runCsvImport', () => {
  it('writes the wells first, then each draft under the importing reviewer; rows with errors are skipped', async () => {
    const store = newStore();
    const project = await store.projects.create({ name: 'CSV AOR' });
    const plan = planOf(
      csv(
        { licence: 'A-1', operator: 'Cenovus', lat: '53.45', lon: '-113.6', sc_plugQuality: '1', sc_age: 'High' },
        { licence: 'A-2' },
        { licence: 'A-3', lat: '95' },
      ),
      await register(store, project.id),
    );
    expect(await store.wells.list(project.id)).toEqual([]); // planning writes nothing

    const outcome = await runCsvImport(store, project.id, plan);
    expect(outcome).toEqual({ created: 2, updated: 0, drafts: 1, skippedRows: 1, warnings: [], failedDrafts: [] });

    // One upsert stamps both wells alike, so list order between them is by id: look them up by licence.
    const wells = await store.wells.list(project.id);
    expect(wells.map((w) => w.licence).sort()).toEqual(['A-1', 'A-2']);
    const a1 = wells.find((w) => w.licence === 'A-1')!;
    const a2 = wells.find((w) => w.licence === 'A-2')!;
    expect(a1).toMatchObject({ operator: 'Cenovus', lat: 53.45, lon: -113.6, classification: 'Type 1' });
    const draft = await store.assessments.draft(a1.id);
    expect(draft).toMatchObject({
      status: 'draft',
      reviewerName: 'T. Chisti',
      scores: { ...emptyScores(), plugQuality: 1, age: 5 },
      justifications: {},
      suggestions: {},
      recommendedAction: { auto: '', override: null },
    });
    expect(await store.assessments.current(a1.id)).toBeNull();
    expect(await store.assessments.draft(a2.id)).toBeNull();
  });

  it('partial-column update leaves other stored fields intact', async () => {
    const store = await fixtureStore();
    const before = (await store.wells.list(FIXTURE_PROJECT_ID)).find((w) => w.licence === FIRST)!;
    const text = toCsv([
      ['Well ID / Licence', 'Operator'],
      [FIRST, 'Imperial Oil Resources'],
    ]);
    const outcome = await runCsvImport(store, FIXTURE_PROJECT_ID, planOf(text, await register(store)));
    expect(outcome).toMatchObject({ created: 0, updated: 1, drafts: 0 });

    const after = (await store.wells.get(before.id))!;
    // Coordinates, notes, construction, legacyV1 … unchanged; only the operator and the stamp move.
    expect(after).toEqual({
      ...before,
      operator: 'Imperial Oil Resources',
      updatedAt: after.updatedAt,
      updatedBy: 'T. Chisti',
    });
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(await store.wells.list(FIXTURE_PROJECT_ID)).toHaveLength(5);
  });

  it('does not overwrite a draft that was started after the plan was made', async () => {
    const store = await fixtureStore();
    const plan = planOf(csv({ licence: FIRST, sc_plugQuality: '4' }), await register(store));
    expect(plan.drafts).toHaveLength(1);
    const well = (await store.wells.list(FIXTURE_PROJECT_ID)).find((w) => w.licence === FIRST)!;
    const theirs = await store.assessments.saveDraft(well.id, {
      scores: { ...emptyScores(), cement: 2 },
      justifications: { cement: 'mine' },
      override: null,
      suggestions: {},
    });

    const outcome = await runCsvImport(store, FIXTURE_PROJECT_ID, plan);
    expect(outcome.drafts).toBe(0);
    expect(outcome.warnings).toEqual([`${FIRST}: has a draft in progress; scores not imported`]);
    expect(await store.assessments.draft(well.id)).toEqual(theirs);
  });
});

describe('runCsvImport when a draft cannot be saved', () => {
  it('reports the draft, saves the others, and keeps the wells written', async () => {
    const store = newStore();
    const project = await store.projects.create({ name: 'Flaky AOR' });
    const plan = planOf(
      csv({ licence: 'A-1', sc_plugQuality: '3' }, { licence: 'A-2', sc_plugQuality: '4' }, { licence: 'A-3', sc_plugQuality: '5' }),
      await register(store, project.id),
    );
    let calls = 0;
    const flaky: Pick<Store, 'wells' | 'assessments'> = {
      wells: store.wells,
      assessments: {
        ...store.assessments,
        saveDraft: async (wellId, input) => {
          calls += 1;
          if (calls === 2) throw new Error('QuotaExceededError');
          return store.assessments.saveDraft(wellId, input);
        },
      },
    };
    const outcome = await runCsvImport(flaky, project.id, plan);
    expect(outcome).toEqual({
      created: 3,
      updated: 0,
      drafts: 2,
      skippedRows: 0,
      warnings: [],
      failedDrafts: [{ licence: 'A-2', message: 'QuotaExceededError' }],
    });
    const wells = await store.wells.list(project.id);
    expect(wells).toHaveLength(3);
    const drafts = await Promise.all(wells.map((w) => store.assessments.draft(w.id)));
    expect(drafts.filter(Boolean)).toHaveLength(2);
  });
});

/* ---------- JSON ---------- */

describe('readImportJson', () => {
  it('recognises a project export and a bare v2 wells array', () => {
    expect(readImportJson(`﻿${FIXTURE_TEXT}`)).toEqual({ kind: 'project', data: JSON.parse(FIXTURE_TEXT) });
    expect(readImportJson(JSON.stringify(V2_WELLS))).toEqual({ kind: 'v2', wells: V2_WELLS });
  });

  it('rejects anything else with a readable message', () => {
    expect(() => readImportJson('{ nope')).toThrow('This file is not valid JSON.');
    expect(() => readImportJson('{"format":"other"}')).toThrow(
      'This JSON file is neither a project file exported from this app nor a v2 wells.json (an array of wells).',
    );
  });
});

const NOW = '2026-10-21T09:00:00.000Z';

describe('retargetExport', () => {
  const active: Project = {
    id: 'prj_active',
    name: 'Active AOR',
    jurisdiction: 'EPA',
    description: 'kept',
    injectors: [],
    formations: [],
    requireApproval: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'T. Chisti',
    updatedAt: '2026-10-02T00:00:00.000Z',
    updatedBy: 'T. Chisti',
  };

  it('puts the export under the stored active project: project record, wells and audit events', () => {
    const exp = JSON.parse(FIXTURE_TEXT) as ProjectExport;
    const out = retargetExport(exp, active);
    expect(out.project).toEqual(active);
    expect(out.wells.map((w) => w.projectId)).toEqual(exp.wells.map(() => 'prj_active'));
    expect(out.auditEvents.map((e) => e.projectId)).toEqual(exp.auditEvents.map(() => 'prj_active'));
    // The well snapshot an import event carries follows its well.
    for (const e of out.auditEvents) {
      const after = e.diff.after as { projectId?: string } | null;
      if (after && 'projectId' in after) expect(after.projectId).toBe('prj_active');
    }
    expect(out.assessments).toEqual(exp.assessments);
    expect(ProjectExportSchema.safeParse(out).success).toBe(true);
    expect(exp.project.id).toBe(FIXTURE_PROJECT_ID); // the input is not changed
  });

  it('a migrated v2 wells.json imports into the active project', async () => {
    const store = newStore();
    const project = await store.projects.create({ name: 'Empty AOR' });
    const migrated = migrateV2Into({ wells: V2_WELLS, project, now: '2026-10-21T09:00:00.000Z', actor: 'T. Chisti' });
    expect(migrated.export.project).toEqual(project);
    expect(migrated.mismatches).toEqual([]);

    const result = await store.importProject(migrated.export, 'merge');
    expect(result.wells).toEqual({ created: 2, updated: 0 });
    expect((await store.wells.list(project.id)).map((w) => w.licence).sort()).toEqual(
      V2_WELLS.map((w) => (w as { licence: string }).licence).sort(),
    );
    expect(await store.projects.get(project.id)).toEqual(project);
    expect(await store.projects.list()).toHaveLength(1);
  });
});

describe('migrateV2Into: one v2 wells.json, several projects (fix round 1, I2)', () => {
  it('goes into two projects, each with its finals and import history; re-importing into either changes nothing', async () => {
    const store = newStore();
    const a = await store.projects.create({ name: 'A AOR' });
    const b = await store.projects.create({ name: 'B AOR' });
    const into = async (id: string) => {
      const project = (await store.projects.get(id))!;
      return store.importProject(migrateV2Into({ wells: V2_WELLS, project, now: NOW, actor: 'T. Chisti' }).export, 'merge');
    };

    for (const p of [a, b]) {
      const result = await into(p.id);
      expect(result.wells).toEqual({ created: 2, updated: 0 });
      expect(result.assessments).toEqual({ added: 1, skipped: 0 });
      expect(result.auditEvents).toEqual({ added: 2, skipped: 0 });
    }
    for (const p of [a, b]) {
      const again = await into(p.id);
      expect(again.assessments).toEqual({ added: 0, skipped: 1 });
      expect(again.auditEvents).toEqual({ added: 0, skipped: 2 });
    }
    for (const p of [a, b]) {
      const wells = await store.wells.list(p.id);
      expect(wells).toHaveLength(2);
      const all = (await Promise.all(wells.map((w) => store.assessments.listForWell(w.id)))).flat();
      expect(all.map((x) => x.status)).toEqual(['final']); // one final, not two
      // The file's two well import events, once each (the store adds its own project event per import).
      const imports = (await store.audit.list({ projectId: p.id })).filter((e) => e.action === 'import' && e.entity === 'well');
      expect(imports).toHaveLength(2);
    }
  });

  it('into the project the v2 migration itself makes (prj_v2_<slug>), ids stay as the migration writes them', () => {
    const raw = migrateV2Data({
      wells: V2_WELLS,
      methodology: DEFAULT_METHODOLOGY,
      projectName: 'Cutover AOR',
      now: NOW,
      actor: 'T. Chisti',
    }).export;
    const base: Project = { ...raw.project };
    const own = migrateV2Into({ wells: V2_WELLS, project: base, now: NOW, actor: 'T. Chisti' }).export;
    expect(own.assessments.map((x) => x.id)).toEqual(raw.assessments.map((x) => x.id));
    expect(own.auditEvents.map((x) => x.id)).toEqual(raw.auditEvents.map((x) => x.id));
    // Renamed since it was migrated: still a v2 project, so still the migration's ids.
    const renamed = migrateV2Into({ wells: V2_WELLS, project: { ...base, name: 'Renamed AOR' }, now: NOW, actor: 'T. Chisti' });
    expect(renamed.export.assessments.map((x) => x.id)).toEqual(raw.assessments.map((x) => x.id));

    const other = migrateV2Into({ wells: V2_WELLS, project: { ...base, id: 'prj_other' }, now: NOW, actor: 'T. Chisti' }).export;
    expect(other.assessments.map((x) => x.id)).toEqual(raw.assessments.map((x) => x.id.replace(/^asm_v2_/, 'asm_v2_prj_other_')));
    expect(other.auditEvents.map((x) => x.id)).toEqual(raw.auditEvents.map((x) => x.id.replace(/^aud_v2_/, 'aud_v2_prj_other_')));
    expect(ProjectExportSchema.safeParse(other).success).toBe(true);
  });
});

describe('carryStoredFields (fix round 1, I3)', () => {
  it('a matching well keeps its name, TD and construction when the newer v2 record has none', async () => {
    const store = newStore();
    const project = await store.projects.create({ name: 'Cutover AOR' });
    const construction = {
      td: 1463.3,
      casings: [{ name: 'Surface', od_mm: 219.1, top_m: 0, shoe_m: 186.2 }],
      plugs: [{ n: 1, kind: 'cement', top_m: 1448, bottom_m: 1463 }],
      perforations: [],
      formations: [],
      packers: [],
      zones: [],
      notes: [],
    };
    const licence = (V2_WELLS[0] as { licence: string }).licence;
    const stored = await store.wells.create(project.id, {
      licence,
      name: 'NAMED IN V3',
      td_m: 1234.5,
      operator: 'v3 operator',
      construction,
    });
    const newer = V2_WELLS.map((w, i) => (i === 0 ? { ...(w as object), updatedAt: '2030-01-01T00:00:00.000Z' } : w));
    const migrated = migrateV2Into({ wells: newer, project: (await store.projects.get(project.id))!, now: NOW, actor: 'T. Chisti' });
    expect(migrated.export.wells[0]).toMatchObject({ licence, name: '', td_m: null, construction: null });

    const exp = carryStoredFields(migrated.export, await store.wells.list(project.id));
    expect(exp.wells[0]).toMatchObject({ name: 'NAMED IN V3', td_m: 1234.5, construction });
    expect(exp.wells[1]).toEqual(migrated.export.wells[1]); // no stored match: unchanged
    expect(migrated.export.wells[0]!.name).toBe(''); // the input is not changed

    await store.importProject(exp, 'merge');
    const after = (await store.wells.get(stored.id))!;
    // The newer v2 record wins where it has a value (operator); v3-only fields survive.
    expect(after).toMatchObject({ name: 'NAMED IN V3', td_m: 1234.5, construction, operator: 'Legacy Oil Co.' });
  });
});
