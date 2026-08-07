# Design: Interactive Wellbore Schematic — Well Detail Tab

**Date:** 2026-08-07
**Status:** Approved
**App:** `index.html` (CO2 Legacy Wellbore Dashboard). Single-file vanilla JS — the source workflow prompt assumed React/Next.js + TypeScript + D3; this spec tailors it: custom SVG renderer in plain JS, JSDoc-typed plain objects instead of TS interfaces, zero new dependencies.

## 1. Goal & placement

A professional, interactive wellbore schematic (casings, cement, plugs, perforations, formations, open hole) on the Well Detail tab, placed directly AFTER the "Score Breakdown" card and BEFORE the remaining detail content (Spatial/Identification column). Gives reviewers a construction/abandonment picture at a glance, in the style of industry well schematics (SLB/Halliburton/WellCat), matching the dashboard's theme incl. dark mode.

## 2. Data model (stored per well, metres internally)

New optional well field `wellbore` — plain object, ALL depths stored in metres regardless of display unit. Absent/empty ⇒ the detail tab shows a compact empty-state card ("No construction records — paste an abandonment report in Edit"). Shape (every field optional unless marked):

```js
wellbore = {
  td: 1447.2,                    // required for rendering; metres
  kbElev: 803.4,                 // optional; draws KB marker when present
  casings: [{ name:'Surface Casing', od_mm:219, grade:'J55', weight_kgm:35.7, top_m:0, shoe_m:186, toc_m:0 }],
  plugs: [{ n:1, top_m:1448, bottom_m:1463, sacks:25, additives:'2% CaCl2', notes:'felt plug', kind:'cement' }],
                                  // kind: 'cement' | 'bridge' | 'cibp'; top_m < bottom_m (top is shallower)
  perforations: [{ top_m:831.7, bottom_m:839.7, status:'squeezed' }],
  formations: [{ name:'Nisku', top_m:1690 }],
  packers: [{ depth_m:1200 }],
  openHole: { top_m:186, bottom_m:1447.2 },
  zones: [{ kind:'salt', top_m:900, bottom_m:1010 }],   // kind: 'salt' | 'hydrocarbon'
  notes: [{ depth_m:981, text:'felt plug at 3219 ft' }],
  source: 'bridge' | 'parsed' | 'manual',
}
```

- Rides the well object through localStorage, sync merge, JSON export/import untouched (`normalizeWell` spreads unknown fields — verified pattern from `recActionOverride`). `scoring.js` unchanged. CSV export excludes it (same rule as `recActionOverride`).
- `mapFrom3D` must PRESERVE an existing `wellbore` (like `recActionOverride`) unless it is absent — see §3.

## 3. 3D-bridge enrichment (mapFrom3D)

When a 3D push arrives for a well with NO existing `wellbore` (or whose `wellbore.source === 'bridge'`), build one from the 3D fields:
- `td` ← `r.td` (fallback `r.tvd`); skip the whole object if neither is a positive number.
- `casings`: `r.surfaceCasingDepth` ⇒ `{name:'Surface Casing', top_m:0, shoe_m:that}`; `r.intermediateCasing` and `r.productionCasing` free text ⇒ run through `parseCasingText()` (§4) — e.g. `'Production @ 1699.5 m'`, `'139.7 mm @ 1700 m'`, `'Liners 2020–2336 m'`, `'None — open hole below surface casing'` (⇒ no casing + `openHole` from surface shoe to td).
- `toc_m` on the deepest casing ← `r.cementTop`.
- `plugs`/`perforations` ← `parseIntervalsText(r.plugIntervals)` / `parseIntervalsText(r.perfIntervals)`.
- `formations`: `r.formationPenetrated` becomes a note (no depth available), NOT a formation marker.
- `source: 'bridge'`.
A well whose `wellbore.source` is `'parsed'` or `'manual'` is never overwritten by a push.

## 4. Paste-report parser (pure functions)

`parseWellboreReport(text) → { wellbore: <partial>, warnings: string[] }` plus helpers `parseCasingText(text)`, `parseIntervalsText(text)`, `parseDepth(str, defaultUnit)`. Requirements:
- Interval forms: `1463–1448 m`, `3658-3277 ft` (either order; en-dash or hyphen; ft auto-converted ×0.3048), `831.7–839.7 and 871.5 m`.
- Plug lines: `Plug #1`, `25 sacks`, `2% CaCl2`/`CaCl₂`, `felt plug at 3219 ft` (⇒ note), `bridge plug`/`CIBP` (⇒ kind), `JET 1677–1679 m (Nordegg)` (⇒ plug + formation-name note), `TREATMENT`/`squeezed` (⇒ perforation status when in perf context).
- Casing lines: `8⅝"` / `8-5/8"` / `219 mm` (OD), `J55`, `35.7 kg/m`, `0–610 ft`, `@ 610 m` (shoe), `TOC 850 m`, `surface plug 0–30 m` (⇒ plug).
- Unparseable lines ⇒ `warnings` + `notes` entries; the parser NEVER throws and never silently drops text.
- All outputs in metres; numbers rounded to 0.1 m.

## 5. SVG renderer (pure function)

