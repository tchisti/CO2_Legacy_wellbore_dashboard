'use client';

// The well dossier (spec §4.3, §7): the printed record of one well's verdict and the evidence for
// it, in this order: header (who the well is, the verdict, the revision it was assessed under,
// reviewer and dates, the well record), summary, recommended action, score table, construction
// (the schematic in the light export palette with its statistics, and every stored row the depth
// rules leave out of the drawing, listed with why), notes, the methodology the assessment was made
// under, and the attribution line with the identity footnote. A draft is never printed as an
// assessment: one line says it exists. A well with no final prints its record and construction
// with "Not yet assessed" in place of the assessment.
import { useId, useMemo } from 'react';
import type { Methodology, Well } from '@lwa/engine';
import { drawingSize } from '@/components/construction/Schematic';
import { StatsCard } from '@/components/construction/StatsCard';
import { BandTable } from '@/components/methodology/BandTable';
import { ParamTable } from '@/components/methodology/ParamTable';
import { ReportFooter } from '@/components/report/ReportFooter';
import { ReportHeader, ReportSection, type MetaItem } from '@/components/report/ReportHeader';
import { AssessmentScores, CONTRIBUTION_CAPTION, RevisionNote } from '@/components/well/AssessmentView';
import { RecommendedAction } from '@/components/well/RecommendedAction';
import { VerdictFigures } from '@/components/well/WellHeader';
import { methodologyForRevision, scoreRows, type DisplayMethodology } from '@/lib/assessment-view';
import { savedConstruction, schematicExport } from '@/lib/construction-edit';
import { assessmentState } from '@/lib/derived';
import { MISSING, fmtCoord, fmtDate, fmtDepth } from '@/lib/format';
import type { WellData } from '@/lib/load-well';
import { dossierSummary, draftNote, reportAttribution } from '@/lib/report';
import { cn } from '@/lib/utils';

/**
 * The box the schematic is drawn for (Schematic's drawingSize): at this size its 11 px labels read
 * at about 8 pt on paper, and the drawing fits a page beside its statistics.
 */
const PRINT_BOX = { w: 420, h: 600 } as const;

