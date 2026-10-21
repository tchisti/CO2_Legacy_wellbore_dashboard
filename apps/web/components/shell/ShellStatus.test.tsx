import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellError } from '@/components/shell/ShellStatus';
import { LOG_PREFIX } from '@/lib/log';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ShellError', () => {
  it('shows the error and reports it once through the logging hook', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('IndexedDB is blocked');
    const { rerender } = render(<ShellError error={error} />);
    rerender(<ShellError error={error} title="Your projects could not be read" />);
    expect(screen.getByRole('alert').textContent).toBe('IndexedDB is blocked');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(`${LOG_PREFIX} Error: IndexedDB is blocked`, { where: 'shell', stack: error.stack });
  });
});
