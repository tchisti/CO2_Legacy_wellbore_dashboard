import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { E2E_BUILD_MARKER, HOOK_MARKER, e2eHookProblems } from './assert-no-e2e-hooks.mjs';

const dirs: string[] = [];
function exportDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwa-out-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('assert-no-e2e-hooks', () => {
  it('passes an export without the hook', () => {
    const dir = exportDir({ 'index.html': '<html></html>', '_next/static/chunks/a.js': 'e.s(["f",0,function(e){}])' });
    expect(e2eHookProblems(dir)).toEqual([]);
  });

  it('fails an export whose chunks install the hook, naming the file', () => {
    const dir = exportDir({ '_next/static/chunks/b.js': 'function(e){window.__lwa={store:e}}', 'index.html': '' });
    expect(e2eHookProblems(dir)).toEqual([`${path.join('_next', 'static', 'chunks', 'b.js')} contains the e2e hook (__lwa)`]);
  });

  it('fails an export marked as an e2e build, and a missing export', () => {
    const dir = exportDir({
      [E2E_BUILD_MARKER]: 'next build with NEXT_PUBLIC_E2E=1\n',
      '_next/static/chunks/a.js': 'e.s(["f",0,function(e){}])',
    });
    expect(e2eHookProblems(dir)).toEqual([`${E2E_BUILD_MARKER} is present: out/ was built by \`pnpm build:e2e\``]);
    expect(e2eHookProblems(path.join(dir, 'nope'))[0]).toMatch(/does not exist/);
  });

  it('fails an export with no JavaScript to scan: an empty out/, or one with only pages', () => {
    const empty = exportDir({});
    expect(e2eHookProblems(empty)).toEqual([`no JavaScript files in ${empty}: nothing was scanned, build the export first`]);
    const pagesOnly = exportDir({ 'index.html': '<html></html>', '404.html': '<html></html>', 'icon.svg': '<svg/>' });
    expect(e2eHookProblems(pagesOnly)).toEqual([
      `no JavaScript files in ${pagesOnly}: nothing was scanned, build the export first`,
    ]);
    // One script is enough to scan (an .mjs counts as well as a .js).
    expect(e2eHookProblems(exportDir({ 'index.html': '', '_next/x.mjs': 'export {}' }))).toEqual([]);
  });

  it('looks for the property the hook really sets (lib/e2e-hooks.ts)', () => {
    const source = readFileSync(path.join(__dirname, '..', 'lib', 'e2e-hooks.ts'), 'utf8');
    expect(source).toContain(`window.${HOOK_MARKER} = `);
  });
});
