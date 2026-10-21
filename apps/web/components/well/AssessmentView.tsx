'use client';

// The Assessment tab (spec §4.3): the current final's recommended action first, then its score
// table, then the earlier finals, collapsed. A well with only a draft says who is drafting; an
// unscored well says so and offers the score flow. Anchors and weights come from the methodology
// revision the assessment was made under; when the project does not have that revision (a v1
// assessment under 1.0.0), the current one is used and the page says so.
import { useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRightIcon, ClipboardListIcon, PencilLineIcon } from 'lucide-react';
import type { Assessment, Methodology, MethodologyRecord } from '@lwa/engine';
import { RankBadge } from '@/components/domain/RankBadge';
import { EmptyState } from '@/components/shell/EmptyState';
import { Button } from '@/components/ui/button';
import { RecommendedAction } from '@/components/well/RecommendedAction';
import { ScoreTable } from '@/components/well/ScoreTable';
import { methodologyForRevision, priorFinals, scoreRows } from '@/lib/assessment-view';
import { fmt1, fmtDate, fmtDateTime } from '@/lib/format';
import { wellHref } from '@/lib/routes';
import { cn } from '@/lib/utils';

type Methodologies = { records: readonly MethodologyRecord[]; current: Methodology };

/** How the score table's last column is worked out (under the Scores heading, on screen and in print). */
export const CONTRIBUTION_CAPTION =
  "Contribution = weight × score; an unknown (?) counts at the parameter's unknown score.";

/** The note shown when an assessment's own revision is not in the project. */
export function RevisionNote({ assessed, current }: { assessed: string; current: string }) {
  return (
    <p role="note" className="text-xs text-muted-foreground">
      Anchors and weights shown from rev {current}; rev {assessed} is not available in this project.
    </p>
  );
}

/** One assessment's score table under the methodology it was assessed with (or the current one). */
export function AssessmentScores({
  assessment,
  methodologies,
  label,
  labelledBy,
}: {
  assessment: Assessment;
  methodologies: Methodologies;
  label?: string;
  labelledBy?: string;
}) {
  const shown = methodologyForRevision(methodologies.records, assessment.methodologyRevision, methodologies.current);
  return (
    <div className="grid gap-2">
      {shown.exact ? null : (
        <RevisionNote assessed={assessment.methodologyRevision} current={methodologies.current.revision} />
      )}
      <ScoreTable
        rows={scoreRows(assessment, shown.methodology)}
        recorded={assessment.computed}
        label={label}
        labelledBy={labelledBy}
      />
    </div>
  );
}

function PriorAssessment({ assessment, methodologies }: { assessment: Assessment; methodologies: Methodologies }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const c = assessment.computed;
  const date = fmtDate(assessment.assessedAt);
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-[13px] outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
        />
        <span className="num w-24 text-ink">{date}</span>
        <span className="min-w-32 text-ink">{assessment.reviewerName}</span>
        <span className="text-muted-foreground">
          rev <span className="num">{assessment.methodologyRevision}</span>
        </span>
        <RankBadge label={c?.rank ?? null} cell={c?.cell} />
        {c ? (
          <span className="num text-muted-foreground">
            L {fmt1(c.L)} × C {fmt1(c.C)}
          </span>
        ) : null}
      </button>
      <div id={panelId} hidden={!open} className="px-3 pt-1 pb-4">
        {open ? (
          <AssessmentScores assessment={assessment} methodologies={methodologies} label={`Scores assessed on ${date}`} />
        ) : null}
      </div>
    </li>
  );
}

function PriorAssessments({
  prior,
  methodologies,
}: {
  prior: readonly Assessment[];
  methodologies: Methodologies;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const title = `Prior assessments (${prior.length})`;
  if (prior.length === 0) {
    return (
      <section className="grid gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">This is the well&apos;s first final assessment.</p>
      </section>
    );
  }
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-sm outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')}
          />
          {title}
        </button>
      </h2>
      <ul id={listId} hidden={!open} aria-label="Prior assessments" className="rounded-lg border bg-surface">
        {prior.map((a) => (
          <PriorAssessment key={a.id} assessment={a} methodologies={methodologies} />
        ))}
      </ul>
    </section>
  );
}

export function AssessmentView({
  wellId,
  current,
  draft,
  assessments,
  methodologies,
}: {
  wellId: string;
  current: Assessment | null;
  draft: Assessment | null;
  /** Every assessment of the well (drafts included), as the store lists them. */
  assessments: readonly Assessment[];
  methodologies: Methodologies;
}) {
  const scoresHeading = useId();
  const scoreHref = wellHref(wellId, { score: true });

  if (!current) {
    if (draft) {
      return (
        <EmptyState
          icon={PencilLineIcon}
          title={`Draft in progress by ${draft.reviewerName}`}
          action={
            <Button asChild>
              <Link href={scoreHref} scroll={false}>
                Continue draft
              </Link>
            </Button>
          }
        >
          Last saved <span className="num">{fmtDateTime(draft.updatedAt)}</span>. The scores appear here once the
          draft is finalised.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        icon={ClipboardListIcon}
        title="Not yet assessed"
        action={
          <Button asChild>
            <Link href={scoreHref} scroll={false}>
              Score
            </Link>
          </Button>
        }
      >
        No assessment of this well has been finalised. Score it against methodology rev{' '}
        <span className="num">{methodologies.current.revision}</span>.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-8">
      <RecommendedAction action={current.recommendedAction} />
      <section aria-labelledby={scoresHeading} className="grid gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={scoresHeading} className="text-sm font-medium">
            Scores
          </h2>
          <p className="text-xs text-muted-foreground">{CONTRIBUTION_CAPTION}</p>
        </div>
        <AssessmentScores assessment={current} methodologies={methodologies} labelledBy={scoresHeading} />
      </section>
      <PriorAssessments prior={priorFinals(assessments, current.id)} methodologies={methodologies} />
    </div>
  );
}
