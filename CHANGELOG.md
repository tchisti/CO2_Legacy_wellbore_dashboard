# Changelog

## 3.0.0-phase1 (unreleased, branch `feat/v3-phase1`)

v3 Phase 1 replaces the v2 single-page register with a local-first app. Design:
[`docs/superpowers/specs/2026-10-20-v3-rebuild-design.md`](docs/superpowers/specs/2026-10-20-v3-rebuild-design.md).
v2 is preserved on branch `v2-static`.

### Added

- **Engine** (`@lwa/engine`, `packages/engine`): one TypeScript copy of the v2 scoring engine
  (weighted L and C, matrix cell, rank, Risk Index), recommended actions, derived score suggestions
  (penetration, age, complexity, barriers, plume), staleness by methodology revision, the wellbore
  report parser and schematic renderer, the domain schemas (Zod) and the v2 → v3 migration. v2's
  golden vectors V1–V5 and the W-W8QB2S migration case pass unchanged; property tests cover weights,
  monotonic rank and the unknown floor.
- **Storage**: a `Store` interface with a contract test suite, and `LocalStore` (IndexedDB via
  Dexie). Every create, update, finalise, delete and import writes an audit event.
- **Projects**: several per browser, a first-run screen (create a project or import a file), the
  project switcher, and the reviewer profile (name and initials, stamped on every assessment and
  change, labelled unverified).
- **Portfolio**: KPI tiles, the 5 × 5 matrix, driver contributions and "Needs attention"; every
  number links to the matching wells.
- **Wells**: the register (sort, filters in the URL, keyboard rows, a licence link per row), new
  well, edit record, guarded delete and bulk delete, CSV and JSON import with a validation report,
  CSV export of the view or the selection.
- **Well page**: header with the verdict, and the Assessment (scores, anchors, justifications,
  recommended action, prior assessments), Construction (rows editor, report paste parser, schematic,
  SVG export) and History tabs.
- **Score flow**: keyboard-first scoring (1–5, `?` for Unknown), derived suggestion chips that are
  never applied for you, a justification for every scored parameter, a live result, drafts,
  re-assessment prefilled from the last final, and a reviewer override of the recommended action.
- **Methodology** page (read-only): parameters, anchors, bands, classification (Table A-1 and Figure
  A-4), sources and the revisions in the project.
- **Project settings**: project details, injectors and formation tops, the reviewer profile, backup
  (export and import with Merge or Replace) and a danger zone.
- **Reports**: a well dossier and a portfolio report as print routes (vector matrix and schematic,
  running header and page numbers in Chromium, always the light palette).
- **Migration** CLI (`pnpm --filter scripts migrate`): v2 `wells.json` + `methodology.json` (+ site
  file, + browser exports) to a v3 project file, with a parity table; it writes only when every well
  matches. All five wells of the current register match.
- **Hardening**: error boundaries per route and for the shell, a client logging hook
  (`lib/log.ts`), a backup reminder after finalising, CI (typecheck, lint, unit tests with coverage
  gates, build, a check that no test hooks ship, Playwright against the static export), axe on every
  route in both themes, phone (390 px) and tablet (1024 px) layout tests, and a 500-well performance
  smoke test.
- **Docs**: this changelog, the README and [`docs/runbook.md`](docs/runbook.md).
- **Vercel config** ([`vercel.json`](vercel.json)): builds the web app and serves `apps/web/out` with
  clean URLs.

### Changed (from v2)

- One app (Next.js, static export) instead of `index.html` plus `3d-reviewer.html` plus a bridge. The
  3D viewer is not part of Phase 1.
- Data lives in each browser's IndexedDB, not in `wells.json` in the repository written through the
  GitHub API. No access tokens. Backup and hand-over are a project export file.
- An assessment is a record of its own (draft or final) instead of fields on the well; finals are
  kept, so a well's history of assessments is visible, and the history tab shows every change.
- Finalising needs a justification for every scored parameter, and Unknown is a deliberate choice
  (`?`), not a default.
- A methodology **patch** revision (wording only) no longer marks assessments stale; major and minor
  revisions do (v2 flagged any revision change).
- Score suggestions are shown as chips with their basis and never fill a score by themselves.
- Band bounds must be whole numbers (a methodology with fractional bounds is rejected); a fractional
  v1 score migrates as Unknown.
- A band's class must be `low`, `mod`, `high` or `crit`: a methodology with any other class is
  refused, where v2 gave it the lowest tier's recommended action.
- The wellbore parser makes inverted intervals and impossible depths visible errors with a one-click
  Swap (v2 swapped silently), and a clause with an unreadable number becomes a note with its text
  kept (v2 drew a NaN row).
- Reports are print pages with vector graphics instead of jsPDF + html2canvas.
- Light theme by default; dark on request.
- The methodology is read-only in the app (v2 had an editor behind a token).
- A construction record's open hole carries no `source` field (spec §5 lists one), so v2's records
  keep comparing exactly (ruling R6).

### Known gaps

Not in Phase 1 by design: hosting and identity (no sign-in, the reviewer name is unverified; no
roles), the Map, Documents, the methodology editor, the approval workflow (fields exist, the
workflow is hidden), assigning a reviewer to wells, schematic PNG export and zoom/pan, server-side
PDF, the 3D view and extractor hand-off.

Verification:

