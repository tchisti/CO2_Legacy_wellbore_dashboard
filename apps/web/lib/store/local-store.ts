// LocalStore: the Phase 1 Store on IndexedDB (Dexie 4), one database per browser. Every mutation
// parses the full record through its stored schema, writes it and its audit event in one Dexie
// transaction, and notifies onChange listeners once after the commit. Spec §6.1.
import Dexie, { type Table } from 'dexie';
import {
  AssessmentSchema,
  AuditEventSchema,
  DEFAULT_METHODOLOGY,
  JustificationsSchema,
  MethodologyRecordSchema,
  PARAM_KEYS,
  ProjectExportSchema,
  ProjectInputSchema,
  ProjectSchema,
  ReviewerProfileSchema,
  ScoresSchema,
  SuggestionsSchema,
  WellInputSchema,
  WellSchema,
  computeWell,
  newId,
  recommend,
  recommendationText,
  validateMethodology,
  type Assessment,
  type AuditEvent,
  type MethodologyRecord,
  type Project,
  type ReviewerProfile,
  type Well,
  type WellInput,
} from '@lwa/engine';
import { applyImport, asStored, jsonEqual, parseProjectExport, projectProblems, toJson } from './local-import';
import { DuplicateLicenceError, FinaliseError, NotFoundError, licenceKey, type Store } from './store';

export type LocalStoreOptions = {
  /** IndexedDB database name; tests pass a fresh one per store. */
  dbName?: string;
  /** The reviewer name stamped on every write. */
  actor: () => string;
  /** ISO-8601 UTC timestamp source; defaults to the system clock. */
  now?: () => string;
};

type ProfileRow = ReviewerProfile & { id: string };
/** A well's fields after WellInputSchema has filled in the defaults. */
type WellFields = ReturnType<typeof WellInputSchema.parse>;
const PROFILE_KEY = 'reviewer';

class LwaDatabase extends Dexie {
  declare profile: Table<ProfileRow, string>;
  declare projects: Table<Project, string>;
  declare wells: Table<Well, string>;
  declare assessments: Table<Assessment, string>;
  declare methodologies: Table<MethodologyRecord, string>;
  declare auditEvents: Table<AuditEvent, string>;

  constructor(name: string) {
    super(name);
    // Licence matching uses licenceKey over the project's wells, so there is no licence index.
    this.version(1).stores({
      profile: 'id',
      projects: 'id',
      wells: 'id, projectId',
      assessments: 'id, wellId, status, [wellId+status]',
      methodologies: 'revision',
      auditEvents: 'id, at, projectId, entityId',
    });
  }
}

/** When a mutation happens and who made it; one per mutation, shared by the record and its audit event. */
type Stamp = { at: string; actorName: string };

/**
 * Wraps a clock so that this store's timestamps strictly increase: a reading at or before the
 * previous one becomes the previous one plus a millisecond. Keeps "newest first" and
 * "edited after assessment" exact when two writes land in the same millisecond.
 */
function monotonic(now: () => string): () => string {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const reading = now();
    const t = Date.parse(reading);
    if (Number.isNaN(t)) throw new Error(`Clock returned an invalid timestamp: ${reading}`);
    if (t > last) {
      last = t;
      return reading;
    }
    last += 1;
    return new Date(last).toISOString();
  };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Numeric semver order (2.10.0 > 2.9.0); a revision that is not semver sorts first. */
function compareSemver(a: string, b: string): number {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) return Number(Boolean(pa)) - Number(Boolean(pb));
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/** The time an assessment counts from: assessedAt for a final, updatedAt for a draft. */
const instant = (a: Assessment): number => Date.parse(a.assessedAt ?? a.updatedAt);

/** Whether `a` is newer than `b`. Equal instants fall back to the supersedes link, then the id. */
function isNewer(a: Assessment, b: Assessment): boolean {
  if (instant(a) !== instant(b)) return instant(a) > instant(b);
  if (a.supersedesId === b.id) return true;
  if (b.supersedesId === a.id) return false;
  return a.id > b.id;
}

const newestFirst = (list: Assessment[]): Assessment[] =>
  [...list].sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));

