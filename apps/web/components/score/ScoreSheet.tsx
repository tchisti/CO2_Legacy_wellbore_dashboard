'use client';

// The score flow (spec §4.4, §5.1): the one place scoring happens, as a full-height panel over the
// well page (full width below 1280 px). The header names the well and revision and carries the
// live result; the body lists the Likelihood parameters, then Consequence, in methodology order,
// and ends with the recommended action and its override; the footer saves a draft or finalises.
//
// What the sheet starts from is fixed when it opens: a first assessment starts with nothing
// decided; a first assessment's draft is continued as saved (its Unknown rows undecided again); a
// re-assessment starts from the current final with every row decided and "carried from <date>",
// and a re-assessment's draft is continued as saved with every row decided. Suggestions are
// derived once, from the record and the project's injectors, and saved with the draft; none is
// ever applied without a click.
//
// Closing (the X, Escape, the overlay) with unsaved changes saves the draft first; so does leaving
// by the browser's Back button; a reload or tab close asks first (beforeunload). Finalise saves the
// draft and finalises it under the current methodology; it stays disabled until every parameter
// is decided (a score, or a deliberate Unknown) and every scored parameter has a justification.
// The first finalise of a browser session in a project also offers "Export a backup" in its
// success toast (spec §10; lib/backup-reminder.ts).
//
// "Show schematic" (spec §4.4: the schematic is viewable in a split pane while scoring) widens the
// sheet to the full viewport with the well's saved construction drawn, read-only and in metres,
// in a left column beside the rows (stacked above them below 1280 px). It is drawn as the dossier
// draws it (savedConstruction): a saved row the depth rules refuse is left out. A well with neither
// a construction record nor a TD has nothing to draw, so the toggle is unavailable and says why.
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LayersIcon } from 'lucide-react';
import {
  nearestInjector,
  paramsOf,
  recommend,
  suggest,
  type Assessment,
  type Axis,
  type Methodology,
  type ParamKey,
  type Project,
  type Well,
} from '@lwa/engine';
import { Schematic } from '@/components/construction/Schematic';
import { LiveResult } from '@/components/score/LiveResult';
import { OverrideField } from '@/components/score/OverrideField';
import { ScoreRow } from '@/components/score/ScoreRow';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toastFinalised } from '@/lib/backup-reminder';
import { savedConstruction } from '@/lib/construction-edit';
import { fmtDate } from '@/lib/format';
import {
  carriedNote,
  initialScoreState,
  isDirty,
  liveComputed,
  missingDecisions,
  missingJustifications,
  nearestInjectorLine,
  scoreReducer,
  toDraftInput,
  visibleSuggestion,
  type ScoreMode,
  type ScoreState,
} from '@/lib/score-flow';
import { toError, useStore } from '@/lib/store/provider';
import { FinaliseError } from '@/lib/store/store';
import { cn } from '@/lib/utils';

const AXES: readonly { axis: Axis; name: string }[] = [
  { axis: 'L', name: 'Likelihood' },
  { axis: 'C', name: 'Consequence' },
];

type Busy = 'save' | 'finalise' | 'close' | null;

/** "11 justifications missing", "1 justification missing". */
function missingText(n: number): string {
  return `${n} ${n === 1 ? 'justification' : 'justifications'} missing`;
}

/** "11 parameters not yet scored", "1 parameter not yet scored". */
function undecidedText(n: number): string {
  return `${n} ${n === 1 ? 'parameter' : 'parameters'} not yet scored`;
}

function modeText(mode: ScoreMode, prev: Assessment | null, revision: string): string {
  if (mode === 'draft' && prev) return `Continuing the draft saved ${fmtDate(prev.updatedAt)}`;
  if (mode === 'draft-reassess' && prev) return `Continuing the re-assessment draft saved ${fmtDate(prev.updatedAt)}`;
  if (mode === 'reassess' && prev) {
    const under = prev.methodologyRevision === revision ? '' : ` (assessed under ${prev.methodologyRevision})`;
    return `Re-assessing the final of ${fmtDate(prev.assessedAt)}${under}`;
  }
  return 'First assessment';
}

/** What the sheet focuses first: the first tab stop among the scoring rows. */
const FIRST_FOCUS =
  'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

/** Shows or hides the schematic pane; unavailable (still focusable, with the reason) when there is nothing to draw. */
function SchematicToggle({ pressed, available, onToggle }: { pressed: boolean; available: boolean; onToggle: () => void }) {
  const button = (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={available ? pressed : false}
      aria-disabled={available ? undefined : true}
      onClick={available ? onToggle : undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-pressed:border-primary/40 aria-pressed:bg-accent aria-disabled:active:translate-y-0"
    >
      <LayersIcon aria-hidden="true" />
      Show schematic
    </Button>
  );
  if (available) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">No construction records yet</TooltipContent>
    </Tooltip>
  );
}

