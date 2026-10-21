// Project-file import for LocalStore: validation of an incoming file (schema plus referential
// checks) and the merge/replace write. createLocalStore calls applyImport inside its own
// read-write transaction, so an import is all-or-nothing. Spec §6.1, §8.1, §9 (a project exported
// from one browser imports into another intact).
import type { Table } from 'dexie';
import {
  AssessmentSchema,
  AuditEventSchema,
  MethodologyRecordSchema,
  ProjectExportSchema,
  ProjectSchema,
  WellSchema,
  newId,
  validateMethodology,
  type Assessment,
  type AuditEvent,
  type MethodologyRecord,
  type Project,
  type ProjectExport,
  type Well,
} from '@lwa/engine';
import { fmtDateTime } from '../format';
import { ImportError, licenceKey, type ImportMode, type ImportResult } from './store';

/* ---------- JSON helpers, shared with local-store.ts ---------- */

/** A JSON round trip: the value exactly as an export file would carry it (no `undefined` anywhere). */
export function toJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Deep equality of JSON-like values; a key holding `undefined` counts as absent. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => jsonEqual(ra[k], rb[k]));
}

type Parser<T> = { parse(value: unknown): T };

/** Parses through a stored-record schema and returns the JSON form that gets written. */
export function asStored<T>(schema: Parser<T>, value: unknown): T {
  return toJson(schema.parse(value));
}

/* ---------- validation ---------- */

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dup.add(v);
    else seen.add(v);
  }
  return [...dup];
}

/** Rules a project must keep so that its export can be imported again. */
export function projectProblems(p: Pick<Project, 'injectors' | 'formations'>): string[] {
  return [
    ...duplicates(p.injectors.map((i) => i.id)).map((id) => `duplicate injector id ${id}`),
    ...duplicates(p.formations.map((f) => f.id)).map((id) => `duplicate formation id ${id}`),
  ];
}

function referentialProblems(file: ProjectExport): string[] {
  const pid = file.project.id;
  const problems = projectProblems(file.project).map((p) => `project: ${p}`);

  for (const id of duplicates(file.wells.map((w) => w.id))) problems.push(`duplicate well id ${id}`);
  const firstByKey = new Map<string, Well>();
  for (const w of file.wells) {
    if (w.projectId !== pid) problems.push(`well ${w.id} (${w.licence}) belongs to project ${w.projectId}, not ${pid}`);
    const first = firstByKey.get(licenceKey(w.licence));
    if (first) problems.push(`duplicate licence ${w.licence}: wells ${first.id} and ${w.id}`);
    else firstByKey.set(licenceKey(w.licence), w);
  }

  const wellIds = new Set(file.wells.map((w) => w.id));
  for (const id of duplicates(file.assessments.map((a) => a.id))) problems.push(`duplicate assessment id ${id}`);
  for (const a of file.assessments) {
    if (!wellIds.has(a.wellId)) problems.push(`assessment ${a.id} points to well ${a.wellId}, which is not in the file`);
  }
  const draftWells = file.assessments.filter((a) => a.status === 'draft').map((a) => a.wellId);
  for (const id of duplicates(draftWells)) problems.push(`well ${id} has more than one draft assessment`);

  for (const id of duplicates(file.auditEvents.map((e) => e.id))) problems.push(`duplicate audit event id ${id}`);
  for (const e of file.auditEvents) {
    if (e.projectId !== pid) problems.push(`audit event ${e.id} belongs to project ${e.projectId}, not ${pid}`);
  }

  for (const r of duplicates(file.methodologies.map((m) => m.revision))) problems.push(`duplicate methodology revision ${r}`);
  for (const r of file.methodologies) {
    if (r.revision !== r.methodology.revision) {
      problems.push(`methodology record ${r.revision} holds methodology revision ${r.methodology.revision}`);
    }
    const check = validateMethodology(r.methodology);
    if (!check.ok) problems.push(`methodology record ${r.revision}: ${check.errors.join('; ')}`);
  }
  return problems;
}

