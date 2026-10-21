# Legacy Well Assessment (v3)

Legacy Well Assessment is a risk-assessment tool for legacy wells inside a CO₂ storage area of
review. A reviewer records each well (licence, status, construction), scores it on the unified
methodology (11 weighted parameters giving likelihood L and consequence C, a 5 × 5 matrix cell and
a rank), justifies every score, and finalises the assessment. The tool then shows the portfolio
(counts, matrix, risk drivers, what needs attention), keeps the full history of every change, and
prints a well dossier or a portfolio report for a regulator. Phase 1 is local-first: everything
lives in the reviewer's browser, and a project moves between browsers as one export file.

Design: [`docs/superpowers/specs/2026-10-20-v3-rebuild-design.md`](docs/superpowers/specs/2026-10-20-v3-rebuild-design.md).
Operations: [`docs/runbook.md`](docs/runbook.md). Changes: [`CHANGELOG.md`](CHANGELOG.md).

## Stack

- **pnpm workspace** (Node 22, see `.nvmrc`; pnpm 10, see `packageManager`):
  - `packages/engine` (`@lwa/engine`): the framework-free TypeScript engine. Scoring, recommended
    actions, derived suggestions, staleness, the wellbore report parser and schematic, the domain
    schemas (Zod), and the v2 → v3 migration. The numerics are v2's, pinned by its golden vectors.
  - `apps/web`: the app. Next.js 16 (App Router) as a **static export**, React 19, TypeScript strict,
    Tailwind CSS 4, shadcn/ui on Radix, TanStack Table, Dexie (IndexedDB), Zod, Sonner.
  - `scripts`: the migration CLI (`migrate-v2.ts`) and its fixtures.
- **Tests:** Vitest with coverage gates (engine, scripts, the web store), and Playwright end to end
  (flows, axe accessibility on every route in both themes, phone and tablet layouts, a 500-well
  performance smoke).
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, unit tests with coverage, the plain build
  with a check that no test hooks ship, then Playwright against the static export.

## Getting started

```bash
pnpm install                 # once
pnpm dev                     # the app on http://localhost:3000 (pnpm --filter web dev)
```

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests in every package, with coverage; fails below a package's gate |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint in every package |
| `pnpm --filter web e2e` | Playwright against `next dev` on port 3100 (started for you) |
| `pnpm --filter web e2e:static` | Builds the export with the test hooks, then runs Playwright against it (what CI runs) |
| `pnpm --filter web build` | The static export, in `apps/web/out` (serve it from any static host) |
| `pnpm --filter web check:no-e2e-hooks` | Fails if `apps/web/out` carries the test hooks or holds no scripts |

`pnpm --filter web build` writes plain HTML, CSS and JavaScript to `apps/web/out`. Detail pages take
their ids from the query string (`/wells/view?id=…`, `/report/well?id=…`), so no server routes are
needed. Pages are written as `wells.html`, `wells/view.html` and so on, so the host must serve
`/wells` from `wells.html` (clean URLs). On Vercel, [`vercel.json`](vercel.json) sets the build
command, the `apps/web/out` output folder and clean URLs. HTTPS is recommended, but plain HTTP
works too: where the browser withholds
`crypto.randomUUID` (any page that is not HTTPS or localhost) ids come from `crypto.getRandomValues`
(checked in Chromium on a plain-HTTP LAN address). Playwright needs Chromium once:
`pnpm --filter web exec playwright install chromium`.

## The reviewer profile

There is no sign-in in Phase 1. The first time the app opens in a browser it asks for a name and
initials: the **reviewer profile**. It is stamped on every assessment and on every change in the
history, and it is labelled as unverified: anyone using that browser can edit it (top bar, your
initials, "Edit profile"). Reports end with the line "Reviewer identity is recorded from a local
profile and is not authenticated."

## Where the data lives, backup and restore

Each browser keeps its own database (IndexedDB, named `lwa`): projects, wells, assessments, the
methodology revisions and the audit trail. Nothing is sent anywhere. That browser holds the only
copy, so back it up:

- **Back up:** Project settings → Backup → **Export project** downloads `<project>-<date>.lwa.json`:
  the whole project, every well, assessment, methodology revision and history event. After each
  finalise the app offers "Export a backup" once per session.
- **Restore or hand over:** on a fresh browser, the first-run screen's **Import project file**; or
  Project settings → Backup → **Import project file**, then **Merge** (adds and updates by licence;
  never deletes) or **Replace** (the file becomes the project; it says what it would delete and asks
  for the project name first).

What to do when an import fails, how to reset a browser and how to roll back:
[`docs/runbook.md`](docs/runbook.md).

## Importing the v2 register

The v2 register (`wells.json` + `methodology.json`, on branch `v2-static`) converts into a v3
project file with the migration script. It prints a parity table (v2's stored L, C, cell, rank and
index against the v3 recompute) and writes only when every well agrees:

```bash
# the v2 files, from the v2-static branch (outside the working tree)
mkdir -p ~/lwa-v2
git show v2-static:wells.json > ~/lwa-v2/wells.json
git show v2-static:methodology.json > ~/lwa-v2/methodology.json

# dry run, from the repository root: the parity table only
pnpm --filter scripts migrate -- --wells ~/lwa-v2/wells.json --methodology ~/lwa-v2/methodology.json \
  --site scripts/fixtures/enbridge-site.json

# write the project file
pnpm --filter scripts migrate -- --wells ~/lwa-v2/wells.json --methodology ~/lwa-v2/methodology.json \
  --site scripts/fixtures/enbridge-site.json --write ~/lwa-v2/out.lwa.json
```

Relative paths resolve from the directory you run pnpm in (here the repository root). `--site` adds the injectors, formation
tops and well names/TDs of the Enbridge POC area of review. `--browser-export <file>` (repeatable)
merges a v2 "Export JSON" or a 3D-reviewer export from someone's browser; `--project-name` overrides
the default "Fort Saskatchewan / Wabamun Hub AOR". Exit code 1 means a parity mismatch (nothing is
written), 2 a bad argument or an unreadable file. On the current register all five wells agree. Then
import `out.lwa.json` through the first-run
screen or Project settings → Backup. The ids are deterministic, so running it again and importing
with Merge is safe. A bare v2 `wells.json` can also be imported straight into the active project
from Wells → Import.

## Where v2 lives

v2 (the single-page `index.html` register, `3d-reviewer.html`, `scoring.js`, `methodology.json`,
`wells.json`, `tools/`) is preserved on branch **`v2-static`**. Those files are still present on this
branch too, on purpose: they leave `main` only after GitHub Pages deploys from `v2-static`, so the
team's v2 link never breaks. The switch is a step for the repository owner, described in
[`docs/runbook.md`](docs/runbook.md#github-pages-switch-before-v2-leaves-main).

## Phase 2 and later

Not in Phase 1, by design (spec §9):

- Hosting and identity: a backend `Store` adapter (Supabase or a Git-JSON store), sign-in,
  per-project roles, nightly snapshots.
- Map view with AOR circles and injector distances.
- Documents tab on the well page.
- Methodology editor with revision notes (the methodology is read-only in Phase 1).
- Optional approval (four-eyes) workflow; the schema already carries the fields.
- Schematic PNG export, zoom and pan; server-side PDF.
- Phase 3: the 3D section view as a Map toggle, and extractor hand-off as suggestions.