const byCreation = <T extends { id: string; createdAt: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The keys of a patch that carry a value; `{ name: undefined }` changes nothing. */
function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function assertProjectRules(p: Pick<Project, 'injectors' | 'formations'>): void {
  const problems = projectProblems(p);
  if (problems.length > 0) throw new Error(`Invalid project: ${problems.join('; ')}`);
}

export function createLocalStore(opts: LocalStoreOptions): Store {
  const db = new LwaDatabase(opts.dbName ?? 'lwa');
  const clock = monotonic(opts.now ?? (() => new Date().toISOString()));
  const listeners = new Set<() => void>();

  /* ---------- lifecycle ---------- */

  let ready: Promise<void> | null = null;
  /** Opens the database and, the first time, seeds the built-in methodology. Not a mutation. */
  function init(): Promise<void> {
    ready ??= db
      .transaction('rw', db.methodologies, async () => {
        if ((await db.methodologies.count()) > 0) return;
        await db.methodologies.add(
          asStored(MethodologyRecordSchema, {
            revision: DEFAULT_METHODOLOGY.revision,
            methodology: DEFAULT_METHODOLOGY,
            note: 'built-in default',
            // The rulebook's own date, so every browser seeds an identical record.
            publishedAt: DEFAULT_METHODOLOGY.updatedAt,
            publishedBy: 'system',
          }),
        );
      })
      .catch((e: unknown) => {
        ready = null;
        throw e;
      });
    return ready;
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (e) {
        // A failing listener must not turn a committed write into a rejected call.
        console.error('Store change listener failed', e);
      }
    }
  }

  /** Runs `fn` in one read-write transaction over every table, then notifies once. */
  async function commit<T>(fn: () => Promise<T>): Promise<T> {
    await init();
    const result = await db.transaction('rw', db.tables, fn);
    notify();
    return result;
  }

  /** A commit stamped with the time and the actor. */
  function mutate<T>(fn: (stamp: Stamp) => Promise<T>): Promise<T> {
    return commit(() => fn({ at: clock(), actorName: opts.actor() }));
  }

  async function read<T>(fn: () => Promise<T>): Promise<T> {
    await init();
    return fn();
  }

  /* ---------- shared helpers (call inside a transaction) ---------- */

  function auditEvent(
    stamp: Stamp,
    e: Pick<AuditEvent, 'projectId' | 'entity' | 'entityId' | 'action'> & { before: unknown; after: unknown },
  ): AuditEvent {
    return asStored(AuditEventSchema, {
      id: newId('aud'),
      at: stamp.at,
      actorName: stamp.actorName,
      projectId: e.projectId,
      entity: e.entity,
      entityId: e.entityId,
      action: e.action,
      diff: { before: toJson(e.before ?? null), after: toJson(e.after ?? null) },
    });
  }

  async function mustGet<T>(table: Table<T, string>, entity: 'project' | 'well' | 'assessment', id: string): Promise<T> {
    const row = await table.get(id);
    if (row === undefined) throw new NotFoundError(entity, id);
    return row;
  }

  async function assertLicenceFree(projectId: string, licence: string, exceptId: string | null): Promise<void> {
    const key = licenceKey(licence);
    const clash = (await db.wells.where('projectId').equals(projectId).toArray()).find(
      (w) => w.id !== exceptId && licenceKey(w.licence) === key,
    );
    if (clash) throw new DuplicateLicenceError(licence, clash.id);
  }

  async function currentRecord(): Promise<MethodologyRecord> {
    const records = await db.methodologies.toArray();
    const best = records.reduce<MethodologyRecord | null>(
      (top, r) => (top === null || compareSemver(r.revision, top.revision) > 0 ? r : top),
      null,
    );
    if (!best) throw new Error('No methodology has been published');
    return best;
  }

  async function finalsOf(wellId: string): Promise<Assessment[]> {
    return db.assessments.where('[wellId+status]').equals([wellId, 'final']).toArray();
  }

  async function draftOf(wellId: string): Promise<Assessment | null> {
    return (await db.assessments.where('[wellId+status]').equals([wellId, 'draft']).first()) ?? null;
  }

  async function insertWell(stamp: Stamp, projectId: string, fields: WellFields): Promise<Well> {
    const well = asStored(WellSchema, {
      ...fields,
      id: newId('wel'),
      projectId,
      createdAt: stamp.at,
      createdBy: stamp.actorName,
      updatedAt: stamp.at,
      updatedBy: stamp.actorName,
    });
    await db.wells.add(well);
    await db.auditEvents.add(
      auditEvent(stamp, { projectId, entity: 'well', entityId: well.id, action: 'create', before: null, after: well }),
    );
    return well;
  }

  /** Applies a patch to a stored well. A patch that changes nothing writes nothing. */
  async function patchWell(stamp: Stamp, before: Well, patch: Partial<WellInput>): Promise<Well> {
    const fields = WellInputSchema.parse({ ...before, ...patch });
    if (jsonEqual(WellInputSchema.parse(before), fields)) return before;
    if (licenceKey(fields.licence) !== licenceKey(before.licence)) {
      await assertLicenceFree(before.projectId, fields.licence, before.id);
    }
    const after = asStored(WellSchema, { ...before, ...fields, updatedAt: stamp.at, updatedBy: stamp.actorName });
    await db.wells.put(after);
    await db.auditEvents.add(
      auditEvent(stamp, { projectId: before.projectId, entity: 'well', entityId: before.id, action: 'update', before, after }),
    );
    return after;
  }

  /* ---------- the store ---------- */

  return {
    profile: {
      get: () =>
        read(async () => {
          const row = await db.profile.get(PROFILE_KEY);
          return row ? ReviewerProfileSchema.parse(row) : null;
        }),
      // Not audited and not stamped: the profile is who the actor is, so it may not exist yet.
      set: async (p) => {
        const profile = asStored(ReviewerProfileSchema, p);
        await commit(async () => {
          await db.profile.put({ ...profile, id: PROFILE_KEY });
        });
      },
    },

    projects: {
      list: () => read(async () => byCreation(await db.projects.toArray())),
      get: (id) => read(async () => (await db.projects.get(id)) ?? null),
      create: async (input) => {
        const fields = ProjectInputSchema.parse(input);
        assertProjectRules(fields);
        return mutate(async (stamp) => {
          const project = asStored(ProjectSchema, {
            ...fields,
            id: newId('prj'),
            createdAt: stamp.at,
            createdBy: stamp.actorName,
            updatedAt: stamp.at,
            updatedBy: stamp.actorName,
          });
          await db.projects.add(project);
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: project.id,
              entity: 'project',
              entityId: project.id,
              action: 'create',
              before: null,
              after: project,
            }),
          );
          return project;
        });
      },
      update: (id, patch) =>
        mutate(async (stamp) => {
          const before = await mustGet(db.projects, 'project', id);
          const fields = ProjectInputSchema.parse({ ...before, ...definedOnly(patch) });
          if (jsonEqual(ProjectInputSchema.parse(before), fields)) return before;
          assertProjectRules(fields);
          const after = asStored(ProjectSchema, { ...before, ...fields, updatedAt: stamp.at, updatedBy: stamp.actorName });
          await db.projects.put(after);
          await db.auditEvents.add(
            auditEvent(stamp, { projectId: id, entity: 'project', entityId: id, action: 'update', before, after }),
          );
          return after;
        }),
      remove: (id) =>
        mutate(async (stamp) => {
          const project = await mustGet(db.projects, 'project', id);
          const wellIds = await db.wells.where('projectId').equals(id).primaryKeys();
          const assessmentIds = await db.assessments.where('wellId').anyOf(wellIds).primaryKeys();
          const eventIds = await db.auditEvents.where('projectId').equals(id).primaryKeys();
          await db.assessments.bulkDelete(assessmentIds);
          await db.wells.bulkDelete(wellIds);
          await db.auditEvents.bulkDelete(eventIds);
          await db.projects.delete(id);
          const counts = { wells: wellIds.length, assessments: assessmentIds.length, auditEvents: eventIds.length };
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: id,
              entity: 'project',
              entityId: id,
              action: 'delete',
              before: { project, counts },
              after: null,
            }),
          );
        }),
    },

    wells: {
      list: (projectId) => read(async () => byCreation(await db.wells.where('projectId').equals(projectId).toArray())),
      get: (id) => read(async () => (await db.wells.get(id)) ?? null),
      create: async (projectId, input) => {
        const fields = WellInputSchema.parse(input);
        return mutate(async (stamp) => {
          await mustGet(db.projects, 'project', projectId);
          await assertLicenceFree(projectId, fields.licence, null);
          return insertWell(stamp, projectId, fields);
        });
      },
      update: (id, patch) =>
        mutate(async (stamp) => patchWell(stamp, await mustGet(db.wells, 'well', id), definedOnly(patch))),
      remove: (id) =>
        mutate(async (stamp) => {
          const well = await mustGet(db.wells, 'well', id);
          const assessments = newestFirst(await db.assessments.where('wellId').equals(id).toArray());
          await db.assessments.bulkDelete(assessments.map((a) => a.id));
          await db.wells.delete(id);
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: well.projectId,
              entity: 'well',
              entityId: id,
              action: 'delete',
              before: { well, assessments },
              after: null,
            }),
          );
        }),
      upsertByLicence: async (projectId, inputs) => {
        const parsed = inputs.map((input) => WellInputSchema.parse(input)); // reject a bad row before writing any
        return mutate(async (stamp) => {
          await mustGet(db.projects, 'project', projectId);
          const stored = await db.wells.where('projectId').equals(projectId).toArray();
          const byKey = new Map(stored.map((w) => [licenceKey(w.licence), w]));
          const result = { created: 0, updated: 0, ids: [] as string[] };
          for (const [i, fields] of parsed.entries()) {
            const key = licenceKey(fields.licence);
            const match = byKey.get(key);
            // A match takes only the fields the input carries, and keeps its licence text.
            const well = match
              ? await patchWell(stamp, match, { ...definedOnly(inputs[i]), licence: match.licence })
              : await insertWell(stamp, projectId, fields);
            byKey.set(key, well);
            result.ids.push(well.id);
            if (match) result.updated += 1;
            else result.created += 1;
          }
          return result;
        });
      },
    },

    assessments: {
      listForWell: (wellId) => read(async () => newestFirst(await db.assessments.where('wellId').equals(wellId).toArray())),
      current: (wellId) => read(async () => newestFirst(await finalsOf(wellId))[0] ?? null),
      draft: (wellId) => read(() => draftOf(wellId)),
      saveDraft: async (wellId, input) => {
        const scores = ScoresSchema.parse(input.scores);
        const justifications = JustificationsSchema.parse(input.justifications);
        const suggestions = SuggestionsSchema.parse(input.suggestions);
        const override = input.override?.trim() || null;
        return mutate(async (stamp) => {
          const well = await mustGet(db.wells, 'well', wellId);
          const existing = await draftOf(wellId);
          const draft = asStored(AssessmentSchema, {
            id: existing?.id ?? newId('asm'),
            wellId,
            methodologyRevision: (await currentRecord()).revision,
            scores,
            justifications,
            suggestions,
            computed: null,
            recommendedAction: { auto: '', override },
            status: 'draft',
            reviewerName: stamp.actorName,
            assessedAt: null,
            supersedesId: null,
            approvedByName: null,
            approvedAt: null,
            createdAt: existing?.createdAt ?? stamp.at,
            updatedAt: stamp.at,
          });
          await db.assessments.put(draft);
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: well.projectId,
              entity: 'assessment',
              entityId: draft.id,
              action: existing ? 'update' : 'create',
              before: existing,
              after: draft,
            }),
          );
          return draft;
        });
      },
      finalise: (draftId) =>
        mutate(async (stamp) => {
          const draft = await mustGet(db.assessments, 'assessment', draftId);
          if (draft.status !== 'draft') throw new Error(`Assessment ${draftId} is already final`);
          const missing = PARAM_KEYS.filter((k) => draft.scores[k] !== null && !draft.justifications[k]?.trim());
          if (missing.length > 0) throw new FinaliseError(missing);

          const well = await mustGet(db.wells, 'well', draft.wellId);
          const { revision, methodology } = await currentRecord();
          const c = computeWell(draft.scores, methodology);
          const previous = newestFirst(await finalsOf(draft.wellId))[0] ?? null;
          const final = asStored(AssessmentSchema, {
            ...draft,
            status: 'final',
            methodologyRevision: revision,
            computed: { L: c.L, C: c.C, Lr: c.Lr, Cr: c.Cr, cell: c.cell, riskIndex: c.riskIndex, rank: c.rank.label },
            recommendedAction: {
              auto: recommendationText(recommend(draft.scores, methodology)),
              override: draft.recommendedAction.override,
            },
            reviewerName: stamp.actorName,
            assessedAt: stamp.at,
            supersedesId: previous?.id ?? null,
            updatedAt: stamp.at,
          });
          await db.assessments.put(final);
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: well.projectId,
              entity: 'assessment',
              entityId: final.id,
              action: 'finalise',
              before: draft,
              after: final,
            }),
          );
          return final;
        }),
      discardDraft: (draftId) =>
        mutate(async (stamp) => {
          const draft = await mustGet(db.assessments, 'assessment', draftId);
          if (draft.status !== 'draft') throw new Error(`Assessment ${draftId} is final; only a draft can be discarded`);
          const well = await mustGet(db.wells, 'well', draft.wellId);
          await db.assessments.delete(draftId);
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: well.projectId,
              entity: 'assessment',
              entityId: draftId,
              action: 'delete',
              before: draft,
              after: null,
            }),
          );
        }),
    },

    methodology: {
      current: () => read(async () => (await currentRecord()).methodology),
      list: () => read(async () => (await db.methodologies.toArray()).sort((a, b) => compareSemver(a.revision, b.revision))),
      publish: async (m, note) => {
        const check = validateMethodology(m);
        if (!check.ok) throw new Error(`Methodology is invalid: ${check.errors.join('; ')}`);
        return mutate(async (stamp) => {
          if ((await db.methodologies.get(m.revision)) !== undefined) {
            throw new Error(`Methodology revision ${m.revision} is already published`);
          }
          const record = asStored(MethodologyRecordSchema, {
            revision: m.revision,
            methodology: m,
            note,
            publishedAt: stamp.at,
            publishedBy: stamp.actorName,
          });
          await db.methodologies.add(record);
          await db.auditEvents.add(
            auditEvent(stamp, {
              projectId: null,
              entity: 'methodology',
              entityId: record.revision,
              action: 'create',
              before: null,
              after: record,
            }),
          );
          return record;
        });
      },
    },

    audit: {
      list: (filter) =>
        read(async () => {
          const { projectId, entityId, limit } = filter;
          let events =
            entityId !== undefined
              ? await db.auditEvents.where('entityId').equals(entityId).toArray()
              : projectId !== undefined
                ? await db.auditEvents.where('projectId').equals(projectId).toArray()
                : await db.auditEvents.toArray();
          if (projectId !== undefined) events = events.filter((e) => e.projectId === projectId);
          events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
          return limit === undefined ? events : events.slice(0, limit);
        }),
    },

    exportProject: (projectId) =>
      mutate(async (stamp) => {
        const project = await mustGet(db.projects, 'project', projectId);
        const wells = byCreation(await db.wells.where('projectId').equals(projectId).toArray());
        const assessments = byCreation(await db.assessments.where('wellId').anyOf(wells.map((w) => w.id)).toArray());
        const methodologies = (await db.methodologies.toArray()).sort((a, b) => compareSemver(a.revision, b.revision));
        const auditEvents = (await db.auditEvents.where('projectId').equals(projectId).toArray()).sort(
          (a, b) => Date.parse(a.at) - Date.parse(b.at),
        );
        const file = ProjectExportSchema.parse({
          format: 'lwa-project',
          version: 1,
          exportedAt: stamp.at,
          exportedBy: stamp.actorName,
          project,
          wells,
          assessments,
          methodologies,
          auditEvents,
        });
        await db.auditEvents.add(
          auditEvent(stamp, {
            projectId,
            entity: 'project',
            entityId: projectId,
            action: 'export',
            before: null,
            after: {
              wells: wells.length,
              assessments: assessments.length,
              methodologies: methodologies.length,
              auditEvents: auditEvents.length,
            },
          }),
        );
        return file;
      }),

    importProject: async (data, mode) => {
      const file = parseProjectExport(data); // ImportError before anything is written
      return mutate(async (stamp) => {
        const { result, removed } = await applyImport(db, file, mode);
        await db.auditEvents.add(
          auditEvent(stamp, {
            projectId: file.project.id,
            entity: 'project',
            entityId: file.project.id,
            action: 'import',
            before: null,
            after: {
              mode,
              wells: result.wells,
              assessments: result.assessments,
              auditEvents: result.auditEvents,
              removed,
              warnings: result.warnings,
            },
          }),
        );
        return result;
      });
    },

    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
