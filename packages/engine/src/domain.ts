// Zod schemas for every stored record, the single source of truth for their shape. The IndexedDB
// store parses each write through them, the v2 migration script builds records against them, and
// the web app's forms and CSV import validate with the *Input schemas. Types are derived from
// the schemas: `Well` and friends are the stored (output) shape, `WellInput` and `ProjectInput`
// are what callers pass (defaults optional). Spec: docs/superpowers/specs/2026-10-20-v3-rebuild-design.md §5.
//
// Conventions: ids are non-empty strings (see ids.ts), timestamps are ISO-8601 UTC strings,
// actor fields are the free-text names snapshotted at the time (there is no sign-in in Phase 1),
// lengths are metres, coordinates are WGS84 decimal degrees.
import { z } from 'zod';
import { MethodologySchema } from './scoring';
import { PARAM_KEYS, type ParamKey } from './types';
import { WellboreSchema } from './wellbore';

/* ---------- shared field types ---------- */

const IdSchema = z.string().min(1);
const TimestampSchema = z.iso.datetime(); // UTC only: `Z` suffix, no offsets
const ActorSchema = z.string();
const NameSchema = z.string().trim().min(1);
const LatSchema = z.number().min(-90).max(90);
const LonSchema = z.number().min(-180).max(180);
const ScoreValueSchema = z.literal([1, 2, 3, 4, 5]);

// createdAt/createdBy/updatedAt/updatedBy, shared by Project and Well.
const auditFields = {
  createdAt: TimestampSchema,
  createdBy: ActorSchema,
  updatedAt: TimestampSchema,
  updatedBy: ActorSchema,
};

/* ---------- enums ---------- */

export const WELL_TYPES = [
  'Oil Producer',
  'Gas Producer',
  'Injection',
  'Disposal',
  'Strat Test',
  'Observation',
  'Unknown',
] as const;

export const TRAJECTORIES = ['Vertical', 'Deviated', 'Horizontal', 'Unknown'] as const;

export const STATUSES = ['Active', 'Suspended', 'Abandoned (P&A)', 'Orphaned', 'Unknown'] as const;

export const CLASSIFICATIONS = [
  'Type 1',
  'Type 2',
  'Type 3',
  'Type 4',
  'Type 5',
  'Type 6',
  'Type 7',
  'Type 8',
  'Type 9',
] as const;

/* ---------- scores, justifications, suggestions ---------- */

// Built from PARAM_KEYS so the schema cannot drift from the engine's parameter list. The cast
// only restores the per-key typing that Object.fromEntries erases.
const scoresShape = Object.fromEntries(PARAM_KEYS.map((key) => [key, ScoreValueSchema.nullable()])) as Record<
  ParamKey,
  z.ZodNullable<typeof ScoreValueSchema>
>;

/** All 11 params present; `null` is "unknown", which the methodology scores at the param's unknownScore. */
export const ScoresSchema = z.object(scoresShape);

// A partial record, not an exhaustive one (Zod 4 makes z.record(z.enum(...)) require every key).
// Keys that are not params are rejected rather than silently dropped.
export const JustificationsSchema = z.partialRecord(z.enum(PARAM_KEYS), z.string());

export const SuggestionSchema = z.object({
  score: ScoreValueSchema,
  source: z.literal('derived'),
  basis: z.string(),
});

export const SuggestionsSchema = z.partialRecord(z.enum(PARAM_KEYS), SuggestionSchema);

/* ---------- project ---------- */

const ProjectInjectorSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  lat: LatSchema,
  lon: LonSchema,
  aorRadius_m: z.number().gt(0),
});

const ProjectFormationSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    top_m: z.number().min(0),
    base_m: z.number().min(0),
    role: z.enum(['seal', 'reservoir', 'other']),
    order: z.number().int().min(0),
  })
  .refine((f) => f.base_m >= f.top_m, { message: 'base_m must be at or below top_m', path: ['base_m'] });

// Stored records carry no defaults: a field the record never had must fail validation, not be
// filled with a plausible value (a missing requireApproval is not "no approval required").
// Defaults exist only on the *Input schemas below, where a form or an import fills in blanks; the
// one exception is the construction record's row lists (see WellSchema).
export const ProjectSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  jurisdiction: z.enum(['AER', 'EPA', 'both']),
  description: z.string(),
  injectors: z.array(ProjectInjectorSchema),
  formations: z.array(ProjectFormationSchema),
  requireApproval: z.boolean(),
  ...auditFields,
});

/**
 * What the project form produces: a name, and defaults for everything else. The validators are
 * the stored schema's own (via `.shape`); only the defaults are added here.
 */
export const ProjectInputSchema = ProjectSchema.omit({
  id: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
}).extend({
  jurisdiction: ProjectSchema.shape.jurisdiction.default('both'),
  description: ProjectSchema.shape.description.default(''),
  injectors: ProjectSchema.shape.injectors.default([]),
  formations: ProjectSchema.shape.formations.default([]),
  requireApproval: ProjectSchema.shape.requireApproval.default(false),
});

/* ---------- well ---------- */

// Every field is required as stored (nullable ones must be present, as null). A well that never
// had a classification fails here instead of being stamped "Type 1", which suggest() would turn
// into the maximum-risk penetration score. Defaults live on WellInputSchema, with one accepted
// exception: inside `construction`, WellboreSchema reads a missing row list (casings, plugs, …) as
// [] and drops null rows (wellbore/types.ts), since a list that was never recorded has no rows.
export const WellSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  licence: z.string().trim().min(1),
  name: z.string(),
  operator: z.string(), // never invented: an unknown operator is the empty string
  lat: LatSchema.nullable(),
  lon: LonSchema.nullable(),
  spudYear: z.number().int().min(1850).max(2100).nullable(),
  type: z.enum(WELL_TYPES),
  trajectory: z.enum(TRAJECTORIES),
  status: z.enum(STATUSES),
  classification: z.enum(CLASSIFICATIONS),
  td_m: z.number().min(0).nullable(),
  notes: z.string(),
  construction: WellboreSchema.nullable(),
  // The v2 `legacy` block (v1 scores), kept on migrated wells for traceability.
  legacyV1: z
    .object({ scores: z.record(z.string(), z.number()), total: z.number() })
    .nullable()
    .optional(),
  ...auditFields,
});

