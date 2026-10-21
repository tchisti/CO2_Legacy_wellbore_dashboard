// Why a project file was not imported: one sentence, then the store's problems (ImportError), the
// first dozen listed and the rest counted. Shared by the first-run import and Project settings.

/** Problems listed before the rest are summarised as "…and N more". */
const MAX_PROBLEMS = 12;

export const NOT_IMPORTED = 'This file was not imported. Nothing was changed. Problems found:';

export function ImportProblems({ id, message, problems }: { id?: string; message: string; problems: readonly string[] }) {
  const shown = problems.slice(0, MAX_PROBLEMS);
  const hidden = problems.length - shown.length;
  return (
    <div id={id} role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
      <p className="font-medium text-destructive">{message}</p>
      {shown.length > 0 ? (
        <ul className="mt-1.5 grid list-disc gap-0.5 pl-4 font-mono text-[11px] text-ink">
          {shown.map((problem, i) => (
            <li key={i}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? <p className="mt-1 text-muted-foreground">…and {hidden} more.</p> : null}
    </div>
  );
}
