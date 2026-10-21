// Everything the well page and the well's printed dossier read for one well: the well, its project
// (name and injectors), its current final and draft, every assessment of it, and the methodologies
// needed to show them (spec §4.3). Null when there is no such well.
import type { Store } from '@/lib/store/store';

export async function loadWell(s: Store, id: string) {
  const well = await s.wells.get(id);
  if (!well) return null;
  const [project, current, draft, assessments, records, methodology] = await Promise.all([
    s.projects.get(well.projectId),
    s.assessments.current(id),
    s.assessments.draft(id),
    s.assessments.listForWell(id),
    s.methodology.list(),
    s.methodology.current(),
  ]);
  return { well, project, current, draft, assessments, records, methodology };
}

export type WellData = NonNullable<Awaited<ReturnType<typeof loadWell>>>;
