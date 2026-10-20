'use client';

// The recommended action in the score flow (spec §4.4): the engine's automatic title for the scores
// as they stand, and the reviewer's override behind an "Override" control. An override is the
// reviewer's own words; left blank, it saves as no override and the automatic text applies.
import { useId, useState } from 'react';
import { PencilLineIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function OverrideField({
  autoTitle,
  value,
  onChange,
}: {
  /** The automatic recommendation's title, under the scores as they stand. */
  autoTitle: string;
  /** As typed; null when there is no override. */
  value: string | null;
  onChange: (text: string | null) => void;
}) {
  const headingId = useId();
  const fieldId = useId();
  const [open, setOpen] = useState(value !== null);
  /** Focus the field only when the reviewer opened it, not when it opens prefilled. */
  const [focusOnOpen, setFocusOnOpen] = useState(false);

  return (
    <section aria-labelledby={headingId} className="grid gap-3 rounded-lg border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p id={headingId} className="text-[13px] text-muted-foreground">
          Recommended action (automatic): <span className="font-medium text-ink">{autoTitle}</span>
        </p>
        {open ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <XIcon aria-hidden="true" />
            Remove override
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(value ?? '');
              setFocusOnOpen(true);
              setOpen(true);
            }}
          >
            <PencilLineIcon aria-hidden="true" />
            Override
          </Button>
        )}
      </div>
      {open ? (
        <div className="grid gap-1">
          <label htmlFor={fieldId} className="text-xs text-muted-foreground">
            Reviewer override
          </label>
          <Textarea
            id={fieldId}
            value={value ?? ''}
            autoFocus={focusOnOpen}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            placeholder="The action you recommend instead, in your own words. Left blank, the automatic action applies."
            className="text-[13px] md:text-[13px]"
          />
        </div>
      ) : null}
    </section>
  );
}
