# Legacy Well Assessment v3 — Rebuild Design Proposal

**Date:** 2026-10-20
**Status:** Approved 2026-10-20 by Tahir Chisti with one amendment: **hosting and identity are parked** (§11.1). Phase 1 is local-first (no backend, no sign-in); the `Store` interface keeps Supabase or any other backend a later drop-in. Builder check completed 2026-10-20.
**Owner:** Tahir Chisti
**Author of this draft:** Claude, from a survey of the live repo, the sibling `legacy-well-management-system` source, and the live GitHub Pages deployment on 2026-10-20
**Supersedes:** the current two-app layout (`index.html` register + `3d-reviewer.html` viewer + bridge)
**Keeps:** the unified risk methodology (spec 2026-07-28), the reviewer override (spec 2026-08-07), the wellbore schematic (spec 2026-08-07), and the scoring engine's numeric behaviour exactly

---

## 1. Intent

Turn the current proof of concept into a single, clean, production-grade engineering tool that a CCS project team uses to assess legacy wells inside an Area of Review, defend each assessment to a regulator (AER Directive 065/020, EPA Class VI §146.84), and track that portfolio over time.

The v2 tool works and its engineering core is sound. What it lacks is a product shape: one data model, one navigation, progressive disclosure, real identity, and a codebase that can be changed safely. Those are the things v3 fixes.

### 1.1 What the survey found (the why)

Facts, measured on 2026-10-20:

| Item | Finding |
|---|---|
| `index.html` | 3,820 lines, 169 global functions, inline `onclick` handlers, no build step |
| `3d-reviewer.html` | 24,995 lines; ~24,500 are a bundled copy of three.js. Real app source is `legacy-well-management-system/src` (2,451 lines, 27 modules, 71 passing tests). The HTML is a committed build artifact. |
| Scoring engine | `scoring.js` 300 lines, zero dependencies, tested (golden vectors). Identical copy vendored in the 3D project. **This is the asset.** |
| Wellbore core | Report parser + SVG schematic renderer, pure, tested (20 tests), but lives inside `index.html` between marker comments and is extracted by regex for testing |
| Data | 5 real wells in `wells.json` (Fort Saskatchewan / Wabamun area, 1949–2025), schema v2, methodology rev 2.0.0 |
| Storage | Register = `wells.json` in a **public** repo, written from the browser through the GitHub Contents API with a personal access token kept in `localStorage`; 3D viewer = separate per-browser `localStorage` datasets with its own three demo sites; a manual two-way "bridge" between them |
| UI load | Register page: 6 tabs, 10 top-bar actions, 117 buttons, 27 inputs; the add/edit form with all 11 scoring rows is pinned to every tab (overview is ~2,700 px tall). 3D page: 80 buttons, 42 inputs. |
| Health | Live page loads with zero console errors; all three test suites pass. Save/sync, conflict retry, and the bridge were not exercised (need a token). "Broken" is not visible at the surface; the real problem is that every change is risky and the information has no hierarchy. |
| Deploys | GitHub Pages (live) and a Vercel project `co-2-legacy-wellbore-dashboard` (homepage URL on the repo) |
| Neighbours | `legacy-well-extractor` (Python backend + frontend) digitises scanned well files into structured JSON with per-field confidence. Natural upstream feed; not integrated today. |

### 1.2 Why it feels like "too much"

1. **Two products in one.** The register and the 3D viewer each own wells, KPIs, sites, import/export, and theme. A user has to know which dataset they are looking at and when to push it across.
2. **No progressive disclosure.** Everything is always on screen: the full scoring form, every KPI, every action, the full dossier with basis text for every parameter.
3. **Actions without context.** Load Demo, Reset register, CSV Template, Import/Export JSON, Methodology editor, theme and sync all sit in the global header beside each other, on a tool holding real data.
4. **Labels drifted.** The form still says "Risk Scoring — Appendix D" and the reference tab "Appendix D & § 7.2" although scoring moved to the unified v2 model.
5. **Architecture resists change.** Global functions, string-built HTML, no types, a vendored library pasted into a page, the parser extracted from HTML by regex to be testable.
6. **Trust boundary is wrong for a team tool.** A write token in every editor's browser, well data in a public repo, attribution by a typed name, and merge/conflict logic running in the browser.

