// A derived suggestion beside a parameter's score buttons (spec §5.1): "Suggested 5 · from Type 3".
// Labelled with its provenance and dashed, so it never reads as a chosen score; it does nothing
// until the reviewer clicks it (the anti-goal of §2: no score the software made up).
import { LightbulbIcon } from 'lucide-react';
import type { Suggestion } from '@lwa/engine';
import { cn } from '@/lib/utils';

export function SuggestionChip({
  suggestion,
  onApply,
  className,
}: {
  suggestion: Suggestion;
  onApply: (suggestion: Suggestion) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-suggestion={suggestion.score}
      title="Apply: sets this score and, when the justification is empty, writes the basis into it"
      onClick={() => onApply(suggestion)}
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm border border-dashed border-line-strong bg-surface px-2 text-xs text-ink outline-none hover:border-primary hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <LightbulbIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">
        Suggested <span className="num font-medium">{suggestion.score}</span>
        {' · '}
        {suggestion.basis}
      </span>
    </button>
  );
}
