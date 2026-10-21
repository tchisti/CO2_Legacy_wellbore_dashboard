import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDraft } from '@/lib/use-draft';

type Value = { name: string };

function setup(initial: Value) {
  return renderHook(({ upstream }: { upstream: Value }) => useDraft(upstream), { initialProps: { upstream: initial } });
}

describe('useDraft', () => {
  it('starts as the stored value, clean', () => {
    const { result } = setup({ name: 'A' });
    expect(result.current.draft).toEqual({ name: 'A' });
    expect(result.current.dirty).toBe(false);
  });

  it('is dirty while the draft differs from the stored value, and clean again when it matches', () => {
    const { result } = setup({ name: 'A' });
    act(() => result.current.setDraft({ name: 'B' }));
    expect(result.current.draft).toEqual({ name: 'B' });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.setDraft((d) => ({ ...d, name: 'A' })));
    expect(result.current.dirty).toBe(false);
  });

  it('takes a new stored value while clean', () => {
    const { result, rerender } = setup({ name: 'A' });
    rerender({ upstream: { name: 'C' } });
    expect(result.current.draft).toEqual({ name: 'C' });
    expect(result.current.dirty).toBe(false);
  });

  it('keeps edits when the stored value changes under them; discard goes to the newest stored value', () => {
    const { result, rerender } = setup({ name: 'A' });
    act(() => result.current.setDraft({ name: 'B' }));
    rerender({ upstream: { name: 'C' } });
    expect(result.current.draft).toEqual({ name: 'B' });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.discard());
    expect(result.current.draft).toEqual({ name: 'C' });
    expect(result.current.dirty).toBe(false);
  });

  it('after a save the draft is clean, and the stored value catching up changes nothing', () => {
    const { result, rerender } = setup({ name: 'A' });
    act(() => result.current.setDraft({ name: 'B ' }));
    act(() => result.current.saved({ name: 'B' }));
    expect(result.current.draft).toEqual({ name: 'B' });
    expect(result.current.dirty).toBe(false);
    rerender({ upstream: { name: 'A' } }); // the old value, before the store change arrives
    expect(result.current.draft).toEqual({ name: 'B' });
    rerender({ upstream: { name: 'B' } });
    expect(result.current.draft).toEqual({ name: 'B' });
    expect(result.current.dirty).toBe(false);
  });
});
