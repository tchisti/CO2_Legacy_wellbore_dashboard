import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportProjectId, readExportFile } from '@/lib/backup';

const FIXTURE = readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8');

const fileOf = (text: string, name = 'project.json') => new File([text], name, { type: 'application/json' });

describe('readExportFile', () => {
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
