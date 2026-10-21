// Entity ids: a short type prefix plus a random UUID, e.g. `wel_3f2b8c1e-...`. The prefix makes
// an id self-describing in logs, exports and the audit trail. Ids are opaque to the schemas
// (they only require a non-empty string), so records migrated from v2 may carry other formats.

export type IdPrefix = 'prj' | 'wel' | 'asm' | 'aud';

// This package's tsconfig has neither the DOM lib nor Node types, so the global is not typed
// here. The declaration is module-local (it shadows, and never redeclares, the global that a
// DOM or Node consumer sees) and emits nothing: at runtime this is the platform's `crypto`.
// Node and every browser page have getRandomValues; browsers give randomUUID only to a secure
// context (HTTPS, or localhost), so a page served over plain HTTP has no randomUUID.
declare const crypto: { randomUUID?: () => string; getRandomValues(array: Uint8Array): Uint8Array };

/**
 * A random RFC 4122 version 4 UUID: crypto.randomUUID where the platform has it, otherwise 16
 * bytes from crypto.getRandomValues with the version (4) and variant (10xx) bits set. Every id the
 * app mints comes from here, so it also works from a plain-HTTP host.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte, i) => {
    const b = i === 6 ? (byte & 0x0f) | 0x40 : i === 8 ? (byte & 0x3f) | 0x80 : byte;
    return b.toString(16).padStart(2, '0');
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUuid()}`;
}
