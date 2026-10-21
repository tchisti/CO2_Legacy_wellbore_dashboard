// Project files: the backup and hand-off mechanism of Phase 1 (spec §6.1, §9, §10). Exporting
// writes the whole project as one `.lwa.json` file; reading a file the user picked turns "the wrong
// kind of file" into a plain sentence before the store sees it. The store does the full validation
// (Store.importProject throws ImportError listing every problem and writes nothing).
import type { Assessment, ProjectExport, Well } from '@lwa/engine';
import { plural } from '@/lib/format';
import { licenceKey, type ImportMode, type ImportResult, type Store } from '@/lib/store/store';

const FORMAT = 'lwa-project';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ---------- export ---------- */

/**
 * The project name as a file-name part: accents dropped, lower case, every run of other
 * characters one hyphen, none at either end ("Fort Saskatchewan / Wabamun Hub AOR" →
 * "fort-saskatchewan-wabamun-hub-aor"); "project" when nothing is left.
 */
export function projectSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** `<project-slug>-<YYYY-MM-DD>.lwa.json`, dated with the UTC day of the export. */
export function exportFileName(projectName: string, exportedAt: string): string {
  return `${projectSlug(projectName)}-${new Date(exportedAt).toISOString().slice(0, 10)}.lwa.json`;
}

/** Hands a file to the user. The default saves it through a download link. */
export type SaveFile = (blob: Blob, filename: string) => void;

const saveWithLink: SaveFile = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Exports the project (the store records the export in the project's history) and saves it as
 * pretty-printed JSON named by exportFileName. Returns the name and the exported data.
 */
export async function downloadExport(
  store: Pick<Store, 'exportProject'>,
  projectId: string,
  save: SaveFile = saveWithLink,
): Promise<{ filename: string; data: ProjectExport }> {
  const data = await store.exportProject(projectId);
  const filename = exportFileName(data.project.name, data.exportedAt);
  save(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }), filename);
  return { filename, data };
}

/* ---------- import ---------- */

/**
 * Reads a picked file as a project export. Rejects with "This file is not valid JSON." or with a
 * message starting "Not a Legacy Well Assessment export" when the JSON is some other document.
 */
export async function readExportFile(file: File): Promise<unknown> {
  const text = (await file.text()).replace(/^﻿/, '');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!isRecord(data) || data.format !== FORMAT) {
    throw new Error(
      'Not a Legacy Well Assessment export. Choose a project file exported from this app or made by the v2 migration.',
    );
  }
  return data;
}

/** The project id an export carries, or null when the value has none. */
export function exportProjectId(data: unknown): string | null {
  if (!isRecord(data) || !isRecord(data.project)) return null;
  const id = data.project.id;
  return typeof id === 'string' ? id : null;
}

/** What a picked file says it holds, before the store has validated it; null for what it lacks. */
export type ExportSummary = {
  projectId: string | null;
  projectName: string | null;
  wells: number | null;
  assessments: number | null;
  auditEvents: number | null;
  exportedAt: string | null;
  exportedBy: string | null;
  /** The licences of the file's wells (those that are strings), in file order. */
  licences: string[];
  /** The ids of the file's assessments (those that are strings), in file order. */
  assessmentIds: string[];
};

export function describeExport(data: unknown): ExportSummary {
  const file = isRecord(data) ? data : {};
  const project = isRecord(file.project) ? file.project : {};
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const count = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);
  const wells: unknown[] = Array.isArray(file.wells) ? file.wells : [];
  const assessments: unknown[] = Array.isArray(file.assessments) ? file.assessments : [];
  return {
    projectId: text(project.id),
    projectName: text(project.name),
    wells: count(file.wells),
    assessments: count(file.assessments),
    auditEvents: count(file.auditEvents),
    exportedAt: text(file.exportedAt),
    exportedBy: text(file.exportedBy),
    licences: wells.flatMap((w) => (isRecord(w) && typeof w.licence === 'string' ? [w.licence] : [])),
    assessmentIds: assessments.flatMap((a) => (isRecord(a) && typeof a.id === 'string' ? [a.id] : [])),
  };
}

/** What a replace import would delete: wells, assessments, and how many of those are finals. */
export type ReplaceDeletions = { wells: number; assessments: number; finals: number };

/**
 * What importing a file in replace mode would delete from the stored project, by the store's
 * rule (Store.importProject, ImportResult.removed): every well whose licence is not in the file,
 * with all its assessments, and every other assessment of the project whose id is not in the
 * file, finals included. `stored` is the project as this browser has it (empty when it has none).
 */
export function replaceDeletions(
  stored: { wells: readonly Pick<Well, 'id' | 'licence'>[]; assessments: readonly Pick<Assessment, 'id' | 'wellId' | 'status'>[] },
  file: Pick<ExportSummary, 'licences' | 'assessmentIds'>,
): ReplaceDeletions {
  const fileLicences = new Set(file.licences.map(licenceKey));
  const fileAssessments = new Set(file.assessmentIds);
  const dropped = new Set(stored.wells.filter((w) => !fileLicences.has(licenceKey(w.licence))).map((w) => w.id));
  const deleted = stored.assessments.filter((a) => dropped.has(a.wellId) || !fileAssessments.has(a.id));
  return {
    wells: dropped.size,
    assessments: deleted.length,
    finals: deleted.filter((a) => a.status === 'final').length,
  };
}

/**
 * "2 wells and 3 assessments (including 2 final assessments) will be deleted.", leaving out the
 * parts that are zero; "Nothing will be deleted." when all are.
 */
export function replacePreviewText({ wells, assessments, finals }: ReplaceDeletions): string {
  const parts: string[] = [];
  if (wells > 0) parts.push(plural(wells, 'well'));
  if (assessments > 0) {
    const including = finals > 0 ? ` (including ${plural(finals, 'final assessment')})` : '';
    parts.push(`${plural(assessments, 'assessment')}${including}`);
  }
  return parts.length === 0 ? 'Nothing will be deleted.' : `${parts.join(' and ')} will be deleted.`;
}

/**
 * An import's result in two lines: "0 created, 5 updated" and "0 assessments and 0 history events
 * added". A replace also says what it deleted (the store's `removed`), zero included:
 * "0 created, 5 updated, 1 deleted" and "…added, 2 assessments deleted".
 */
export function importSummary(result: ImportResult, mode: ImportMode): { wells: string; added: string } {
  const { created, updated } = result.wells;
  const replace = mode === 'replace';
  const added = `${plural(result.assessments.added, 'assessment')} and ${plural(result.auditEvents.added, 'history event')} added`;
  return {
    wells: `${created} created, ${updated} updated${replace ? `, ${result.removed.wells} deleted` : ''}`,
    added: replace ? `${added}, ${plural(result.removed.assessments, 'assessment')} deleted` : added,
  };
}
