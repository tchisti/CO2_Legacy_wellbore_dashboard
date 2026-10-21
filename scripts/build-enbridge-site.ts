// Builds fixtures/enbridge-site.json (spec §8.3) from the 3D viewer's preloaded Enbridge site,
// legacy-well-management-system/src/data-enbridge.js (ENBRIDGE_SITE, ENBRIDGE_WELLS): the injectors
// and formation column of the Nisku Enbridge POC AOR, and each well's name and TD by UWI.
//
//   pnpm --filter scripts exec tsx build-enbridge-site.ts --source <path/to/data-enbridge.js> \
//     [--write fixtures/enbridge-site.json]
//
// Relative paths resolve against INIT_CWD when pnpm sets it, else the current directory (which is
// scripts/ under `pnpm --filter scripts exec`). Without --write the JSON goes to stdout.
import { realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSiteConfig, type SiteConfig } from '@lwa/engine';

export type LatLon = { lat: number; lon: number };

/** Metres per degree of latitude: the 3D viewer's flat-earth constant. */
const M_PER_DEG_LAT = 111320;

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * The 3D viewer's local frame (x east, y north, metres from `origin`) to WGS84 decimal degrees,
 * flat earth at the origin latitude, rounded to 6 decimals (about 0.1 m):
 * lat = lat0 + y / 111320, lon = lon0 + x / (111320 × cos(lat0)).
 */
export function localToLatLon(x: number, y: number, origin: LatLon): LatLon {
  return {
    lat: round6(origin.lat + y / M_PER_DEG_LAT),
    lon: round6(origin.lon + x / (M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180))),
  };
}

/** The parts of ENBRIDGE_SITE this reads. */
export type SourceSite = {
  name: string;
  origin: LatLon;
  aor: { radius_m: number };
  injectors: ReadonlyArray<{ id: string; name: string; x: number; y: number }>;
  formations: ReadonlyArray<{ id: string; name: string; top_m: number; base_m: number; role: string }>;
};

/** The parts of an ENBRIDGE_WELLS record this reads. */
export type SourceWell = { uwi: string; wellName: string; td: number | null };

const roleOf = (role: string): 'seal' | 'reservoir' | 'other' =>
  role === 'caprock' ? 'seal' : role === 'reservoir' ? 'reservoir' : 'other';

/** Injectors in WGS84, formations ordered by top (0-based), and { name, td_m } by UWI. */
export function buildSiteConfig(site: SourceSite, wells: readonly SourceWell[], source?: string): SiteConfig {
  return parseSiteConfig({
    name: site.name,
    ...(source ? { source } : {}),
    injectors: site.injectors.map((i) => ({
      id: i.id,
      name: i.name,
      ...localToLatLon(i.x, i.y, site.origin),
      aorRadius_m: site.aor.radius_m,
    })),
    formations: [...site.formations]
      .sort((a, b) => a.top_m - b.top_m)
      .map((f, order) => ({ id: f.id, name: f.name, top_m: f.top_m, base_m: f.base_m, role: roleOf(f.role), order })),
    wellsByUwi: Object.fromEntries(
      wells.map((w) => [w.uwi, { name: w.wellName, td_m: typeof w.td === 'number' ? w.td : null }]),
    ),
  });
}

async function run(argv: readonly string[]): Promise<number> {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sourcePath = valueOf('--source');
  if (!sourcePath) {
    console.error('Usage: tsx build-enbridge-site.ts --source <path/to/data-enbridge.js> [--write <out.json>]');
    return 2;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const mod = (await import(pathToFileURL(resolve(cwd, sourcePath)).href)) as {
    ENBRIDGE_SITE: SourceSite;
    ENBRIDGE_WELLS: SourceWell[];
  };
  const config = buildSiteConfig(
    mod.ENBRIDGE_SITE,
    mod.ENBRIDGE_WELLS,
    'legacy-well-management-system/src/data-enbridge.js (ENBRIDGE_SITE, ENBRIDGE_WELLS)',
  );
  const json = JSON.stringify(config, null, 2) + '\n';
  const out = valueOf('--write');
  if (!out) {
    process.stdout.write(json);
    return 0;
  }
  writeFileSync(resolve(cwd, out), json);
  console.log(`Wrote ${resolve(cwd, out)}`);
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

if (isEntryPoint()) process.exitCode = await run(process.argv.slice(2));
