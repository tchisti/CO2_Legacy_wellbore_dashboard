# CO₂ Legacy Wellbore Review Dashboard — Shared Team Register

A single-page dashboard for legacy-well risk review (Appendix D / § 7.2 scoring), now with a
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
