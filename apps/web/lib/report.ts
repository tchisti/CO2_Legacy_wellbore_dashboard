// The print reports as text (spec §4.2, §4.3, §7): the well dossier's attribution line and summary,
// the line about a draft that is not printed, the portfolio report's description of its filter,
// the identity footnote both reports end with, and the running header the reports print in the
// page margins. Pure: the report pages load the records and render these.
import type { Assessment, Well } from '@lwa/engine';
import { revisionNote, type ScoreRow } from '@/lib/assessment-view';
import type { AssessmentState } from '@/lib/derived';
import { MISSING, fmt1, fmtDate, plural } from '@/lib/format';
import { STATE_LABELS, type Filters } from '@/lib/wells-view';

/** Every report ends with this: reviewer names are typed into a local profile, not signed in. */
export const IDENTITY_FOOTNOTE = 'Reviewer identity is recorded from a local profile and is not authenticated.';

/** The named page (app/report/report.css `@page report`) every report is printed on. */
export const REPORT_PAGE = 'report';

/**
 * The browser tab's title for a report, which "Save as PDF" proposes as the file name, so two
 * reports never save under the same name: "Well dossier 100/07-21-055-22W4/00 — <project>",
 * "Portfolio report — <project>" (the subject alone when there is no project name).
 */
export function reportDocumentTitle(subject: string, project: string | null | undefined): string {
  const name = project?.trim();
  return name ? `${subject} — ${name}` : subject;
}

/** A parameter scored this high or higher is a driver the dossier's summary names. */
export const DRIVER_SCORE_MIN = 4;

const nameOr = (name: string): string => name.trim() || MISSING;

/**
 * "Assessed by <reviewer> on <YYYY-MM-DD> · Methodology rev <x> · Printed <YYYY-MM-DD>", dates in
 * UTC like every date in the app; "Not yet assessed · Printed <YYYY-MM-DD>" without a final.
 */
export function reportAttribution(
  a: Pick<Assessment, 'reviewerName' | 'assessedAt' | 'methodologyRevision'> | null,
  printedAt: string,
): string {
  if (!a) return `Not yet assessed · Printed ${fmtDate(printedAt)}`;
  return `Assessed by ${nameOr(a.reviewerName)} on ${fmtDate(a.assessedAt)} · Methodology rev ${a.methodologyRevision} · Printed ${fmtDate(printedAt)}`;
}

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/**
 * The dossier's summary of a final assessment, in one paragraph: the rank and cell with L × C and
 * the Risk Index; the parameters scored 4 or higher (`rows` in table order, L then C); how many are
 * Unknown; and the states of spec §5.1 a reader must know: a stale or wording-only revision, and a
 * record changed after the assessment. `rows` are the assessment's score rows (scoreRows).
 */
export function dossierSummary({
  current,
  rows,
  state,
  currentRevision,
  well,
}: {
  current: Pick<Assessment, 'computed' | 'methodologyRevision' | 'assessedAt'>;
  rows: readonly ScoreRow[];
  state: Pick<AssessmentState, 'stale' | 'recordChanged'>;
  currentRevision: string;
  well: Pick<Well, 'updatedAt'>;
}): string {
  const c = current.computed;
  const parts: string[] = [];
  if (c) {
    parts.push(
      `Ranked ${c.rank}: cell ${c.cell} of the 5 × 5 matrix (L ${fmt1(c.L)} × C ${fmt1(c.C)}, Risk Index ${fmt1(c.riskIndex)}).`,
    );
  }
  const drivers = rows.filter((r) => r.score !== null && r.score >= DRIVER_SCORE_MIN);
  parts.push(
    drivers.length > 0
      ? `Scored ${DRIVER_SCORE_MIN} or higher: ${drivers.map((r) => `${r.name} (${r.score})`).join(', ')}.`
      : `No parameter scored ${DRIVER_SCORE_MIN} or higher.`,
  );
  const unknown = rows.filter((r) => r.score === null).length;
  if (unknown > 0) {
    parts.push(
      unknown === 1
        ? '1 parameter scored Unknown and counts at its unknown score.'
        : `${plural(unknown, 'parameter')} scored Unknown and count at their unknown scores.`,
    );
  }
  if (state.stale.stale) {
    parts.push(
      `Assessed under methodology rev ${current.methodologyRevision}; the current revision is ${currentRevision}, so this assessment is stale.`,
    );
  } else {
    const note = revisionNote(current.methodologyRevision, currentRevision, state.stale.delta);
    if (note) parts.push(sentence(note));
  }
  if (state.recordChanged) {
    parts.push(`The well record was changed on ${fmtDate(well.updatedAt)}, after this assessment.`);
  }
  return parts.join(' ');
}

