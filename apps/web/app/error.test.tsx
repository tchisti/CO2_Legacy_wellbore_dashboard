import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RouteError from '@/app/error';
import { LOG_PREFIX } from '@/lib/log';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('route error boundary (app/error.tsx)', () => {
  it('says calmly what happened, offers Try again and the way back to Portfolio, and shows the message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RouteError error={new Error('Cannot read properties of undefined')} reset={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong on this page.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Portfolio' }).getAttribute('href')).toBe('/portfolio');
    expect(screen.getByText('Cannot read properties of undefined')).toBeTruthy();
  });

  it('Try again calls reset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reset = vi.fn();
    render(<RouteError error={new Error('boom')} reset={reset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reports the error once through the logging hook', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new RangeError('Invalid time value');
    render(<RouteError error={error} reset={() => {}} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([`${LOG_PREFIX} RangeError: Invalid time value`, { where: 'route-error-boundary', stack: error.stack }]);
  });

  it('a thrown value that is not an Error shows no detail line and is not logged as it is', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<RouteError error={{ licence: '100/13-06-055-22W4/00' }} reset={() => {}} />);
    expect(container.querySelector('.font-mono')).toBeNull();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('100/13-06-055-22W4/00');
  });
});
