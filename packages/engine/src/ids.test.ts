import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId, randomUuid } from './ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The platform's Web Crypto (Node's here), typed locally: this package has no Node or DOM typings. */
const platform = (globalThis as unknown as { crypto: { getRandomValues(array: Uint8Array): Uint8Array } }).crypto;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('randomUuid', () => {
  it('uses crypto.randomUUID when the platform has it (Node; a browser page on HTTPS or localhost)', () => {
    const randomUUID = vi.fn(() => '0f0e0d0c-0b0a-4908-8706-050403020100');
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });
    expect(randomUuid()).toBe('0f0e0d0c-0b0a-4908-8706-050403020100');
    expect(newId('wel')).toBe('wel_0f0e0d0c-0b0a-4908-8706-050403020100');
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('without crypto.randomUUID (a page served over plain HTTP) builds distinct v4 UUIDs from getRandomValues', () => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => platform.getRandomValues(array) });
    const ids = Array.from({ length: 500 }, () => randomUuid());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(500);
    expect(newId('asm')).toMatch(new RegExp(`^asm_${V4.source.slice(1)}`));
  });

  it.each([
    [0x00, '00000000-0000-4000-8000-000000000000'],
    [0xff, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ])('sets the version and variant bits whatever the random bytes are (every byte %i)', (byte, uuid) => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => array.fill(byte) });
    expect(randomUuid()).toBe(uuid);
    expect(randomUuid()).toMatch(V4);
  });

  it('keeps the byte order: byte i is hex digits 2i and 2i + 1, around the dashes', () => {
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => array.map((_, i) => i * 16 + i) });
    // bytes 00 11 22 … ff; byte 6 (0x66) becomes 0x46, byte 8 (0x88) becomes 0x88
    expect(randomUuid()).toBe('00112233-4455-4677-8899-aabbccddeeff');
  });
});