export function ScoreSheet({
  well,
  project,
  methodology,
  current,
  draft,
  onClosed,
}: {
  well: Well;
  /** The well's project, for its injectors (the plume suggestion and the nearest injector). */
  project: Project | null;
  /** The current methodology: scores are shown, computed and finalised under it. */
  methodology: Methodology;
  current: Assessment | null;
  draft: Assessment | null;
  /** Called once the sheet has closed (after any save); the page drops `score=1` from the URL. */
  onClosed: () => void;
}) {
  const store = useStore();
  const sectionId = useId();
  const undecidedHelpId = useId();
  const finaliseHelpId = useId();
  const finaliseNamesId = useId();

  // Fixed when the sheet opens; later store changes (a saved draft) do not restart the flow.
  const [opening] = useState(() => {
    const mode: ScoreMode = draft ? (current ? 'draft-reassess' : 'draft') : current ? 'reassess' : 'new';
    const injectors = project?.injectors ?? [];
    const suggestions = suggest({
      classification: well.classification,
      spudYear: well.spudYear,
      trajectory: well.trajectory,
      casingCount: well.construction?.casings.length ?? null,
      lat: well.lat,
      lon: well.lon,
      injectors,
    });
    const prev = draft ?? current;
    return {
      mode,
      prev,
      suggestions,
      nearest: nearestInjectorLine(nearestInjector({ lat: well.lat, lon: well.lon, injectors })),
    };
  });
  const [state, dispatch] = useReducer(scoreReducer, opening, (o) =>
    initialScoreState(o.prev, o.suggestions, o.mode),
  );
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [showSchematic, setShowSchematic] = useState(false);
  const [schematicHover, setSchematicHover] = useState<string | null>(null);
  const drawing = useMemo(() => savedConstruction(well.construction, well.td_m).drawing, [well.construction, well.td_m]);
  const canShowSchematic = drawing !== null;
  /** The scoring rows: the sheet opens with focus on their first control, as before the header had a button. */
  const rowsRef = useRef<HTMLDivElement>(null);

  // Leaving without the close handler (the browser's Back button) must not lose the reviewer's
  // work either: on unmount, unsaved changes are saved as the draft. `settled` is set once a close
  // or finalise has dealt with them.
  const latest = useRef<ScoreState>(state);
  const settled = useRef(false);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  useEffect(() => {
    const last = latest;
    const done = settled;
    return () => {
      if (done.current || !isDirty(last.current)) return;
      store.assessments.saveDraft(well.id, toDraftInput(last.current)).then(
        () => toast.success('Draft saved'),
        (e: unknown) => toast.error(`The draft could not be saved: ${toError(e).message}`),
      );
    };
  }, [store, well.id]);

  // A reload or tab close cannot wait for a save, so the browser asks first while anything is unsaved.
  useEffect(() => {
    const last = latest;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty(last.current)) return;
      e.preventDefault();
      e.returnValue = true; // older engines
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const computed = liveComputed(state, methodology);
  const automatic = recommend(state.scores, methodology);
  const undecided = missingDecisions(state);
  const missing = missingJustifications(state);
  const nameOf = (key: ParamKey): string => methodology.params.find((p) => p.key === key)?.name ?? key;
  const reasons = undecided.length + missing.length > 0;
  const blocked = reasons || busy !== null;
  /** Why Finalise is blocked, in words: both lists, for the screen-reader description. */
  const blockedText = [
    undecided.length > 0 ? `Not yet scored: ${undecided.map(nameOf).join(', ')}.` : '',
    missing.length > 0 ? `Justification missing for: ${missing.map(nameOf).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const describedBy = [
    undecided.length > 0 ? undecidedHelpId : null,
    missing.length > 0 ? finaliseHelpId : null,
    reasons ? finaliseNamesId : null,
  ]
    .filter(Boolean)
    .join(' ');

  /** Saves what is entered as the well's draft; the reducer then treats it as saved. */
  const save = async (): Promise<Assessment> => {
    const input = toDraftInput(state);
    const saved = await store.assessments.saveDraft(well.id, input);
    dispatch({ type: 'saved', input });
    return saved;
  };

  const close = () => {
    settled.current = true;
    setOpen(false);
    onClosed();
  };

  const requestClose = async () => {
    if (busy !== null) return;
    if (!isDirty(state)) {
      close();
      return;
    }
    setBusy('close');
    settled.current = true; // this save covers an unmount that lands meanwhile
    try {
      await save();
    } catch (e) {
      settled.current = false;
      setBusy(null);
      toast.error(`The draft could not be saved: ${toError(e).message}`);
      return; // stay open: nothing entered is lost
    }
    toast.success('Draft saved');
    close();
  };

  const onSaveDraft = async () => {
    if (busy !== null) return;
    setBusy('save');
    try {
      await save();
      toast.success('Draft saved');
    } catch (e) {
      toast.error(`The draft could not be saved: ${toError(e).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onFinalise = async () => {
    if (blocked) return;
    setBusy('finalise');
    settled.current = true;
    try {
      const saved = await save();
      await store.assessments.finalise(saved.id);
    } catch (e) {
      settled.current = false;
      setBusy(null);
      if (e instanceof FinaliseError) {
        toast.error(`Justification required for: ${e.missing.map(nameOf).join(', ')}`);
      } else {
        toast.error(`The assessment could not be finalised: ${toError(e).message}`);
      }
      return;
    }
    toastFinalised(store, well.projectId);
    close();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose();
      }}
    >
      <SheetContent
        side="right"
        onOpenAutoFocus={(e) => {
          const first = rowsRef.current?.querySelector<HTMLElement>(FIRST_FOCUS);
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
        className={cn(
          'gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none',
          !showSchematic && 'data-[side=right]:xl:w-[54rem]',
        )}
      >
        <SheetHeader className="gap-2 border-b px-5 py-4 pr-14">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="grid min-w-0 gap-0.5">
              <SheetTitle className="text-base font-semibold tracking-tight text-ink">
                Score <span className="num break-all">{well.licence}</span>
              </SheetTitle>
              <SheetDescription className="text-xs">
                {well.name ? `${well.name} · ` : ''}
                rev <span className="num">{methodology.revision}</span> ·{' '}
                {modeText(opening.mode, opening.prev, methodology.revision)}
              </SheetDescription>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LiveResult computed={computed} className="pt-0.5" />
              <SchematicToggle
                pressed={showSchematic}
                available={canShowSchematic}
                onToggle={() => setShowSchematic((v) => !v)}
              />
            </div>
          </div>
        </SheetHeader>

        <div
          className={cn(
            'flex-1 overflow-y-auto',
            showSchematic && 'xl:grid xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:overflow-hidden',
          )}
        >
          {showSchematic ? (
            <div className="border-b px-5 py-4 xl:overflow-y-auto xl:border-r xl:border-b-0">
              <Schematic
                wellbore={drawing}
                unit="m"
                size="sheet"
                highlightId={schematicHover}
                onHover={setSchematicHover}
                hint="The saved construction, read-only. Edit it on the Construction tab."
              />
            </div>
          ) : null}
          <div ref={rowsRef} className={cn('px-5 pb-6', showSchematic && 'xl:overflow-y-auto')}>
            {AXES.map(({ axis, name }) => {
              const headingId = `${sectionId}-${axis}`;
              return (
                <section key={axis} aria-labelledby={headingId} className="pt-5">
                  <h3
                    id={headingId}
                    className="border-b pb-1.5 text-xs font-semibold tracking-wide text-ink uppercase"
                  >
                    {name} <span className="font-normal text-muted-foreground normal-case">({axis})</span>
                  </h3>
                  {paramsOf(methodology, axis).map((p) => (
                    <ScoreRow
                      key={p.key}
                      param={p}
                      score={state.scores[p.key]}
                      decided={state.decided.has(p.key)}
                      justification={state.justifications[p.key] ?? ''}
                      suggestion={visibleSuggestion(state, p.key)}
                      carried={carriedNote(state, p.key)}
                      info={p.key === 'plume' ? opening.nearest : undefined}
                      onScore={(score) => dispatch({ type: 'set', key: p.key, score })}
                      onJustify={(text) => dispatch({ type: 'justify', key: p.key, text })}
                      onApplySuggestion={(suggestion) => dispatch({ type: 'applySuggestion', key: p.key, suggestion })}
                    />
                  ))}
                </section>
              );
            })}
            <div className="pt-5">
              <OverrideField
                autoTitle={automatic.title}
                value={state.override}
                onChange={(text) => dispatch({ type: 'override', text })}
              />
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row flex-wrap items-center justify-between gap-3 border-t bg-surface px-5 py-3">
          <Button variant="outline" onClick={() => void onSaveDraft()} disabled={busy !== null}>
            Save draft
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {undecided.length > 0 ? (
              <p id={undecidedHelpId} className="text-xs text-muted-foreground">
                {undecidedText(undecided.length)}
              </p>
            ) : null}
            {missing.length > 0 ? (
              <p id={finaliseHelpId} className="text-xs text-muted-foreground">
                {missingText(missing.length)}
              </p>
            ) : null}
            {reasons ? (
              <span id={finaliseNamesId} className="sr-only">
                {blockedText}
              </span>
            ) : null}
            <Tooltip open={tipOpen && reasons} onOpenChange={setTipOpen}>
              <TooltipTrigger asChild>
                <Button
                  aria-disabled={blocked}
                  aria-describedby={describedBy || undefined}
                  onClick={() => void onFinalise()}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary aria-disabled:active:translate-y-0"
                >
                  Finalise assessment
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" className="max-w-sm">
                <div className="grid gap-2">
                  {undecided.length > 0 ? (
                    <div className="grid gap-1">
                      <p className="font-medium">Not yet scored (choose a score or ?):</p>
                      <ul className="grid list-disc gap-0.5 pl-4">
                        {undecided.map((k) => (
                          <li key={k}>{nameOf(k)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {missing.length > 0 ? (
                    <div className="grid gap-1">
                      <p className="font-medium">Justification missing for:</p>
                      <ul className="grid list-disc gap-0.5 pl-4">
                        {missing.map((k) => (
                          <li key={k}>{nameOf(k)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
