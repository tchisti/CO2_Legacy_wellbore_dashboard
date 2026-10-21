// Fails when the static export in out/ carries the e2e hooks (lib/e2e-hooks.ts), which expose the
// whole store as window.__lwa. CI runs it after the plain `next build`; only `pnpm build:e2e`
// (NEXT_PUBLIC_E2E=1) may compile them in. next.config.ts defines NEXT_PUBLIC_E2E at build time
// for every build, so a plain build drops the hook code and the property name never appears.
//
//   node scripts/assert-no-e2e-hooks.mjs [dir]     (default: out/ next to this script's parent)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The hook's window property: present in an e2e build (minified or not), absent from a plain one. */
export const HOOK_MARKER = '__lwa';
/** Written by `pnpm build:e2e` next to the export. */
export const E2E_BUILD_MARKER = '.e2e-build';

const TEXT = /\.(?:js|mjs|html|txt|json|css|map)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

/** The problems with `outDir` as a deployable export: empty when it carries no e2e hooks. */
export function e2eHookProblems(outDir) {
  if (!existsSync(outDir)) return [`${outDir} does not exist: build the export first`];
  const problems = [];
  if (existsSync(path.join(outDir, E2E_BUILD_MARKER))) {
    problems.push(`${E2E_BUILD_MARKER} is present: out/ was built by \`pnpm build:e2e\``);
  }
  for (const file of files(outDir)) {
    if (TEXT.test(file) && readFileSync(file, 'utf8').includes(HOOK_MARKER)) {
      problems.push(`${path.relative(outDir, file)} contains the e2e hook (${HOOK_MARKER})`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out'));
  const problems = e2eHookProblems(outDir);
  if (problems.length > 0) {
    console.error(`The export in ${outDir} must not ship the e2e hooks:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`No e2e hooks in ${outDir}.`);
}
