// The client error logging hook (spec §10, observability). Phase 1 has no hosting, so there is no
// logging provider yet: an error is written to the console under a stable prefix, and the provider
// chosen with hosting replaces the body of reportError (nothing is sent anywhere in Phase 1).
//
// Only the error's own name, message, stack and digest are logged, with the caller's few words of
// context. A thrown value that is not an Error is never logged as it is (it could be a well or an
// assessment): a string or number keeps its text, anything else is named by its type only.
import { useEffect } from 'react';

/** Starts every line this hook logs, so the lines can be found (and later forwarded) reliably. */
export const LOG_PREFIX = '[lwa]';

type Described = { name: string; message: string; stack?: string; digest?: string };

function describe(error: unknown): Described {
  if (error instanceof Error) {
    const digest = (error as Error & { digest?: unknown }).digest;
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(typeof digest === 'string' ? { digest } : {}),
    };
  }
  if (typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean') {
    return { name: 'NonError', message: String(error) };
  }
  return { name: 'NonError', message: `a thrown ${error === null ? 'null' : typeof error} (not logged)` };
}

/**
 * Reports an error the app caught (an error boundary, a failed read, a listener). `context` says
 * where, in a few fixed words, e.g. `{ where: 'store-provider', action: 'read-profile' }`. Never
 * throws: logging must not turn a handled error into an unhandled one.
 */
export function reportError(error: unknown, context: Record<string, string>): void {
  const { name, message, ...detail } = describe(error);
  try {
    console.error(`${LOG_PREFIX} ${name}: ${message}`, { ...context, ...detail });
  } catch {
    // nothing left to report to
  }
}

/** Reports `error` once per distinct error while a component shows it; null reports nothing. */
export function useReportError(error: unknown, where: string): void {
  useEffect(() => {
    if (error !== null && error !== undefined) reportError(error, { where });
  }, [error, where]);
}
