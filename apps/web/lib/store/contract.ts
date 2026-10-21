// The Store contract: behaviour every Store implementation must show. LocalStore runs it from
// local-store.test.ts; a later backend store runs the same suite. Tests talk to the Store
// interface only (never to IndexedDB or Dexie), and inject the actor and a monotonic fake clock.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_METHODOLOGY,
  PARAM_KEYS,
  ProjectExportSchema,
  computeWell,
  emptyScores,
  recommend,
  recommendationText,
  validateMethodology,
  type Assessment,
  type AuditEvent,
  type Methodology,
  type MethodologyRecord,
  type Scores,
  type Well,
} from '@lwa/engine';
import {
  DuplicateLicenceError,
  FinaliseError,
  ImportError,
  NotFoundError,
  licenceKey,
  type DraftInput,
  type Store,
} from './store';

/** Builds a fresh, empty store (its own database) that uses the given actor and clock. */
export type StoreFactory = (opts: { actor: () => string; now: () => string }) => Store;

type Score = 1 | 2 | 3 | 4 | 5;

const LICENCE = '100/13-06-055-22W4/00';
/** The same licence as typed by someone else: different case, stray spaces. */
const LICENCE_VARIANT = ' 100/13-06-055-22w4/00 ';
const LICENCE_2 = '102/01-01-050-20W4/00';
const LICENCE_3 = '103/07-12-051-21W4/00';

/** A JSON round trip, as when an export is written to a file and read back. */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function byId<T extends { id: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function byRevision(xs: MethodologyRecord[]): MethodologyRecord[] {
  return [...xs].sort((a, b) => (a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0));
}

function scoresAll(v: Score | null): Scores {
  const s = emptyScores();
  for (const k of PARAM_KEYS) s[k] = v;
  return s;
}

function justifyAll(): DraftInput['justifications'] {
  const j: DraftInput['justifications'] = {};
  for (const k of PARAM_KEYS) j[k] = `Reason for ${k}`;
  return j;
}

function draftInput(
  scores: Scores,
  justifications: DraftInput['justifications'] = {},
  override: string | null = null,
  suggestions: DraftInput['suggestions'] = {},
): DraftInput {
  return { scores, justifications, override, suggestions };
}

function withRevision(revision: string): Methodology {
  const m = clone(DEFAULT_METHODOLOGY);
  m.revision = revision;
  return m;
}

async function newProject(s: Store, name = 'Wabamun Hub AOR') {
  return s.projects.create({ name });
}

/** A well with one final assessment (every param scored 3 and justified). */
async function scoredWell(s: Store, projectId: string, licence: string) {
  const well = await s.wells.create(projectId, { licence });
  const draft = await s.assessments.saveDraft(well.id, draftInput(scoresAll(3), justifyAll()));
  const final = await s.assessments.finalise(draft.id);
  return { well, final };
}

/** Everything a project holds, in a stable order. Import and export events are left out. */
async function dump(s: Store, projectId: string) {
  const wells = byId(await s.wells.list(projectId));
  const assessments = byId((await Promise.all(wells.map((w) => s.assessments.listForWell(w.id)))).flat());
  const auditEvents = byId(
    (await s.audit.list({ projectId })).filter((e) => e.action !== 'import' && e.action !== 'export'),
  );
  return {
    project: await s.projects.get(projectId),
    wells,
    assessments,
    auditEvents,
    methodologies: byRevision(await s.methodology.list()),
  };
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (e: unknown) => e,
  );
}