/** Validates an incoming project file. Throws ImportError listing every problem found. */
export function parseProjectExport(data: unknown): ProjectExport {
  const parsed = ProjectExportSchema.safeParse(data);
  if (!parsed.success) {
    throw new ImportError(
      parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || 'file'}: ${issue.message}`),
    );
  }
  const problems = referentialProblems(parsed.data);
  if (problems.length > 0) throw new ImportError(problems);
  return parsed.data;
}

/* ---------- write ---------- */

export interface ImportTables {
  projects: Table<Project, string>;
  wells: Table<Well, string>;
  assessments: Table<Assessment, string>;
  methodologies: Table<MethodologyRecord, string>;
  auditEvents: Table<AuditEvent, string>;
}

const atOrAfter = (a: string, b: string): boolean => Date.parse(a) >= Date.parse(b);
const after = (a: string, b: string): boolean => Date.parse(a) > Date.parse(b);

/**
 * The audit event that wrote a stored well as it is now: the store stamps a well's create or
 * update event with the well's new updatedAt (an import brings the other browser's events along,
 * re-pointed to the stored id). Undefined when the stored copy has no such event (a file without
 * history wrote it).
 */
async function eventThatWrote(db: ImportTables, well: Well): Promise<AuditEvent | undefined> {
  const at = Date.parse(well.updatedAt);
  const events = await db.auditEvents.where('entityId').equals(well.id).toArray();
  return events.find((e) => e.entity === 'well' && e.action !== 'delete' && Date.parse(e.at) === at);
}

/**
 * Writes a validated file into the store. Must run inside one read-write transaction over the
 * five tables (the caller's), so a failure part-way leaves the store as it was.
 */
export async function applyImport(db: ImportTables, file: ProjectExport, mode: ImportMode): Promise<ImportResult> {
  const replace = mode === 'replace';
  const pid = file.project.id;
  const result: ImportResult = {
    wells: { created: 0, updated: 0 },
    assessments: { added: 0, skipped: 0 },
    auditEvents: { added: 0, skipped: 0 },
    removed: { wells: 0, assessments: 0 },
    warnings: [],
  };

  // Project: matched by id. Merge applies the file's fields only when they are at least as new.
  const storedProject = await db.projects.get(pid);
  if (!storedProject || replace || atOrAfter(file.project.updatedAt, storedProject.updatedAt)) {
    await db.projects.put(asStored(ProjectSchema, file.project));
  }

  // Wells: matched by licence within the project.
  const fileKeys = new Set(file.wells.map((w) => licenceKey(w.licence)));
  let storedWells = await db.wells.where('projectId').equals(pid).toArray();
  if (replace) {
    // The file is the truth: drop wells it does not have (with their assessments), then the
    // remaining wells' assessments it does not have. Done first, so freed ids can be reused.
    const fileAssessmentIds = new Set(file.assessments.map((a) => a.id));
    const dropped = storedWells.filter((w) => !fileKeys.has(licenceKey(w.licence))).map((w) => w.id);
    storedWells = storedWells.filter((w) => fileKeys.has(licenceKey(w.licence)));
    const droppedAssessments = await db.assessments.where('wellId').anyOf(dropped).primaryKeys();
    const stray = (await db.assessments.where('wellId').anyOf(storedWells.map((w) => w.id)).toArray())
      .filter((a) => !fileAssessmentIds.has(a.id))
      .map((a) => a.id);
    await db.assessments.bulkDelete([...droppedAssessments, ...stray]);
    await db.wells.bulkDelete(dropped);
    result.removed = { wells: dropped.length, assessments: droppedAssessments.length + stray.length };
  }
  const storedByKey = new Map(storedWells.map((w) => [licenceKey(w.licence), w]));

  const wellIdMap = new Map<string, string>(); // file well id → store well id
  const licenceOf = new Map<string, string>(); // store well id → licence, for warnings
  const fileEventIds = new Set(file.auditEvents.map((e) => e.id));
  for (const incoming of file.wells) {
    const match = storedByKey.get(licenceKey(incoming.licence));
    if (match) {
      result.wells.updated += 1;
      wellIdMap.set(incoming.id, match.id);
      licenceOf.set(match.id, match.licence);
      if (replace) {
        await db.wells.put(asStored(WellSchema, { ...incoming, id: match.id, projectId: pid }));
      } else if (atOrAfter(incoming.updatedAt, match.updatedAt)) {
        // Merge is newest-wins for the whole record, but the well was created here: its creation
        // stamps stay. When the stored copy holds a change the file does not have (the edit that
        // wrote it is not in the file's history, or it was made after the export), say it was lost.
        const merged = asStored(WellSchema, {
          ...incoming,
          id: match.id,
          projectId: pid,
          createdAt: match.createdAt,
          createdBy: match.createdBy,
        });
        if (!jsonEqual(merged, match)) {
          const wrote = await eventThatWrote(db, match);
          if ((wrote !== undefined && !fileEventIds.has(wrote.id)) || after(match.updatedAt, file.exportedAt)) {
            result.warnings.push(
              `Well ${match.licence} was edited here on ${fmtDateTime(match.updatedAt)} and in the file on ${fmtDateTime(incoming.updatedAt)}; the file's copy replaced it${wrote ? ' (History keeps the earlier record)' : ''}.`,
            );
          }
          await db.wells.put(merged);
        }
      }
    } else {
      const idTaken = (await db.wells.get(incoming.id)) !== undefined;
      const id = idTaken ? newId('wel') : incoming.id;
      result.wells.created += 1;
      wellIdMap.set(incoming.id, id);
      licenceOf.set(id, incoming.licence);
      await db.wells.add(asStored(WellSchema, { ...incoming, id, projectId: pid }));
    }
  }

  // Assessments: added when new. A stored draft with the same id may be overtaken (finalised or
  // edited in the other browser); finals never change. Finals go first so that a draft finalised
  // elsewhere frees its well for an incoming draft. An id that belongs to another well here is
  // never taken over: that would move the other well's assessment (and could give one well two
  // drafts).
  const ordered = [...file.assessments].sort((a, b) => Number(a.status === 'draft') - Number(b.status === 'draft'));
  for (const incoming of ordered) {
    const wellId = wellIdMap.get(incoming.wellId) ?? incoming.wellId;
    const record = asStored(AssessmentSchema, { ...incoming, wellId });
    const stored = await db.assessments.get(incoming.id);
    if (stored && stored.wellId !== wellId) {
      const other = await db.wells.get(stored.wellId);
      result.assessments.skipped += 1;
      result.warnings.push(
        `Assessment ${incoming.id} for well ${licenceOf.get(wellId) ?? wellId} was not imported: this browser already has an assessment with that id for well ${other?.licence ?? stored.wellId}.`,
      );
      continue;
    }
    if (stored) {
      const overtakes =
        stored.status === 'draft' &&
        (replace
          ? !jsonEqual(stored, record)
          : incoming.status === 'final' || after(incoming.updatedAt, stored.updatedAt));
      if (overtakes) {
        await db.assessments.put(record);
        result.assessments.added += 1;
      } else {
        result.assessments.skipped += 1;
      }
      continue;
    }
    if (incoming.status === 'draft') {
      const localDraft = await db.assessments.where('[wellId+status]').equals([wellId, 'draft']).first();
      if (localDraft) {
        result.assessments.skipped += 1;
        result.warnings.push(
          `Draft ${incoming.id} for well ${licenceOf.get(wellId) ?? wellId} was not imported: the well already has a draft (${localDraft.id}).`,
        );
        continue;
      }
    }
    await db.assessments.add(record);
    result.assessments.added += 1;
  }

  // Audit events: append-only, never deleted; well ids follow the licence match.
  for (const incoming of file.auditEvents) {
    if ((await db.auditEvents.get(incoming.id)) !== undefined) {
      result.auditEvents.skipped += 1;
      continue;
    }
    const entityId = incoming.entity === 'well' ? (wellIdMap.get(incoming.entityId) ?? incoming.entityId) : incoming.entityId;
    await db.auditEvents.add(asStored(AuditEventSchema, { ...incoming, entityId }));
    result.auditEvents.added += 1;
  }

  // Methodology records: merged by revision; a stored revision is never overwritten.
  for (const incoming of file.methodologies) {
    const stored = await db.methodologies.get(incoming.revision);
    if (!stored) {
      await db.methodologies.add(asStored(MethodologyRecordSchema, incoming));
    } else if (!jsonEqual(stored.methodology, incoming.methodology)) {
      result.warnings.push(
        `Methodology revision ${incoming.revision} in the file differs from the stored revision ${incoming.revision}; the stored one was kept.`,
      );
    }
  }

  return result;
}
