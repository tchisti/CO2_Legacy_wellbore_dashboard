import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectExportSchema, emptyScores, type Project, type ProjectExport, type Scores } from '@lwa/engine';
import { CSV_COLUMNS, toCsv, type CsvColumnKey } from '@/lib/csv';
import {
  MISSING_LICENCE_MESSAGE,
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
    expect(changed.drafts).toEqual([{ key: FIRST, scores: { ...finalScores, plugQuality: 4 }, reassessment: true }]);

    const same = planOf(csv({ licence: FIRST, ...scoreCells(finalScores) }), snapshot);
    expect(same.rows[0]).toMatchObject({ draft: 'same' });
    expect(same.drafts).toEqual([]);
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
    expect(outcome).toEqual({ created: 2, updated: 0, drafts: 1, skippedRows: 1, warnings: [] });

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