/**
 * The one line a report prints about a draft (spec §5.1 "draft in progress"): a draft is never
 * printed as an assessment. Null when there is no draft.
 */
export function draftNote(draft: Pick<Assessment, 'reviewerName'> | null, hasFinal: boolean): string | null {
  if (!draft) return null;
  return `A draft ${hasFinal ? 're-assessment' : 'assessment'} by ${nameOr(draft.reviewerName)} is in progress and not included.`;
}

/**
 * The filter a portfolio report was printed with, in the Wells chips' words and order:
 * "Filter: Rank Low; Assessment Stale revision", or "All wells" when nothing is filtered.
 */
export function filterDescription(f: Filters): string {
  const parts: string[] = [];
  const text = f.text.trim();
  if (text) parts.push(`Search “${text}”`);
  const facet = (label: string, values: readonly string[]) => {
    if (values.length > 0) parts.push(`${label} ${values.join(', ')}`);
  };
  facet('Rank', f.rank);
  facet('Status', f.status);
  facet('Class', f.classification);
  facet('Assessment', f.state.map((s) => STATE_LABELS[s]));
  facet('Reviewer', f.reviewer);
  if (f.minUnknown !== undefined) parts.push(`Unknowns ≥ ${f.minUnknown}`);
  if (f.cell) parts.push(`Matrix cell L${f.cell.Lr} × C${f.cell.Cr}`);
  return parts.length > 0 ? `Filter: ${parts.join('; ')}` : 'All wells';
}

/* ---------- the running header, in the page margins ---------- */

const PLAIN = /^[A-Za-z0-9 ,.:_()/-]$/;

/**
 * `text` as a quoted CSS string. Every character but plain letters, digits and a little punctuation
 * is written as a hex escape, so project or well names can neither end the string nor the
 * <style> element it is written into.
 */
export function cssString(text: string): string {
  let out = '';
  for (const ch of text) out += PLAIN.test(ch) ? ch : `\\${(ch.codePointAt(0) ?? 0).toString(16)} `;
  return `"${out}"`;
}

/** The page-margin boxes a report fills with its own text (the page number box is report.css's). */
export type MarginBoxes = Partial<Record<'top-left' | 'top-right' | 'bottom-left', string>>;

/**
 * A stylesheet that writes `boxes` into the margins of the named report page, except the running
 * header (the top boxes) on page 1, which opens with the report's own header; the footer stays on
 * every page. The :first rule comes after the others: Chrome lets the later margin rule win here
 * whatever the page selectors' specificity, so it cannot sit in report.css (loaded earlier).
 */
export function pageMarginCss(boxes: MarginBoxes): string {
  const rules = (Object.keys(boxes) as (keyof MarginBoxes)[])
    .filter((box) => boxes[box])
    .map((box) => `@${box} { content: ${cssString(boxes[box] ?? '')}; }`);
  return (
    `@page ${REPORT_PAGE} { ${rules.join(' ')} } ` +
    `@page ${REPORT_PAGE}:first { @top-left { content: none; } @top-right { content: none; } }`
  );
}
