import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METHODOLOGY, ProjectExportSchema, type Assessment, type Scores } from '@lwa/engine';
import { scoreRows } from '@/lib/assessment-view';
import { assessmentState } from '@/lib/derived';
import {
  IDENTITY_FOOTNOTE,
  cssString,
  dossierSummary,
  draftNote,
  filterDescription,
  pageMarginCss,
  reportAttribution,
  reportDocumentTitle,
} from '@/lib/report';
import { EMPTY_FILTERS } from '@/lib/wells-view';

const FIXTURE = ProjectExportSchema.parse(
  JSON.parse(readFileSync(join(__dirname, '..', 'e2e', 'fixtures', 'fort-sask.project.json'), 'utf8')),
);
const FT_SASK_ID = 'wel_v2_W-4A62O7';
const REDWATER_ID = 'wel_v2_W-LX242Q';
const wellOf = (id: string) => FIXTURE.wells.find((w) => w.id === id)!;
const finalOf = (id: string) => FIXTURE.assessments.find((a) => a.wellId === id && a.status === 'final')!;

/** The summary of a fixture well's final, as the dossier builds it (current revision 2.0.0 unless given). */
function summaryOf(id: string, opts: { current?: Assessment; currentRevision?: string; wellUpdatedAt?: string } = {}) {
  const current = opts.current ?? finalOf(id);
  const well = { ...wellOf(id), ...(opts.wellUpdatedAt ? { updatedAt: opts.wellUpdatedAt } : {}) };
  const currentRevision = opts.currentRevision ?? '2.0.0';
  const state = assessmentState({ current, draft: null, well, currentRevision });
  return dossierSummary({ current, rows: scoreRows(current, DEFAULT_METHODOLOGY), state, currentRevision, well });
}

describe('reportAttribution', () => {
  it('reads "Assessed by <reviewer> on <date> · Methodology rev <x> · Printed <date>" (UTC dates)', () => {
    expect(reportAttribution(finalOf(FT_SASK_ID), '2026-10-21T09:30:00.000Z')).toBe(
      'Assessed by Tahir Chisti on 2026-08-07 · Methodology rev 2.0.0 · Printed 2026-10-21',
    );
  });

  it('without a final reads "Not yet assessed · Printed <date>"', () => {
    expect(reportAttribution(null, '2026-10-21T09:30:00.000Z')).toBe('Not yet assessed · Printed 2026-10-21');
  });

  it('shows a blank reviewer as a dash, never as an empty name', () => {
    const a = { ...finalOf(FT_SASK_ID), reviewerName: '  ' };
    expect(reportAttribution(a, '2026-10-21T09:30:00.000Z')).toBe(
      'Assessed by — on 2026-08-07 · Methodology rev 2.0.0 · Printed 2026-10-21',
    );
  });
});

describe('IDENTITY_FOOTNOTE', () => {
  it('says the reviewer identity is not authenticated, with no phase wording', () => {
    expect(IDENTITY_FOOTNOTE).toBe('Reviewer identity is recorded from a local profile and is not authenticated.');
    expect(IDENTITY_FOOTNOTE).not.toMatch(/phase/i);
  });
});

describe('dossierSummary', () => {
  it('states rank, cell, L × C, index and the parameters scored 4 or higher, in table order', () => {
    expect(summaryOf(FT_SASK_ID)).toBe(
      'Ranked Moderate: cell 6 of the 5 × 5 matrix (L 1.8 × C 2.6, Risk Index 4.6). Scored 4 or higher: ' +
        'Well Age & Regulatory Era (4), Wellbore Complexity & Condition (4), Penetration vs Storage Complex (4).',
    );
  });

  it('says so when no parameter scored 4 or higher, and counts the Unknowns', () => {
    const low: Scores = { ...finalOf(REDWATER_ID).scores };
    const current = { ...finalOf(REDWATER_ID), scores: low };
    const text = summaryOf(REDWATER_ID, { current, currentRevision: '1.0.0' });
    expect(text).toContain('No parameter scored 4 or higher.');
    expect(text).toContain('3 parameters scored Unknown and count at their unknown scores.');
    expect(text).not.toContain('stale');
  });

  it('uses the singular for one Unknown', () => {
    const current = { ...finalOf(FT_SASK_ID), scores: { ...finalOf(FT_SASK_ID).scores, scvf: null } };
    expect(summaryOf(FT_SASK_ID, { current })).toContain('1 parameter scored Unknown and counts at its unknown score.');
  });

  it('notes a stale revision: assessed under an earlier major or minor revision', () => {
    expect(summaryOf(REDWATER_ID)).toContain(
      'Assessed under methodology rev 1.0.0; the current revision is 2.0.0, so this assessment is stale.',
    );
  });

  it('notes a wording-only revision without calling it stale', () => {
    const text = summaryOf(FT_SASK_ID, { currentRevision: '2.0.1' });
    expect(text).toContain('Assessed under 2.0.0 (current 2.0.1, wording only).');
    expect(text).not.toContain('stale');
  });

  it('notes a record changed after the assessment, with the date of the change', () => {
    expect(summaryOf(FT_SASK_ID, { wellUpdatedAt: '2026-10-20T12:00:00.000Z' })).toContain(
      'The well record was changed on 2026-10-20, after this assessment.',
    );
    expect(summaryOf(FT_SASK_ID)).not.toContain('record was changed');
  });
});