---

## 2. Goals, non-goals, anti-goals

### Goals

- **G1 One product.** One data model (Project → Wells → Assessments), one navigation, one set of KPIs. The 3D scene becomes a view of the same data, not a second app.
- **G2 Verdict first, evidence on demand.** Every screen leads with what a reviewer needs to decide or report; detail is one click away, never pinned.
- **G3 Defensible by construction.** Every score carries its anchor, a justification, the reviewer's identity, a timestamp, and the methodology revision. Assessments are immutable once final; re-assessment creates a new version. A regulator-grade report is one click.
- **G4 Production engineering.** Typed, modular, tested, built, checked by CI, with backups from day one; real sign-in, roles, and private hosting arrive with the parked hosting decision (§11.1).
- **G5 Numeric continuity.** v3 produces the same L, C, cell, rank, and Risk Index as v2 for the same inputs (golden vectors carried over verbatim). Existing wells migrate losslessly.
- **G6 Looks like an engineering instrument.** Calm, dense where it should be, light theme by default, prints well, risk colours reserved for risk.

### Non-goals

- Not a GIS or a replacement for AccuMap / geoSCOUT / Petrel. Spatial views support the review; they are not the product.
- Not a document management system. Attachments are supported but minimal (file + type + link to the well).
- Not multi-tenant SaaS. One organisation, several projects.
- Not a change to the methodology. Parameters, weights, anchors, bands, and unknown policy stay at rev 2.0.0 unless edited through the versioned admin flow.

### Anti-goals (what would make v3 a failure even if it "works")

- A score that the software made up. Unknown stays explicit; machine-derived suggestions are labelled, carry provenance, and are never saved as a human score without a human choosing them.
- Any secret in the browser.
- A second copy of the engine anywhere.
- Feature parity with the v2 toolbar. If an action does not have a clear owner and moment of use, it is cut.

---

## 3. Users and the moments that matter

Assumed from the artefacts (no interview was held; see §11):

| Role | What they do | What they need on screen |
|---|---|---|
| **Reviewer** (wellbore/CCS engineer) | Builds the well record from well files, scores 11 parameters, writes justification, picks or overrides the recommended action | A focused scoring flow with anchors visible, the construction record and schematic beside it, live L×C |
| **Lead / approver** | Checks assessments, watches the portfolio, decides what goes to the regulator | Portfolio state, what changed, what is stale or unknown-heavy, the matrix, one-click report |
| **Reader** (regulator, partner, management) | Reads a dossier or the portfolio report | A clean printed document with method, evidence, and attribution |

Moments v3 is designed around:

1. "I have a well file in front of me and need to get this well into the register correctly." → Well record + Construction, in one flow.
2. "Score this well and justify it." → Score flow.
3. "What is the state of the AOR this quarter and what needs attention?" → Portfolio.
4. "Give me the dossier for well X for the D065 submission." → Report.
5. "The methodology changed; what needs re-review?" → derived "assessed under older revision" state, portfolio filter.

---

## 4. Information architecture

```
┌ Top bar ──────────────────────────────────────────────────────────────┐
│ ◈ Legacy Well Assessment   [Project ▾ Nisku Enbridge POC AOR]   ⌕ search   (user ▾) │
└──────────────────────────────────────────────────────────────────────┘
 Portfolio │ Wells │ Map │ Methodology │ Project settings (admin)
```

### 4.1 Portfolio (home)

One screen, no scrolling at 1440×900.

```
┌ KPIs ─────────────────────────────────────────────────────────────────┐
│ 42 wells   Low 25  Moderate 11  High 5  Very High 1   │ 6 unscored · 3 stale revision · 4 unknown-heavy │
├ 5×5 matrix (counts per cell, click → filtered Wells) ┬ Needs attention ─────────┤
│                                                      │ • 100/07-21… stale rev   │
│        C→ 1   2   3   4   5                          │ • 100/13-05… 4 unknowns  │
│  L 5  [ ] [ ] [1] [ ] [ ]                            │ • …                      │
│    …                                                  │                          │
├ Driver contribution (which parameters carry the risk) ┴ Map thumbnail ──────────┤
└───────────────────────────────────────────────────────────────────────┘
```

Cut from v2: the donut (replaced by the count row and matrix), the separate "Top Risk Wells" card (the Wells table sorted by index does this), the second KPI row from the 3D app.

