'use client';

// The score flow (spec §4.4, §5.1): the one place scoring happens, as a full-height panel over the
// well page (full width below 1280 px). The header names the well and revision and carries the
// live result; the body lists the Likelihood parameters, then Consequence, in methodology order,
// and ends with the recommended action and its override; the footer saves a draft or finalises.
//
// What the sheet starts from is fixed when it opens: a first assessment starts all Unknown; a
// draft is continued as saved; a re-assessment starts from the current final with every row
// "carried from <date>". Suggestions are derived once, from the record and the project's
// injectors, and saved with the draft; none is ever applied without a click.
//
// Closing (the X, Escape, the overlay) with unsaved changes saves the draft first. Finalise saves
// the draft and finalises it under the current methodology; it stays disabled while any scored
// parameter lacks a justification.
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
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
import { LiveResult } from '@/components/score/LiveResult';
import { OverrideField } from '@/components/score/OverrideField';
import { ScoreRow } from '@/components/score/ScoreRow';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fmtDate } from '@/lib/format';
import {
  carriedNote,
  initialScoreState,
  isDirty,
  liveComputed,
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

const AXES: readonly { axis: Axis; name: string }[] = [
  { axis: 'L', name: 'Likelihood' },
  { axis: 'C', name: 'Consequence' },
];

type Busy = 'save' | 'finalise' | 'close' | null;

/** "11 justifications missing", "1 justification missing". */
function missingText(n: number): string {
  return `${n} ${n === 1 ? 'justification' : 'justifications'} missing`;
}

function modeText(mode: ScoreMode, prev: Assessment | null, revision: string): string {
  if (mode === 'draft' && prev) return `Continuing the draft saved ${fmtDate(prev.updatedAt)}`;
  if (mode === 'reassess' && prev) {
    const under = prev.methodologyRevision === revision ? '' : ` (assessed under ${prev.methodologyRevision})`;
    return `Re-assessing the final of ${fmtDate(prev.assessedAt)}${under}`;
  }
  return 'First assessment';
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
  const finaliseHelpId = useId();
  const finaliseNamesId = useId();

  // Fixed when the sheet opens; later store changes (a saved draft) do not restart the flow.
  const [opening] = useState(() => {
    const mode: ScoreMode = draft ? 'draft' : current ? 'reassess' : 'new';
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

  const computed = liveComputed(state, methodology);
  const automatic = recommend(state.scores, methodology);
  const missing = missingJustifications(state);
  const nameOf = (key: ParamKey): string => methodology.params.find((p) => p.key === key)?.name ?? key;
  const blocked = missing.length > 0 || busy !== null;

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
    toast.success('Assessment finalised');
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
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none data-[side=right]:xl:w-[54rem]"
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
            <LiveResult computed={computed} className="pt-0.5" />
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 pb-6">
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

        <SheetFooter className="flex-row flex-wrap items-center justify-between gap-3 border-t bg-surface px-5 py-3">
          <Button variant="outline" onClick={() => void onSaveDraft()} disabled={busy !== null}>
            Save draft
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {missing.length > 0 ? (
              <>
                <p id={finaliseHelpId} className="text-xs text-muted-foreground">
                  {missingText(missing.length)}
                </p>
                <span id={finaliseNamesId} className="sr-only">
                  {`Justification missing for: ${missing.map(nameOf).join(', ')}`}
                </span>
              </>
            ) : null}
            <Tooltip open={tipOpen && missing.length > 0} onOpenChange={setTipOpen}>
              <TooltipTrigger asChild>
                <Button
                  aria-disabled={blocked}
                  aria-describedby={missing.length > 0 ? `${finaliseHelpId} ${finaliseNamesId}` : undefined}
                  onClick={() => void onFinalise()}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-primary aria-disabled:active:translate-y-0"
                >
                  Finalise assessment
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" className="max-w-sm">
                <div className="grid gap-1">
                  <p className="font-medium">Justification missing for:</p>
                  <ul className="grid list-disc gap-0.5 pl-4">
                    {missing.map((k) => (
                      <li key={k}>{nameOf(k)}</li>
                    ))}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
