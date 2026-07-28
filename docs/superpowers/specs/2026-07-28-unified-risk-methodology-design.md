# Unified Legacy-Well Risk Methodology — Design

**Date:** 2026-07-28
**Status:** Approved design, pending implementation
**Owner:** Tahir Chisti
**Applies to:** `index.html` (shared team register), `3d-reviewer.html` (3D Legacy Well Reviewer), `wells.json`, new files `methodology.json` and `scoring.js`

## 1. Purpose

Replace the current Appendix-D-derived scoring model (9 parameters × 1/3/5, unweighted sum 9–45) with **one unified risk methodology anchored to both the AER regulatory framework (Directive 065 CCS scheme requirements + Directive 020 abandonment standards) and EPA Class VI (40 CFR 146.84 AoR & corrective action)**, defensible in either jurisdiction. One model governs both apps. The methodology itself is admin-tunable in the UI and versioned.

Decisions made during brainstorming (2026-07-28):

| Decision | Choice |
|---|---|
| Scope | Full methodology overhaul (parameters, anchors, weights, tiers, matrix) |
| Regulatory basis | AER D065/D020 + EPA Class VI §146.84, as **one unified model** with per-parameter traceability |
| Scoring | Weighted Likelihood × Consequence, placed on the 5×5 matrix |
| Coverage | Both the register **and** the 3D Reviewer — one shared engine |
| Migration | Auto-migrate existing wells + flag `needsReview`; run once at deploy time |
| Authorship | Parameter set proposed by Claude, approved by Tahir (this document is the approved set) |
| Tunability | Admin-tunable in the UI; methodology stored in the repo and versioned via Git |
| Architecture | `methodology.json` in the repo, synced like `wells.json`; shared `scoring.js` engine |

## 2. Parameter Set (approved)

Each parameter is scored **1–5**. Anchors are defined at 1/3/5; scores 2 and 4 are engineering-judgment interpolations. Weights sum to 1.00 within each axis.

### 2.1 Likelihood axis — probability a leakage pathway exists or activates

| Key | Parameter | Weight | 1 (best) | 3 | 5 (worst) | Unknown scores as | Regulatory / literature basis |
|---|---|---|---|---|---|---|---|
| `plugQuality` | Abandonment & Plug Quality | 0.22 | Abandoned to current D020 / Class VI standard; verified plugs across storage complex | Era-standard abandonment; plugs present but unverified (no tag/log) | Improper abandonment; bridge-plug-only / welded-cap era; plugs missing | 5 | AER D020 §3; 40 CFR 146.84(c); Arbad et al. 2024 |
| `cement` | Cement Coverage & Quality | 0.20 | Returns/CBL confirm coverage across primary seal and to surface-casing shoe | TOC below a required seal, or quality unverified (no CBL/VDL) | Known uncemented interval across a seal or across BGWP/USDW base; no cement records | 5 | AER D020; 40 CFR 146.84(c); Watson & Bachu 2009 |
| `barriers` | Barriers Across Flow Zones | 0.12 | ≥2 independent verified barriers per flow zone | Single barrier somewhere | No barrier across ≥1 flow zone | 3 | AER D020; CSA Z741 |
| `scvf` | SCVF / Gas Migration History | 0.16 | Tested; none reported | Historical SCVF/GM repaired & verified, or never tested | Active or unrepaired SCVF/GM | 3 | Watson & Bachu 2009 (top predictor); AER ID 2003-01 |
| `age` | Well Age & Regulatory Era | 0.10 | Post-1995 | 1965–1995 | Pre-1965 or unknown spud date | 5 | Watson & Bachu 2009 era analysis; Arbad et al. 2024 |
| `complexity` | Wellbore Complexity & Condition | 0.10 | Vertical, sweet, simple completion | Deviated, or sour/oil-producer history, or suspected casing issues | Multiple factors, or known casing failure/corrosion | 3 | Watson & Bachu 2009; AER D065 wellbore review |
| `data` | Data Confidence | 0.10 | Complete records incl. logs | Partial / incomplete | None or analog only | 5 (by definition) | 40 CFR 146.84(c); Arbad public-data method |

### 2.2 Consequence axis — severity if a pathway activates

