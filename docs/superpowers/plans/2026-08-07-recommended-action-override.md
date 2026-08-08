# Recommended Action Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-well `recActionOverride` field, edited via the existing well form, that replaces the engine-generated "Recommended Action — § 8" wording in the dossier and PDF; clearing it (or saving it unchanged from the engine text) reverts to automatic.

**Architecture:** All in the single-file app `index.html`. A new `recPlainText(w)` helper converts the engine's HTML recommendation to plain text for form prefill and for the equal-to-engine comparison at save time. The dossier and PDF branch on `w.recActionOverride`. The field rides the well object through sync/normalize untouched (`normalizeWell` spreads unknown fields — verify, don't change, `scoring.js`).

**Tech Stack:** Vanilla JS in `index.html` (semicolons, 2-space indent — match the file), jsPDF for the PDF section, `confirm`-free (this feature adds no dialogs).

**Spec:** `docs/superpowers/specs/2026-08-07-recommended-action-override-design.md`

## Global Constraints

- Working directory: `/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard`
- Only `index.html` changes. `scoring.js`, `methodology.json`, `wells.json`, `3d-reviewer.html`, `tools/` untouched.
- Field name exactly `recActionOverride`; empty string / absent means automatic.
- Save rule verbatim from spec §4: `t = textarea.value.trim()`; store `''` when `t === ''` OR `t === recPlainText(justBuiltWell).trim()`; else store `t`.
- Hint text verbatim: `Leave empty to restore the automatic recommendation.`
- Dossier tag text: `reviewer-edited`; PDF heading suffix: ` (reviewer-edited)`.
- Syntax gate after every edit:

```bash
node -e "
const html = require('fs').readFileSync('index.html','utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
new Function(blocks.join('\n;\n'));
console.log('syntax OK —', blocks.length, 'inline script blocks');
"
```

- Work on the feature branch the controller creates; SKIP any `git pull` inside tasks; do NOT push (controller merges + pushes after the human checklist — pushing auto-deploys production).

---

### Task 1: Helper, form field, prefill, save semantics

**Files:**
- Modify: `index.html:239` (form markup), `index.html:648-669` (`readForm` tail), `index.html:696` (`resetForm` id list), `index.html:716` (`editWell` prefill), and a new helper directly after the `recommend()` function (which ends with the `Low Tier` return, ~`index.html:1048`).

**Interfaces:**
- Consumes: existing `recommend(w) → {title, body, warn?}` (body/warn are HTML strings).
- Produces (Task 2 relies on): `recPlainText(w) → string` (plain-text engine recommendation, trimmed); well objects carrying `recActionOverride: string` (`''` = automatic); form textarea `#f_recAction`.

- [ ] **Step 1: Verify the field survives normalization (read-only check)**

