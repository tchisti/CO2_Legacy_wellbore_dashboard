import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectReadError, ReportMessage } from '@/components/report/ReportFrame';
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
