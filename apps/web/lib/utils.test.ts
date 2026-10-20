import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('lets the last of two conflicting classes win', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('drops falsy and conditional inputs and flattens arrays and objects', () => {
    const off = false as boolean;
    expect(cn('a', off && 'b', null, undefined, '', 0, 'c')).toBe('a c');
    expect(cn('base', ['x', { y: true, z: false }])).toBe('base x y');
  });

  // Custom palette tokens (app/globals.css @theme) must be read as colours, so two text colours
  // conflict, but a colour and a font size do not.
  it('treats custom colour tokens as colours: the last text colour wins', () => {
    expect(cn('text-ink', 'text-warn')).toBe('text-warn');
    expect(cn('text-muted-foreground', 'text-ink')).toBe('text-ink');
    expect(cn('bg-subtle', 'bg-warn-bg')).toBe('bg-warn-bg');
    expect(cn('bg-rank-low', 'bg-rank-crit')).toBe('bg-rank-crit');
  });

  it('keeps background, border and text colour together (different properties)', () => {
    expect(cn('bg-warn-bg', 'border-warn-line', 'text-warn')).toBe('bg-warn-bg border-warn-line text-warn');
  });

  it('keeps a font size alongside a text colour', () => {
    expect(cn('text-sm', 'text-warn')).toBe('text-sm text-warn');
    expect(cn('text-warn', 'text-sm')).toBe('text-warn text-sm');
  });
});
