// Project files: reading an export the user picked. The store does the full validation
// (Store.importProject throws ImportError listing every problem); this only turns "the wrong kind
// of file" into a plain sentence before the store sees it. Spec §6.1 (export/import as backup).

const FORMAT = 'lwa-project';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
