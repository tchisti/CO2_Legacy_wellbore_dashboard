import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GlobalError from '@/app/global-error';
import { LOG_PREFIX } from '@/lib/log';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

// The component renders a whole document. React 19 renders <html>, <head> and <body> into the
// document's own singletons (so the attributes land on document.documentElement) and may warn
// about the nesting through console.error, so console.error is silenced and the logging hook's
// call is looked for among its calls.
const silenceConsole = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const hookCalls = (spy: ReturnType<typeof silenceConsole>) =>
  spy.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].startsWith(`${LOG_PREFIX} `));

describe('global error boundary (app/global-error.tsx)', () => {
  it('renders its own document with the calm message, Try again, a plain link to Portfolio and the detail', () => {
    silenceConsole();
    render(<GlobalError error={new Error('Cannot read the shell')} reset={() => {}} />);
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.body.querySelector('main h1')).not.toBeNull();
    expect(document.title).toBe('Something went wrong · Legacy Well Assessment');
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong on this page.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to Portfolio' }).getAttribute('href')).toBe('/portfolio');
    expect(screen.getByText('Cannot read the shell')).toBeTruthy();
  });

  it('defines the font variables the root layout would have, as system stacks, so the page is not set in serif', () => {
    silenceConsole();
    render(<GlobalError error={new Error('x')} reset={() => {}} />);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--font-inter')).toBe('ui-sans-serif, system-ui, sans-serif');
    expect(style.getPropertyValue('--font-jetbrains-mono')).toMatch(/monospace$/);
  });

  it('Try again calls reset', async () => {
    silenceConsole();
    const reset = vi.fn();
    render(<GlobalError error={new Error('boom')} reset={reset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reports the error once through the logging hook as the global boundary', () => {
    const spy = silenceConsole();
    const error = new TypeError('profile is undefined');
    render(<GlobalError error={error} reset={() => {}} />);
    expect(hookCalls(spy)).toEqual([[`${LOG_PREFIX} TypeError: profile is undefined`, { where: 'global-error-boundary', stack: error.stack }]]);
  });

  it('keeps a saved dark theme, and light otherwise', () => {
    silenceConsole();
    window.localStorage.setItem('lwa.theme', 'dark');
    render(<GlobalError error={new Error('x')} reset={() => {}} />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    cleanup();
    window.localStorage.clear();
    render(<GlobalError error={new Error('x')} reset={() => {}} />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
