# Runbook: Legacy Well Assessment v3 (Phase 1)

What to do when something goes wrong, for the people who use and look after the app. Setup and
commands are in the [README](../README.md).

**The one fact behind most of this page:** in Phase 1 every project lives in the browser that
created or imported it (IndexedDB database `lwa` for that site). There is no server copy. A project
moves, or is backed up, as one export file (`<project>-<date>.lwa.json`, Project settings → Backup →
**Export project**). Export before anything risky.

## An import fails

There are three ways in, and all of them check the whole file before writing anything:

| Where | Takes |
|---|---|
| First-run screen → **Import project file** | a project export (`.lwa.json`) |
| Project settings → Backup → **Import project file** | a project export, with Merge or Replace |
| Wells → **Import** | a CSV in the template's columns, a project export, or a v2 `wells.json` |

**"Not a Legacy Well Assessment export."** The file is JSON but not a project export (or not JSON
at all). Pick the `.lwa.json` that Export project or the migration script wrote. A v2 `wells.json`
goes through Wells → Import, not Backup.

**"This file was not imported. Nothing was changed. Problems found:"** The file was refused as a
whole and nothing was written. Each line names a record and what is wrong with it (a missing field, a value out of
range, an assessment whose well is not in the file, a duplicate id). Problems are reported in two
passes: first the shape of every record, then the references between them, so after fixing the
first list a second one can appear. Fix the file, or export it again from the browser it came from,
and import again.