### 4.2 Wells (register)

- Dense table: Licence/UWI, name, operator, type, status, class (Type 1–9), spud year, L × C, cell, rank badge, assessment status (Final / Draft / Unscored / Stale rev), reviewer, updated.
- Filters as chips: rank, status, class, assessment status, reviewer, "unknown ≥ n". Saved views optional.
- Row click → Well page. Multi-select → bulk actions (export, assign reviewer, delete with two-step confirm, admin only).
- Toolbar: **New well**, **Import** (CSV/XLSX/JSON, with mapping preview and validation report), **Export** (CSV/JSON of the current filter), **Report** (portfolio PDF of current filter).

### 4.3 Well page

Header: licence, name, operator, status, type, class, spud year, coordinates. Right side: rank badge, L × C, cell, Risk Index, "assessed under rev 2.0.0 by T. Chisti on 2026-08-07", buttons **Score / Re-assess**, **Edit record**, **Report**.

Tabs:

| Tab | Content |
|---|---|
| **Assessment** | Recommended action (auto text or reviewer override, clearly labelled). Score table: parameter, score, anchor text for that score, justification, weighted contribution. Grouped L then C with axis subtotals. Prior assessments collapsible. |
| **Construction** | Wellbore schematic (SVG, unit toggle, zoom, export) beside the construction rows editor (casing, cement, plugs, perforations, open hole, formation tops). "Paste abandonment report → parse" lives here. Each row keeps `source` (parsed / manual / extractor) and verbatim text. |
| **Location** | Map with this well, AOR circle(s), injectors, neighbouring wells coloured by rank; distance to nearest injector; formation column for the project. |
| **History** | Audit trail: every change to the record, each assessment version, who, when, what. |
| **Documents** | Attached files (scan, report, extractor JSON) with type and date. Minimal. |

### 4.4 Score flow (the one focused task)

Opened from the Well page as a full-height side panel (desktop) or full page (tablet). It is the only place scoring happens.

```
┌ Score 100/07-21-055-22W4/00 · rev 2.0.0 ──────────────────────── L 1.76 × C 2.60 → cell 6 · Moderate ┐
│ LIKELIHOOD                                                                                             │
│ Abandonment & Plug Quality  (w 0.22)      [?] [1] [2] [3] [4] [5]                                      │
│   1 — Abandoned to current D020 / Class VI standard; verified plugs across storage complex             │
│   Justification: [ Seven plugs, tagged, 1953 …                                           ]            │
│ Cement Coverage & Quality (w 0.20)        …                                                            │
│ …                                                                                                      │
│ CONSEQUENCE …                                                                                          │
│ Recommended action (auto): Targeted Diagnostics + Watchlist   [override ▾]                             │
│ [Save draft]                                                     [Finalise assessment]                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Rules: no default score (a parameter is Unknown until chosen, and Unknown is a deliberate click); the anchor text for the chosen score is always visible; justification is required for every non-Unknown score on finalise; the construction schematic is viewable in a split pane while scoring; live L × C and rank update per click; finalise is atomic and attributed to the signed-in user.

### 4.5 Map

MapLibre with a neutral basemap, township/range grid optional. Wells coloured by rank, AOR circles per injector, injector markers, hover → mini card, click → Well page. Filters shared with the Wells table. **3D section view** appears here as a toggle in Phase 3 (§9), ported from `scene3d.js`.

### 4.6 Methodology

Read-only reference page rendered from the stored methodology: parameters, axis, weight, anchors 1/3/5, unknown policy, references; matrix bands; Type 1–9 classification table with the adapted Figure A-4 (keep the existing SVG); sources. Admins get **Edit**, which produces a new revision through the same validation as today (`validateMethodology`) and records who/when. Nothing is rescored silently; wells assessed under an older revision show as "stale revision".

### 4.7 Project settings (admin)

Project name, jurisdiction, injectors (name, lat/lon, AOR radius), formation column (name, top/base, role seal/reservoir/other), users and roles, export/backup, danger zone (delete project, two-step).

### 4.8 What is cut, and where it went

| v2 feature | v3 |
|---|---|
| Load Demo | Removed from the product. Demo data lives in a dev seed script only. |
| Reset register | Project settings → danger zone, admin only, typed confirmation. |
| CSV Template | Inside the Import dialog. |
| Import/Export JSON | Project settings → export/backup. |
| Theme toggle | User menu. Light is default. |
| Sync pill / token modal | Removed. Local reviewer profile now; sign-in when hosting is decided. |
| 3D tab + iframe + bridge | Removed. Map view now; 3D section as a Map toggle in Phase 3 on the same data. |
| 3D "sites" | Become Projects. |
| Permanent add/edit form | Well record form (modal/page) + Score flow. |
| "Integrity" score | Dropped from UI (it is 100 − risk score, a second number for the same fact). Engine still returns it. |
| `needsReview` flag | Derived: `assessment.methodologyRevision ≠ current` or `assessment.status ≠ final`. |
| Appendix D labels | Replaced by "Unified methodology rev x.y.z". |

---

## 5. Data model (v3)

Canonical units: metres, decimal degrees (WGS84), ISO-8601 UTC. Construction rows keep the verbatim value and unit as read from the source; conversion is on display.

```
Project
  id, name, jurisdiction: 'AER' | 'EPA' | 'both', description
  injectors[]: { id, name, lat, lon, aorRadius_m }
  formations[]: { id, name, top_m, base_m, role: 'seal'|'reservoir'|'other', order }
  createdAt, createdBy

