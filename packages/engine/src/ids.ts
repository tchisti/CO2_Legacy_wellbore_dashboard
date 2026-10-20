// Entity ids: a short type prefix plus a random UUID, e.g. `wel_3f2b8c1e-...`. The prefix makes
// an id self-describing in logs, exports and the audit trail. Ids are opaque to the schemas
// (they only require a non-empty string), so records migrated from v2 may carry other formats.

export type IdPrefix = 'prj' | 'wel' | 'asm' | 'aud';

// This package's tsconfig has neither the DOM lib nor Node types, so the global is not typed
// here. The declaration is module-local (it shadows, and never redeclares, the global that a
// DOM or Node consumer sees) and emits nothing: at runtime this is the platform's `crypto`,
// which exists in Node and in browsers (secure contexts, which includes localhost).
declare const crypto: { randomUUID(): string };

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
