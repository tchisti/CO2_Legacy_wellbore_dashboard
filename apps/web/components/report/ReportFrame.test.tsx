import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectReadError, ReportFrame, ReportMessage, ReportStatus } from '@/components/report/ReportFrame';
import { LOG_PREFIX } from '@/lib/log';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('report error states', () => {
  it('ProjectReadError shows the error with the way back and reports it through the logging hook', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('The database connection was closed');
    render(<ProjectReadError error={error} backHref="/wells" />);
    expect(screen.getByRole('heading', { name: 'The project could not be read' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Wells' }).getAttribute('href')).toBe('/wells');
    expect(spy).toHaveBeenCalledWith(`${LOG_PREFIX} Error: The database connection was closed`, { where: 'report', stack: error.stack });
  });

  it('a report message that is not about an error logs nothing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ReportMessage title="Well not found" action={<a href="/wells">Back to Wells</a>}>
        No well with this link is stored in this browser.
      </ReportMessage>,
    );
    expect(screen.getByRole('heading', { name: 'Well not found' })).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('report frame', () => {
  const frame = (documentTitle: string) => (
    <ReportFrame
      title="Well dossier 100/07-21-055-22W4/00"
      documentTitle={documentTitle}
      back={{ href: '/wells/view?id=w1', label: 'well' }}
      margins={{ 'top-left': 'Fort Sask AOR' }}
    >
      <h1>100/07-21-055-22W4/00</h1>
    </ReportFrame>
  );

  it('puts the toolbar and the report in the main landmark', () => {
    render(frame('Well dossier 100/07-21-055-22W4/00 — Fort Sask AOR'));
    const main = screen.getByRole('main');
    expect(main.contains(screen.getByRole('group', { name: 'Report actions' }))).toBe(true);
    expect(main.contains(screen.getByRole('article', { name: 'Well dossier 100/07-21-055-22W4/00' }))).toBe(true);
  });

  it('titles the browser tab after the report while it is open, and puts the old title back after', () => {
    document.title = 'Legacy Well Assessment';
    const { rerender, unmount } = render(frame('Well dossier 100/07-21-055-22W4/00 — Fort Sask AOR'));
    expect(document.title).toBe('Well dossier 100/07-21-055-22W4/00 — Fort Sask AOR');
    rerender(frame('Well dossier 100/07-21-055-22W4/00 — Redwater AOR'));
    expect(document.title).toBe('Well dossier 100/07-21-055-22W4/00 — Redwater AOR');
    unmount();
    expect(document.title).toBe('Legacy Well Assessment');
  });

  it('the loading line is in the main landmark too', () => {
    render(<ReportStatus>Loading the well…</ReportStatus>);
    expect(screen.getByRole('main').textContent).toBe('Loading the well…');
  });
});