**CSV rows with errors.** The validation report lists each bad row with its reason; those rows are
skipped and the good ones are imported only when you confirm. Score columns never create final
assessments: they create drafts, which a reviewer finalises with a justification per score. A
blank cell never clears a stored value (use the well's Edit record for that).

**Merge or Replace (Project settings → Backup).**

- **Merge** (default) adds wells, assessments and history that are new, and updates wells matched
  by licence unless the file's copy is older than the stored one. It never deletes anything.
- **Replace** makes the file the project. It deletes, in this browser: every well of the project
  whose licence is not in the file, with all of that well's assessments; and every assessment of a
  kept well that is not in the file, **final assessments included**. Project fields (name,
  injectors, formations) become the file's. The history (audit events) is never deleted. Before
  Import is enabled the panel states what would go (for example "1 well and 2 assessments
  (including 1 final assessment) will be deleted.", or "Nothing will be deleted.") and asks you to
  type the project name. If that is not what you expect, cancel and Merge instead.

**The migration script refuses to write.** Exit code 1: a parity mismatch, a v2 well whose v3
recompute differs from what v2 stored; the table says which and nothing was written. Exit code 2: a
bad argument or an unreadable file (the message names it). See the README for the command.

## Recovering from a browser export

**A v3 project export** (`.lwa.json`): open the app in the browser that should hold the project. On
a fresh browser the first-run screen offers **Import project file**; otherwise use Project settings →
Backup → **Import project file** with **Merge**. Every well, assessment, methodology revision and
history event comes back. Importing the same file again adds nothing new (the import itself is
recorded as one history event).

**A v2 or 3D-reviewer browser export** (v2's "Export JSON", or the 3D reviewer's export): run the
migration script with the register files and the export:

```bash
pnpm --filter scripts migrate -- --wells ~/lwa-v2/wells.json --methodology ~/lwa-v2/methodology.json \
  --site scripts/fixtures/enbridge-site.json --browser-export ~/Downloads/v2-export.json --write ~/lwa-v2/out.lwa.json
```

It merges by licence (the newest copy of a well wins) and lists every well that exists only in the
browser export as "browser-only". Wells from a 3D export arrive with Type 1 and their scores as a
**draft**, so a reviewer must classify and finalise them; 3D wells already in the register are
skipped (the register wins). Import the result with Merge.

## Resetting a browser's data

Do this only after exporting every project you want to keep (Project settings → Backup → Export
project, once per project; the project switcher in the top bar lists them).

- **One project:** Project settings → Danger zone → **Delete project…**, then type its name. Its
  wells, assessments and history go; one "delete" event remains in this browser's audit trail.
- **Everything:** in the browser's site settings for the app's address, clear the site data
  (Chrome: the padlock or site-info icon → Site settings → Delete data; or DevTools → Application →
  Storage → Clear site data). This removes the `lwa` database (every project, well, assessment,
  methodology revision, history event and the reviewer profile) and the small settings kept beside
  it: the light/dark choice and the active project (localStorage), and this session's backup
  reminder and unsaved construction edits (sessionStorage). The next visit starts at the first-run
  screen; import your exports there.

Private windows keep nothing after they close; do not keep a project only in one.

## Restoring unsaved construction edits

Construction edits (Well page → Construction) are a working copy until **Save construction**. Clicking
a link or another tab while there are unsaved changes asks first (Keep editing / Discard changes).
Leaving any other way (the browser's Back button, closing the page) keeps the working copy for that
well in this tab's session storage. When you come back to the well's Construction tab in the same
browser tab:

- **"Unsaved construction changes were restored"**: the copy is back, still unsaved. **Save** writes
  it; **Discard** drops it and shows the saved record.
- **"Unsaved construction changes were restored. The saved record changed after these edits were
  made. Saving replaces it."**: something (an import, another tab) changed the saved construction
  after your edits began. **Discard** keeps the
  newer saved record; **Save anyway** replaces it with your copy. Nothing is saved until you choose.

Session storage belongs to the browser tab: closing the tab, or opening the well in a new tab, does
not bring the copy back.

## Printing reports

Reports open from the well page (**Report**) and from Wells (**Report**, which prints the current
filter). Use **Print / Save as PDF** in the report's toolbar.

- Use a **Chromium browser** (Chrome, Edge). Reports print on US Letter with 18 mm margins, a running
  header (project; report and subject) from page 2, and a footer with the attribution and "Page n of
  N" on every page. These come from CSS page-margin boxes, which Safari drops: the report still
  prints there, but without the running header, footer or page numbers.
- Reports always print in the light palette, whatever theme the app uses, and the rank colours print
  as on screen.
- The PDF's suggested file name is the report's title: "Well dossier <licence> — <project>" or
  "Portfolio report — <project>".
- A draft is never printed as an assessment; the dossier says when one is in progress.

## Rolling back

- **A project's data:** import an earlier export with **Replace** (see above for what Replace
  deletes; the history is kept, so the replaced state stays visible in History).
- **The app version:** the app is a static export, so redeploy the previous build (or check out the
  previous commit and run `pnpm --filter web build`). The database format is unchanged across Phase 1;
  exports from this version import into the same version.
- **Back to v2:** v2 is unchanged on branch `v2-static` (and, until the owner's switch below, on
  `main`). Its data is `wells.json` in that branch, not the v3 browser data.

## GitHub Pages switch before v2 leaves main

v2 is served by GitHub Pages from `main` (root). The v3 branch keeps the v2 files (`index.html`,
`3d-reviewer.html`, `scoring.js`, `methodology.json`, `wells.json`, `tools/`) **on purpose**:
removing them from `main` before Pages serves another branch would take the team's v2 link down.

The repository owner does this, once, **before** any v2 file is removed from `main`:

1. GitHub → the repository → **Settings → Pages → Build and deployment**.
2. Source: **Deploy from a branch**; Branch: **`v2-static`**, folder **`/ (root)`**; Save. (The branch
   must be pushed to GitHub first.)
3. Wait for the Pages deployment to finish, then check the link still answers:
   `curl -sI https://tchisti.github.io/CO2_Legacy_wellbore_dashboard/ | head -1` prints a `200` line,
   and the page is v2.
4. Only then may a later change delete the v2 files from `main` and tag `v2-static` as `v2-final`.

Until that switch, the v2 files stay on `feat/v3-phase1` and on `main`, and nothing in v3 depends on
them.
