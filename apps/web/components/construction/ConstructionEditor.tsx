'use client';

// The Construction tab (spec §4.3; schematic spec 2026-08-07 §5–§8): the wellbore schematic with
// its toolbar and statistics on the left, the construction rows editor on the right (stacked
// under 1024 px). The tab edits a working copy of the well's construction record: pasting a report
// or editing rows changes only the copy, the schematic and statistics draw the copy as it stands,
// "Save construction" writes it with one audited update, and "Discard changes" goes back to the
// stored record. While the copy has unsaved changes it is never lost without a word:
// - a reload or tab close asks first (beforeunload);
// - another tab of the well page asks first (DiscardConstructionDialog, wired by the page through
//   onDirtyChange), and so does any same-origin link that would leave this tab (a capture-phase
//   click guard; links that keep the tab, such as the header's score link, are let through);
// - and for what cannot be intercepted (the browser's Back button) the copy is kept in
//   sessionStorage while it has changes and offered back, with a banner, on the next visit. It is
//   never written into the record; a save or a discard clears it.
// The schematic draws with the record's TD, else the well's.
import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CircleDotIcon, ClipboardPasteIcon, HistoryIcon, LayersIcon, XIcon } from 'lucide-react';
import { parseWellboreReport, type DepthUnit, type Well, type Wellbore } from '@lwa/engine';
import { PasteReportDialog } from '@/components/construction/PasteReportDialog';
import { RowsTable, type FocusRequest } from '@/components/construction/RowsTable';
import { Schematic } from '@/components/construction/Schematic';
import { SchematicToolbar, type Zoom } from '@/components/construction/SchematicToolbar';
import { StatsCard } from '@/components/construction/StatsCard';
import { StateBadge } from '@/components/domain/StateBadge';
import { EmptyState } from '@/components/shell/EmptyState';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  addRow,
  applyParsedToRows,
  constructionKey,
  exportFilename,
  removeRow,
  rowForSvgId,
  rowsFromWellbore,
  sameConstruction,
  schematicExport,
  schematicInput,
  setHeader,
  setValue,
  summariseReport,
  swapValues,
  toConstruction,
  wellboreFromRows,
  type ConstructionRows,
  type ListKey,
  type ReportSummary,
} from '@/lib/construction-edit';
import {
  clearUnsavedConstruction,
  readUnsavedConstruction,
  saveUnsavedConstruction,
} from '@/lib/construction-session';
import { plural } from '@/lib/format';
import { isWellTabUrl, wellReportHref } from '@/lib/routes';
import { toError, useStore } from '@/lib/store/provider';

