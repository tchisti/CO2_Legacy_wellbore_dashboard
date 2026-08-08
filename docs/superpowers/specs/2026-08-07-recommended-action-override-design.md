# Design: Editable Recommended Action (Reviewer Override)

**Date:** 2026-08-07
**Status:** Approved
**App:** `index.html` (CO2 Legacy Wellbore Dashboard) — well dossier (Detail tab), Add/Edit Well form, PDF export

## 1. Scope & goal

Let a reviewer change the wording of a well's "Recommended Action — § 8" section. The engine-generated recommendation (`recommend(w)`) stays the default; a per-well manual override, edited through the existing Edit flow, replaces it when present. Clearing the override restores the automatic text.

Out of scope: per-line editing of engine bullets, staleness warnings when scores change after an override, changes to the recommendation engine or `scoring.js`, 3D-viewer UI.

## 2. Data model

- New optional well field: `recActionOverride` — plain-text string. Absent/empty ⇒ automatic recommendation.
- No schema/migration work: wells are plain objects; `normalizeWell` spreads unknown fields through, so the field survives localStorage, shared-register sync, JSON export/import, and the 3D bridge with zero changes elsewhere.
- CSV export: the field is NOT added to the CSV (CSV columns are the scored register view; the override travels via JSON/sync). If this proves wanted later it is a one-line follow-up.

## 3. Edit form

- The Add/Edit Well form gains a labeled block "Recommended Action (§ 8)" with a `<textarea id="f_recAction" rows="4">` placed directly after the existing Notes field, and a muted hint: `Leave empty to restore the automatic recommendation.`
- `editWell(id)` prefill: `w.recActionOverride` if non-empty, else the engine's current wording as plain text via a new helper `recPlainText(w)` (title + body + warning of `recommend(w)`, HTML converted to readable text: tags stripped, `<br>`/`</li>` → newlines, entities decoded via a detached DOM element).
- `resetForm()` clears the textarea (new-well default: automatic).

## 4. Save semantics (anti-footgun)

On form save, compute `t = textarea.value.trim()`:
- If `t === ''` OR `t === recPlainText(currentWell).trim()` ⇒ store `recActionOverride: ''` (automatic). Opening Edit and saving untouched never freezes the auto text.
- Else ⇒ store `recActionOverride: t`.
- The comparison uses the well AS SAVED (current form scores), so the engine text compared against is the one the prefill produced in the same session.
- Text that matches the engine wording of the well AS PREFILLED (i.e. `prev` without its override) is also treated as automatic — this covers score edits made in the same session: if the reviewer changes a score (so the engine text for the new scores differs) but never touches the textarea, the stale prefilled text is not frozen into an override.

## 5. Dossier display

In `openDetail`'s dossier template, the Recommended Action card becomes:
- Override present: `<div class="rec-card"><h4>Reviewer Recommendation <span class="tag" ...>reviewer-edited</span></h4><div style="white-space:pre-wrap">${escapeHtml(override)}</div></div>` — the engine title/body/warn are not rendered.
- No override: exactly today's rendering (`rec.title`, `rec.body`, `rec.warn`).

## 6. PDF export

In `exportPDF`, the "Recommended Action (Sec. 8)" section prints the override text (plain text, wrapped) when present, with a "(reviewer-edited)" suffix on the section heading; otherwise the engine-derived text exactly as today.

## 7. Verification

- Syntax gate (compile all inline script blocks) after each task.
- Node logic smoke for the save rule: empty ⇒ '', equal-to-engine ⇒ '', changed ⇒ stored.
- Manual checklist (local file, Load Demo data):
  - [ ] Edit a well: textarea prefills with the engine wording
  - [ ] Change wording, save → dossier shows the custom text with the reviewer-edited tag; engine warning block gone
  - [ ] PDF export prints the custom text with "(reviewer-edited)"
  - [ ] Edit again: textarea shows the custom text; clear it, save → automatic text returns, tag gone
  - [ ] Edit and save WITHOUT touching the field → dossier still automatic (no tag)
  - [ ] Reload: override persists
  - [ ] A well without override renders byte-identical to before
- Deploy: `git pull --ff-only`, commit, push to main (auto-deploys Vercel).