Well
  id, projectId, licence (UWI/licence, unique within project), name, operator
  lat, lon, spudYear, type, trajectory, status, classification ('Type 1'..'Type 9')
  td_m, notes
  construction: {                 // = the `wellbore` object of spec 2026-08-07 §2, unchanged, plus provenance
    kbElev_m | null
    casings[]:      { name, od_mm, grade, weight_kgm, top_m, shoe_m, toc_m, source, verbatim }
    plugs[]:        { n, kind: 'cement'|'bridge'|'cibp', top_m, bottom_m, sacks, additives, notes, source, verbatim }
    perforations[]: { top_m, bottom_m, status, source, verbatim }
    formations[]:   { name, top_m, source }
    packers[]:      { depth_m, source }
    openHole:       { top_m, bottom_m, source } | null
    zones[]:        { kind: 'salt'|'hydrocarbon', top_m, bottom_m, source }
    notes[]:        { depth_m, text, source }
    sourceText: string | null     // pasted report, kept verbatim
  }
  // source: 'parsed' | 'manual' | 'extractor'; verbatim: the text a parsed value was read from.
  // The parser, renderer, stats card, and the 20 existing wellbore tests carry over without a shape change.
  createdAt, createdBy, updatedAt, updatedBy

Assessment            // append-only; one 'final' is current per well
  id, wellId, methodologyRevision
  scores:         { [paramKey]: 1|2|3|4|5|null }
  justifications: { [paramKey]: string }
  suggestions:    { [paramKey]: { score, source: 'extractor'|'derived', basis } }   // never auto-applied
  computed:       { L, C, Lr, Cr, cell, riskIndex, rank }     // written by the engine at finalise
  recommendedAction: { auto: string, override: string | null }
  status: 'draft' | 'final'
  reviewerId, reviewerName (snapshot), assessedAt, supersedesId | null
  approvedById | null, approvedByName | null, approvedAt | null   // used only when the project requires approval (§5.1)

Methodology           // versioned; same shape as methodology.json today
  revision, params[], matrix, wellTypes, updatedBy, updatedAt, changeNote

AuditEvent            // append-only
  id, at, actorId, actorName, entity ('well'|'assessment'|'methodology'|'project'), entityId
  action ('create'|'update'|'finalise'|'delete'|'import'), diff (before/after JSON)

Document (Phase 2)
  id, wellId, kind ('scan'|'report'|'extraction'|'other'), filename, storagePath, uploadedBy, uploadedAt
