# CO₂ Legacy Wellbore Review Dashboard — Shared Team Register

A single-page dashboard for legacy-well risk review (unified AER D065/D020 + EPA Class VI §146.84 weighted L×C scoring (see methodology.json)), now with a
**shared team register**: every well saved is stored centrally in this repository
([`wells.json`](wells.json)) and stays there — visible to the whole team — until someone deletes it.
Every change is a Git commit, so there is a full audit trail of **who changed what, and when**.

## How it works

- The dashboard page (`index.html`) is served free by **GitHub Pages**.
- The well register lives in **`wells.json`** in this repo. The page reads it on load,
  auto-refreshes it in the background (every ~45 s and whenever the tab regains focus),
  and writes it back through the GitHub API whenever someone saves.
- **Viewing** needs nothing but the link. **Saving** needs a GitHub access token entered
  once per browser (⚙ sync pill in the top bar).
- Simultaneous edits are merged per-well (newest edit wins); true mid-air collisions are
  detected via the file's SHA and retried automatically.
- Each browser also keeps a local cache, so the page still opens with the last-seen data
  when offline.

## Risk methodology (v2)

- Wells are scored 1–5 on **11 parameters** (7 Likelihood, 4 Consequence); `?` = unknown, which scores
  conservatively per parameter. Weighted sums give **L** and **C** (1.00–5.00); the well's official rank is
  its **5×5 matrix cell** (round L × round C): Low 1–4 · Moderate 5–9 · High 10–16 · Very High 17–25.
  The continuous **Risk Index = L × C** breaks ties.
- The rulebook lives in [`methodology.json`](methodology.json) — weights, anchors, unknown policy, bands,
  and a semver revision. Both the register and the 3D Reviewer load it; each well records the revision it
  was scored under and is flagged **re-review** when the rulebook moves on.
- **Editing the rulebook:** ⚖ Methodology in the dashboard toolbar (needs a save token). Every change is
  a Git commit of `methodology.json` — the file's History is the audit trail.
- Wells scored under the old 9–45 model were migrated mechanically (`tools/migrate-v1.js`) with their v1
  scores archived per-well under `legacy`; every migrated well carries `needsReview` until a human
  re-confirms its scores. Console `WellScoring.runSelfTest()` verifies the engine in either app.

## One-time setup (repo owner)

1. **Enable GitHub Pages** — repo **Settings → Pages → Build and deployment**:
   *Source* = "Deploy from a branch", *Branch* = `main`, folder `/ (root)`. Save.
   After a minute the dashboard is live at:
   `https://tchisti.github.io/CO2_Legacy_wellbore_dashboard/`
2. **Repo visibility** — with a public repo, anyone with the link can *view* the register
   with zero setup (free GitHub Pages requires a public repo). If the well data must stay
   private, keep the repo private (Pages then needs a paid plan) and every viewer also
   needs a token.
3. Share the Pages link with your team.

## Per-editor setup (once, ~2 minutes)

Anyone who needs to **save/edit/delete** wells (not just view):

1. Sign in to GitHub and open <https://github.com/settings/personal-access-tokens/new>.
2. Name the token anything (e.g. `well dashboard`); pick a long expiration.
3. *Repository access* → **Only select repositories** → `CO2_Legacy_wellbore_dashboard`.
   (Editors other than the owner must first be added as repo **collaborators**:
   Settings → Collaborators → Add people.)
4. *Permissions → Repository permissions* → **Contents: Read and write**. Generate and copy.
5. On the dashboard, click the sync pill (top-left of the toolbar), enter your **name**
   (stamped on your edits) and the **token**, then **Save & Test Connection**.

> Alternatively, the repo owner can generate one token and share it privately with the
> team; each person pastes it once. Simpler, but edits are then attributed by the typed
> name only.

## Sync status pill

| Pill | Meaning |
|---|---|
| 🟢 Live · shared register | Connected with a token — your saves go to the team register |
| 🔵 Shared · view only | Reading the shared register; add a token to save changes |
| 🟠 Saving… | A save is in flight |
| ⚪ Local only | No connection — changes stay in this browser until connected |
| 🔴 Sync error | Click the pill for details (bad token, no access, rate limit…) |

## Data & recovery

- The register is plain JSON: [`wells.json`](wells.json). Every save is a commit — use the
  file's **History** on GitHub to see or restore any previous version of the register.
- CSV/JSON import-export in the top bar still works and syncs like any other edit
  (importing with "replace" replaces the shared register for everyone — the page warns first).


## 3D Legacy Well Reviewer (new)

The **3D Well Reviewer** tab embeds a full interactive AOR / wellbore-risk application ([`3d-reviewer.html`](3d-reviewer.html), also usable stand-alone):

- Orbitable 3D scene: DLS section/township fabric, per-injector 5 km AOR circles, formation slabs, wells colored by screening risk class
- Two preloaded sites — a Wabamun demo set and **Nisku Enbridge POC AOR** (three proposed injectors, five real offset wells from the AccuMap wellbore review)
- Scores on the same unified methodology as the register (shared scoring.js + methodology.json); the Risk Model & Methodology page renders the live rulebook
- Add/edit/duplicate/import/export wells, scenario mode, undo/redo, per-site autosave

**Bridge to the register:** the "Send register wells → 3D viewer" button pushes the shared register into the active 3D site. Wells with lat/lon are geolocated; wells without coordinates are parked on a flagged holding row. The bridge is **two-way**: when embedded, the reviewer's toolbar gains a "⇧ Push to Register" button that maps its wells back into the shared register — existing register entries are matched by licence/UWI. The bridge is lossless in both directions — the 11 parameter scores travel with each well.