/** Who the well is, as on the well page: status, type, trajectory, class, spud, TD, coordinates. */
function RecordFacts({ well, wellTypes }: { well: Well; wellTypes: Methodology['wellTypes'] }) {
  const classShort = wellTypes[well.classification]?.short;
  const coordinates = well.lat === null || well.lon === null ? MISSING : `${fmtCoord(well.lat)}, ${fmtCoord(well.lon)}`;
  const facts: readonly { key: string; label: string; value: string; detail?: string; mono?: boolean }[] = [
    { key: 'status', label: 'Status', value: well.status },
    { key: 'type', label: 'Type', value: well.type },
    { key: 'trajectory', label: 'Trajectory', value: well.trajectory },
    { key: 'class', label: 'Class', value: well.classification, detail: classShort },
    { key: 'spud', label: 'Spud', value: well.spudYear === null ? MISSING : String(well.spudYear), mono: true },
    { key: 'td', label: 'TD', value: fmtDepth(well.td_m, 'm'), mono: true },
    { key: 'coordinates', label: 'Coordinates', value: coordinates, mono: true },
  ];
  return (
    <dl aria-label="Well record" className="flex flex-wrap gap-x-8 gap-y-2.5 text-[13px]">
      {facts.map((f) => (
        <div key={f.key} data-fact={f.key} className={cn('min-w-0', f.detail && 'max-w-64')}>
          <dt className="text-xs text-muted-foreground">{f.label}</dt>
          <dd className={cn('text-ink', f.mono && 'num whitespace-nowrap')}>
            {f.value}
            {f.detail ? <span className="block text-xs text-muted-foreground">{f.detail}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The schematic and statistics of the stored construction record, in metres; the rows it cannot draw, listed. */
function Construction({ well }: { well: Well }) {
  const notDrawnId = useId();
  const model = useMemo(() => {
    if (!well.construction) return null;
    const { drawing, stats, notDrawn } = savedConstruction(well.construction, well.td_m);
    return {
      svg: drawing ? schematicExport(drawing, 'm', drawingSize(PRINT_BOX, drawing.td)) : '',
      stats,
      notDrawn,
    };
  }, [well.construction, well.td_m]);

  return (
    <ReportSection name="construction" title="Construction">
      {() =>
        model ? (
          <div className="grid break-inside-avoid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            {model.svg ? (
              <figure aria-label="Wellbore schematic" className="grid content-start justify-items-start gap-1.5">
                <div
                  className="overflow-hidden rounded-lg border [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-[820px] [&>svg]:w-auto [&>svg]:max-w-full"
                  // Safe to inject: renderWellboreSVG builds the markup from numbers and from text it
                  // escapes itself (every label, name and note goes through its `esc`), never raw input.
                  dangerouslySetInnerHTML={{ __html: model.svg }}
                />
                <figcaption className="text-xs text-muted-foreground">Wellbore schematic, depths in metres.</figcaption>
              </figure>
            ) : (
              <p className="max-w-64 rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                The schematic is not drawn: neither the construction record nor the well has a total depth.
              </p>
            )}
            <div className="grid min-w-0 content-start gap-4">
              <StatsCard wellbore={model.stats} unit="m" columns={1} />
              {model.notDrawn.length > 0 ? (
                <section aria-labelledby={notDrawnId} data-keep className="grid gap-1.5 rounded-lg border px-3 py-2.5">
                  <h3 id={notDrawnId} className="text-xs font-semibold tracking-wide text-ink uppercase">
                    Construction rows not drawn
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Stored rows whose depths cannot be drawn. They are left out of the schematic and the statistics until
                    they are corrected.
                  </p>
                  <ul className="grid gap-2 text-[13px]">
                    {model.notDrawn.map((r) => (
                      <li key={r.name} className="grid gap-0.5">
                        <span>
                          <span className="font-medium text-ink">{r.name}</span>: {r.reasons.join(' ')}
                        </span>
                        {r.depths ? <span className="num text-xs text-muted-foreground">{r.depths}</span> : null}
                        {r.verbatim ? (
                          <span className="text-xs break-words text-muted-foreground">Read from “{r.verbatim}”</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">No construction records</p>
        )
      }
    </ReportSection>
  );
}

/** The parameters and bands of the methodology the assessment is shown under (a new page in print). */
function MethodologyAppendix({ shown, assessedRevision }: { shown: DisplayMethodology; assessedRevision: string }) {
  const paramsId = useId();
  const bandsId = useId();
  const { methodology } = shown;
  return (
    <ReportSection
      name="methodology"
      title={`Methodology rev ${methodology.revision}`}
      subtitle={shown.exact ? 'The rulebook this assessment was scored against.' : undefined}
      className="space-y-4 print:break-before-page"
    >
      {() => (
        <>
          {shown.exact ? null : <RevisionNote assessed={assessedRevision} current={methodology.revision} />}
          <div className="space-y-2">
            <h3 id={paramsId} className="text-xs font-semibold tracking-wide text-ink uppercase">
              Scoring parameters
            </h3>
            <ParamTable methodology={methodology} labelledBy={paramsId} compact />
          </div>
          <div className="space-y-2" data-keep>
            <h3 id={bandsId} className="text-xs font-semibold tracking-wide text-ink uppercase">
              Rank bands
            </h3>
            <BandTable methodology={methodology} labelledBy={bandsId} />
          </div>
        </>
      )}
    </ReportSection>
  );
}

export function Dossier({ data, printedAt }: { data: WellData; printedAt: string }) {
  const { well, project, current, draft, records, methodology } = data;
  const state = assessmentState({ current, draft, well, currentRevision: methodology.revision });
  const shown = current ? methodologyForRevision(records, current.methodologyRevision, methodology) : null;
  const draftLine = draftNote(draft, current !== null);
  const draftParagraph = draftLine ? (
    <p data-note="draft" className="text-muted-foreground">
      {draftLine}
    </p>
  ) : null;

  const meta: MetaItem[] = [
    { key: 'revision', label: 'Methodology rev', value: current?.methodologyRevision ?? methodology.revision, mono: true },
    { key: 'reviewer', label: 'Reviewer', value: current?.reviewerName.trim() || MISSING },
    { key: 'assessed', label: 'Assessed', value: fmtDate(current?.assessedAt), mono: true },
    { key: 'printed', label: 'Printed', value: fmtDate(printedAt), mono: true },
  ];

  return (
    <>
      <ReportHeader
        project={project?.name}
        kind="Well dossier"
        title={well.licence}
        mono
        subtitle={
          well.name || well.operator ? (
            <>
              {well.name ? <span className="font-medium text-ink">{well.name}</span> : null}
              {well.name && well.operator ? <span className="text-muted-foreground"> · </span> : null}
              {well.operator ? <span className="text-muted-foreground">{well.operator}</span> : null}
            </>
          ) : null
        }
        verdict={
          current?.computed ? (
            <VerdictFigures computed={current.computed} />
          ) : (
            <p className="text-sm text-muted-foreground">Not yet assessed</p>
          )
        }
        meta={meta}
      >
        <RecordFacts well={well} wellTypes={methodology.wellTypes} />
      </ReportHeader>

      {current && shown ? (
        <>
          <ReportSection name="summary" title="Summary">
            {() => (
              <>
                <p className="max-w-[80ch] text-pretty">
                  {dossierSummary({
                    current,
                    rows: scoreRows(current, shown.methodology),
                    state,
                    currentRevision: methodology.revision,
                    well,
                  })}
                </p>
                {draftParagraph}
              </>
            )}
          </ReportSection>
          <div data-section="action" data-keep>
            <RecommendedAction action={current.recommendedAction} foldAutomatic={false} />
          </div>
          <ReportSection name="scores" title="Scores" subtitle={CONTRIBUTION_CAPTION}>
            {(headingId) => (
              <AssessmentScores
                assessment={current}
                methodologies={{ records, current: methodology }}
                labelledBy={headingId}
              />
            )}
          </ReportSection>
        </>
      ) : (
        <ReportSection name="assessment" title="Assessment">
          {() => (
            <>
              <p className="font-medium text-ink">Not yet assessed</p>
              <p className="max-w-[80ch] text-muted-foreground">
                No assessment of this well has been finalised, so it has no rank, scores or recommended action yet.
              </p>
              {draftParagraph}
            </>
          )}
        </ReportSection>
      )}

      <Construction well={well} />

      <ReportSection name="notes" title="Notes">
        {() => (
          <p data-notes className="max-w-[80ch] whitespace-pre-line text-pretty wrap-anywhere">
            {well.notes.trim() || MISSING}
          </p>
        )}
      </ReportSection>

      {current && shown ? <MethodologyAppendix shown={shown} assessedRevision={current.methodologyRevision} /> : null}

      <ReportFooter attribution={reportAttribution(current, printedAt)} />
    </>
  );
}