export function runStoreContract(makeStore: StoreFactory): void {
  const START = Date.parse('2026-01-01T00:00:00.000Z');
  let tick = 0;
  let actorName = 'T. Chisti';
  // One clock per test, shared by every store the test opens, one second per call.
  const now = (): string => new Date(START + ++tick * 1000).toISOString();
  const actor = (): string => actorName;
  const open = (): Store => makeStore({ actor, now });

  beforeEach(() => {
    tick = 0;
    actorName = 'T. Chisti';
  });

  describe('profile', () => {
    it('profile set/get round-trips', async () => {
      const s = open();
      expect(await s.profile.get()).toBeNull();
      await s.profile.set({ name: 'T. Chisti', initials: 'TC' });
      expect(await s.profile.get()).toEqual({ name: 'T. Chisti', initials: 'TC' });
      await expect(s.profile.set({ name: 'T', initials: 'TC' })).rejects.toThrow();
      expect(await s.profile.get()).toEqual({ name: 'T. Chisti', initials: 'TC' });
    });
  });

  describe('projects', () => {
    it('projects.create stamps createdBy from actor and writes an audit "create"', async () => {
      const s = open();
      const p = await newProject(s);
      expect(p).toMatchObject({
        name: 'Wabamun Hub AOR',
        jurisdiction: 'both',
        description: '',
        injectors: [],
        formations: [],
        requireApproval: false,
        createdBy: 'T. Chisti',
        updatedBy: 'T. Chisti',
      });
      expect(p.id).toMatch(/^prj_/);
      expect(p.updatedAt).toBe(p.createdAt);
      expect(await s.projects.get(p.id)).toEqual(p);
      expect(await s.projects.list()).toEqual([p]);

      const events = await s.audit.list({ projectId: p.id });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entity: 'project',
        entityId: p.id,
        projectId: p.id,
        action: 'create',
        actorName: 'T. Chisti',
        at: p.createdAt,
      });
      expect(events[0].diff).toEqual({ before: null, after: p });
    });

    it('projects.update applies the patch, bumps updatedAt/updatedBy and audits before/after', async () => {
      const s = open();
      const p = await newProject(s);
      actorName = 'A. Reviewer';
      const injector = { id: 'inj-1', name: 'INJ-1', lat: 53.55, lon: -114.1, aorRadius_m: 3200 };
      const u = await s.projects.update(p.id, { description: 'Pilot AOR', injectors: [injector] });
      expect(u).toMatchObject({
        id: p.id,
        name: p.name,
        description: 'Pilot AOR',
        injectors: [injector],
        createdBy: 'T. Chisti',
        createdAt: p.createdAt,
        updatedBy: 'A. Reviewer',
      });
      expect(Date.parse(u.updatedAt)).toBeGreaterThan(Date.parse(p.updatedAt));
      expect(await s.projects.get(p.id)).toEqual(u);

      const events = await s.audit.list({ entityId: p.id });
      expect(events.map((e) => e.action)).toEqual(['update', 'create']);
      expect(events[0]).toMatchObject({ actorName: 'A. Reviewer', at: u.updatedAt, diff: { before: p, after: u } });

      // Injector ids must be unique: an exported project has to import again.
      await expect(s.projects.update(p.id, { injectors: [injector, injector] })).rejects.toThrow(/injector/i);
      expect(await s.projects.get(p.id)).toEqual(u);
    });

    it('projects.update that changes nothing returns the stored project and writes nothing', async () => {
      const s = open();
      const p = await newProject(s);
      expect(await s.projects.update(p.id, { name: p.name, description: undefined })).toEqual(p);
      expect(await s.projects.get(p.id)).toEqual(p);
      expect((await s.audit.list({ entityId: p.id })).map((e) => e.action)).toEqual(['create']);
    });

    it('projects.remove deletes the project, its wells, assessments and audit events, then writes one "delete" event', async () => {
      const s = open();
      const p = await newProject(s);
      const keep = await newProject(s, 'Keep');
      const { well } = await scoredWell(s, p.id, LICENCE);
      await s.wells.create(p.id, { licence: LICENCE_2 });
      const kept = await s.wells.create(keep.id, { licence: LICENCE });
      const eventCount = (await s.audit.list({ projectId: p.id })).length;
      expect(eventCount).toBe(5); // project, well, draft, finalise, second well

      await s.projects.remove(p.id);

      expect(await s.projects.get(p.id)).toBeNull();
      expect(await s.projects.list()).toEqual([keep]);
      expect(await s.wells.list(p.id)).toEqual([]);
      expect(await s.wells.get(well.id)).toBeNull();
      expect(await s.assessments.listForWell(well.id)).toEqual([]);
      const events = await s.audit.list({ projectId: p.id });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'delete',
        entity: 'project',
        entityId: p.id,
        diff: { before: { project: p, counts: { wells: 2, assessments: 1, auditEvents: eventCount } }, after: null },
      });
      // the other project is untouched
      expect(await s.wells.list(keep.id)).toEqual([kept]);
      expect(await s.audit.list({ projectId: keep.id })).toHaveLength(2);
    });
  });

  describe('wells', () => {
    it('wells.create defaults; wells.update bumps updatedAt/updatedBy; audit diff has before/after', async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE });
      expect(w).toMatchObject({
        projectId: p.id,
        licence: LICENCE,
        name: '',
        operator: '',
        lat: null,
        lon: null,
        spudYear: null,
        type: 'Unknown',
        trajectory: 'Unknown',
        status: 'Unknown',
        classification: 'Type 1',
        td_m: null,
        notes: '',
        construction: null,
        createdBy: 'T. Chisti',
        updatedBy: 'T. Chisti',
      });
      expect(w.id).toMatch(/^wel_/);

      actorName = 'A. Reviewer';
      const u = await s.wells.update(w.id, { name: 'Wabamun 1', spudYear: 1958 });
      expect(u).toMatchObject({
        id: w.id,
        licence: LICENCE,
        name: 'Wabamun 1',
        spudYear: 1958,
        createdAt: w.createdAt,
        createdBy: 'T. Chisti',
        updatedBy: 'A. Reviewer',
      });
      expect(Date.parse(u.updatedAt)).toBeGreaterThan(Date.parse(w.updatedAt));
      expect(await s.wells.get(w.id)).toEqual(u);
      expect(await s.wells.list(p.id)).toEqual([u]);

      const events = await s.audit.list({ entityId: w.id });
      expect(events.map((e) => e.action)).toEqual(['update', 'create']);
      expect(events[0]).toMatchObject({ entity: 'well', projectId: p.id, actorName: 'A. Reviewer', at: u.updatedAt });
      expect(events[0].diff).toEqual({ before: w, after: u });
      expect(events[1].diff).toEqual({ before: null, after: w });

      // an invalid patch is rejected and nothing is written
      await expect(s.wells.update(w.id, { lat: 123 })).rejects.toThrow();
      expect(await s.wells.get(w.id)).toEqual(u);
      expect(await s.audit.list({ entityId: w.id })).toHaveLength(2);
    });

    it('wells.update that changes nothing returns the stored well and writes no audit event', async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE, name: 'MANNING 13-6' });
      expect(await s.wells.update(w.id, { name: 'MANNING 13-6', notes: undefined })).toEqual(w);
      expect((await s.audit.list({ entityId: w.id })).map((e) => e.action)).toEqual(['create']);
    });

    it('a write to a project, well or assessment the store does not have rejects with NotFoundError and writes nothing', async () => {
      const s = open();
      const p = await newProject(s);
      const before = await s.audit.list({});
      const missing: [string, () => Promise<unknown>][] = [
        ['projects.update', () => s.projects.update('prj_missing', { name: 'X' })],
        ['projects.remove', () => s.projects.remove('prj_missing')],
        ['wells.create', () => s.wells.create('prj_missing', { licence: LICENCE })],
        ['wells.upsertByLicence', () => s.wells.upsertByLicence('prj_missing', [{ licence: LICENCE }])],
        ['wells.update', () => s.wells.update('wel_missing', { name: 'X' })],
        ['wells.remove', () => s.wells.remove('wel_missing')],
        ['assessments.saveDraft', () => s.assessments.saveDraft('wel_missing', draftInput(emptyScores()))],
        ['assessments.finalise', () => s.assessments.finalise('asm_missing')],
        ['assessments.discardDraft', () => s.assessments.discardDraft('asm_missing')],
        ['exportProject', () => s.exportProject('prj_missing')],
      ];
      for (const [name, call] of missing) {
        const err = await rejection(call());
        expect(err, name).toBeInstanceOf(NotFoundError);
        expect((err as Error).message, name).toMatch(/^No (project|well|assessment) with id (prj|wel|asm)_missing$/);
      }
      expect(await s.audit.list({})).toEqual(before);
      expect(await s.wells.list(p.id)).toEqual([]);
    });

    it('wells.create rejects a duplicate licence (case and spaces ignored) with DuplicateLicenceError', async () => {
      const s = open();
      const p = await newProject(s);
      expect(licenceKey(LICENCE_VARIANT)).toBe(licenceKey(LICENCE));
      const w = await s.wells.create(p.id, { licence: LICENCE });

      const err = await rejection(s.wells.create(p.id, { licence: LICENCE_VARIANT }));
      expect(err).toBeInstanceOf(DuplicateLicenceError);
      expect(err).toMatchObject({ existingId: w.id });
      expect(await s.wells.list(p.id)).toEqual([w]);

      // the same licence is fine in another project
      const other = await newProject(s, 'Other');
      await expect(s.wells.create(other.id, { licence: LICENCE })).resolves.toMatchObject({ projectId: other.id });

      // renaming another well onto the licence is rejected too
      const w2 = await s.wells.create(p.id, { licence: LICENCE_2 });
      await expect(s.wells.update(w2.id, { licence: LICENCE_VARIANT })).rejects.toBeInstanceOf(DuplicateLicenceError);
      expect(await s.wells.get(w2.id)).toEqual(w2);
    });

    it('wells.upsertByLicence: new → created 1; same licence again → updated 1, same id', async () => {
      const s = open();
      const p = await newProject(s);
      const first = await s.wells.upsertByLicence(p.id, [{ licence: LICENCE, operator: 'Acme' }]);
      expect(first).toMatchObject({ created: 1, updated: 0 });
      expect(first.ids).toHaveLength(1);

      const second = await s.wells.upsertByLicence(p.id, [{ licence: LICENCE_VARIANT, name: 'Wabamun 1' }]);
      expect(second).toEqual({ created: 0, updated: 1, ids: first.ids });
      // fields the input omits are kept, and so is the stored licence text
      const wells = await s.wells.list(p.id);
      expect(wells).toHaveLength(1);
      expect(wells[0]).toMatchObject({ id: first.ids[0], licence: LICENCE, name: 'Wabamun 1', operator: 'Acme' });
      expect((await s.audit.list({ entityId: first.ids[0] })).map((e) => e.action)).toEqual(['update', 'create']);
    });

    it('wells.upsertByLicence: identical data leaves the well and its history untouched; ids follow input order', async () => {
      const s = open();
      const p = await newProject(s);
      const { ids } = await s.wells.upsertByLicence(p.id, [{ licence: LICENCE, name: 'Wabamun 1' }]);
      const before = await s.wells.get(ids[0]);
      const eventsBefore = await s.audit.list({ entityId: ids[0] });

      const again = await s.wells.upsertByLicence(p.id, [{ licence: LICENCE_2 }, { licence: LICENCE, name: 'Wabamun 1' }]);
      expect(again).toMatchObject({ created: 1, updated: 1 });
      expect(again.ids[1]).toBe(ids[0]);
      expect(await s.wells.get(again.ids[0])).toMatchObject({ licence: LICENCE_2 });
      expect(await s.wells.get(ids[0])).toEqual(before);
      expect(await s.audit.list({ entityId: ids[0] })).toEqual(eventsBefore);
    });

    it('wells.upsertByLicence: unchanged matches followed by a new licence and a change commit as one', async () => {
      // Regression: a run of no-op matches used to end the IndexedDB transaction before the next
      // write (Dexie PrematureCommitError), e.g. re-importing a CSV with one new row at the end.
      const s = open();
      const p = await newProject(s);
      const { ids } = await s.wells.upsertByLicence(p.id, [{ licence: 'A' }, { licence: 'B' }, { licence: 'C' }, { licence: 'E' }]);
      const result = await s.wells.upsertByLicence(p.id, [
        { licence: 'A' },
        { licence: 'B' },
        { licence: 'C' },
        { licence: 'D' },
        { licence: 'E', operator: 'Acme' },
      ]);
      expect(result).toMatchObject({ created: 1, updated: 4 });
      expect(result.ids.slice(0, 3)).toEqual(ids.slice(0, 3));
      expect(result.ids[4]).toBe(ids[3]);
      expect(await s.wells.get(ids[3]!)).toMatchObject({ operator: 'Acme' });
      expect(await s.wells.list(p.id)).toHaveLength(5);
    });

    it('wells.remove snapshots assessments in audit (diff.before.assessments.length === n) and deletes them', async () => {
      const s = open();
      const p = await newProject(s);
      const { well, final } = await scoredWell(s, p.id, LICENCE);
      const draft = await s.assessments.saveDraft(well.id, draftInput(scoresAll(2), justifyAll()));
      const stored = await s.wells.get(well.id);

      await s.wells.remove(well.id);

      expect(await s.wells.get(well.id)).toBeNull();
      expect(await s.wells.list(p.id)).toEqual([]);
      expect(await s.assessments.listForWell(well.id)).toEqual([]);
      const events = await s.audit.list({ entityId: well.id });
      expect(events.map((e) => e.action)).toEqual(['delete', 'create']);
      expect(events[0]).toMatchObject({ entity: 'well', projectId: p.id, diff: { after: null } });
      const snapshot = events[0].diff.before as { well: Well; assessments: Assessment[] };
      expect(snapshot.well).toEqual(stored);
      expect(snapshot.assessments).toHaveLength(2);
      expect(byId(snapshot.assessments)).toEqual(byId([final, draft]));
    });
  });

  describe('assessments', () => {
    it('saveDraft twice updates the same draft; current() stays null until finalise', async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE });

      const d1 = await s.assessments.saveDraft(w.id, draftInput(emptyScores()));
      expect(d1).toMatchObject({
        wellId: w.id,
        status: 'draft',
        computed: null,
        assessedAt: null,
        supersedesId: null,
        reviewerName: 'T. Chisti',
        methodologyRevision: '2.0.0',
        recommendedAction: { auto: '', override: null },
        approvedByName: null,
        approvedAt: null,
      });
      expect(d1.id).toMatch(/^asm_/);

      const scores: Scores = { ...emptyScores(), cement: 4 };
      const suggestions: DraftInput['suggestions'] = { penetration: { score: 1, source: 'derived', basis: 'from Type 1' } };
      const d2 = await s.assessments.saveDraft(
        w.id,
        draftInput(scores, { cement: 'TOC below the seal on the CBL' }, '  Run a CBL first  ', suggestions),
      );
      expect(d2.id).toBe(d1.id);
      expect(d2.createdAt).toBe(d1.createdAt);
      expect(Date.parse(d2.updatedAt)).toBeGreaterThan(Date.parse(d1.updatedAt));
      expect(d2).toMatchObject({
        scores,
        justifications: { cement: 'TOC below the seal on the CBL' },
        suggestions,
        recommendedAction: { auto: '', override: 'Run a CBL first' },
      });
      expect(await s.assessments.listForWell(w.id)).toEqual([d2]);
      expect(await s.assessments.draft(w.id)).toEqual(d2);
      expect(await s.assessments.current(w.id)).toBeNull();

      // a blank override means "no override"
      const d3 = await s.assessments.saveDraft(w.id, draftInput(scores, {}, '   '));
      expect(d3.recommendedAction.override).toBeNull();
      expect((await s.audit.list({ entityId: d1.id })).map((e) => e.action)).toEqual(['update', 'update', 'create']);
    });

    it('finalise rejects with FinaliseError listing params that have a score but no justification', async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE });
      const scores: Scores = { ...emptyScores(), age: 2, plugQuality: 3, cement: 4 };
      const d = await s.assessments.saveDraft(w.id, draftInput(scores, { cement: 'CBL log', age: '   ' }));

      const err = await rejection(s.assessments.finalise(d.id));
      expect(err).toBeInstanceOf(FinaliseError);
      expect((err as FinaliseError).missing).toEqual(['plugQuality', 'age']);
      expect(await s.assessments.current(w.id)).toBeNull();
      expect(await s.assessments.draft(w.id)).toEqual(d);
    });

    it('finalise accepts Unknown scores without justification', async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE });
      const d = await s.assessments.saveDraft(w.id, draftInput(emptyScores()));
      const f = await s.assessments.finalise(d.id);
      expect(f.status).toBe('final');
      expect(f.computed?.rank).toBe(computeWell(emptyScores(), DEFAULT_METHODOLOGY).rank.label);
    });

    it('finalise: computed equals computeWell(scores, current methodology); recommendedAction.auto === recommendationText(recommend(scores,m)); status final; assessedAt set; supersedesId null on first', async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE });
      const scores: Scores = { ...scoresAll(3), plugQuality: 5, cement: 4 };
      const d = await s.assessments.saveDraft(w.id, draftInput(scores, justifyAll(), 'Re-enter and squeeze'));

      actorName = 'A. Reviewer';
      const f = await s.assessments.finalise(d.id);
      const c = computeWell(scores, DEFAULT_METHODOLOGY);
      expect(f).toMatchObject({
        id: d.id,
        wellId: w.id,
        status: 'final',
        methodologyRevision: '2.0.0',
        supersedesId: null,
        reviewerName: 'A. Reviewer',
        scores,
        justifications: justifyAll(),
        createdAt: d.createdAt,
      });
      expect(f.computed).toEqual({ L: c.L, C: c.C, Lr: c.Lr, Cr: c.Cr, cell: c.cell, riskIndex: c.riskIndex, rank: c.rank.label });
      expect(f.recommendedAction).toEqual({
        auto: recommendationText(recommend(scores, DEFAULT_METHODOLOGY)),
        override: 'Re-enter and squeeze',
      });
      expect(f.assessedAt).not.toBeNull();
      expect(Date.parse(f.assessedAt ?? '')).toBeGreaterThan(Date.parse(d.updatedAt));
      expect(await s.assessments.current(w.id)).toEqual(f);
      expect(await s.assessments.draft(w.id)).toBeNull();
      expect(await s.assessments.listForWell(w.id)).toEqual([f]);

      const [event] = await s.audit.list({ entityId: f.id, limit: 1 });
      expect(event).toMatchObject({
        action: 'finalise',
        entity: 'assessment',
        projectId: p.id,
        actorName: 'A. Reviewer',
        at: f.assessedAt,
        diff: { before: d, after: f },
      });
      // a final is not a draft any more
      await expect(s.assessments.finalise(f.id)).rejects.toThrow();
    });

    it('re-finalise: new final has supersedesId = previous final id; previous record unchanged', async () => {
      const s = open();
      const p = await newProject(s);
      const { well, final: f1 } = await scoredWell(s, p.id, LICENCE);
      const d2 = await s.assessments.saveDraft(well.id, draftInput(scoresAll(4), justifyAll()));
      expect(d2.id).not.toBe(f1.id);
      expect(await s.assessments.current(well.id)).toEqual(f1);

      const f2 = await s.assessments.finalise(d2.id);
      expect(f2.supersedesId).toBe(f1.id);
      expect(await s.assessments.current(well.id)).toEqual(f2);
      expect(await s.assessments.listForWell(well.id)).toEqual([f2, f1]);
    });

    it("finalise stamps current revision, not the draft's (publish 2.1.0 between saveDraft and finalise → methodologyRevision \"2.1.0\")", async () => {
      const s = open();
      const p = await newProject(s);
      const w = await s.wells.create(p.id, { licence: LICENCE });
      const scores = scoresAll(4);
      const d = await s.assessments.saveDraft(w.id, draftInput(scores, justifyAll()));
      expect(d.methodologyRevision).toBe('2.0.0');

      // 2.1.0 renames the bands, so a result computed under 2.0.0 would show
      const m21 = withRevision('2.1.0');
      m21.matrix.bands = m21.matrix.bands.map((b) => ({ ...b, label: `${b.label} (2.1)` }));
      await s.methodology.publish(m21, 'band labels');

      const f = await s.assessments.finalise(d.id);
      expect(f.methodologyRevision).toBe('2.1.0');
      expect(f.computed?.rank).toBe(computeWell(scores, m21).rank.label);
      expect(f.recommendedAction.auto).toBe(recommendationText(recommend(scores, m21)));
    });

    it('discardDraft deletes the draft and audits "delete"; a final cannot be discarded', async () => {
      const s = open();
      const p = await newProject(s);
      const { well, final } = await scoredWell(s, p.id, LICENCE);
      const d = await s.assessments.saveDraft(well.id, draftInput(scoresAll(4), justifyAll()));

      await s.assessments.discardDraft(d.id);
      expect(await s.assessments.draft(well.id)).toBeNull();
      expect(await s.assessments.listForWell(well.id)).toEqual([final]);
      const [event] = await s.audit.list({ entityId: d.id, limit: 1 });
      expect(event).toMatchObject({ action: 'delete', entity: 'assessment', projectId: p.id, diff: { before: d, after: null } });

      await expect(s.assessments.discardDraft(final.id)).rejects.toThrow();
      expect(await s.assessments.current(well.id)).toEqual(final);
    });
  });

  describe('methodology', () => {
    it('methodology.current() is DEFAULT_METHODOLOGY on a fresh store; publish validates and refuses an invalid rulebook', async () => {
      const s = open();
      expect(await s.methodology.current()).toEqual(DEFAULT_METHODOLOGY);
      const records = await s.methodology.list();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        revision: '2.0.0',
        note: 'built-in default',
        publishedBy: 'system',
        methodology: DEFAULT_METHODOLOGY,
      });

      const badRevision = withRevision('2.1');
      const { errors } = validateMethodology(badRevision);
      expect(errors.length).toBeGreaterThan(0);
      await expect(s.methodology.publish(badRevision, 'bad')).rejects.toThrow(errors[0]);

      const missingParam = withRevision('2.1.0');
      missingParam.params = missingParam.params.slice(1);
      await expect(s.methodology.publish(missingParam, 'bad')).rejects.toThrow('missing param: plugQuality');

      await expect(s.methodology.publish(withRevision('2.0.0'), 'again')).rejects.toThrow(/2\.0\.0/);
      expect(await s.methodology.list()).toEqual(records);
      expect(await s.audit.list({})).toEqual([]);
    });

    it('methodology.publish: the highest semver revision is current; publishing is audited', async () => {
      const s = open();
      actorName = 'Admin';
      const rec = await s.methodology.publish(withRevision('2.1.0'), 'weights review');
      expect(rec).toMatchObject({
        revision: '2.1.0',
        note: 'weights review',
        publishedBy: 'Admin',
        methodology: withRevision('2.1.0'),
      });
      expect(await s.methodology.current()).toEqual(withRevision('2.1.0'));

      await s.methodology.publish(withRevision('2.0.1'), 'wording');
      expect((await s.methodology.current()).revision).toBe('2.1.0');
      await s.methodology.publish(withRevision('2.9.0'), 'nine');
      await s.methodology.publish(withRevision('2.10.0'), 'ten');
      expect((await s.methodology.current()).revision).toBe('2.10.0');
      expect(await s.methodology.list()).toHaveLength(5);

      const [event] = await s.audit.list({ entityId: '2.1.0' });
      expect(event).toMatchObject({
        entity: 'methodology',
        projectId: null,
        action: 'create',
        actorName: 'Admin',
        at: rec.publishedAt,
        diff: { before: null, after: rec },
      });
    });
  });

  describe('export and import', () => {
    it('exportProject includes project, wells, assessments, methodologies, auditEvents and validates against ProjectExportSchema', async () => {
      const s = open();
      const p = await newProject(s);
      const other = await newProject(s, 'Other');
      const { well, final } = await scoredWell(s, p.id, LICENCE);
      const second = await s.wells.create(p.id, { licence: LICENCE_2 });
      const draft = await s.assessments.saveDraft(second.id, draftInput(emptyScores()));
      await s.wells.create(other.id, { licence: LICENCE_3 });
      await s.methodology.publish(withRevision('2.1.0'), 'weights review');
      const projectEvents = await s.audit.list({ projectId: p.id });

      actorName = 'Exporter';
      const file = await s.exportProject(p.id);
      expect(ProjectExportSchema.safeParse(file).success).toBe(true);
      expect(file).toMatchObject({ format: 'lwa-project', version: 1, exportedBy: 'Exporter', project: p });
      expect(byId(file.wells)).toEqual(byId([well, second]));
      expect(byId(file.assessments)).toEqual(byId([final, draft]));
      expect(byRevision(file.methodologies)).toEqual(byRevision(await s.methodology.list()));
      expect(byId(file.auditEvents)).toEqual(byId(projectEvents));

      // the export is audited, but the event is not part of the file
      const [latest] = await s.audit.list({ projectId: p.id, limit: 1 });
      expect(latest).toMatchObject({
        action: 'export',
        entity: 'project',
        entityId: p.id,
        actorName: 'Exporter',
        at: file.exportedAt,
      });
      expect(file.auditEvents.some((e) => e.id === latest.id)).toBe(false);
    });

    it('export from store A, import into an empty store B → identical project, wells, assessments, methodology records and audit events', async () => {
      const a = open();
      const p = await newProject(a);
      await a.projects.update(p.id, {
        formations: [{ id: 'f-1', name: 'Nisku', top_m: 1600, base_m: 1650, role: 'reservoir', order: 0 }],
      });
      const { well } = await scoredWell(a, p.id, LICENCE);
      const reassess = await a.assessments.saveDraft(well.id, draftInput(scoresAll(4), justifyAll()));
      await a.assessments.finalise(reassess.id);
      const second = await a.wells.create(p.id, { licence: LICENCE_2, name: 'Second', lat: 53.5, lon: -114 });
      await a.assessments.saveDraft(second.id, draftInput(emptyScores()));
      await a.methodology.publish(withRevision('2.1.0'), 'weights review');
      const expected = await dump(a, p.id);

      const file = clone(await a.exportProject(p.id));
      const b = open();
      const result = await b.importProject(file, 'merge');

      expect(result).toEqual({
        wells: { created: 2, updated: 0 },
        assessments: { added: 3, skipped: 0 },
        auditEvents: { added: file.auditEvents.length, skipped: 0 },
        removed: { wells: 0, assessments: 0 },
        warnings: [],
      });
      expect(await dump(b, p.id)).toEqual(expected);
      expect(await b.methodology.current()).toEqual(await a.methodology.current());
      expect(await b.assessments.current(well.id)).toEqual(await a.assessments.current(well.id));
      // the import itself is audited once
      const imports = (await b.audit.list({ projectId: p.id })).filter((e) => e.action === 'import');
      expect(imports).toHaveLength(1);
      expect(imports[0]).toMatchObject({ entity: 'project', entityId: p.id });
    });

    it('importProject merge is idempotent: importing the same export twice → second result all zeros for created/added', async () => {
      const a = open();
      const p = await newProject(a);
      await scoredWell(a, p.id, LICENCE);
      const second = await a.wells.create(p.id, { licence: LICENCE_2 });
      await a.assessments.saveDraft(second.id, draftInput(emptyScores()));
      const file = clone(await a.exportProject(p.id));

      const b = open();
      const first = await b.importProject(file, 'merge');
      expect(first.wells).toEqual({ created: 2, updated: 0 });
      const snapshot = await dump(b, p.id);

      const again = await b.importProject(file, 'merge');
      expect(again).toEqual({
        wells: { created: 0, updated: 2 },
        assessments: { added: 0, skipped: file.assessments.length },
        auditEvents: { added: 0, skipped: file.auditEvents.length },
        removed: { wells: 0, assessments: 0 },
        warnings: [],
      });
      expect(await dump(b, p.id)).toEqual(snapshot);
    });

    it('importProject merge into a store with the same licence under another well id: keeps the stored id and re-points assessments and audit events', async () => {
      const a = open();
      const p = await newProject(a);
      const { well: aWell, final } = await scoredWell(a, p.id, LICENCE);
      const file = clone(await a.exportProject(p.id));

      const b = open();
      await b.importProject({ ...file, wells: [], assessments: [], auditEvents: [] }, 'merge');
      const bWell = await b.wells.create(p.id, { licence: LICENCE_VARIANT, name: 'Local copy' });
      expect(bWell.id).not.toBe(aWell.id);

      const result = await b.importProject(file, 'merge');
      expect(result.wells).toEqual({ created: 0, updated: 1 });
      expect(result.assessments).toEqual({ added: 1, skipped: 0 });
      const wells = await b.wells.list(p.id);
      expect(wells.map((w) => w.id)).toEqual([bWell.id]);
      expect(await b.wells.get(aWell.id)).toBeNull();
      expect(await b.assessments.current(bWell.id)).toEqual({ ...final, wellId: bWell.id });

      const fileWellEvents = file.auditEvents.filter((e) => e.entityId === aWell.id).map((e) => e.id);
      expect(fileWellEvents.length).toBeGreaterThan(0);
      const bWellEvents = (await b.audit.list({ entityId: bWell.id })).map((e) => e.id);
      expect(bWellEvents).toEqual(expect.arrayContaining(fileWellEvents));
      expect(await b.audit.list({ entityId: aWell.id })).toEqual([]);
    });

    it('importProject merge is newest-wins: an older incoming well does not overwrite a newer stored one (still counted updated)', async () => {
      const a = open();
      const p = await newProject(a);
      const w = await a.wells.create(p.id, { licence: LICENCE, name: 'Original' });
      const oldFile = clone(await a.exportProject(p.id));

      const b = open();
      await b.importProject(oldFile, 'merge');
      const edited = await b.wells.update(w.id, { name: 'Edited in B' });

      const result = await b.importProject(oldFile, 'merge');
      expect(result.wells).toEqual({ created: 0, updated: 1 });
      expect(await b.wells.get(w.id)).toEqual(edited);

      // a newer incoming well does win
      const newer = await a.wells.update(w.id, { name: 'Edited in A later' });
      await b.importProject(clone(await a.exportProject(p.id)), 'merge');
      expect(await b.wells.get(w.id)).toEqual(newer);
    });

    it('importProject replace: removes wells not in the file', async () => {
      const a = open();
      const p = await newProject(a);
      const { well: w1 } = await scoredWell(a, p.id, LICENCE);
      const w2 = await a.wells.create(p.id, { licence: LICENCE_2, name: 'From A' });
      const file = clone(await a.exportProject(p.id));

      const b = open();
      await b.importProject(file, 'merge');
      const extra = await b.wells.create(p.id, { licence: LICENCE_3 });
      await b.assessments.saveDraft(extra.id, draftInput(emptyScores()));
      await b.assessments.saveDraft(w1.id, draftInput(scoresAll(1), justifyAll()));
      await b.wells.update(w2.id, { name: 'Edited in B' }); // newer than the file, but replace means the file wins
      await b.projects.update(p.id, { description: 'Edited in B' });
      const eventsBefore = await b.audit.list({});

      const result = await b.importProject(file, 'replace');
      expect(result.wells).toEqual({ created: 0, updated: 2 });
      // the extra well with its draft, and w1's draft: what the file does not have
      expect(result.removed).toEqual({ wells: 1, assessments: 2 });
      expect(await b.projects.get(p.id)).toEqual(file.project);
      expect(byId(await b.wells.list(p.id))).toEqual(byId(file.wells));
      expect(await b.wells.get(extra.id)).toBeNull();
      expect(await b.assessments.listForWell(extra.id)).toEqual([]);
      // assessments the file does not have are removed too
      expect(await b.assessments.draft(w1.id)).toBeNull();
      expect(byId(await b.assessments.listForWell(w1.id))).toEqual(byId(file.assessments));
      // the audit trail is never deleted
      const eventsAfter = (await b.audit.list({})).map((e) => e.id);
      expect(eventsAfter).toEqual(expect.arrayContaining(eventsBefore.map((e) => e.id)));
    });

    it('importProject replace removes a stored final the file does not have, and counts it in removed.assessments', async () => {
      const a = open();
      const p = await newProject(a);
      const { well, final } = await scoredWell(a, p.id, LICENCE);
      const file = clone(await a.exportProject(p.id));

      const b = open();
      await b.importProject(file, 'merge');
      const draft = await b.assessments.saveDraft(well.id, draftInput(scoresAll(4), justifyAll()));
      const reassessed = await b.assessments.finalise(draft.id);
      expect(await b.assessments.current(well.id)).toEqual(reassessed);

      const result = await b.importProject(file, 'replace');
      expect(result.removed).toEqual({ wells: 0, assessments: 1 });
      expect(result.wells).toEqual({ created: 0, updated: 1 });
      expect(await b.assessments.listForWell(well.id)).toEqual([final]);
      expect(await b.assessments.current(well.id)).toEqual(final);
      // the import's audit event (newest first) records the same figures
      const [imported] = (await b.audit.list({ projectId: p.id })).filter((e) => e.action === 'import');
      expect(imported?.diff.after).toMatchObject({ mode: 'replace', removed: { wells: 0, assessments: 1 } });
    });

    it('importProject merge removes nothing: removed is zero', async () => {
      const a = open();
      const p = await newProject(a);
      await scoredWell(a, p.id, LICENCE);
      const file = clone(await a.exportProject(p.id));
      const b = open();
      await b.importProject(file, 'merge');
      await b.wells.create(p.id, { licence: LICENCE_2 });
      const result = await b.importProject(file, 'merge');
      expect(result.removed).toEqual({ wells: 0, assessments: 0 });
      expect(await b.wells.list(p.id)).toHaveLength(2);
    });

    it('importProject rejects an invalid file with one ImportError listing every problem, and writes nothing', async () => {
      const a = open();
      const p = await newProject(a);
      await scoredWell(a, p.id, LICENCE);
      const good = clone(await a.exportProject(p.id));

      const b = open();
      const bp = await newProject(b, 'Local project');
      await b.wells.create(bp.id, { licence: LICENCE });
      const before = { projects: await b.projects.list(), local: await dump(b, bp.id), events: await b.audit.list({}) };

      const bad = clone(good);
      bad.assessments.push({ ...bad.assessments[0], id: 'asm_orphan', wellId: 'wel_missing' });
      bad.wells.push({ ...bad.wells[0], id: 'wel_duplicate', licence: LICENCE_VARIANT });
      bad.methodologies[0] = { ...bad.methodologies[0], revision: '9.9.9' };

      const err = await rejection(b.importProject(bad, 'merge'));
      expect(err).toBeInstanceOf(ImportError);
      const problems = (err as ImportError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.some((m) => m.includes('asm_orphan') && m.includes('wel_missing'))).toBe(true);
      expect(problems.some((m) => /licence/i.test(m) && m.includes('wel_duplicate'))).toBe(true);
      expect(problems.some((m) => m.includes('9.9.9'))).toBe(true);
      expect({ projects: await b.projects.list(), local: await dump(b, bp.id), events: await b.audit.list({}) }).toEqual(before);
      expect(await b.projects.get(p.id)).toBeNull();

      // a file that is not a project export at all
      const notAnExport = await rejection(b.importProject({ format: 'something-else' }, 'merge'));
      expect(notAnExport).toBeInstanceOf(ImportError);
      expect((notAnExport as ImportError).problems.length).toBeGreaterThan(0);
      const badLat = clone(good);
      badLat.wells[0].lat = 500;
      const latErr = await rejection(b.importProject(badLat, 'replace'));
      expect(latErr).toBeInstanceOf(ImportError);
      expect((latErr as ImportError).problems.join('\n')).toMatch(/wells\.0\.lat/);
      expect(await b.audit.list({})).toEqual(before.events);
    });

    it('importProject rejects wells and audit events of another project and an invalid methodology record, listing each', async () => {
      const a = open();
      const p = await newProject(a);
      await a.wells.create(p.id, { licence: LICENCE });
      const file = clone(await a.exportProject(p.id));
      file.wells[0].projectId = 'prj_other';
      file.auditEvents[0].projectId = 'prj_other';
      file.methodologies[0] = { ...file.methodologies[0], methodology: { ...file.methodologies[0].methodology, revision: '2.0.0', params: [] } };

      const b = open();
      const err = await rejection(b.importProject(file, 'merge'));
      expect(err).toBeInstanceOf(ImportError);
      const problems = (err as ImportError).problems;
      expect(problems.some((m) => m.startsWith(`well ${file.wells[0].id}`) && m.includes('belongs to project prj_other'))).toBe(true);
      expect(problems.some((m) => m.startsWith(`audit event ${file.auditEvents[0].id}`) && m.includes('belongs to project prj_other'))).toBe(true);
      expect(problems.some((m) => m.startsWith('methodology record 2.0.0: missing param'))).toBe(true);
      expect(await b.projects.list()).toEqual([]);
    });

    it('importProject merge keeps the stored project when the file\'s copy is older', async () => {
      const a = open();
      const p = await newProject(a);
      const old = clone(await a.exportProject(p.id));
      const b = open();
      await b.importProject(old, 'merge');
      const renamed = await b.projects.update(p.id, { name: 'Renamed in B' });
      await b.importProject(old, 'merge');
      expect(await b.projects.get(p.id)).toEqual(renamed);
      await b.importProject(old, 'replace'); // replace makes the file the truth
      expect((await b.projects.get(p.id))?.name).toBe(p.name);
    });

    it('two finals at the same instant: the one that supersedes the other is newer, whatever their ids', async () => {
      const a = open();
      const p = await newProject(a);
      const { well, final: first } = await scoredWell(a, p.id, LICENCE);
      const d = await a.assessments.saveDraft(well.id, draftInput(scoresAll(4), justifyAll()));
      const second = await a.assessments.finalise(d.id);
      expect(second.supersedesId).toBe(first.id);

      // The same pair as another tool might write it: one shared instant, ids in the opposite order.
      const file = clone(await a.exportProject(p.id));
      const at = file.assessments[0].assessedAt;
      for (const x of file.assessments) {
        x.assessedAt = at;
        x.updatedAt = at ?? x.updatedAt;
        if (x.id === first.id) x.id = 'asm_z_first';
        if (x.id === second.id) Object.assign(x, { id: 'asm_a_second', supersedesId: 'asm_z_first' });
      }
      const b = open();
      await b.importProject(file, 'merge');
      expect((await b.assessments.listForWell(well.id)).map((x) => x.id)).toEqual(['asm_a_second', 'asm_z_first']);
      expect((await b.assessments.current(well.id))?.id).toBe('asm_a_second');
    });

    it('importProject merge: a draft finalised in the other browser arrives as the final', async () => {
      const a = open();
      const p = await newProject(a);
      const w = await a.wells.create(p.id, { licence: LICENCE });
      const d = await a.assessments.saveDraft(w.id, draftInput(scoresAll(3), justifyAll()));
      const b = open();
      await b.importProject(clone(await a.exportProject(p.id)), 'merge');
      expect(await b.assessments.draft(w.id)).toEqual(d);

      const f = await a.assessments.finalise(d.id);
      const result = await b.importProject(clone(await a.exportProject(p.id)), 'merge');
      expect(result.assessments).toEqual({ added: 1, skipped: 0 });
      expect(await b.assessments.current(w.id)).toEqual(f);
      expect(await b.assessments.draft(w.id)).toBeNull();
    });

    it('importProject merge keeps a local draft and skips a different incoming draft for the same well, with a warning', async () => {
      const a = open();
      const p = await newProject(a);
      const w = await a.wells.create(p.id, { licence: LICENCE });
      const b = open();
      await b.importProject(clone(await a.exportProject(p.id)), 'merge');
      const local = await b.assessments.saveDraft(w.id, draftInput({ ...emptyScores(), age: 1 }, { age: 'Spudded 2012' }));
      await a.assessments.saveDraft(w.id, draftInput(emptyScores()));

      const result = await b.importProject(clone(await a.exportProject(p.id)), 'merge');
      expect(result.assessments).toEqual({ added: 0, skipped: 1 });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain(LICENCE);
      expect(await b.assessments.draft(w.id)).toEqual(local);
    });

    it('importProject merges methodology records by revision and warns when one revision differs in content', async () => {
      const a = open();
      const p = await newProject(a);
      await a.methodology.publish(withRevision('2.1.0'), 'from A');
      await a.methodology.publish(withRevision('2.2.0'), 'from A');
      const b = open();
      const different = withRevision('2.1.0');
      different.matrix.bands = different.matrix.bands.map((band) => ({ ...band, label: `${band.label}*` }));
      const bRecord = await b.methodology.publish(different, 'from B');

      const result = await b.importProject(clone(await a.exportProject(p.id)), 'merge');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('2.1.0');
      const records = byRevision(await b.methodology.list());
      expect(records.map((r) => r.revision)).toEqual(['2.0.0', '2.1.0', '2.2.0']);
      expect(records[1]).toEqual(bRecord);
      expect((await b.methodology.current()).revision).toBe('2.2.0');
    });

    it('importProject: an incoming well whose id is taken elsewhere gets a new id; its assessments and audit events follow it', async () => {
      const a = open();
      const p = await newProject(a);
      const { well, final } = await scoredWell(a, p.id, LICENCE);
      const file = clone(await a.exportProject(p.id));
      const b = open();
      await b.importProject(file, 'merge');

      // the same well copied into a second project, keeping its id
      const copy = clone(file);
      copy.project.id = 'prj_copy';
      for (const w of copy.wells) w.projectId = 'prj_copy';
      copy.assessments = copy.assessments.map((x) => ({ ...x, id: `${x.id}_copy` }));
      copy.auditEvents = copy.auditEvents.map(
        (e): AuditEvent => ({
          ...e,
          id: `${e.id}_copy`,
          projectId: 'prj_copy',
          entityId: e.entityId === p.id ? 'prj_copy' : e.entityId,
        }),
      );

      const result = await b.importProject(copy, 'merge');
      expect(result.wells).toEqual({ created: 1, updated: 0 });
      const moved = await b.wells.list('prj_copy');
      expect(moved).toHaveLength(1);
      expect(moved[0].id).not.toBe(well.id);
      expect(moved[0].licence).toBe(LICENCE);
      expect((await b.assessments.listForWell(moved[0].id)).map((x) => x.id)).toEqual([`${final.id}_copy`]);
      expect((await b.audit.list({ entityId: moved[0].id })).length).toBeGreaterThan(0);
      expect(await b.wells.get(well.id)).toMatchObject({ projectId: p.id });
      expect(await b.assessments.listForWell(well.id)).toEqual([final]);
    });
  });

  describe('change notification', () => {
    it('onChange fires once per mutation and the unsubscribe stops it', async () => {
      const s = open();
      let calls = 0;
      const off = s.onChange(() => {
        calls += 1;
      });

      const p = await s.projects.create({ name: 'P' });
      expect(calls).toBe(1);
      const { ids } = await s.wells.upsertByLicence(p.id, [{ licence: 'A' }, { licence: 'B' }, { licence: 'C' }]);
      expect(calls).toBe(2);
      const d = await s.assessments.saveDraft(ids[0], draftInput(emptyScores()));
      expect(calls).toBe(3);
      await s.assessments.finalise(d.id);
      expect(calls).toBe(4);

      // reads and rejected mutations do not notify
      await s.wells.list(p.id);
      await s.methodology.current();
      await s.audit.list({});
      await expect(s.wells.create(p.id, { licence: 'a' })).rejects.toBeInstanceOf(DuplicateLicenceError);
      expect(calls).toBe(4);

      const file = await s.exportProject(p.id); // appends an audit event
      expect(calls).toBe(5);
      await s.importProject(file, 'merge');
      expect(calls).toBe(6);
      await s.profile.set({ name: 'T. Chisti', initials: 'TC' });
      expect(calls).toBe(7);

      off();
      await s.projects.update(p.id, { name: 'Q' });
      expect(calls).toBe(7);
    });
  });
}