`renderWellboreSVG(wellbore, opts) → string` where `opts = { unit:'m'|'ft', width, height, theme, highlightId?, viewBox? }`.
- True proportional depth scale surface(0)→td; depth axis with tick marks every 50 m (metric) or 100 ft (imperial), labeled; ground-surface line labeled "Ground Surface"; KB marker if `kbElev`.
- Concentric casing rendering: widest (first) casing outermost; steel walls gray; cement shading (light blue) behind each casing from `toc_m` (or shoe if no TOC) down to shoe; hatched open-hole pattern below the last shoe (or from `openHole`); plugs as dark-green filled blocks (bridge/CIBP as the standard hourglass-in-casing symbol); perforation intervals as red outward ticks; formation tops as orange horizontal lines with names beside the axis; salt zones shaded pale violet band, hydrocarbon zones pale amber band; packer symbols (opposed black triangles); note icons (ⓘ) at depth beside the bore.
- Colors via the app's CSS variables where possible (`var(--line)`, `--muted`, theme-aware) with a colorblind-safe fixed accent set for semantic colors (steel #8a93a1, cement #a8cdea, plug #1d6b47, formation #e08a2e, perf #d4453a, open-hole hatch #8a6b4f). Dark mode inherits automatically via CSS variables in the host card; exported SVG inlines resolved colors.
- Every interactive element carries `data-kind`, `data-id`, `role="img"`-compatible `<title>` for native tooltips fallback, and `aria-label`.
- Renders ONLY components present in the data; missing fields in labels show "—". Never throws on partial data; returns the empty-state card markup when `td` is missing.

## 6. Layout & interactions

- Detail-tab section: responsive two-column grid (CSS grid, stacks under 900px): LEFT the schematic card (SVG fills width, tall); RIGHT three stacked cards — Legend (interactive: hovering a legend row highlights that component class), Statistics, and Selection Details (filled on click).
- Hover tooltip (reuse the app's tooltip styling): casing → name, OD, grade, weight, top–shoe, TOC; plug → n/kind, top, bottom, length, sacks, additives, notes; perf → interval + status; formation → name + depth; note → text.
- Click: highlights the element (accent stroke), fills the Selection Details card with all fields. Click empty space clears.
- Zoom/pan: wheel zoom (cursor-anchored), drag pan, double-click reset — implemented via SVG `viewBox` manipulation on the live element (renderer stays pure; interaction layer adjusts the DOM node's viewBox). Jump-to-depth input: entering e.g. `900` (current unit) pans/zooms to center that depth.
- Unit toggle (segmented `m | ft`, top-right of the schematic card): re-renders labels/axis/tooltips/stats from the stored metres; geometry proportions unchanged. Choice persisted in localStorage (`lwms:schemUnit`).
- Statistics card: Total Depth; casing string count; plug count; deepest/shallowest plug; longest plug; total plugged interval; plug coverage % (plugged length ÷ td); open-hole length; perforated interval count; formation count. All in the active unit.

## 7. Rows editor (edit form)

Collapsible "Wellbore Construction" section in the Add/Edit Well form (below the Recommended Action field):
- TD + KB inputs; per-component repeatable rows with typed inputs matching §2 (casings: name/OD/grade/weight/top/shoe/TOC; plugs: #/kind/top/bottom/sacks/additives/notes; perfs: top/bottom/status; formations: name/top; packers: depth; zones: kind/top/bottom). Add-row and ✕ remove-row buttons per list.
- "Paste abandonment report…" textarea + Parse button: fills the rows from `parseWellboreReport`; if rows already contain data, `confirm('Replace the current construction rows with the parsed report?')` first. Parser warnings shown under the box.
- Save path: rows serialize into `w.wellbore` inside `readForm()` (empty section ⇒ field absent); `source` is set to `'parsed'` at the moment Parse fills the rows, and flipped to `'manual'` by any subsequent `input` event on a construction-row field (a simple change listener on the section container). Depth sanity: rows with non-numeric or negative depths are dropped with an inline warning; top>bottom pairs are swapped silently.

## 8. Export

Buttons on the schematic card: **SVG** (serialize current render + legend into a standalone `.svg` download with inlined colors), **PNG** (draw the SVG to an offscreen canvas at 2× and download), **Print** (opens print dialog; print CSS shows only the schematic card + legend). Filenames `wellbore-<licence>.<ext>`. No new dependencies.

## 9. Accessibility

Keyboard: schematic focusable; arrow keys pan, +/- zoom, 0 reset; legend rows and drawn elements are tabbable (`tabindex=0`) with `aria-label`s; visible focus outline. Tooltip content also available via `<title>` elements. Contrast ≥ 4.5:1 for text in both themes.

## 10. Code organization

All in `index.html` (project convention), organized as clearly-bounded sections: `/* ===== WELLBORE DATA ===== */` (model helpers + conversions m⇄ft), `/* ===== WELLBORE PARSER ===== */` (pure), `/* ===== WELLBORE SVG ===== */` (pure renderer), `/* ===== WELLBORE UI ===== */` (mount, interactions, editor wiring). Pure parts written so they can be loaded by node tests via the same extraction approach as the syntax gate. New test file `tools/wellbore.test.js` (node, zero deps, mirrors `tools/scoring.test.js` style) covering: parser cases from §4 incl. real Enbridge strings, m⇄ft conversion round-trips, depth-scale math, stats computations, bridge-enrichment mapping, and renderer smoke (`renderWellboreSVG` returns a string containing expected elements for a full fixture and for sparse fixtures without throwing).

## 11. Out of scope (v1)

Schematic inside the well PDF export; directional/horizontal wellpath geometry (all wells drawn vertical); editing via drag on the schematic; automatic formation tops from external data; 3D-viewer-side schematic UI.

## 12. Verification & rollout

- `node tools/wellbore.test.js` green; syntax gate green after every task.
- Manual checklist (local file): schematic renders for a bridged Enbridge well; paste-parser round-trip; rows editor add/edit/remove; empty-state for bare wells; tooltips/click/zoom/pan/jump; unit toggle consistency (axis+tooltip+stats agree); dark mode; export PNG/SVG/print; sync carries `wellbore` to a second browser profile; existing detail tab unchanged for wells without data.
- Feature branch → PR with preview deploy (user merges; merge auto-deploys production).
