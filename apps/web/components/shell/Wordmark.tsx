// The product name with its mark: a well in section (ground line, casing, and a cement plug).
// `compact` keeps only the mark on a phone (below `sm`): the name stays for screen readers.
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0 text-primary">
        <path d="M1.5 3.75h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M5.75 3.75v10.5M10.25 3.75v10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="5.75" y="9" width="4.5" height="2.75" fill="currentColor" />
      </svg>
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>Legacy Well Assessment</span>
    </span>
  );
}
