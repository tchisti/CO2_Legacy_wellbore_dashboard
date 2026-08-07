# Register Bulk Delete + Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checkbox multi-select with Gmail-style select-all, a bulk "Delete selected" action, and a "Reset register…" button in the Well Register tab of the dashboard.

**Architecture:** Everything lives in the single-file app `index.html` (inline `<script>`, no framework, no build step). Selection is an in-memory `Set` on the global `state`; all deletions funnel through one new `deleteWells(ids, label)` function that feeds `SYNC.pendingDeletes` so shared-register propagation works exactly like today's single delete. The table is rebuilt by `render()` on every change, so selection UI is just more `render()` output.

**Tech Stack:** Vanilla JS in `index.html` (2-space indent, semicolons ARE used in this file — match it, unlike the 3D-viewer repo), `confirm()`/`alert()` dialogs, localStorage persistence via `save()`.

**Spec:** `docs/superpowers/specs/2026-08-07-register-bulk-actions-design.md`

## Global Constraints

- Working directory: `/Users/roomi/VS Workspace/Subsurface AI App/CO2_Legacy_wellbore_dashboard`
- Only `index.html` changes (plus this plan's checkbox ticks). `tools/`, `scoring.js`, `methodology.json`, `wells.json`, `3d-reviewer.html` are untouched.
- Every deletion path must add each removed well id to `SYNC.pendingDeletes` (this is what deletes the well from the shared team register on the next sync push).
- Confirm wording verbatim from the spec:
  - Bulk: `Delete {N} wells{shared}? Tip: Export CSV first if you want a backup.`
  - Reset: `Reset the register? This deletes ALL {N} wells{shared} and cannot be undone. Tip: Export CSV first if you want a backup.`
  - `{shared}` = ` from the SHARED team register (for everyone)` when `syncToken()` is truthy, else empty — identical to existing `deleteWell`.
- Empty-register reset guard: `alert('Register is already empty.')`.
- Selection is never persisted (not in localStorage, not in sync payloads).
- Syntax gate after every edit (no test harness exists for index.html):

```bash
node -e "
const html = require('fs').readFileSync('index.html','utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
new Function(blocks.join('\n;\n'));
console.log('syntax OK —', blocks.length, 'inline script blocks');
"
```

- IMPORTANT before any commit: `git pull --ff-only` first — the in-app GitHub sync writes commits directly to origin/main.
- Do NOT push until the final task's manual checklist has passed (pushing auto-deploys the live Vercel site).

---

### Task 1: Selection state, checkbox column, select-all + banner, bulk bar UI

**Files:**
- Modify: `index.html:565` (state init), `index.html:295-309` (register header + thead), `index.html:729-790` (`render()` table section), plus new helper functions next to `deleteWell`.

**Interfaces:**
- Produces (Task 2 relies on these exact names):
  - `state.bulkSelected` — `Set<string>` of well ids, initialised in the state literal.
  - `visibleWells()` — returns the filtered array `render()` shows (search + re-review filter applied, unsorted).
  - `toggleSelect(id, on)`, `toggleSelectAll(on)`, `selectEntireRegister()`, `clearSelection()` — all end with `render()`.
  - `deleteSelected()` — REFERENCED by the bulk bar's button in this task but IMPLEMENTED in Task 2; until Task 2 lands, define a stub `function deleteSelected(){}` so the syntax gate and clicks don't error (Task 2 replaces it).
  - DOM: `#selAll` header checkbox, `#bulkBar` div, `#selBanner` div.

- [ ] **Step 1: Add the Set to state**

At line 565 change:

```js
let state = { wells: [], editingId: null, currentForm: defaultScores(), selected: null };
```

to:

```js
let state = { wells: [], editingId: null, currentForm: defaultScores(), selected: null, bulkSelected: new Set() };
```

- [ ] **Step 2: Markup — bulk bar + banner divs, header checkbox column, Reset button placeholder position**

In the register section (`index.html:295-309`):

After the closing `</div>` of the `row spread` header block (line 305) and BEFORE the table-wrapper `<div style="max-height:540px...">`, insert:

```html
        <div id="bulkBar" style="display:none;margin-bottom:8px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--field);font-size:12px" class="row spread">
          <span id="bulkCount" style="font-weight:700"></span>
          <span class="row" style="gap:8px">
            <button class="danger" style="padding:4px 10px;font-size:11px" onclick="deleteSelected()">Delete selected</button>
            <button class="ghost" style="padding:4px 10px;font-size:11px" onclick="clearSelection()">Clear selection</button>
          </span>
        </div>
        <div id="selBanner" style="display:none;margin-bottom:8px;padding:6px 12px;border:1px dashed var(--line);border-radius:10px;font-size:12px;color:var(--muted)"></div>
```

Change the thead row (line 307-309) from:

```html
            <thead><tr>
              <th>Well ID</th><th>Type</th><th>Status</th><th>Class</th><th>Age</th><th>L × C</th><th>Index</th><th>Category</th><th></th>
            </tr></thead>
```

to:

```html
            <thead><tr>
              <th style="width:28px"><input type="checkbox" id="selAll" title="Select all visible wells" onchange="toggleSelectAll(this.checked)"></th>
              <th>Well ID</th><th>Type</th><th>Status</th><th>Class</th><th>Age</th><th>L × C</th><th>Index</th><th>Category</th><th></th>
            </tr></thead>
```

- [ ] **Step 3: Selection helper functions**

Directly ABOVE `function deleteWell(id){` (line 717), insert:

```js
/* ============ BULK SELECTION ============ */
function visibleWells(){
  const q = (document.getElementById('search')?.value||'').toLowerCase();
  const reviewOnly = document.getElementById('fltReview')?.checked;
  return state.wells.filter(w=>{
    if(q && ![w.licence,w.operator,w.status,w.klass,w.type].join(' ').toLowerCase().includes(q)) return false;
    if(reviewOnly && !(w.needsReview || w.scoredUnder!==METHODOLOGY.revision)) return false;
    return true;
  });
}
function pruneSelection(){
  const ids = new Set(state.wells.map(w=>w.id));
  for(const id of [...state.bulkSelected]) if(!ids.has(id)) state.bulkSelected.delete(id);
}
function toggleSelect(id, on){
  if(on) state.bulkSelected.add(id); else state.bulkSelected.delete(id);
  render();
}
function toggleSelectAll(on){
  const vis = visibleWells();
  if(on) vis.forEach(w=>state.bulkSelected.add(w.id));
  else vis.forEach(w=>state.bulkSelected.delete(w.id));
  render();
}
function selectEntireRegister(){
  state.wells.forEach(w=>state.bulkSelected.add(w.id));
  render();
}
function clearSelection(){
  state.bulkSelected.clear();
  render();
}
function deleteSelected(){} /* implemented in the bulk-delete task */
```

- [ ] **Step 4: Use visibleWells() inside render() (single filter path)**

In `render()` (~line 744), replace the inline filter:

```js
  const q = (document.getElementById('search')?.value||'').toLowerCase();
  const reviewOnly = document.getElementById('fltReview')?.checked;
  const tbody = document.getElementById('wellsBody'); tbody.innerHTML='';
  const filtered = state.wells.filter(w=>{
    if(q && ![w.licence,w.operator,w.status,w.klass,w.type].join(' ').toLowerCase().includes(q)) return false;
    if(reviewOnly && !(w.needsReview || w.scoredUnder!==METHODOLOGY.revision)) return false;
    return true;
  });
```

with:

```js
  pruneSelection();
  const tbody = document.getElementById('wellsBody'); tbody.innerHTML='';
  const filtered = visibleWells();
```

Before removing the `q`/`reviewOnly` locals, grep the rest of `render()` to confirm nothing else references them (in the current file nothing does — the filter is their only use).

- [ ] **Step 5: Empty-state colspan**

In the same function change `colspan="9"` to `colspan="10"` in the "No wells." row.

- [ ] **Step 6: Row checkbox cell**

In the row template inside `render()`, add a new FIRST cell before the Well ID cell. Change:

```js
      tr.innerHTML = `
        <td><span class="well-id">${escapeHtml(w.licence)}</span><br><small style="color:var(--muted)">${escapeHtml(w.operator)}</small></td>
```

to:

```js
      tr.innerHTML = `
        <td><input type="checkbox" ${state.bulkSelected.has(w.id)?'checked':''} onclick="event.stopPropagation();toggleSelect('${w.id}', this.checked)"></td>
        <td><span class="well-id">${escapeHtml(w.licence)}</span><br><small style="color:var(--muted)">${escapeHtml(w.operator)}</small></td>
```

(`w.id` values are internally generated ids — no quote-escaping hazard; this matches the existing `onclick="...deleteWell('${w.id}')"` pattern.)

- [ ] **Step 7: Header checkbox state, bulk bar, banner — after the table is built**

Still in `render()`, immediately AFTER the `if(!filtered.length){...} else {...}` block that fills `tbody` (i.e. before the `// top list` comment), insert:

```js
  // bulk-selection chrome
  const selAll = document.getElementById('selAll');
  const visSelected = filtered.filter(w=>state.bulkSelected.has(w.id)).length;
  if(selAll){
    selAll.checked = filtered.length>0 && visSelected===filtered.length;
    selAll.indeterminate = visSelected>0 && visSelected<filtered.length;
  }
  const bar = document.getElementById('bulkBar');
  if(bar){
    bar.style.display = state.bulkSelected.size ? 'flex' : 'none';
    document.getElementById('bulkCount').textContent = `${state.bulkSelected.size} selected`;
  }
  const banner = document.getElementById('selBanner');
  if(banner){
    const total = state.wells.length;
    const hidden = total - filtered.length;
    if(hidden>0 && state.bulkSelected.size===total && total>0){
      banner.style.display='block';
      banner.innerHTML = `All ${total} wells selected — <a href="#" onclick="event.preventDefault();clearSelection()">Clear selection</a>`;
    } else if(hidden>0 && filtered.length>0 && visSelected===filtered.length){
      banner.style.display='block';
      banner.innerHTML = `All ${filtered.length} filtered wells selected — <a href="#" onclick="event.preventDefault();selectEntireRegister()">Select all ${total} wells in register</a>`;
    } else banner.style.display='none';
  }
```

- [ ] **Step 8: Syntax gate**

Run the Global Constraints node one-liner. Expected: `syntax OK — ...`.

- [ ] **Step 9: Commit (after `git pull --ff-only`)**

```bash
git pull --ff-only
git add index.html
git commit -m "feat(register): checkbox multi-select with select-all banner and bulk bar"
```

---

### Task 2: One delete path — deleteWells(), Delete selected, Reset register

**Files:**
- Modify: `index.html` — replace `deleteWell` (line ~717 post-Task-1) and the Task-1 `deleteSelected` stub; add `resetRegister`; add the Reset button to the register header (line ~297-304).

**Interfaces:**
- Consumes: `state.bulkSelected`, `clearSelection`-adjacent helpers, `#bulkBar` (Task 1); existing `SYNC.pendingDeletes` (a `Set`, `index.html:1743`), `syncToken()`, `save(msg)`, `render()`.
- Produces: `deleteWells(ids, label)` — the ONLY code path that removes wells; `deleteSelected()`, `resetRegister()`.

- [ ] **Step 1: Replace deleteWell with the shared path + bulk/reset functions**

Replace the whole existing `deleteWell` function:

```js
function deleteWell(id){
  const w = state.wells.find(x=>x.id===id);
  const shared = syncToken() ? ' from the SHARED team register (for everyone)' : '';
  if(!confirm(`Delete well ${w?w.licence:''}${shared}?`)) return;
  state.wells = state.wells.filter(x=>x.id!==id);
  SYNC.pendingDeletes.add(id);
  if(state.selected===id) state.selected=null;
  save('Delete well '+(w?w.licence:id)); render();
}
```

with:

```js
function deleteWells(ids, label){
  const del = new Set(ids);
  state.wells = state.wells.filter(w=>!del.has(w.id));
  del.forEach(id=>{ SYNC.pendingDeletes.add(id); state.bulkSelected.delete(id); });
  if(state.selected && del.has(state.selected)) state.selected=null;
  save(label); render();
}
function deleteWell(id){
  const w = state.wells.find(x=>x.id===id);
  const shared = syncToken() ? ' from the SHARED team register (for everyone)' : '';
  if(!confirm(`Delete well ${w?w.licence:''}${shared}?`)) return;
  deleteWells([id], 'Delete well '+(w?w.licence:id));
}
```

- [ ] **Step 2: Replace the deleteSelected stub**

Replace `function deleteSelected(){} /* implemented in the bulk-delete task */` with:

```js
function deleteSelected(){
  const n = state.bulkSelected.size;
  if(!n) return;
  const shared = syncToken() ? ' from the SHARED team register (for everyone)' : '';
  if(!confirm(`Delete ${n} wells${shared}? Tip: Export CSV first if you want a backup.`)) return;
  deleteWells([...state.bulkSelected], `Delete ${n} wells`);
}
function resetRegister(){
  if(!state.wells.length){ alert('Register is already empty.'); return; }
  const n = state.wells.length;
  const shared = syncToken() ? ' from the SHARED team register (for everyone)' : '';
  if(!confirm(`Reset the register? This deletes ALL ${n} wells${shared} and cannot be undone. Tip: Export CSV first if you want a backup.`)) return;
  deleteWells(state.wells.map(w=>w.id), `Reset register (${n} wells removed)`);
}
```

- [ ] **Step 3: Reset button in the register header**

In the register header controls `row` (the div containing the `fltReview` label and search box, `index.html:297-304`), add as the LAST child, after the search div:

```html
            <button class="danger" style="padding:5px 10px;font-size:11px" onclick="resetRegister()" title="Delete every well in the register">Reset register…</button>
```

- [ ] **Step 4: Syntax gate**

Run the Global Constraints node one-liner. Expected: `syntax OK`.

- [ ] **Step 5: Quick logic smoke in node (no DOM)**

```bash
node -e "
const state={wells:[{id:'a'},{id:'b'},{id:'c'}],selected:'b',bulkSelected:new Set(['a','b'])};
const SYNC={pendingDeletes:new Set()};
let saved=null; const save=m=>saved=m; const render=()=>{};
function deleteWells(ids,label){const del=new Set(ids);state.wells=state.wells.filter(w=>!del.has(w.id));del.forEach(id=>{SYNC.pendingDeletes.add(id);state.bulkSelected.delete(id);});if(state.selected&&del.has(state.selected))state.selected=null;save(label);render();}
deleteWells(['a','b'],'Delete 2 wells');
console.assert(state.wells.length===1&&state.wells[0].id==='c','wells filtered');
console.assert(SYNC.pendingDeletes.has('a')&&SYNC.pendingDeletes.has('b'),'pendingDeletes fed');
console.assert(state.selected===null,'selected cleared');
console.assert(state.bulkSelected.size===0,'selection cleaned');
console.assert(saved==='Delete 2 wells','save label');
console.log('deleteWells logic OK');
"
```

Expected: `deleteWells logic OK` with no assertion output. (This mirrors the function body; if you change the body, change the mirror.)

- [ ] **Step 6: Commit (after `git pull --ff-only`)**

```bash
git pull --ff-only
git add index.html
git commit -m "feat(register): bulk Delete selected + Reset register through single deleteWells path"
```

---

### Task 3: Manual checklist, then deploy

**Files:** none (verification + push).

- [ ] **Step 1: Human checklist on the LOCAL file** (open `index.html` from disk in Chrome — file:// has separate localStorage, so the shared register is not touched; use "Load Demo" for data). All items from spec §7:

- [ ] Row checkboxes toggle; bar appears at ≥1 with correct count
- [ ] Header checkbox selects exactly visible rows; indeterminate when partial
- [ ] Banner only when search/filter hides wells; "Select all N" selects everything; flips to "Clear selection"
- [ ] Delete selected: one confirm, correct count, only selected wells removed
- [ ] Detail view cleared if the open well was bulk-deleted
- [ ] Reset register empties register, KPIs 0, empty-state row shows (colspan spans full width)
- [ ] Reset on empty register → "Register is already empty." alert
- [ ] Single-well Del unchanged; checkbox click never opens detail; row click does
- [ ] Reload: selection resets, deletions persist
- [ ] Shared-register confirm wording: cannot be exercised on file:// (no sync token there) — verified by code reading in Task 2 (the `{shared}` clause is the same `syncToken()` ternary the single delete has always used)
- [ ] `SYNC.pendingDeletes` propagation: covered by the Task 2 Step 5 logic smoke; after deploy, optionally delete one test well on the live site with sync on and confirm it stays gone after the next sync cycle

- [ ] **Step 2: Push (deploys live)**

```bash
git pull --ff-only
git push origin main
```

- [ ] **Step 3: Verify live** — `curl -s https://co-2-legacy-wellbore-dashboard.vercel.app/ | grep -c bulkBar` returns ≥1 within ~1 min of push.