/** Asks before leaving the Construction tab with unsaved changes (the page shows it on a tab change). */
export function DiscardConstructionDialog({
  open,
  onKeep,
  onDiscard,
}: {
  open: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
    >
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Discard unsaved construction changes?</DialogTitle>
          <DialogDescription>
            The construction rows have changes that are not saved. Discarding them keeps the record as it was last saved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep} autoFocus>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            Discard changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ParseResult({ summary, onDismiss }: { summary: ReportSummary; onDismiss: () => void }) {
  const { rowsAdded, notUnderstood, messages } = summary;
  return (
    <div role="status" aria-label="Parse result" className="grid gap-1.5 rounded-lg border bg-subtle px-3 py-2.5 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink">
          {plural(rowsAdded, 'row')} added · {plural(notUnderstood.length, 'line')} not understood
        </p>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss the parse result" onClick={onDismiss} className="-mt-0.5 -mr-1">
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {notUnderstood.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">
            Not turned into rows; add what matters by hand. Lines no reader could use are also kept as notes.
          </p>
          <ul className="grid gap-0.5 border-l-2 border-line-strong pl-2.5">
            {notUnderstood.map((line) => (
              <li key={line} className="num text-xs break-words text-ink">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {messages.length > 0 ? (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50">
            Parser messages ({messages.length})
          </summary>
          <ul className="mt-1 grid gap-0.5 pl-2.5">
            {messages.map((m, i) => (
              <li key={`${i}-${m}`} className="num break-words text-muted-foreground">
                {m}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ConstructionEditor({
  well,
  onDirtyChange,
}: {
  well: Well;
  /** Told whether the working copy has unsaved changes (false again on unmount). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const store = useStore();
  const router = useRouter();
  const tdMessageId = useId();
  const stored = well.construction;

  // A working copy kept from an earlier visit (see construction-session.ts) is offered back when it
  // still differs from the saved record; one that matches it is stale and dropped.
  const [kept] = useState<ConstructionRows | null>(() => {
    const copy = readUnsavedConstruction(well.id);
    if (!copy) return null;
    const r = wellboreFromRows(copy, well.td_m);
    if (r.errors.some((e) => e.kind === 'input') || !sameConstruction(toConstruction(r.record), stored)) return copy;
    clearUnsavedConstruction(well.id);
    return null;
  });
  const [rows, setRows] = useState<ConstructionRows>(() => kept ?? rowsFromWellbore(stored));
  /** The working copy came back from an earlier visit (shown as a banner while it has changes). */
  const [restored, setRestored] = useState(kept !== null);
  /** The record the working copy is measured against: as stored, or as just saved. */
  const [baseline, setBaseline] = useState<Wellbore | null>(stored);
  const [seenKey, setSeenKey] = useState(() => constructionKey(stored));
  /** The editor shows once there is a record, or once the reviewer starts one. */
  const [started, setStarted] = useState(stored !== null || kept !== null);
  /** Where a link the reviewer clicked would go, while the discard dialog asks. */
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [unit, setUnit] = useState<DepthUnit>('m');
  const [zoom, setZoom] = useState<Zoom>(1);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [parsed, setParsed] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => wellboreFromRows(rows, well.td_m), [rows, well.td_m]);
  /** What Save writes (Save is blocked while there are errors, so it is the record as entered). */
  const construction = toConstruction(result.wellbore);
  const errorCount = result.errors.length;
  // Unsaved: the record as entered differs from the saved one, or typed text does not read. A
  // depth error alone in a stored row (an imported inverted interval) is not an edit.
  const dirty =
    result.errors.some((e) => e.kind === 'input') || !sameConstruction(toConstruction(result.record), baseline);

  // The stored record changed under the tab (it is re-read after every store change): a clean
  // working copy follows it; one with unsaved changes is kept and measured against the new record.
  const storedKey = constructionKey(stored);
  if (storedKey !== seenKey) {
    setSeenKey(storedKey);
    setBaseline(stored);
    if (!dirty) {
      setRows(rowsFromWellbore(stored));
      setStarted(stored !== null);
    }
  }

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Kept while it has changes, so leaving by Back does not lose it; cleared once it has none.
  useEffect(() => {
    if (dirty) saveUnsavedConstruction(well.id, rows);
    else clearUnsavedConstruction(well.id);
  }, [dirty, rows, well.id]);

  // A same-origin link that would leave this tab asks first (capture phase, before Next's Link
  // navigates). Modified clicks, new-tab and download links, and links that keep this tab pass.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return;
      if (link.target && link.target !== '_self') return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || isWellTabUrl(url, well.id, 'construction')) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, well.id]);

  // A reload or tab close cannot keep the working copy, so the browser asks first while it has changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = true; // older engines
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const drawing = useMemo(() => schematicInput(result.drawing, well.td_m), [result.drawing, well.td_m]);
  const forStats = useMemo(() => schematicInput(result.wellbore, well.td_m), [result.wellbore, well.td_m]);
  const highlightId = hoverId ?? focusId;
  const canDraw = typeof drawing?.td === 'number' && drawing.td > 0;

  const onParse = (text: string) => {
    const report = parseWellboreReport(text);
    setRows((r) => applyParsedToRows(r, { ...report.wellbore, sourceText: text }, well.td_m));
    setParsed(summariseReport(text, report));
    setStarted(true);
  };

  const onAdd = (list: ListKey) => {
    const added = addRow(rows, list);
    setRows(added.rows);
    setFocusRequest({ key: added.key, seq: (focusRequest?.seq ?? 0) + 1 });
  };

  /** A click on a drawn component focuses its row. */
  const onSelect = (id: string | null) => {
    const at = id ? rowForSvgId(id) : null;
    const row = at ? rows.lists[at.list][at.index] : undefined;
    if (row) setFocusRequest({ key: row.key, seq: (focusRequest?.seq ?? 0) + 1 });
  };

  /** A standalone file in the light palette, whatever the screen's theme. */
  const onExport = () => {
    const svg = drawing ? schematicExport(drawing, unit) : '';
    if (svg) download(svg, exportFilename(well.licence));
  };

  const discard = () => {
    clearUnsavedConstruction(well.id);
    setRows(rowsFromWellbore(baseline));
    setStarted(baseline !== null);
    setRestored(false);
    setParsed(null);
    setHoverId(null);
    setFocusId(null);
  };

  const save = async () => {
    if (busy || !dirty || errorCount > 0) return;
    setBusy(true);
    try {
      const saved = (await store.wells.update(well.id, { construction })).construction;
      setBaseline(saved);
      setSeenKey(constructionKey(saved));
      setRows(rowsFromWellbore(saved));
      setStarted(saved !== null);
      setRestored(false);
      clearUnsavedConstruction(well.id);
      toast.success('Construction saved');
    } catch (e) {
      toast.error(`The construction could not be saved: ${toError(e).message}`);
    } finally {
      setBusy(false);
    }
  };

  const leaveDialog = (
    <DiscardConstructionDialog
      open={leaveTo !== null}
      onKeep={() => setLeaveTo(null)}
      onDiscard={() => {
        const to = leaveTo;
        clearUnsavedConstruction(well.id); // discarded: not offered back on the next visit
        setLeaveTo(null);
        if (to) router.push(to);
      }}
    />
  );
  const dialogs = (
    <>
      <PasteReportDialog open={pasteOpen} onOpenChange={setPasteOpen} onParse={onParse} />
      {leaveDialog}
    </>
  );

  if (!started) {
    return (
      <>
        <EmptyState
          icon={LayersIcon}
          title="No construction records"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setPasteOpen(true)}>
                <ClipboardPasteIcon aria-hidden="true" />
                Paste report
              </Button>
              <Button variant="outline" onClick={() => setStarted(true)}>
                Add rows
              </Button>
            </div>
          }
        >
          Paste an abandonment or casing report to read its plugs, casings and perforations into rows, or add the rows
          by hand. The wellbore schematic is drawn from them.
        </EmptyState>
        {dialogs}
      </>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="min-w-0">
        <div className="grid gap-2.5 lg:sticky lg:top-4">
          <SchematicToolbar
            unit={unit}
            onUnitChange={setUnit}
            zoom={zoom}
            onZoomChange={setZoom}
            onExport={onExport}
            canExport={canDraw}
            printHref={wellReportHref(well.id)}
          />
          <Schematic
            wellbore={drawing}
            unit={unit}
            zoom={zoom}
            highlightId={highlightId}
            onHover={setHoverId}
            onSelect={onSelect}
            hint="Hover a component for its details; click it to edit its row."
            emptyMessageId={tdMessageId}
          />
          <StatsCard wellbore={forStats} unit={unit} />
        </div>
      </div>

      <div className="grid min-w-0 content-start gap-5">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">Construction record</h2>
              {dirty ? <StateBadge icon={CircleDotIcon}>Unsaved changes</StateBadge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setPasteOpen(true)}>
                <ClipboardPasteIcon aria-hidden="true" />
                Paste report
              </Button>
              <Button variant="outline" onClick={discard} disabled={!dirty || busy}>
                Discard changes
              </Button>
              <Button onClick={() => void save()} disabled={!dirty || errorCount > 0 || busy}>
                Save construction
              </Button>
            </div>
          </div>
          {errorCount > 0 ? (
            <p className="text-right text-xs text-danger">Fix {plural(errorCount, 'value')} before saving</p>
          ) : null}
        </div>
        {restored && dirty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-[13px] text-warn">
            <p className="flex items-center gap-2">
              <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
              <span>
                <span className="font-medium">Unsaved construction changes were restored</span>
                <span className="text-warn/90"> from your last visit to this tab. They are not saved yet.</span>
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={discard} disabled={busy}>
                Discard
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={errorCount > 0 || busy}>
                Save
              </Button>
            </div>
          </div>
        ) : null}
        {parsed ? <ParseResult summary={parsed} onDismiss={() => setParsed(null)} /> : null}
        <RowsTable
          rows={rows}
          errors={result.errors}
          warnings={result.warnings}
          fallbackTd={well.td_m}
          tdMessageId={canDraw ? undefined : tdMessageId}
          highlightId={highlightId}
          focusRequest={focusRequest}
          onHeader={(field, text) => setRows(setHeader(rows, field, text))}
          onValue={(list, key, field, text) => setRows(setValue(rows, list, key, field, text))}
          onAdd={onAdd}
          onRemove={(list, key) => setRows(removeRow(rows, list, key))}
          onSwap={(list, key, a, b) => setRows(swapValues(rows, list, key, a, b))}
          onHover={setHoverId}
          onFocusRow={setFocusId}
        />
      </div>
      {dialogs}
    </div>
  );
}
