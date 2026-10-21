// What a project-file import did (lib/backup.ts importProjectFile): the wells created and updated,
// what was added, the store's warnings, and the project that became active when the file held
// another one. Shared by Project settings → Backup and the Wells page's Import.
import type { ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ImportResultView({
  fileName,
  wells,
  added,
  warnings,
  switchedTo,
  notice,
  onDismiss,
}: {
  fileName: string;
  wells: string;
  added: string;
  warnings: readonly string[];
  /** The name of the project that is now active, when the import switched to it. */
  switchedTo: string | null;
  /** A line shown under the title (e.g. how the file was converted). */
  notice?: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <section aria-label="Import result" className="grid gap-1 rounded-md border bg-subtle px-3 py-2.5 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium">
          Imported <span className="num break-all">{fileName}</span>
        </p>
        {onDismiss ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss the import result"
            onClick={onDismiss}
            className="-mt-0.5 -mr-1"
          >
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      <p>
        <span className="text-muted-foreground">Wells: </span>
        {wells}
      </p>
      <p>{added}</p>
      {warnings.length > 0 ? (
        <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      {switchedTo ? <p className="text-xs text-muted-foreground">{switchedTo} is now the active project.</p> : null}
    </section>
  );
}