/**
 * What the well form and the CSV import produce: no id, project or audit fields, and a default
 * for every optional field. The validators are the stored schema's own (via `.shape`), so range
 * rules are defined once; only the defaults are added here.
 */
export const WellInputSchema = WellSchema.omit({
  id: true,
  projectId: true,
  createdAt: true,
  createdBy: true,
  updatedAt: true,
  updatedBy: true,
}).extend({
  name: WellSchema.shape.name.default(''),
  operator: WellSchema.shape.operator.default(''),
  lat: WellSchema.shape.lat.default(null),
  lon: WellSchema.shape.lon.default(null),
  spudYear: WellSchema.shape.spudYear.default(null),
  type: WellSchema.shape.type.default('Unknown'),
  trajectory: WellSchema.shape.trajectory.default('Unknown'),
  status: WellSchema.shape.status.default('Unknown'),
  classification: WellSchema.shape.classification.default('Type 1'),
  td_m: WellSchema.shape.td_m.default(null),
  notes: WellSchema.shape.notes.default(''),
  construction: WellSchema.shape.construction.default(null),
});

/* ---------- assessment ---------- */

/** The engine's results, written at finalise. `rank` is the band label. */
const AssessmentComputedSchema = z.object({
  L: z.number(),
  C: z.number(),
  Lr: z.number().int(),
  Cr: z.number().int(),
  cell: z.number().int(),
  riskIndex: z.number(),
  rank: z.string(),
});

/**
 * Append-only; one `final` is current per well. A draft has no computed results and no
 * assessedAt requirement; a final must have both. (Spec §5, §5.1.)
 */
export const AssessmentSchema = z
  .object({
    id: IdSchema,
    wellId: IdSchema,
    methodologyRevision: z.string().min(1),
    scores: ScoresSchema,
    justifications: JustificationsSchema,
    suggestions: SuggestionsSchema,
    computed: AssessmentComputedSchema.nullable(),
    recommendedAction: z.object({ auto: z.string(), override: z.string().nullable() }),
    status: z.enum(['draft', 'final']),
    reviewerName: z.string(),
    assessedAt: TimestampSchema.nullable(),
    supersedesId: IdSchema.nullable(),
    approvedByName: z.string().nullable(),
    approvedAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .superRefine((a, ctx) => {
    if (a.status === 'final') {
      if (a.computed === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['computed'],
          message: 'A final assessment must carry computed results',
        });
      }
      if (a.assessedAt === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['assessedAt'],
          message: 'A final assessment must have an assessedAt timestamp',
        });
      }
    } else if (a.computed !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['computed'],
        message: 'A draft assessment must not carry computed results',
      });
    }
  });

/* ---------- methodology, audit, reviewer ---------- */

/** One published revision of the rulebook. Structural check only; semantic checks are validateMethodology. */
export const MethodologyRecordSchema = z.object({
  revision: z.string().min(1),
  methodology: MethodologySchema,
  note: z.string(),
  publishedAt: TimestampSchema,
  publishedBy: ActorSchema,
});

// Diffs are persisted and exported as JSON, which drops `undefined`. Rejecting it up front
// keeps a record that the store accepted from failing to re-import. Use null for "nothing".
const DiffSideSchema = z.unknown().refine((v) => v !== undefined, { message: 'Use null, not undefined' });

/** Append-only. Create and delete events use `null` for the absent side of the diff. */
export const AuditEventSchema = z.object({
  id: IdSchema,
  at: TimestampSchema,
  actorName: ActorSchema,
  projectId: IdSchema.nullable(),
  entity: z.enum(['project', 'well', 'assessment', 'methodology']),
  entityId: IdSchema,
  action: z.enum(['create', 'update', 'finalise', 'delete', 'import', 'export']),
  diff: z.object({ before: DiffSideSchema, after: DiffSideSchema }),
});

/** The reviewer identity stored locally; `initials` are shown on assessments. */
export const ReviewerProfileSchema = z.object({
  name: z.string().trim().min(2),
  initials: z.string().trim().min(2).max(3),
});

/* ---------- project export ---------- */

/** A whole project as one JSON file. All five collections are always written, possibly empty. */
export const ProjectExportSchema = z.object({
  format: z.literal('lwa-project'),
  version: z.literal(1),
  exportedAt: TimestampSchema,
  exportedBy: ActorSchema,
  project: ProjectSchema,
  wells: z.array(WellSchema),
  assessments: z.array(AssessmentSchema),
  methodologies: z.array(MethodologyRecordSchema),
  auditEvents: z.array(AuditEventSchema),
});

/* ---------- types ---------- */

// Stored records are the schema outputs. Inputs are what callers pass (defaults optional).
export type Project = z.output<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectInputSchema>;
export type Well = z.output<typeof WellSchema>;
export type WellInput = z.input<typeof WellInputSchema>;
export type Assessment = z.output<typeof AssessmentSchema>;
export type MethodologyRecord = z.output<typeof MethodologyRecordSchema>;
export type AuditEvent = z.output<typeof AuditEventSchema>;
export type ReviewerProfile = z.output<typeof ReviewerProfileSchema>;
export type ProjectExport = z.output<typeof ProjectExportSchema>;