| Key | Parameter | Weight | 1 (best) | 3 | 5 (worst) | Unknown scores as | Regulatory / literature basis |
|---|---|---|---|---|---|---|---|
| `penetration` | Penetration vs Storage Complex | 0.30 | Does not reach primary seal (Types 8–9) | Penetrates primary seal, not reservoir (Types 4–7) | Intersects storage reservoir (Types 1–3) | 5 (Type 1 default) | Type classification (GD-40 / Arbad); §146.84; D065 AOR |
| `plume` | Position vs Plume & Pressure Front | 0.25 | Outside modeled pressure front (AoR) | Inside pressure front, outside plume | Inside modeled CO₂ plume extent | 3 | §146.84(a) AoR modeling; D065. Fallback guidance where no model exists yet: >3.2 km → 1; 1.6–3.2 km → 3; <1.6 km → 5 |
| `usdw` | Groundwater (USDW/BGWP) Isolation | 0.25 | Verified isolation across BGWP/USDW base (surface casing + cement, or plugs) | Unverified | Known open pathway at the groundwater interval | 3 | AER D020 non-saline protection; EPA USDW mandate |
| `access` | Corrective-Action Accessibility | 0.20 | Licensee active; surface access; re-entry feasible | Suspended / no marker / constrained access | Orphaned, unknown location, or re-entry infeasible | 3 | §146.84(d) corrective action; AER orphan registry |

### 2.3 Deliberate changes from the v1 model

1. **SCVF/GM history added** (`scvf`) — Watson & Bachu's strongest single leakage predictor; an AER data source not previously captured.
2. **Plume proximity redefined** (`plume`) — from raw distance bands to position relative to the *modeled* plume and pressure front (what §146.84 and D065 actually regulate). The old 1.6/3.2 km bands survive as fallback anchor guidance for sites without a model.
3. **Access moved from Likelihood to Consequence** (`access`) — inability to remediate worsens outcome, it does not raise leak probability; mirrors §146.84(d).
4. **Unknown-data policy is explicit per parameter** (column above): unknown generally scores 3, but 5 where absence of records is itself the hazard (plugs, cement, age, penetration), consistent with the Arbad public-data method and the existing cement-carbonation note.

## 3. Scoring Mechanics

- **L** = Σ(weightᵢ × scoreᵢ) over the 7 Likelihood parameters → 1.00–5.00.
- **C** = Σ(weightᵢ × scoreᵢ) over the 4 Consequence parameters → 1.00–5.00.
- **Matrix cell** = (round(L), round(C)) on the 5×5 matrix — the cell is the official risk rank per §7.2. Standard rounding (x.5 rounds up).
- **Risk Index** = L × C (continuous, 1.0–25.0) for sorting, top-risk tables, and tie-breaking within a cell.
- **Rank bands** on round(L) × round(C) (admin-tunable): **Low 1–4 · Moderate 5–9 · High 10–16 · Very High 17–25.**
- **Type → C1 auto-suggest:** Types 8–9 → 1, Types 4–7 → 3, Types 1–3 → 5; reviewer may override.
- **Integrity Score (3D Reviewer continuity):** derived display only, `100 − (RiskIndex − 1) / 24 × 100`, computed solely in `scoring.js`.
- Each saved well records: per-parameter scores, computed L / C / Risk Index / rank, `scoredUnder` (methodology revision), `needsReview` flag.
- Charts: risk distribution by rank band; driver heatmap switches to **weighted contribution** (weight × score) per parameter; top-risk table sorts by Risk Index.

## 4. `methodology.json`

Single source of truth for the rulebook, stored in the repo root beside `wells.json`. The snippet below illustrates the schema only (anchors abbreviated); **the tables in §2 are the normative content** that ships as revision 2.0.0.

```json
{
  "revision": "2.0.0",
  "updatedBy": "Tahir Chisti",
  "updatedAt": "2026-07-28T00:00:00Z",
  "params": [
    {
      "key": "plugQuality",
      "name": "Abandonment & Plug Quality",
      "axis": "L",
      "weight": 0.22,
      "desc": "Verified modern plugs vs. missing/unverifiable",
      "anchors": { "1": "…", "3": "…", "5": "…" },
      "unknownScore": 5,
      "refs": ["AER D020 §3", "40 CFR 146.84(c)", "Arbad et al. 2024"]
    }
  ],
  "matrix": {
    "bands": [
      { "min": 1,  "max": 4,  "label": "Low",       "cls": "low"  },
      { "min": 5,  "max": 9,  "label": "Moderate",  "cls": "mod"  },
      { "min": 10, "max": 16, "label": "High",      "cls": "high" },
      { "min": 17, "max": 25, "label": "Very High", "cls": "vhigh" }
    ]
  },
  "wellTypes": { "Type 1": { "short": "…", "desc": "…", "prot": "…" } }
}
```

- Loaded by both apps on boot and on the existing ~45 s / focus-regain refresh cycle.
- Each app embeds a baked-in copy of the approved 2.0.0 as offline/first-load fallback; a banner indicates fallback mode.
- **Validation on load and on save:** axis weights must each sum to 1.00 (±0.001); all 11 keys present; bands must cover 1–25 without overlap. Invalid → reject, keep last-good, surface details behind the sync pill.