describe('draftNote', () => {
  it('says a draft re-assessment is in progress and not included', () => {
    expect(draftNote({ reviewerName: 'J. Doe' }, true)).toBe(
      'A draft re-assessment by J. Doe is in progress and not included.',
    );
  });

  it('calls a draft of a well with no final a draft assessment', () => {
    expect(draftNote({ reviewerName: 'J. Doe' }, false)).toBe('A draft assessment by J. Doe is in progress and not included.');
  });

  it('is null without a draft', () => {
    expect(draftNote(null, true)).toBeNull();
  });
});

describe('filterDescription', () => {
  it('is "All wells" with no filter', () => {
    expect(filterDescription(EMPTY_FILTERS)).toBe('All wells');
  });

  it('names each filter as its chip does, in chip order, separated by semicolons', () => {
    expect(filterDescription({ ...EMPTY_FILTERS, rank: ['Low'], state: ['stale'] })).toBe(
      'Filter: Rank Low; Assessment Stale revision',
    );
    expect(
      filterDescription({
        text: ' redwater ',
        rank: ['Low', 'Moderate'],
        status: ['Abandoned (P&A)'],
        classification: ['Type 3'],
        state: ['unscored', 'draft'],
        reviewer: ['T. Chisti'],
        minUnknown: 4,
        cell: { Lr: 2, Cr: 3 },
      }),
    ).toBe(
      'Filter: Search “redwater”; Rank Low, Moderate; Status Abandoned (P&A); Class Type 3; Assessment Unscored, Draft; ' +
        'Reviewer T. Chisti; Unknowns ≥ 4; Matrix cell L2 × C3',
    );
  });
});

describe('reportDocumentTitle', () => {
  it('names the report and its project, so each saves as its own PDF', () => {
    expect(reportDocumentTitle('Well dossier 100/07-21-055-22W4/00', 'Fort Saskatchewan / Wabamun Hub AOR')).toBe(
      'Well dossier 100/07-21-055-22W4/00 — Fort Saskatchewan / Wabamun Hub AOR',
    );
    expect(reportDocumentTitle('Portfolio report', ' Redwater AOR ')).toBe('Portfolio report — Redwater AOR');
  });

  it('is the subject alone without a project name', () => {
    expect(reportDocumentTitle('Portfolio report', '')).toBe('Portfolio report');
    expect(reportDocumentTitle('Well dossier X', null)).toBe('Well dossier X');
    expect(reportDocumentTitle('Well dossier X', undefined)).toBe('Well dossier X');
  });
});

describe('page margin boxes', () => {
  it('cssString escapes everything but plain text, so data cannot end the string or the style element', () => {
    expect(cssString('Fort Saskatchewan / Wabamun Hub AOR')).toBe('"Fort Saskatchewan / Wabamun Hub AOR"');
    expect(cssString('a"b\\c')).toBe('"a\\22 b\\5c c"');
    expect(cssString('</style><script>')).toBe('"\\3c /style\\3e \\3c script\\3e "');
    expect(cssString('line\nbreak · ×')).toBe('"line\\a break \\b7  \\d7 "');
  });

  it('pageMarginCss fills the named report page’s margin boxes, then leaves the running header off page 1', () => {
    const css = pageMarginCss({ 'top-left': 'Fort Sask AOR', 'top-right': 'Well dossier' });
    expect(css).toBe(
      '@page report { @top-left { content: "Fort Sask AOR"; } @top-right { content: "Well dossier"; } } ' +
        '@page report:first { @top-left { content: none; } @top-right { content: none; } }',
    );
  });
});

describe('app/report/report.css', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', 'app', ...file.split('/')), 'utf8');
  /** The custom properties declared in the block that opens with `selector {`. */
  function tokens(css: string, selector: string): Record<string, string> {
    const start = css.indexOf(`${selector} {`);
    expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    return Object.fromEntries([...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  }

  it('forces the light value of every token the dark theme changes, so a report never prints dark', () => {
    const globals = read('globals.css');
    const light = tokens(globals, ':root');
    const dark = tokens(globals, '[data-theme="dark"]');
    const report = tokens(read('report/report.css'), 'html:has(.report-root)');
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    for (const name of Object.keys(dark)) expect(report[name], name).toBe(light[name]);
  });

  it('prints on letter with 18 mm margins and numbered pages, on the named report page only', () => {
    const css = read('report/report.css');
    expect(css).toMatch(/@page report \{[^}]*size: letter;/);
    expect(css).toMatch(/@page report \{[^}]*margin: 18mm;/);
    expect(css).toContain('content: "Page " counter(page) " of " counter(pages);');
    expect(css).not.toMatch(/@page\s*\{/); // never an unnamed @page: the file stays loaded after leaving a report
  });
});
