'use client';

// "Paste report → parse" (spec §4.3; schematic spec 2026-08-07 §4): the reviewer pastes a historic
// abandonment or casing report and the parser reads it into rows. The rows are added to the
// working copy (never replacing what is there) and nothing is saved until "Save construction";
// the editor then says how many rows were added and lists the lines it could not read.
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const EXAMPLE = 'Plug #1\n1463–1448 m\n25 sacks\n2% CaCl2';

function PasteForm({ onParse, onCancel }: { onParse: (text: string) => void; onCancel: () => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (text.trim()) onParse(text);
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Paste a report</DialogTitle>
        <DialogDescription>
          Plugs, casings, perforations and notes are read into rows and added to the rows already here. Nothing is saved
          until you save the construction.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-text`}>Abandonment or casing report</Label>
        <Textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          spellCheck={false}
          autoFocus
          aria-describedby={`${id}-hint`}
          className="num max-h-[50vh] min-h-48 text-[13px] md:text-[13px]"
        />
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Depths in m or ft (converted to metres). The text is kept with the record as it was pasted.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!text.trim()}>
          Parse into rows
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PasteReportDialog({
  open,
  onOpenChange,
  onParse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Given the pasted text; the dialog closes after. */
  onParse: (text: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Mounted only while open, so every paste starts from an empty box. */}
        {open ? (
          <PasteForm
            onCancel={() => onOpenChange(false)}
            onParse={(text) => {
              onParse(text);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
