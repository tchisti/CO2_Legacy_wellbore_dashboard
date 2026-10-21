// The pieces the Project settings sections share: the section itself (an anchored heading the
// in-page links point at), the list of sections, the save row of an editor, and the message an
// editor shows when a save is blocked or fails.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The page's sections in order: their anchors (`/settings#injectors`) and headings. */
export const SETTINGS_SECTIONS = [
  { id: 'project', title: 'Project' },
  { id: 'injectors', title: 'Injectors' },
  { id: 'formations', title: 'Formation column' },
  { id: 'profile', title: 'Reviewer profile' },
  { id: 'backup', title: 'Backup' },
  { id: 'danger-zone', title: 'Danger zone' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

const titleOf = (id: SettingsSectionId): string => SETTINGS_SECTIONS.find((s) => s.id === id)?.title ?? id;

/** A section of the page: a region named by its heading, reachable at `#<id>`. */
export function SettingsSection({
  id,
  description,
  children,
}: {
  id: SettingsSectionId;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid min-w-0 scroll-mt-4 gap-4">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
          {titleOf(id)}
        </h2>
        {description ? <div className="max-w-2xl text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** "On this page": links to every section. */
export function SettingsNav({ className }: { className?: string }) {
  return (
    <nav aria-label="On this page" className={className}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">On this page</p>
      <ul className="grid gap-0.5 border-l">
        {SETTINGS_SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="-ml-px block border-l border-transparent py-1 pl-3 text-sm text-muted-foreground outline-none hover:border-line-strong hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "Fix the highlighted field before saving." / "Fix the 3 highlighted fields before saving." */
export function blockedMessage(fields: number): string {
  return fields === 1 ? 'Fix the highlighted field before saving.' : `Fix the ${fields} highlighted fields before saving.`;
}

/** An editor's save row: the reason a save was blocked or failed, "Unsaved changes", Discard and Save. */
export function SaveBar({
  saveLabel,
  dirty,
  busy,
  message,
  onDiscard,
  className,
}: {
  saveLabel: string;
  dirty: boolean;
  busy: boolean;
  /** Why the last save did not happen; announced. */
  message?: string | null;
  onDiscard: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-x-3 gap-y-2', className)}>
      {message ? (
        <p role="alert" className="mr-auto text-xs text-destructive">
          {message}
        </p>
      ) : dirty ? (
        <p className="mr-auto text-xs text-muted-foreground">Unsaved changes</p>
      ) : null}
      {dirty ? (
        <Button type="button" variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard changes
        </Button>
      ) : null}
      <Button type="submit" disabled={!dirty || busy}>
        {busy ? 'Saving…' : saveLabel}
      </Button>
    </div>
  );
}