## 5. Admin Panel (Methodology tab)

- New tab in the settings area beside the sync-pill configuration.
- Editable: weights (live-validated; Save disabled until each axis sums to 1.00), anchor wording, unknown-score policy, band cutoffs.
- Save commits `methodology.json` via the existing GitHub-token flow with SHA-collision retry; **revision auto-bumps** (minor for weight/band changes, patch for wording) and stamps `updatedBy`/`updatedAt`.
- Methodology commits are separate from register commits. Git history of the file is the audit trail; recovery = restore any prior version from GitHub history.
- Wells scored under an older revision display a badge ("scored under v2.0.0 — current v2.1.0") and count toward the re-review backlog KPI. Stored per-well scores are never silently recomputed; displayed L/C/rank recompute live against the current methodology.

## 6. Migration (v1 register → v2)

Runs **once at deploy time** as a script; output is a single migration commit of `wells.json` (schema v2). The pre-migration register remains recoverable via Git history.

Mapping (old key → new key, scores carried 1→1, 3→3, 5→5):

| Old (v1) | New (v2) |
|---|---|
| `plug` | `plugQuality` |
| `cement` | `cement` |
| `barriers` | `barriers` |
| `age` | `age` |
| `data` | `data` |
| `access` | `access` (now Consequence axis) |
| `prox` | `plume` (km fallback anchors) |
| `depthR`, `depthC` | `penetration` = max(depthR, depthC) |
| — | `scvf` = 3, `complexity` = 3, `usdw` = 3 (unknown defaults) |

- Each migrated well keeps its complete v1 record (all 9 scores + 9–45 total) under a `legacy` block; gets `needsReview: true` and `scoredUnder: "1.0.0"`.
- **Pre-commit gate:** the script prints an old-tier → new-rank shift table for all 32 wells; Tahir sanity-checks it before the migration commit is pushed.
- UI: "Migrated — needs re-review" filter chip; re-review backlog KPI.
- CSV: import/export moves to v2 columns; v1-format CSVs are auto-detected and run through the same mapping with the same flags. 3D Reviewer per-site autosaved data migrates on first open, same mapping and flags.

## 7. Shared Engine (`scoring.js`) and 3D Reviewer Integration

- New `scoring.js` in the repo root, included by **both** HTML files (works from GitHub Pages and `file://`). Contents: methodology load/validate/fallback, weighted L/C computation, matrix rank + bands, Risk Index, Integrity Score derivation, v1→v2 migration mapping, golden self-test.
- The 3D Reviewer's own additive screening model is **removed**; its wells score on the same 11 parameters. Risk-class colors in the 3D scene derive from the matrix rank bands. Its "Risk Model & Methodology" page is generated live from `methodology.json`.
- The register↔reviewer bridge becomes **lossless**: identical scores and metadata move both ways; all anchor-translation code and the "verify after push" caveat are deleted.

## 8. Error Handling

| Failure | Behavior |
|---|---|
| `methodology.json` fetch fails | Baked-in fallback + visible banner |
| Methodology invalid (weights ≠ 1.00, missing keys, band gaps) | Reject; keep last-good; details behind sync pill |
| Concurrent methodology edits | SHA-collision detection + retry (same as `wells.json`) |
| Revision changes mid-session | Live display recomputes; stored scores untouched; stale badge appears |
| Well missing a parameter score | Parameter's `unknownScore` applies; well flagged incomplete |

## 9. Testing

- **Golden test vectors:** five canonical wells — best-case (all 1s), worst-case (all 5s), unknown-heavy (all unknown defaults), migrated-legacy (a real v1 well mapped), band-boundary (L/C chosen to land exactly on a rank cutoff) — with hand-computed expected L, C, Risk Index, and rank, stored in `scoring.js`.
- `runSelfTest()` console harness runs the vectors in **both** apps; identical expected values passing in both is the anti-drift tripwire.
- Manual checklist: methodology admin save/validation, fallback banner, migration shift table, bridge round-trip (register → 3D → register with no value changes), CSV v1 auto-detect, stale-revision badge.

## 10. Out of Scope

- No changes to the GitHub Pages hosting, token/sync model, or per-well merge semantics.
- No rescoring automation beyond the mechanical v1→v2 mapping — human re-review closes the `needsReview` flags.
- The separate Vercel deployment and repo remain untouched by this design (deploy flow unchanged).
- No changes to the Hijaz/ccus-space integration plan (tracked separately).
