'use client';

// The well page header (spec §4.3): who the well is on the left (licence, name, operator, status,
// type, class, spud year, coordinates); the verdict on the right (rank, L × C, cell, Risk Index,
// who assessed it under which revision and when, and the derived states of §5.1), with the
// actions: Score / Re-assess / Continue draft (the score flow, `?score=1`), Edit record, Report.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { FilePenLineIcon, FileTextIcon, HistoryIcon, PencilLineIcon, type LucideIcon } from 'lucide-react';
import type { Assessment, Methodology, Well } from '@lwa/engine';
import { RankBadge } from '@/components/domain/RankBadge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { attribution } from '@/lib/assessment-view';
import type { AssessmentState } from '@/lib/derived';
import { MISSING, fmt1, fmtCoord, fmtDate } from '@/lib/format';
import { wellHref, wellReportHref } from '@/lib/routes';
import { cn } from '@/lib/utils';

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

const Missing = () => <span className="text-muted-foreground">{MISSING}</span>;

/** A derived state (§5.1) as a quiet badge with an icon; the tooltip says why. Focusable, so the reason reaches the keyboard. */
function StateBadge({ icon: Icon, label, reason }: { icon: LucideIcon; label: string; reason?: string }) {
  const badge = (
    <span
      tabIndex={reason ? 0 : undefined}
      className="inline-flex h-5 items-center gap-1 rounded-sm border border-line bg-subtle px-1.5 text-xs whitespace-nowrap text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Icon aria-hidden="true" className="size-3 text-muted-foreground" />
      {label}
    </span>
  );
  if (!reason) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="bottom">{reason}</TooltipContent>
    </Tooltip>
  );
}

export function WellHeader({
  well,
  current,
  draft,
  state,
  currentRevision,
  wellTypes,
  projectName,
  onEdit,
}: {
  well: Well;
  /** The current final, or null. */
  current: Assessment | null;
  draft: Assessment | null;
  state: AssessmentState;
  currentRevision: string;
  /** Classification descriptions, from the current methodology. */
  wellTypes: Methodology['wellTypes'];
  projectName?: string | null;
  onEdit: () => void;
}) {
  const computed = current?.computed ?? null;
  const classShort = wellTypes[well.classification]?.short;
  const coordinates =
    well.lat === null || well.lon === null ? null : `${fmtCoord(well.lat)}, ${fmtCoord(well.lon)}`;
  const primary = draft ? 'Continue draft' : current ? 'Re-assess' : 'Score';

  return (
    <section aria-label="Well summary" className="grid gap-x-10 gap-y-5 border-b pb-6 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="grid min-w-0 content-start gap-4">
        <div className="min-w-0">
          {projectName ? <p className="truncate text-xs text-muted-foreground">{projectName}</p> : null}
          <h1 className="font-mono text-xl font-semibold tracking-tight break-all text-ink">{well.licence}</h1>
          {well.name || well.operator ? (
            <p className="mt-0.5 text-sm">
              {well.name ? <span className="font-medium text-ink">{well.name}</span> : null}
              {well.name && well.operator ? <span className="text-muted-foreground"> · </span> : null}
              {well.operator ? <span className="text-muted-foreground">{well.operator}</span> : null}
            </p>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-10">
          <Fact label="Status">{well.status}</Fact>
          <Fact label="Type">{well.type}</Fact>
          <Fact label="Class" className="sm:max-w-64">
            {well.classification}
            {classShort ? <span className="block text-xs text-muted-foreground">{classShort}</span> : null}
          </Fact>
          <Fact label="Spud">{well.spudYear === null ? <Missing /> : <span className="num">{well.spudYear}</span>}</Fact>
          <Fact label="Coordinates" className="col-span-2 sm:col-span-1">
            {coordinates === null ? <Missing /> : <span className="num whitespace-nowrap">{coordinates}</span>}
          </Fact>
        </dl>
      </div>

      <div className="grid content-start gap-3 lg:justify-items-end">
        <div role="group" aria-label="Verdict" className="grid gap-1.5 lg:justify-items-end lg:text-right">
          {computed ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:justify-end">
                <RankBadge label={computed.rank} cell={computed.cell} className="h-6 px-2 text-sm" />
                <span className="num text-sm whitespace-nowrap text-ink">
                  L {fmt1(computed.L)} × C {fmt1(computed.C)}
                </span>
                {/* Each separator travels with the figure after it, so a wrapped line never ends on a dot. */}
                <span className="inline-flex items-center gap-3">
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span className="num text-sm whitespace-nowrap text-ink">Cell {computed.cell}</span>
                </span>
                <span className="inline-flex items-center gap-3">
                  <span aria-hidden="true" className="text-line-strong">
                    ·
                  </span>
                  <span className="num text-sm whitespace-nowrap text-ink">Index {fmt1(computed.riskIndex)}</span>
                </span>
              </div>
              {current ? <p className="text-xs text-muted-foreground">{attribution(current)}</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Not yet assessed</p>
          )}
          {state.stale.stale || state.recordChanged || draft ? (
            <div className="flex flex-wrap gap-1.5 lg:justify-end">
              {current && state.stale.stale ? (
                <StateBadge
                  icon={HistoryIcon}
                  label="Stale revision"
                  reason={`Assessed under ${current.methodologyRevision}; current ${currentRevision}`}
                />
              ) : null}
              {current && state.recordChanged ? (
                <StateBadge
                  icon={FilePenLineIcon}
                  label="Record changed since assessment"
                  reason={`The record was edited on ${fmtDate(well.updatedAt)}, after the assessment of ${fmtDate(current.assessedAt)}.`}
                />
              ) : null}
              {draft ? <StateBadge icon={PencilLineIcon} label={state.label} /> : null}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button asChild>
            <Link href={wellHref(well.id, { score: true })} scroll={false}>
              {primary}
            </Link>
          </Button>
          <Button variant="outline" onClick={onEdit}>
            <PencilLineIcon aria-hidden="true" />
            Edit record
          </Button>
          <Button asChild variant="outline">
            <Link href={wellReportHref(well.id)} prefetch={false}>
              <FileTextIcon aria-hidden="true" />
              Report
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