Run: `grep -n "normalizeWell" scoring.js | head -3` and read the function — confirm it spreads the input well (`...w` or equivalent) so unknown fields like `recActionOverride` pass through. Do NOT modify scoring.js. If it does not pass fields through, STOP and report BLOCKED (the spec's zero-schema-change premise would be wrong).

- [ ] **Step 2: Add the plain-text helper**

Immediately AFTER the closing brace of `function recommend(w){...}` (the function ending with the `return {title:'No Further Action — Monitor at MMV Cycle', ...}` statement, ~line 1048), insert:

```js
/* Plain-text rendering of the engine recommendation — used to prefill the edit
   form and to detect "saved unchanged" so an untouched form never freezes an
   override (spec 2026-08-07-recommended-action-override §4). */
function recPlainText(w){
  const rec = recommend(w);
  const html = '<b>'+rec.title+'</b><br>'+rec.body + (rec.warn ? '<br>'+rec.warn : '');
  const div = document.createElement('div');
  div.innerHTML = String(html)
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<li[^>]*>/gi,'\n- ')
    .replace(/<\/li>/gi,'')
    .replace(/<ul[^>]*>|<\/ul>/gi,'\n');
  return div.textContent.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
```

- [ ] **Step 3: Form markup**

In the form grid, directly AFTER the Notes div (line 239):

```html
        <div style="grid-column:1/-1"><label>Recommended Action (§ 8) — reviewer override</label><textarea id="f_recAction" rows="4" placeholder="Prefilled with the automatic recommendation when editing — change the wording to override it."></textarea><small style="display:block;margin-top:2px;color:var(--muted)">Leave empty to restore the automatic recommendation.</small></div>
```

- [ ] **Step 4: Save semantics in readForm**

`readForm` currently ends by returning an object literal (`return { id: ..., updatedBy: ... };`). Change `return {` to `const w = {`, and after the literal's closing `};` add:

```js
  const t = document.getElementById('f_recAction').value.trim();
  w.recActionOverride = (t && t !== recPlainText(w).trim()) ? t : '';
  return w;
```

(`recPlainText(w)` here runs on the just-built well — current form scores — exactly as spec §4 requires. `recommend` is a hoisted function declaration, so call order is safe.)

- [ ] **Step 5: Prefill + reset**

In `editWell(id)` directly after the `f_notes` line (line 716), add:

```js
  document.getElementById('f_recAction').value = w.recActionOverride || recPlainText(w);
```

In `resetForm(keepScores)` change the id list (line 696) from:

```js
  ['f_id','f_op','f_lat','f_lon','f_year','f_reviewer','f_notes'].forEach(id=>document.getElementById(id).value='');
```

to:

```js
  ['f_id','f_op','f_lat','f_lon','f_year','f_reviewer','f_notes','f_recAction'].forEach(id=>document.getElementById(id).value='');
```

- [ ] **Step 6: Syntax gate**

Run the Global Constraints gate. Expected: `syntax OK — 2 inline script blocks`.

- [ ] **Step 7: Save-rule smoke (mirror of the Step 4 expression)**

```bash
node -e "
function decide(raw, engineNew, enginePrefill, prevOverride){ const t = raw.trim(); const wasPrefillEngine = !prevOverride && t === enginePrefill.trim(); return (t && !wasPrefillEngine && t !== engineNew.trim()) ? t : ''; }
console.assert(decide('','N','P','')==='','empty -> auto');
console.assert(decide('N','N','P','')==='','unchanged-vs-new -> auto');
console.assert(decide('P','N','P','')==='','stale prefill after score change -> auto');
console.assert(decide('P','N','P','P')==='P','stored override kept on untouched save');
console.assert(decide('custom','N','P','')==='custom','changed -> stored');
console.log('override save rule OK');
"
```

Expected: `override save rule OK`. (If you change the Step 4 expression, change this mirror.)

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(dossier): reviewer override field for Recommended Action — form, prefill, save semantics"
```

---

### Task 2: Dossier and PDF rendering

**Files:**
- Modify: `index.html:1010-1012` (dossier card, inside `openDetail`'s template literal; `const rec = recommend(w2)` already exists at line 963), `index.html:1764-1796` (PDF Recommended Action section inside `exportPDF`).

**Interfaces:**
- Consumes: `w2.recActionOverride` (Task 1; `w2` is the `normalizeWell` output which passes the field through — verified in Task 1 Step 1), existing `rec` object, `escapeHtml`, `pdfSafe`, `doc`/`ensure`/`M`/`CONTENT_W`/`y` in the PDF closure.

- [ ] **Step 1: Dossier branch**

In `openDetail`'s big template literal, replace:

```js
        <h2 style="margin-top:14px">Recommended Action — § 8</h2>
        <div class="rec-card"><h4>${rec.title}</h4>${rec.body}</div>
        ${rec.warn?`<div class="warn" style="margin-top:8px">${rec.warn}</div>`:''}
```

with:

```js
        <h2 style="margin-top:14px">Recommended Action — § 8</h2>
        ${w2.recActionOverride
          ? `<div class="rec-card"><h4>Reviewer Recommendation <span class="tag" style="background:#3a2f12;color:#f0c96b;margin-left:6px">reviewer-edited</span></h4><div style="white-space:pre-wrap">${escapeHtml(w2.recActionOverride)}</div></div>`
          : `<div class="rec-card"><h4>${rec.title}</h4>${rec.body}</div>${rec.warn?`<div class="warn" style="margin-top:8px">${rec.warn}</div>`:''}`}
```

(The amber tag colors match the existing re-review badge styling used in the register table.)

- [ ] **Step 2: PDF branch**

In `exportPDF`, replace the section that currently reads:

```js
    // Recommended action
    const rec = recommend(w2);
    ensure(80);
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text(pdfSafe('Recommended Action (Sec. 8)'), M, y); y+=16;
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5);
    const titleLines = doc.splitTextToSize(pdfSafe(rec.title), CONTENT_W);
    doc.text(titleLines, M, y); y += titleLines.length*12 + 4;
