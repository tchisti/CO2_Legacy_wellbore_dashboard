# Design: Bulk Delete + Register Reset — Legacy Well Register

**Date:** 2026-08-07
**Status:** Approved
**App:** `index.html` (CO2 Legacy Wellbore Dashboard), Well Register tab (`#tab-register`)

## 1. Scope & goal

Let the user act on many wells at once in the Legacy Well Register: select multiple wells and delete them together, and reset (empty) the entire register with one action. Both operations propagate to the shared team register exactly like today's single-well delete (via `SYNC.pendingDeletes`). Out of scope: bulk score-reset, bulk mark-reviewed, undo system, changes to the 3D viewer.

## 2. Selection model

- New first column in the register table: one checkbox per row, plus a header checkbox in `<thead>`.
- The header checkbox selects/deselects exactly the rows currently visible under the search box and the "re-review only" filter (the `filtered` array in `render()`).
- Gmail-style extension: when the header checkbox is checked while a filter/search hides part of the register, a banner appears directly under the table header: "All {filtered} filtered wells selected — **Select all {total} wells in register**" (link selects every well). When every well is selected via the link, the banner switches to "All {total} wells selected — **Clear selection**".
- Selection state: `state.bulkSelected` — an in-memory `Set` of well ids. Never persisted to localStorage or sync. On every `render()`, ids no longer present in `state.wells` are dropped from the set.
- Checkbox clicks call `event.stopPropagation()` so they don't trigger the row's `openDetail`. Row click behavior is otherwise unchanged.
- The header checkbox shows the indeterminate state when some-but-not-all visible rows are selected.

## 3. Bulk action bar

- When `state.bulkSelected.size >= 1`, a slim bar renders between the register header and the table: "**{N} selected** · [Delete selected] · [Clear selection]".
- **Delete selected** shows ONE `confirm()`:
  - Text: `Delete {N} wells{shared}? Tip: Export CSV first if you want a backup.` where `{shared}` is ` from the SHARED team register (for everyone)` when `syncToken()` is truthy — identical wording to the existing `deleteWell`.
  - On confirm: remove all selected wells from `state.wells`, add each id to `SYNC.pendingDeletes`, clear `state.selected` if it was among them, empty `state.bulkSelected`, `save('Delete {N} wells')`, `render()`.
- **Clear selection** empties `state.bulkSelected` and re-renders. No confirm.

## 4. One delete path

- New function `deleteWells(ids, label)` implements removal + `pendingDeletes` + selection cleanup + `save(label)` + `render()`.
- The existing `deleteWell(id)` keeps its per-well confirm text but delegates the mutation to `deleteWells([id], 'Delete well {licence}')`. One code path performs deletions.

## 5. Reset register

- A "Reset register…" button (danger styling) in the register tab header area, near the table controls.
- Confirm text: `Reset the register? This deletes ALL {N} wells{shared} and cannot be undone. Tip: Export CSV first if you want a backup.` with the same `{shared}` clause.
- On confirm: `deleteWells(allIds, 'Reset register ({N} wells removed)')`. The register ends empty (NOT the demo set; "Load Demo" remains the way to reseed).
- When the register is empty, clicking the button shows `alert('Register is already empty.')` and does nothing else (matches the app's existing alert-guard pattern, e.g. Export CSV).

## 6. What does not change

Per-row View/Edit/Del buttons, search, re-review filter, KPI cards, charts, matrix, sync machinery internals, Load Demo, CSV export, and the 3D-viewer bridge. No undo is added — the dashboard has none today; the confirms plus the CSV-backup tip are the guard rails.

## 7. Testing / verification

No UI test harness exists for `index.html` (only `tools/scoring.test.js`, unaffected). Manual checklist before deploy:

- [ ] Row checkboxes toggle selection; bar appears at ≥1 and shows the right count
- [ ] Header checkbox selects exactly the visible (filtered/searched) rows; indeterminate state when partial
- [ ] Gmail banner appears only when a filter/search hides wells; "Select all N" selects the whole register; banner flips to "Clear selection"
- [ ] Delete selected removes exactly the selected wells; single confirm; shared-register wording appears only when a sync token is set
- [ ] Deleted ids reach `SYNC.pendingDeletes` (wells stay gone after the next sync merge)
- [ ] Detail view (`state.selected`) cleared if the open well was bulk-deleted
- [ ] Reset register empties the register, KPIs go to 0, table shows the empty state
- [ ] Single-well Del button behaves exactly as before
- [ ] Checkbox clicks never open the detail tab; row clicks still do
- [ ] Reload: selection resets, deletions persist

## 8. Deployment

Commit to `main` and push — the Vercel project `co-2-legacy-wellbore-dashboard` auto-deploys from GitHub main (confirmed 2026-08-07). Pull before committing: the in-app GitHub sync writes commits (well edits/deletes) directly to origin/main.