```

Validation: every entity has a Zod schema; the same schema validates imports, API bodies, and seeds. The v2 `legacy` block (v1 scores) is preserved on migrated wells as `legacyV1` for traceability.

### 5.1 Derived states and re-assessment rules

These are computed, never stored:

| State | Rule | Shown as |
|---|---|---|
| **Unscored** | no assessment with `status = final` | grey badge; counted on Portfolio |
| **Draft in progress** | a `draft` newer than the current final (or no final yet) | "Draft by X" |
| **Stale revision** | the current final's `methodologyRevision` differs from the current methodology in **major or minor** (weights, bands, unknown policy, parameter set). A **patch** bump (wording only; `bumpRevision` already makes this distinction) does not mark stale; the badge reads "assessed under 2.0.0 (current 2.0.1, wording only)". | amber badge; Portfolio KPI and filter |
| **Record changed since assessment** | `well.updatedAt > assessment.assessedAt` for any change to identity, classification, coordinates, or construction | info badge on the Well page; not a KPI |
| **Awaiting approval** | project has `requireApproval = true` and the current final has no `approvedAt` | amber badge; Portfolio KPI (Phase 2) |

**Re-assessment.** "Re-assess" opens the Score flow prefilled from the current final (scores, justifications, override), every row marked "carried from assessment of <date>". The reviewer may finalise without changes (logged as a re-confirmation) or change any row. "No default score" applies to a well's first assessment only. Finalising creates a new Assessment with `supersedesId` set; the previous final is never edited.

**Suggestions (Phase 1, `source: 'derived'`).** Computed by the engine from facts already in the record and never auto-applied: classification Type → penetration; spud year → age; trajectory and casing count → complexity; distance to nearest injector against the AOR radius → plume (only when the project has injectors). Shown as a chip beside the score buttons ("suggested 4 · from Type 3"); one click applies it and prefills the justification with the basis. The v2 `deriveScoresFromReviewer` mapping is the starting point for this module. Scoring never depends on project geometry existing; without injectors there is simply no plume suggestion.

**Approval (optional, Phase 2).** Project setting `requireApproval`. When on, an `approver` or `admin` approves a final assessment; reports print "Approved by … on …" and unapproved finals print "Pending approval". When off, the fields stay null and the UI hides approval entirely. Finalise remains the reviewer's act in both modes.

---

## 6. Architecture and stack

### 6.1 Decisions

| Area | Decision | Why |
|---|---|---|
| App | **Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui primitives** | Matches your other deployed projects and the existing Vercel project; accessible components without inventing a design system |
| Engine | `packages/engine` — framework-free TypeScript port of `scoring.js` and the wellbore core, published as a workspace package, **one copy** | Ends the vendored duplicate; testable without a DOM; reusable by the extractor later |
| Data | All data access goes through a `Store` interface (`listWells`, `getWell`, `saveWell`, `createAssessment`, `finaliseAssessment`, `getMethodology`, `publishMethodology`, `history`, `importProject`, `exportProject`). **Phase 1 ships `LocalStore`**: IndexedDB in the browser (Dexie), one database per browser, with full-project JSON export/import as the backup and hand-off mechanism. **Backend parked** (§11.1): when hosting and identity are decided, a `SupabaseStore` (Postgres + Auth + RLS + Storage) or a Git-JSON store implements the same interface; the UI does not change. | Lets the product shape, engine, and flows ship now without committing to infrastructure. Audit events are written by the store, so the audit trail exists from day one and carries over. |
| Audit trail | `AuditEvent` records written by the store on every create/update/finalise/delete/import (Phase 1: in IndexedDB, included in project export). With a backend: database triggers + a nightly JSON snapshot | Keeps the "every change is recorded" property from day one; the snapshot idea returns with hosting |
| Auth | **Parked.** Phase 1 has no sign-in; a local **reviewer profile** (name, initials) is set once per browser and stamped on every assessment and audit event, clearly labelled "unverified" in the data. Role checks are a single `can(action)` helper that returns true in Phase 1, so the call sites exist. Target design when identity is decided: per-project membership (`viewer` / `reviewer` / `approver` / `admin`) plus an org-level admin flag, enforced server-side. | Ships the flows now; attribution from real identity arrives with the backend without touching the UI |
| Tables | TanStack Table | Sorting, filtering, column visibility, virtualised rows for hundreds of wells |
| Charts | Hand-rolled SVG React components (matrix, driver bars, count row) | Few, specific, print as vectors; no chart library |
| Map | MapLibre GL with a neutral raster/vector basemap | Real geography beats an abstract grid for AOR review |
| 3D | three.js from npm, lazy-loaded, ported from `legacy-well-management-system/src/scene3d.js` + `frame.js` + `formations.js` (~600 lines) | Phase 3, same data |
| Reports | Dedicated print routes (`/report/well/[id]`, `/report/portfolio`) with print CSS, vector SVG | Higher fidelity than jsPDF + html2canvas; "Save as PDF" works everywhere. Server-side PDF (headless Chromium in a route) is a Phase 2 convenience. |
| Tests | Vitest (engine, parser, schemas, store adapter), Playwright (create well, score, finalise, report, import), golden vectors from `tools/scoring.test.js` carried over verbatim | G5 |
| CI/CD | GitHub Actions: typecheck, lint, unit, e2e on PR. Deployment target parked with hosting; the app builds as a standard Next.js app and runs locally with `pnpm dev` or as a static export | |
| Repo | Same repository. **First PR:** branch `v2-static` from current `main` and switch GitHub Pages to deploy from `v2-static` (root). **Then** `main` becomes the Next.js app, built by the existing Vercel project `co-2-legacy-wellbore-dashboard`. v2 keeps its Pages URL untouched until cutover; `legacy-well-management-system` is archived after the Phase 3 port | History and URL continuity without a `legacy/` folder; the Pages URL never breaks |

**Alternative considered, kept available:** stay file-based (JSON per project in a private repo) with writes behind a serverless function holding a GitHub App token, and sign-in via GitHub OAuth. Lower infra, same Git audit trail, but weaker identity for a corporate team, no row-level roles, and conflict handling stays custom. The `Store` interface is designed so this can be swapped in without touching the UI. Choose this only if Supabase cannot be approved (see §11).

### 6.2 Engine contract (unchanged numerics)

```ts
computeWell(scores, methodology) → { L, C, Lr, Cr, cell, riskIndex, rank, riskScore, integrity }
validateMethodology(m) → { ok, errors[] }
migrateV1(well, m), isV1Well(well), v1TierFor(total)
recommend(scores, computed, m) → { title, body }        // ported from index.html recommend()
suggest(well, project, m) → { [paramKey]: { score, source:'derived', basis } }   // §5.1; from deriveScoresFromReviewer
isStale(assessment, m) → { stale: bool, reason }        // major/minor vs patch, §5.1
parseAbandonmentReport(text) → { rows, warnings }        // ported from the wellbore core
buildSchematic(construction, opts) → SVG string / React element
```

Golden vectors V1–V5 and the W-W8QB2S migration case must pass unchanged. Add property tests: weights sum to 1 per axis; rank is monotonic in each score; Unknown never scores lower than the parameter's `unknownScore`.

### 6.3 Repository layout

```
/
  apps/web/                 Next.js app
    app/(portfolio|wells|map|methodology|settings|report)/
    components/             ui (shadcn), domain (RankBadge, Matrix5x5, ScoreRow, Schematic, WellTable…)
    lib/store/              Store interface + LocalStore (IndexedDB) adapter; backend adapters later
    lib/schemas/            Zod schemas
  packages/engine/          scoring, recommend, wellbore parser, schematic model (no React, no DOM)
  scripts/migrate-v2.ts     wells.json + methodology.json (from the v2-static branch) → a v3 project JSON file the app imports (dry-run by default)
  docs/superpowers/         specs and plans