```

with:

```js
    // Recommended action
    const rec = recommend(w2);
    const recOverride = w2.recActionOverride || '';
    ensure(80);
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text(pdfSafe('Recommended Action (Sec. 8)' + (recOverride ? ' (reviewer-edited)' : '')), M, y); y+=16;
    if(recOverride){
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
      const oLines = doc.splitTextToSize(pdfSafe(recOverride), CONTENT_W);
      oLines.forEach(line=>{ ensure(13); doc.text(line, M, y); y += 12; });
      y += 6;
    } else {
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5);
    const titleLines = doc.splitTextToSize(pdfSafe(rec.title), CONTENT_W);
    doc.text(titleLines, M, y); y += titleLines.length*12 + 4;
```

then find the END of the existing engine-rendering block — the closing `}` of `if(rec.warn){...}` followed by the blank line before the next section — and add a closing `}` for the new `else` right after the `if(rec.warn){...}` block's closing brace. The final structure must be:

```js
    if(recOverride){
      ...override lines...
    } else {
      ...existing title/body/warn code, unchanged...
    }
```

(Keep the existing engine-rendering lines byte-identical inside the `else`; only indentation of the wrapped block may stay as-is — this file does not enforce re-indentation of wrapped blocks.)

- [ ] **Step 3: Syntax gate**

Run the Global Constraints gate. Expected: `syntax OK — 2 inline script blocks`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(dossier): render reviewer-edited Recommended Action in dossier and PDF"
```

---

### Task 3: Human checklist, merge, deploy

**Files:** none (verification + controller-run merge/push).

- [ ] **Step 1: Human checklist on the LOCAL file** (open `index.html` from disk; Load Demo for data; file:// storage is isolated from the shared register):

- [ ] Edit a well → textarea prefills with the automatic wording (readable plain text, bullets as "- " lines)
- [ ] Change the wording, Update Well → dossier shows the custom text + amber `reviewer-edited` tag; engine warning box gone
- [ ] Download Well PDF → Recommended Action section shows "(reviewer-edited)" and the custom text
- [ ] Edit again → textarea shows the custom text; clear it, Update Well → automatic wording + warning box return, no tag
- [ ] Edit and save WITHOUT touching the field → dossier still automatic (no tag)
- [ ] Edit a well, change one score so the tier changes, do NOT touch the textarea, save → dossier still automatic (no tag)
- [ ] Reload the page → override persists on the edited well
- [ ] A never-overridden well's dossier and PDF look exactly as before

- [ ] **Step 2 (controller): merge to main, push, verify live**

```bash
git checkout main && git pull --ff-only && git merge <feature-branch> && git push origin main
curl -s https://co-2-legacy-wellbore-dashboard.vercel.app/ | grep -c f_recAction   # expect ≥1 within ~1 min
```
