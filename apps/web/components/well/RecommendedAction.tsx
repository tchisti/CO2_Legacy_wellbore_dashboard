// The recommended action of an assessment (spec §4.3): the reviewer's override when there is one,
// else the automatic text, labelled so a reader always knows which they are reading. The automatic
// text is the engine's (recommendationText): a title line, then paragraphs and "- " action lists.
// An override is the reviewer's own words and keeps its line breaks; the automatic text stays one
// click away beneath it, or (`foldAutomatic={false}`, the printed dossier) is shown beneath it.
// Long unbroken text (a pasted URL, a document number) wraps anywhere rather than overflowing.
import { useId } from 'react';
import type { Assessment } from '@lwa/engine';
import { actionText } from '@/lib/assessment-view';

function AutomaticText({ text, headingLevel }: { text: string; headingLevel: 'h3' | 'p' }) {
  const { title, blocks } = actionText(text);
  const Title = headingLevel;
  return (
    <div className="grid gap-2">
      {title ? <Title className="text-base font-semibold tracking-tight text-ink">{title}</Title> : null}
      {blocks.map((b, i) =>
        b.kind === 'paragraph' ? (
          <p key={i} className="max-w-[80ch] text-pretty wrap-anywhere">
            {b.text}
          </p>
        ) : (
          <ul key={i} className="grid max-w-[80ch] list-disc gap-1 pl-5 wrap-anywhere marker:text-muted-foreground">
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

export function RecommendedAction({
  action,
  foldAutomatic = true,
}: {
  action: Assessment['recommendedAction'];
  /** Under an override, the automatic text is folded into a disclosure; false shows it (print has no clicks). */
  foldAutomatic?: boolean;
}) {
  const headingId = useId();
  const override = action.override?.trim() ? action.override : null;
  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded-lg border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-xs font-medium text-muted-foreground">
          Recommended action
        </h2>
        <span
          data-source={override ? 'override' : 'automatic'}
          className="inline-flex h-5 items-center rounded-sm border border-line bg-subtle px-1.5 text-xs text-ink"
        >
          {override ? 'Reviewer override' : 'Automatic'}
        </span>
      </div>
      {override ? (
        <>
          <p data-override className="max-w-[80ch] whitespace-pre-line text-pretty wrap-anywhere text-ink">
            {override}
          </p>
          {action.auto && !foldAutomatic ? (
            <div data-automatic className="grid gap-1.5 border-l-2 pl-3 text-muted-foreground">
              <p className="text-xs">Automatic recommendation</p>
              <AutomaticText text={action.auto} headingLevel="p" />
            </div>
          ) : action.auto ? (
            <details className="group text-muted-foreground">
              <summary className="w-fit cursor-pointer rounded-sm text-xs outline-none select-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50">
                Automatic recommendation
              </summary>
              <div className="mt-2 border-l-2 pl-3">
                <AutomaticText text={action.auto} headingLevel="p" />
              </div>
            </details>
          ) : null}
        </>
      ) : action.auto ? (
        <AutomaticText text={action.auto} headingLevel="h3" />
      ) : (
        <p className="text-muted-foreground">No recommended action was recorded with this assessment.</p>
      )}
    </section>
  );
}
