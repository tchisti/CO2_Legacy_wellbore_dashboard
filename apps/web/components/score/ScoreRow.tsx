'use client';

// One parameter in the score flow (spec §4.4): its name and weight; the score as a radio group
// "? 1 2 3 4 5" (Unknown first, and a deliberate choice like any other); the methodology's anchor
// for the chosen value, always visible under the buttons; a derived suggestion beside the buttons
// while it differs from the choice; and the justification, required once the parameter has a score.
//
// Keyboard (spec §7): one tab stop per group (roving tabindex on the chosen option); with the group
// focused, 1–5 choose that score, ? chooses Unknown, arrow keys move through the options and choose
// them, as radios do; Tab moves on to the justification.
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CornerDownRightIcon } from 'lucide-react';
import { anchorText, type Param, type Score, type Suggestion } from '@lwa/engine';
import { SuggestionChip } from '@/components/score/SuggestionChip';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/** The options in display order: Unknown, then 1–5. */
const OPTIONS: readonly (Score | null)[] = [null, 1, 2, 3, 4, 5];

const DIGIT = /^[1-5]$/;

function ScoreButtons({
  param,
  value,
  onChange,
}: {
  param: Param;
  value: Score | null;
  onChange: (score: Score | null) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, OPTIONS.indexOf(value));

  const choose = (i: number) => {
    const option = OPTIONS[i];
    if (option === undefined) return;
    onChange(option);
    buttons.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let next: number | null = null;
    if (DIGIT.test(e.key)) next = Number(e.key);
    else if (e.key === '?') next = 0;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % OPTIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + OPTIONS.length) % OPTIONS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = OPTIONS.length - 1;
    if (next === null) return;
    e.preventDefault();
    choose(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label={`Score for ${param.name}`}
      onKeyDown={onKeyDown}
      className="flex shrink-0 gap-1"
    >
      {OPTIONS.map((option, i) => {
        const checked = i === index;
        return (
          <button
            key={option ?? 'unknown'}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option === null ? 'Unknown' : undefined}
            title={option === null ? anchorText(param, null) : `${option} — ${anchorText(param, option)}`}
            tabIndex={checked ? 0 : -1}
            data-value={option ?? 'unknown'}
            onClick={() => choose(i)}
            className={cn(
              'num relative inline-flex h-7 w-8 items-center justify-center rounded-sm border text-sm outline-none transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
              !checked && 'border-line-strong bg-surface text-ink hover:bg-accent',
              // Unknown chosen: a quiet grey, so scored rows (accent) stand out at a glance.
              checked && option === null && 'border-ink/50 bg-line font-semibold text-ink',
              checked && option !== null && 'border-primary bg-primary font-semibold text-primary-foreground',
            )}
          >
            {option ?? '?'}
          </button>
        );
      })}
    </div>
  );
}

export function ScoreRow({
  param,
  score,
  justification,
  suggestion,
  carried,
  info,
  onScore,
  onJustify,
  onApplySuggestion,
}: {
  param: Param;
  score: Score | null;
  /** As typed. */
  justification: string;
  /** Shown only when it differs from `score` (the caller decides; see visibleSuggestion). */
  suggestion: Suggestion | null;
  /** "carried from 2026-08-07" while a re-assessed row is unchanged; null otherwise. */
  carried: string | null;
  /** A fact that helps score this row (the plume row's nearest injector). */
  info?: ReactNode;
  onScore: (score: Score | null) => void;
  onJustify: (text: string) => void;
  onApplySuggestion: (suggestion: Suggestion) => void;
}) {
  const nameId = useId();
  const fieldId = useId();
  const required = score !== null;
  const missing = required && justification.trim() === '';

  return (
    <div
      role="group"
      aria-labelledby={nameId}
      data-param={param.key}
      data-axis={param.axis}
      className="grid gap-2 border-b py-3.5 last:border-b-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p id={nameId} className="font-medium text-ink">
            {param.name}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span>
              weight <span className="num">{param.weight.toFixed(2)}</span>
            </span>
            {carried ? (
              <span data-carried className="inline-flex items-center gap-1">
                <CornerDownRightIcon aria-hidden="true" className="size-3" />
                {carried}
              </span>
            ) : null}
          </p>
        </div>
        {/* The suggestion sits beside the buttons (spec §5.1), before them in tab order, so Tab
            from the buttons goes straight to the justification (spec §7). */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {suggestion ? <SuggestionChip suggestion={suggestion} onApply={onApplySuggestion} /> : null}
          <ScoreButtons param={param} value={score} onChange={onScore} />
        </div>
      </div>

      <p
        data-anchor
        className={cn(
          'border-l-2 pl-2.5 text-[13px] text-pretty',
          score === null ? 'border-line text-muted-foreground' : 'border-primary/60 text-ink',
        )}
      >
        {score === null ? (
          anchorText(param, null)
        ) : (
          <>
            <span className="num font-semibold">{score}</span>
            {' — '}
            {anchorText(param, score)}
          </>
        )}
      </p>

      {info ? <p className="text-xs text-muted-foreground">{info}</p> : null}

      <div className="grid gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={fieldId} className="text-xs text-muted-foreground">
            Justification<span className="sr-only"> for {param.name}</span>
          </label>
          {required ? (
            <span
              aria-hidden="true"
              data-required={missing ? 'missing' : 'met'}
              className={cn('text-xs', missing ? 'font-medium text-ink' : 'text-muted-foreground')}
            >
              required
            </span>
          ) : null}
        </div>
        <Textarea
          id={fieldId}
          value={justification}
          aria-required={required}
          onChange={(e) => onJustify(e.target.value)}
          rows={1}
          placeholder={required ? 'Why this score: the record, test or document it rests on' : undefined}
          className="min-h-9 py-1.5 text-[13px] md:text-[13px]"
        />
      </div>
    </div>
  );
}
