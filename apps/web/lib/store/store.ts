// The Store interface: the only way the web app reads or writes data. Phase 1 ships LocalStore
// (IndexedDB via Dexie, local-store.ts); a later backend implements the same interface and must
// pass the same contract suite (contract.ts). Spec: docs/superpowers/specs/2026-10-20-v3-rebuild-design.md
// §5 (data model), §5.1 (derived states, re-assessment), §6.1 (Store, audit trail).
//
// Every mutation validates the full record through its stored schema, writes it together with its
// audit event atomically, and then notifies onChange listeners once.
import type {
  Assessment,
  AuditEvent,
  Methodology,
  MethodologyRecord,
  ParamKey,
  Project,
  ProjectExport,
  ProjectInput,
  ReviewerProfile,
  Scores,
  Well,
  WellInput,
} from '@lwa/engine';

/** What the score flow saves: everything the reviewer entered. The store fills in the rest. */
export type DraftInput = {
  scores: Scores;
  justifications: Assessment['justifications'];
  /** Reviewer override of the recommended action; trimmed, and blank means "no override". */
  override: string | null;
  suggestions: Assessment['suggestions'];
};

export type UpsertResult = { created: number; updated: number; ids: string[] };

export type ImportMode = 'merge' | 'replace';

/**
 * Counts for one import. Wells: `created` (new to the store) or `updated` (matched by licence,
 * whether or not the incoming fields were newer). Assessments and audit events: `added` (the
 * import changed the store) or `skipped` (the store already had it, or could not take it — see
 * `warnings`). `removed`: what a replace deleted because the file does not have it — the
 * project's wells whose licence is not in the file (with all their assessments), and the kept
 * wells' assessments, finals included, whose ids are not in the file. Always zero for a merge.
 */
export type ImportResult = {
  wells: { created: number; updated: number };
  assessments: { added: number; skipped: number };
  auditEvents: { added: number; skipped: number };
  removed: { wells: number; assessments: number };
  warnings: string[];
};

export type AuditFilter = { projectId?: string; entityId?: string; limit?: number };

export interface Store {
  profile: {
    get(): Promise<ReviewerProfile | null>;
    set(p: ReviewerProfile): Promise<void>;
  };
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project | null>;
    create(input: ProjectInput): Promise<Project>;
    update(id: string, patch: Partial<ProjectInput>): Promise<Project>;
    /** Deletes the project with its wells, assessments and audit events; leaves one `delete` event. */
    remove(id: string): Promise<void>;
  };
  wells: {
    list(projectId: string): Promise<Well[]>;
    get(id: string): Promise<Well | null>;
    /** Rejects with DuplicateLicenceError when the project already has the licence (see licenceKey). */
    create(projectId: string, input: WellInput): Promise<Well>;
    update(id: string, patch: Partial<WellInput>): Promise<Well>;
    /** Deletes the well and its assessments; the audit event keeps both. */
    remove(id: string): Promise<void>;
    /**
     * Matches each input to a well of the project by licence. A match is updated with the fields
     * the input carries (the stored licence text is kept); no match creates a well with defaults.
     * `ids` follows the order of `inputs`.
     */
    upsertByLicence(projectId: string, inputs: WellInput[]): Promise<UpsertResult>;
  };
  assessments: {
    /** Newest first. */
    listForWell(wellId: string): Promise<Assessment[]>;
    /** The final assessment with the latest assessedAt, or null. */
    current(wellId: string): Promise<Assessment | null>;
    /** The well's draft (there is at most one), or null. */
    draft(wellId: string): Promise<Assessment | null>;
    /** Creates the well's draft, or updates it when one exists. */
    saveDraft(wellId: string, input: DraftInput): Promise<Assessment>;
    /**
     * Turns the draft into a final under the current methodology (same id). Rejects with
     * FinaliseError when a scored parameter has no justification.
     */
    finalise(draftId: string): Promise<Assessment>;
    discardDraft(draftId: string): Promise<void>;
  };
  methodology: {
    /** The methodology of the highest (semver) published revision. */
    current(): Promise<Methodology>;
    list(): Promise<MethodologyRecord[]>;
    publish(m: Methodology, note: string): Promise<MethodologyRecord>;
  };
  audit: {
    /** Newest first. */
    list(filter: AuditFilter): Promise<AuditEvent[]>;
  };
  exportProject(projectId: string): Promise<ProjectExport>;
  /** Atomic. Rejects with ImportError, writing nothing, when the file is not a valid project export. */
  importProject(data: unknown, mode: ImportMode): Promise<ImportResult>;
  /** Called once after every committed mutation. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** The licence as matched: trimmed, upper-cased, with all whitespace removed. The stored text is kept as entered. */
export function licenceKey(l: string): string {
  return l.trim().toUpperCase().replace(/\s+/g, '');
}

export class FinaliseError extends Error {
  /** Params with a score but no justification, in methodology (PARAM_KEYS) order. */
  readonly missing: ParamKey[];
  constructor(missing: ParamKey[]) {
    super(`Justification required for: ${missing.join(', ')}`);
    this.name = 'FinaliseError';
    this.missing = missing;
  }
}

export class DuplicateLicenceError extends Error {
  readonly licence: string;
  readonly existingId: string;
  constructor(licence: string, existingId: string) {
    super(`Licence ${licence} already exists in this project (well ${existingId})`);
    this.name = 'DuplicateLicenceError';
    this.licence = licence;
    this.existingId = existingId;
  }
}

export class ImportError extends Error {
  /** Every problem found in the file. */
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`The project file was not imported:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.name = 'ImportError';
    this.problems = problems;
  }
}

export class NotFoundError extends Error {
  constructor(entity: 'project' | 'well' | 'assessment', id: string) {
    super(`No ${entity} with id ${id}`);
    this.name = 'NotFoundError';
  }
}
