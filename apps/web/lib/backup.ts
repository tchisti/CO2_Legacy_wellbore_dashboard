// Project files: the backup and hand-off mechanism of Phase 1 (spec §6.1, §9, §10). Exporting
// writes the whole project as one `.lwa.json` file; reading a file the user picked turns "the wrong
// kind of file" into a plain sentence before the store sees it. The store does the full validation
// (Store.importProject throws ImportError listing every problem and writes nothing).
import type { ProjectExport } from '@lwa/engine';
import { plural } from '@/lib/format';
import type { ImportResult, Store } from '@/lib/store/store';

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
};

export function describeExport(data: unknown): ExportSummary {
  const file = isRecord(data) ? data : {};
  const project = isRecord(file.project) ? file.project : {};
  const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const count = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);
  const wells: unknown[] = Array.isArray(file.wells) ? file.wells : [];
  return {
    projectId: text(project.id),
    projectName: text(project.name),
    wells: count(file.wells),
    assessments: count(file.assessments),
    auditEvents: count(file.auditEvents),
    exportedAt: text(file.exportedAt),
    exportedBy: text(file.exportedBy),
    licences: wells.flatMap((w) => (isRecord(w) && typeof w.licence === 'string' ? [w.licence] : [])),
  };
}

/**
 * An import's result in two lines: "0 created, 5 updated" (", 2 deleted" when a replace removed
 * wells) and "0 assessments and 0 history events added".
 */
export function importSummary(result: ImportResult, deleted = 0): { wells: string; added: string } {
  const { created, updated } = result.wells;
  return {
    wells: `${created} created, ${updated} updated${deleted > 0 ? `, ${deleted} deleted` : ''}`,
    added: `${plural(result.assessments.added, 'assessment')} and ${plural(result.auditEvents.added, 'history event')} added`,
  };
}
