'use client';

// The Construction tab (spec §4.3; schematic spec 2026-08-07 §5–§8): the wellbore schematic with
// its toolbar and statistics on the left, the construction rows editor on the right (stacked
// under 1024 px). The tab edits a working copy of the well's construction record: pasting a report
// or editing rows changes only the copy, the schematic and statistics draw the copy as it stands,
// "Save construction" writes it with one audited update, and "Discard changes" goes back to the
// stored record. While the copy has unsaved changes the page asks before a reload or tab close
// (beforeunload) and before another tab of the well page (DiscardConstructionDialog, wired by the
// page through onDirtyChange). The schematic draws with the record's TD, else the well's.
import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CircleDotIcon, ClipboardPasteIcon, LayersIcon, XIcon } from 'lucide-react';
import { parseWellboreReport, renderWellboreSVG, type DepthUnit, type Well, type Wellbore } from '@lwa/engine';
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
  safeColour,
  sameConstruction,
  schematicInput,
  setHeader,
  setValue,
  standaloneSvg,
  summariseReport,
  toConstruction,
  wellboreFromRows,
  type ConstructionRows,
  type ListKey,
  type ReportSummary,
} from '@/lib/construction-edit';
import { plural } from '@/lib/format';
import { wellReportHref } from '@/lib/routes';
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

/** The current theme's colours for a standalone SVG (no CSS variables left in the file). */
function resolvedColours(): { colours: { line: string; muted: string; ink: string }; background: string } {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => safeColour(style.getPropertyValue(name), fallback);
  return {
    colours: { line: read('--line', '#e1e5ea'), muted: read('--muted', '#5d6773'), ink: read('--ink', '#15191e') },
    background: read('--surface', '#ffffff'),
  };
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
  const tdMessageId = useId();
  const stored = well.construction;

  const [rows, setRows] = useState<ConstructionRows>(() => rowsFromWellbore(stored));
  /** The record the working copy is measured against: as stored, or as just saved. */
  const [baseline, setBaseline] = useState<Wellbore | null>(stored);
  const [seenKey, setSeenKey] = useState(() => constructionKey(stored));
  /** The editor shows once there is a record, or once the reviewer starts one. */
  const [started, setStarted] = useState(stored !== null);
  const [unit, setUnit] = useState<DepthUnit>('m');
  const [zoom, setZoom] = useState<Zoom>(1);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [parsed, setParsed] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => wellboreFromRows(rows), [rows]);
  const construction = toConstruction(result.wellbore);
  const errorCount = result.errors.length;
  const dirty = errorCount > 0 || !sameConstruction(construction, baseline);

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

  const onExport = () => {
    if (!drawing) return;
    const { colours, background } = resolvedColours();
    const svg = renderWellboreSVG(drawing, { unit, resolvedColors: colours });
    if (svg) download(standaloneSvg(svg, background), exportFilename(well.licence));
  };

  const discard = () => {
    setRows(rowsFromWellbore(baseline));
    setStarted(baseline !== null);
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
      toast.success('Construction saved');
    } catch (e) {
      toast.error(`The construction could not be saved: ${toError(e).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pasteDialog = <PasteReportDialog open={pasteOpen} onOpenChange={setPasteOpen} onParse={onParse} />;

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
        {pasteDialog}
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
        {parsed ? <ParseResult summary={parsed} onDismiss={() => setParsed(null)} /> : null}
        <RowsTable
          rows={rows}
          errors={result.errors}
          fallbackTd={well.td_m}
          tdMessageId={canDraw ? undefined : tdMessageId}
          highlightId={highlightId}
          focusRequest={focusRequest}
          onHeader={(field, text) => setRows(setHeader(rows, field, text))}
          onValue={(list, key, field, text) => setRows(setValue(rows, list, key, field, text))}
          onAdd={onAdd}
          onRemove={(list, key) => setRows(removeRow(rows, list, key))}
          onHover={setHoverId}
          onFocusRow={setFocusId}
        />
      </div>
      {pasteDialog}
    </div>
  );
}