```

---

## 7. Visual and interaction direction

- **Tone:** instrument, not dashboard theatre. Neutral greys, one accent for interactive elements, and the four rank colours used only for rank (Low, Moderate, High, Very High at the current hex values so printed reports stay consistent with v2).
- **Theme:** light default (reads better in offices and prints), dark available in the user menu.
- **Type:** Inter (UI) + JetBrains Mono for UWIs, depths, and numbers; tabular numerals everywhere numbers align.
- **Density:** tables at 13 px with 32 px rows; forms at 14 px. Generous whitespace between sections, tight inside them. No decorative cards; borders only where they separate.
- **Numbers:** one decimal for L and C, one for Risk Index, integer cell. Units shown next to values (m, with ft on hover or via project toggle).
- **States:** every list and panel has empty, loading, error, and "no permission" states designed, not defaulted.
- **Keyboard:** scoring flow fully operable by keyboard (1–5, `?` for Unknown, Tab to justification). Table rows reachable by keyboard.
- **Print:** report routes have their own stylesheet; schematic and matrix are vector; header with project, methodology revision, reviewer, date, page numbers.
- **Responsive:** desktop first; tablet (1024 px) fully usable; phone read-only.

The implementation phase should apply the project's frontend design skill before building components; this section sets the constraints, not the pixels.

---

## 8. Migration and cutover

1. **No write freeze.** The team keeps using v2 (and the 3D viewer) until cutover day. `scripts/migrate-v2.ts` produces a **v3 project JSON file**; the app's Import upserts it **keyed by (project, licence)**, so it is safe to run repeatedly: once early for development data, once more on cutover day.
2. The script reads `wells.json` and `methodology.json` from the `v2-static` branch, creates one Project (name chosen at run time; default "Fort Saskatchewan / Wabamun Hub AOR"), one Well per entry, and one **final** Assessment per well with `methodologyRevision = scoredUnder`, `reviewerName = reviewer`, `assessedAt = updatedAt`, `justifications = {}` (v2 had none), `recommendedAction.override` from the v2 override field, and `legacyV1` preserved. Dry run prints a parity table (v2 cell/rank vs v3 recompute) and refuses to write on any mismatch.
3. **Browser-only data.** The 3D viewer keeps per-site datasets in `localStorage` and v2 keeps a local cache. Before cutover each editor runs "Export JSON" once in both apps; the script accepts those files as extra inputs, upserts by licence, and flags any well that exists only in a browser export. Injectors and the formation column for the Enbridge POC AOR come from `legacy-well-management-system/src/data-enbridge.js`; well `name` and `td_m` for migrated wells are matched by UWI from the same file. Synthetic demo wells (Wabamun Demo seed) are not imported; they become a dev seed.
4. **Cutover day:** final upsert run; personal access tokens revoked; the `v2-static` branch gets a banner "superseded by v3 at <Vercel URL>" and its token modal removed (read-only); Pages stays on that branch for one release, then redirects to the Vercel app; the branch is tagged `v2-final`.

---

## 9. Phases and acceptance

### Phase 1 — Core (replaces the register)

Portfolio, Wells table, Well page (Assessment + Construction + History), Score flow with derived suggestion chips, Methodology (read-only), Project settings (injectors, formations, reviewer profile), `LocalStore` with full-project JSON export/import, Import (CSV/JSON with validation report), Export, well and portfolio print reports, migration script, CI. No sign-in, no backend (parked). Approval fields exist in the schema; the workflow stays hidden.

Accept when: the five migrated wells show identical L, C, cell, rank, index to v2; a reviewer can create a well, paste a report, see the schematic, score it, finalise, and print a dossier without touching another screen; a project exported from one browser imports into another with every well, assessment, and audit event intact; Playwright flows green on CI; Lighthouse accessibility ≥ 95 on Wells and Well pages.

### Phase 2 — Spatial and documents

Hosting and identity decision, then the matching `Store` adapter (Supabase or Git-JSON), sign-in, per-project roles, nightly snapshot. Map view with AOR circles and injector distances, Documents tab, methodology admin editor with revision notes, optional approval workflow (§5.1), server-side PDF, saved filters.

Accept when: a lead can answer "what is inside the AOR and what is stale" from one screen; a methodology edit creates a new revision and the portfolio shows the stale count.

### Phase 3 — 3D section view and extractor hand-off

Port `scene3d.js` as a Map toggle (same wells, formations, injectors); accept extractor JSON as `suggestions` with provenance on the Score flow and as Construction rows marked `source: 'extractor'`.

Accept when: 3D renders the same project with no second dataset; an extractor file loads into a well as suggestions that a reviewer must explicitly accept.

---

## 10. Production readiness checklist (definition of done for Phase 1)

- TypeScript strict, ESLint + Prettier, no `any` in `packages/engine`
- Unit coverage: engine and parser 100 % of branches; schemas and store adapter ≥ 90 %
- Playwright: set reviewer profile, create well, import CSV with one bad row (report shown, good rows saved), score + finalise, stale-revision filter, print report
- `Store` interface has a contract test suite that `LocalStore` passes and any later adapter must pass unchanged
- Backups: full-project export/import round-trip verified (wells, assessments, methodology, audit events); the UI reminds the user to export after finalising
- Error boundaries per route; toasts for failures with retry; optimistic updates only where the store confirms
- Performance: Wells table with 500 wells scrolls at 60 fps; Portfolio renders < 1 s on a cold load
- Accessibility: keyboard paths, labels, focus order, contrast AA; axe clean on all routes
- Observability: client error logging hook in place (provider chosen with hosting), no PII in logs
- README (setup, reviewer profile, backup/restore), CHANGELOG, `docs/runbook.md` (what to do when an import fails, how to recover from a browser export, how to roll back)
- Version tag and release notes; `v2-static` branch tagged `v2-final`

---

## 11. Decisions assumed in this draft (your call to confirm or change)

These change what gets built. Defaults are what this document assumes.

1. **Hosting and identity.** **Parked by decision on 2026-10-20.** Phase 1 runs local-first in the browser with no sign-in and a local reviewer profile. When decided, the candidates are Vercel + Supabase (email magic link or Microsoft SSO), a corporate Postgres, or the Git-JSON store; the `Store` interface and the `can()` helper isolate the change.
2. **Keep the 3D view?** Default: yes, deferred to Phase 3 and demoted to a Map toggle. If it is not needed, Phase 3 becomes extractor hand-off only and three.js leaves the dependency list.
3. **Projects.** Default: multi-project from day one (the 3D app already had three sites). If one AOR is all that is needed, the project switcher hides until a second project exists.
4. **Justification required on finalise.** Default: yes for every non-Unknown score. This is the single biggest change to how scoring feels; it is what makes assessments defensible.
5. **Units.** Default: metric canonical, imperial on display. The historic records are imperial; the parser keeps verbatim values.
6. **Extractor integration.** Default: Phase 3, file-based hand-off (JSON upload). Live API integration is out of scope until both tools are stable.
7. **Who may finalise.** Default: `reviewer`, `approver`, and `admin`; `viewer` is read-only.
8. **Approval (four-eyes) workflow.** Default: a project setting from Phase 2, off by default. If the regulator submission needs a documented approver, turn it on; the schema carries the fields from day one so nothing is retrofitted.
9. **Staleness on wording-only methodology patches.** Default: a patch bump does not mark assessments stale (v2 flagged on any revision change). If you want every revision to force re-review, it is one rule in `isStale`.
10. **Re-assess prefill.** Default: prefilled from the prior final with "carried from" marks. If you prefer a blank re-score to avoid anchoring, it is a flag on the Score flow.

---

## 12. Left to the builder

- Component-level design (spacing, exact tokens) within §7.
- IndexedDB schema details (Dexie tables, indexes); later, the backend schema and triggers for audit events.
- CSV column mapping UX for Import.
- Exact print layout of the dossier beyond the required sections (header, summary, score table with anchors and justifications, construction schematic, recommended action, methodology appendix, attribution).
- Choice of basemap provider for the Map.
- Test fixture wells beyond the five real ones.
- `methodologyRevision` is stored as a string; migrated wells that reference rev 1.0.0 keep it (no v3-shaped 1.0.0 rulebook exists) and simply show as stale.
- Injector lat/lon for the Enbridge POC AOR are derived from the local flat-earth origin in `data-enbridge.js`; verify against the source AccuMap export before Phase 2 Map work.
- Domain schemas (Zod) live in the engine, `packages/engine/src/domain.ts`, not in `apps/web/lib/schemas` as §6.3 sketches: the migration script (`scripts/migrate-v2.ts`) imports them without Next.js, and the app imports them from `@lwa/engine`.

## 13. References carried over

- `docs/superpowers/specs/2026-07-28-unified-risk-methodology-design.md` — parameter set, weights, anchors, unknown policy, bands (authoritative)
- `docs/superpowers/specs/2026-08-07-recommended-action-override-design.md` — override semantics
- `docs/superpowers/specs/2026-08-07-wellbore-schematic-design.md` — parser and renderer behaviour
- `scoring.js`, `tools/scoring.test.js` — golden vectors
- `legacy-well-management-system/src/scene3d.js`, `frame.js`, `formations.js`, `data-enbridge.js` — 3D scene and Enbridge POC AOR configuration
- Enbridge *CO2 Underground Storage Legacy Well Review Guideline* GD-40-0B42-524E v1.0.0; AER D065, D020; 40 CFR 146.84; Arbad et al. 2024 (IJGGC 133)
