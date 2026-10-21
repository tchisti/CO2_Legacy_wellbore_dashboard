// The end of a printed report: the attribution line (who assessed under which revision, when it
// was printed; the dossier only) and the footnote every report carries, that reviewer names come
// from a local profile and are not authenticated.
import { IDENTITY_FOOTNOTE } from '@/lib/report';

export function ReportFooter({ attribution }: { attribution?: string | null }) {
  return (
    <footer data-section="footer" data-keep className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
      {attribution ? (
        <p data-attribution className="text-ink">
          {attribution}
        </p>
      ) : null}
      <p data-footnote>{IDENTITY_FOOTNOTE}</p>
    </footer>
  );
}
