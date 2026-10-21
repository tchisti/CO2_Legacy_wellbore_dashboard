'use client';

// The active project's register as the Wells and Portfolio pages read it: every well with its
// current final and draft, the current methodology, and the rows built from them
// (lib/wells-view.ts). Re-read after every store change, like any store query.
import { useMemo } from 'react';
import type { Assessment, Methodology, Well } from '@lwa/engine';
import { useStoreQuery } from '@/lib/store/provider';
import type { Store } from '@/lib/store/store';
import { buildRows, type WellRow } from '@/lib/wells-view';

export type RegisterRecords = {
  wells: Well[];
  methodology: Methodology;
  current: ReadonlyMap<string, Assessment | null>;
  drafts: ReadonlyMap<string, Assessment | null>;
};

export type Register = RegisterRecords & {
  rows: WellRow[];
  /** The wells' current finals (one per well that has one), in well order. */
  finals: Assessment[];
};

/** The project's wells with each one's current final and draft, and the current methodology. */
export async function loadRegister(s: Store, projectId: string): Promise<RegisterRecords> {
  const [wells, methodology] = await Promise.all([s.wells.list(projectId), s.methodology.current()]);
  const pairs = await Promise.all(
    wells.map(async (w) => [w.id, await s.assessments.current(w.id), await s.assessments.draft(w.id)] as const),
  );
  return {
    wells,
    methodology,
    current: new Map(pairs.map(([id, current]) => [id, current])),
    drafts: new Map(pairs.map(([id, , draft]) => [id, draft])),
  };
}

/** The register of `projectId`: null while loading (or with no project), `error` when it could not be read. */
export function useRegister(projectId: string | null): { data: Register | null; error: Error | null } {
  const query = useStoreQuery((s) => (projectId ? loadRegister(s, projectId) : Promise.resolve(null)), [projectId]);
  const records = query.data ?? null;
  const data = useMemo<Register | null>(() => {
    if (!records) return null;
    const { wells, current, drafts, methodology } = records;
    return {
      ...records,
      rows: buildRows(wells, current, drafts, methodology.revision),
      finals: wells.flatMap((w) => {
        const f = current.get(w.id);
        return f ? [f] : [];
      }),
    };
  }, [records]);
  return { data, error: query.error };
}
