// CLI for the v2 → v3 migration (spec §8). Reads the v2 files, runs migrateV2Data (@lwa/engine),
// prints the parity table (stored v2 computed block vs v3 recompute), and writes the v3 project
// export only when asked to (--write) and only when every row agrees.
//
//   pnpm --filter scripts migrate -- --wells <wells.json> --methodology <methodology.json>
//     [--site scripts/fixtures/enbridge-site.json] [--browser-export <file>]...
//     [--project-name "<name>"] [--actor "<name>"] [--write <out.json>]
//
// Relative paths resolve against the directory pnpm was started from (INIT_CWD).
// Exit codes: 0 done; 1 parity mismatch (nothing written); 2 bad arguments or unreadable input.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateV2Data, parseSiteConfig, type MigrateV2Result, type ParityMetrics, type ParityRow } from '@lwa/engine';

/** Everything the CLI touches outside its arguments, so tests can run it in-process. */
export type CliIo = {
  /** Base for relative paths. */
  cwd: string;
  now: () => string;
  out: (line: string) => void;
  err: (line: string) => void;
};

const DEFAULT_ACTOR = 'v2 migration';

const USAGE = `Usage: pnpm --filter scripts migrate -- --wells <wells.json> --methodology <methodology.json> [options]

  --wells <file>            v2 wells.json (required)
  --methodology <file>      v2 methodology.json (required)
  --site <file>             site file: injectors, formations, well name/TD by UWI
  --browser-export <file>   v2 "Export JSON" or 3D reviewer export; repeatable
  --project-name <name>     default "Fort Saskatchewan / Wabamun Hub AOR"
  --actor <name>            recorded as exportedBy and on audit events (default "${DEFAULT_ACTOR}")
  --write <out.json>        write the project export; without it this is a dry run`;

class UsageError extends Error {}

type Options = {
  help: boolean;
  wells: string;
  methodology: string;
  site: string | null;
  browserExports: string[];
  projectName: string | undefined;
  actor: string;
  write: string | null;
};

export function parseArgs(argv: readonly string[]): Options {
  const o = {
    help: false,
    wells: null as string | null,
    methodology: null as string | null,
    site: null as string | null,
    browserExports: [] as string[],
    projectName: undefined as string | undefined,
    actor: DEFAULT_ACTOR,
    write: null as string | null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--') continue; // pnpm passes its argument separator through to the script
    if (arg === '--help' || arg === '-h') {
      o.help = true;
      continue;
    }
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = (): string => {
      if (eq > 0) return arg.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case '--wells':
        o.wells = value();
        break;
      case '--methodology':
        o.methodology = value();
        break;
      case '--site':
        o.site = value();
        break;
      case '--browser-export':
        o.browserExports.push(value());
        break;
      case '--project-name':
        o.projectName = value();
        break;
      case '--actor':
        o.actor = value();
        break;
      case '--write':
        o.write = value();
        break;
      default:
        throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  if (!o.help && o.wells === null) throw new UsageError('--wells <wells.json> is required');
  if (!o.help && o.methodology === null) throw new UsageError('--methodology <methodology.json> is required');
  return { ...o, wells: o.wells ?? '', methodology: o.methodology ?? '' };
}

function readJson(path: string, flag: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`${flag} ${path}: cannot read (${e instanceof Error ? e.message : String(e)})`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (e) {
    throw new Error(`${flag} ${path}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
}

const metrics = (m: ParityMetrics | null): string =>
  m ? `${m.L} / ${m.C} / ${m.cell} / ${m.riskIndex} / ${m.rank}` : '-';

/** The parity table as aligned text lines. */
export function formatParityTable(rows: readonly ParityRow[]): string[] {
  const header = ['licence', 'status', 'v2 L / C / cell / RI / rank', 'v3 L / C / cell / RI / rank', 'note'];
  const body = rows.map((r) => [r.licence, r.status, metrics(r.v2), metrics(r.v3), r.note ?? '']);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((cells) => (cells[i] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)];
}

function report(result: MigrateV2Result, browserExports: readonly string[], io: CliIo): void {
  const { project, wells, assessments, methodologies, auditEvents } = result.export;
  io.out(`Parity: stored v2 computed block vs v3 recompute under methodology ${methodologies[0]?.revision ?? '?'}`);
  io.out('');
  for (const l of formatParityTable(result.parity)) io.out(l);
  io.out('');
  const counts = new Map<string, number>();
  for (const r of result.parity) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  io.out(`${result.parity.length} rows: ${[...counts].map(([status, n]) => `${n} ${status}`).join(', ')}`);
  browserExports.forEach((p, i) => io.out(`browser export ${i + 1} = ${p}`));
  const finals = assessments.filter((a) => a.status === 'final').length;
  io.out(
    `Project ${project.id} "${project.name}": ${wells.length} wells, ${assessments.length} assessments ` +
      `(${finals} final, ${assessments.length - finals} draft), ${auditEvents.length} audit events, ` +
      `${project.injectors.length} injectors, ${project.formations.length} formations.`,
  );
  for (const w of result.warnings) io.err(`warning: ${w}`);
}

export function main(argv: readonly string[], io: CliIo): number {
  let opts: Options;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`error: ${e.message}`);
    io.err(USAGE);
    return 2;
  }
  if (opts.help) {
    io.out(USAGE);
    return 0;
  }

  const path = (p: string): string => resolve(io.cwd, p);
  let result: MigrateV2Result;
  try {
    const site = opts.site === null ? null : parseSiteConfig(readJson(path(opts.site), '--site'));
    result = migrateV2Data({
      wells: readJson(path(opts.wells), '--wells'),
      methodology: readJson(path(opts.methodology), '--methodology'),
      site,
      browserExports: opts.browserExports.map((p) => readJson(path(p), '--browser-export')),
      projectName: opts.projectName,
      now: io.now(),
      actor: opts.actor,
    });
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  report(result, opts.browserExports, io);
  const n = result.mismatches.length;
  if (n > 0) {
    io.err(
      opts.write === null
        ? `Parity failed: ${n} mismatch(es). A --write run would refuse to write.`
        : `Refusing to write ${path(opts.write)}: ${n} parity mismatch(es). Nothing was written.`,
    );
    return 1;
  }
  if (opts.write === null) {
    io.out('Dry run: nothing written. Add --write <out.json> to write the project export.');
    return 0;
  }
  const out = path(opts.write);
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result.export, null, 2) + '\n');
  } catch (e) {
    io.err(`error: cannot write ${out} (${e instanceof Error ? e.message : String(e)})`);
    return 2;
  }
  io.out(`Wrote ${out}`);
  return 0;
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  try {
    return entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.env.INIT_CWD ?? process.cwd(),
    now: () => new Date().toISOString(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}
