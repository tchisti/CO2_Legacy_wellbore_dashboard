'use client';

// "Edit record" for one well: the record form in a dialog. Opened from the Wells table's row menu
// and from the well page header. Saves only the record fields, so construction and assessments
// are never touched; the store records the change in the well's history.
import type { Methodology, Well } from '@lwa/engine';
import { toast } from 'sonner';
import { WellForm } from '@/components/wells/WellForm';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStore } from '@/lib/store/provider';
import { wellRecordFields } from '@/lib/wells-view';

export function EditWellDialog({
  well,
  open,
  onOpenChange,
  wellTypes,
}: {
  /** The well to edit; the dialog stays closed while it is null. */
  well: Well | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wellTypes?: Methodology['wellTypes'];
}) {
  const store = useStore();
  return (
    <Dialog open={open && well !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
        // Focus the first field without selecting it (the default), so a stray key cannot replace the licence.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('input')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit well record</DialogTitle>
          <DialogDescription>
            <span className="num text-ink">{well?.licence}</span>
            {well?.name ? ` · ${well.name}` : null}. Scores and construction are edited on the well page.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed by well, so reopening on another well starts from that well's record. */}
        {well ? (
          <WellForm
            key={well.id}
            initial={wellRecordFields(well)}
            submitLabel="Save changes"
            wellTypes={wellTypes}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (fields) => {
              await store.wells.update(well.id, fields);
              toast.success('Well updated');
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
