import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectExportSchema } from '@lwa/engine';
import {
  describeExport,
  downloadExport,
  exportFileName,
  exportProjectId,
  importSummary,
  projectSlug,
  readExportFile,
} from '@/lib/backup';
import { createLocalStore } from '@/lib/store/local-store';

const FIXTURE = readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8');

const fileOf = (text: string, name = 'project.json') => new File([text], name, { type: 'application/json' });

describe('readExportFile', () => {
  it('readExportFile rejects a file with format !== "lwa-project" with message starting "Not a Legacy Well Assessment export"', async () => {
    await expect(readExportFile(fileOf('{"format":"lwa-backup","version":1}'))).rejects.toThrow(
      /^Not a Legacy Well Assessment export/,
    );
  });

  it('returns the parsed project export', async () => {
    const data = await readExportFile(fileOf(FIXTURE));
    expect(data).toEqual(JSON.parse(FIXTURE));
  });

  it('accepts a file that starts with a byte-order mark', async () => {
    const data = await readExportFile(fileOf(`﻿${FIXTURE}`));
    expect(exportProjectId(data)).toBe('prj_v2_fort-saskatchewan-wabamun-hub-aor');
  });

  it('rejects text that is not JSON', async () => {
    await expect(readExportFile(fileOf('{ "format": "lwa-project", '))).rejects.toThrow('This file is not valid JSON.');
    await expect(readExportFile(fileOf(''))).rejects.toThrow('This file is not valid JSON.');
  });

  it.each([
    ['an array of wells', '[{"licence":"0001"}]'],
    ['an object without a format', '{"wells":[]}'],
    ['another format', '{"format":"something-else","version":1}'],
    ['a bare string', '"lwa-project"'],
    ['null', 'null'],
  ])('rejects JSON that is not a project export: %s', async (_label, text) => {
    const error = await readExportFile(fileOf(text)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.startsWith('Not a Legacy Well Assessment export')).toBe(true);
  });
});

describe('exportProjectId', () => {
  it('reads project.id from an export', () => {
    expect(exportProjectId(JSON.parse(FIXTURE))).toBe('prj_v2_fort-saskatchewan-wabamun-hub-aor');
  });

  it('is null when the value has no project id', () => {
    expect(exportProjectId(null)).toBeNull();
    expect(exportProjectId({ project: {} })).toBeNull();
    expect(exportProjectId({ project: { id: 7 } })).toBeNull();
    expect(exportProjectId('prj_1')).toBeNull();
  });
});

describe('export file name', () => {
  it.each([
    ['Fort Saskatchewan / Wabamun Hub AOR', 'fort-saskatchewan-wabamun-hub-aor'],
    ['  Test AOR  ', 'test-aor'],
    ['Évangéline – Nisku (2026)', 'evangeline-nisku-2026'],
    ['CO₂ hub #3', 'co2-hub-3'],
    ['---', 'project'],
    ['', 'project'],
  ])('slugs %j as %j', (name, slug) => {
    expect(projectSlug(name)).toBe(slug);
  });

  it('is <project-slug>-<YYYY-MM-DD>.lwa.json with the UTC date of the export', () => {
    expect(exportFileName('Fort Saskatchewan / Wabamun Hub AOR', '2026-10-20T23:59:59.000Z')).toBe(
      'fort-saskatchewan-wabamun-hub-aor-2026-10-20.lwa.json',
    );
    expect(exportFileName('Test AOR', '2026-01-02T00:00:00Z')).toBe('test-aor-2026-01-02.lwa.json');
  });
});

describe('downloadExport', () => {
  it('saves the project as pretty JSON named <slug>-<date>.lwa.json that parses back as a project export', async () => {
    const store = createLocalStore({
      dbName: 'lwa-backup-download-test',
      actor: () => 'T. Chisti',
      now: () => '2026-10-20T08:30:00.000Z',
    });
    await store.importProject(JSON.parse(FIXTURE), 'merge');

    const saved: { blob: Blob; filename: string }[] = [];
    const { filename, data } = await downloadExport(store, 'prj_v2_fort-saskatchewan-wabamun-hub-aor', (blob, name) =>
      saved.push({ blob, filename: name }),
    );

    expect(filename).toBe('fort-saskatchewan-wabamun-hub-aor-2026-10-20.lwa.json');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.filename).toBe(filename);
    expect(saved[0]!.blob.type).toBe('application/json');
    const text = await saved[0]!.blob.text();
    expect(text.startsWith('{\n  "format": "lwa-project",')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    const parsed = ProjectExportSchema.parse(JSON.parse(text));
    expect(parsed).toEqual(data);
    expect(parsed.exportedBy).toBe('T. Chisti');
    expect(parsed.wells).toHaveLength(5);
    expect(parsed.assessments).toHaveLength(5);
  });
});

describe('describeExport', () => {
  it('summarises a project export', () => {
    expect(describeExport(JSON.parse(FIXTURE))).toEqual({
      projectId: 'prj_v2_fort-saskatchewan-wabamun-hub-aor',
      projectName: 'Fort Saskatchewan / Wabamun Hub AOR',
      wells: 5,
      assessments: 5,
      auditEvents: 5,
      exportedAt: expect.any(String),
      exportedBy: expect.any(String),
      licences: [
        '100/13-06-055-22W4/00',
        '100/08-19-055-22W4/00',
        '100/07-21-055-22W4/00',
        '100/13-05-056-22W4/00',
        '100/03-17-056-22W4/00',
      ],
    });
  });

  it('leaves out what the value does not carry', () => {
    expect(describeExport({ format: 'lwa-project', project: { name: 7 }, wells: [{ licence: 3 }, {}] })).toEqual({
      projectId: null,
      projectName: null,
      wells: 2,
      assessments: null,
      auditEvents: null,
      exportedAt: null,
      exportedBy: null,
      licences: [],
    });
    expect(describeExport(null).wells).toBeNull();
  });
});

describe('importSummary', () => {
  const result = (wells: [number, number], assessments: number, events: number) => ({
    wells: { created: wells[0], updated: wells[1] },
    assessments: { added: assessments, skipped: 0 },
    auditEvents: { added: events, skipped: 2 },
    warnings: [],
  });

  it('counts wells created and updated, then assessments and history events added', () => {
    expect(importSummary(result([0, 5], 0, 0))).toEqual({
      wells: '0 created, 5 updated',
      added: '0 assessments and 0 history events added',
    });
    expect(importSummary(result([1, 0], 1, 1))).toEqual({
      wells: '1 created, 0 updated',
      added: '1 assessment and 1 history event added',
    });
  });

  it('adds the wells a replace deleted', () => {
    expect(importSummary(result([0, 5], 0, 0), 2).wells).toBe('0 created, 5 updated, 2 deleted');
    expect(importSummary(result([0, 5], 0, 0), 0).wells).toBe('0 created, 5 updated');
  });
});