- Wellbore parser branch coverage is 96.2 % (gate 96 %), not the spec's 100 %. The 19 branches left
  cannot run: `?? ''` fallbacks on regex groups that always match (needed by
  `noUncheckedIndexedAccess`) in `parse.ts` and `units.ts`, `FRAC_CHARS[…] ?? NaN`, the parser's
  never-throw `catch`, and `esc()`'s null branch and `ESCAPES[ch] ?? ch` in `svg.ts`.
- The store adapter is gated at 90 % (achieved 93.3 % branches); the rest of the web app has no
  coverage gate.
- Performance targets are smoke-tested, not asserted as specified: Portfolio reaches its 500-well
  KPI in about 0.4 s and Wells in about 0.6 s, but "60 fps" scrolling is not measured as a frame rate.
- The Wells register, the backup preview and History read each well's assessments on every store
  change (O(N) reads): fine at the spec's 500-well target (measured 0.4–0.6 s), but expect seconds
  per change past about 1,000 wells; a project-scoped read is planned.
- Lighthouse accessibility (100 on Wells and the Well page) was run once locally; CI runs axe, not
  Lighthouse. The CI e2e job has not yet run on GitHub.
- The build fetches Inter and JetBrains Mono from Google Fonts (`next/font/google`): a blocked fetch
  fails the build, and CI has never run on GitHub.
- `@vitest/coverage-v8` is pinned to `5.0.5` while `vitest` is `^5.0.5`: upgrade them together. The
  `shadcn` CLI (dev dependency) still installs the `cn` package; the app uses its own `cn`.

Printing and display:

- Safari drops CSS page-margin boxes: reports print there without the running header, footer and
  page numbers. Use Chrome or Edge.
- Formation labels can overlap on a printed schematic where tops are close together.
- Figure A-4 keeps v2's fixed domain colours (strata, casing, leak arrows) in both themes; a thin
  near-black outline under the arrows, open hole and cement gives them 3:1 against every backdrop.
- The wordmark's mark uses the accent colour, which the visual rules reserve for interactive
  elements.
- The Moderate rank pill and the amber Stale pill look alike (their text and icon tell them apart);
  in the Wells table a draft over a stale final shows as the draft, hiding the stale state.
- Between 1024 and 1279 px the Wells table hides five sortable columns; a sort link on a hidden
  column orders by a column you cannot see, with no indicator.
- The Methodology page leaves out v2's cement carbonation note.

Import, export and migration:

- Merge import replaces a well record wholesale when the file's copy is at least as new (no
  field-level merge), keeping the local creation stamps; it warns when the local copy holds an edit
  the file does not have (for example one made after the file was exported).
- Merge import: an incoming final can overwrite a newer local draft with the same id without a
  warning, and conflicting finals with the same id are skipped silently.
- The same v2 register migrated into two projects gives both the same assessment ids: importing the
  second skips each assessment whose id another well here already uses, with a warning.
- A methodology record must carry every v2 field (the schema is stricter than v2's checks).
- An import that switches the active project drops unsaved settings edits without asking, and an
  import's result stays on screen after a project switch.
- An import that fails reports the file's shape problems first and its reference problems only once
  those are fixed. Replace records counts of what it deleted, not the deleted records.
- CSV: a blank cell cannot clear a stored value (by design: use Edit record); text that starts with
  an apostrophe before `=`, `+`, `-` or `@` loses that apostrophe on an export/import round trip;
  rows that change nothing are reported as updated.
- Migration: an unreadable 3D record aborts the run instead of being listed; some 3D status texts map
  to Unknown; a 3D well's draft discarded in the app comes back if the migration is imported again;
  re-importing after a v2 record was edited adds a second final with no `supersedesId`, and clearing
  `needsReview` in v2 between runs leaves the earlier draft beside the new final.
- The in-browser v2 import (Wells → Import) migrates against the built-in 2.0.0 rulebook and lets the
  import go ahead despite parity mismatches, which it lists; the CLI refuses on any mismatch.
- Wells migrated with methodology revision 1.0.0 show as stale (no v3 1.0.0 rulebook exists). The
  Enbridge injector coordinates are derived from a local flat-earth origin; verify them before Map
  work.

Interaction details:

- A deliberate Unknown (`?`) in a first-assessment draft is not stored: continuing that draft asks
  for those rows again. Closing the score sheet saves a draft automatically.
- While the score sheet is saving on close or finalising, edits made meanwhile are discarded; X or
  Escape during Save draft is ignored; Back during a save saves twice (two toasts); Save draft with
  nothing entered writes an empty draft.
- The first project is created before the reviewer profile exists, so it records "Unknown" as its
  creator.
- The well form reads numbers with `Number()`: `1e2` is accepted there but refused by CSV import.
- The open hole is read-only in the construction editor; unsaved construction edits survive Back only
  within the same browser tab; a change to the saved construction made elsewhere (another tab, an
  import) while the editor holds unsaved edits is not announced, and Save then replaces it.
- The report parser keeps a clause with an unreadable number as a note, readable depths in that
  clause included ("Plug #1 100-200 m and , m" gives no plug); a pasted run of about 1,300 digits
  takes about a second to read (longer runs, longer).
- Wells: selections hidden by a filter stay selected; a partly failed bulk delete cannot be retried
  in one step; a row clicked within a quarter of a second of typing in the search box can be
  overtaken by the pending filter update, and, rarely, a filter change is lost on reload.
- The Sources section credits "Khan & Christi, 2025" verbatim from v2 (the owner's surname is
  Chisti); the owner decides whether to correct it.
