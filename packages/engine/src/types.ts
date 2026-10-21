// Plain types shared across the engine. The Methodology type itself is derived from its Zod
// schema in scoring.ts, so it is not declared here.

/** The 11 scored parameters, in methodology order (L axis first, then C axis). */
export const PARAM_KEYS = [
  'plugQuality',
  'cement',
  'barriers',
  'scvf',
  'age',
  'complexity',
  'data',
  'penetration',
  'plume',
  'usdw',
  'access',
] as const;

export type ParamKey = (typeof PARAM_KEYS)[number];

/** Likelihood (leak) axis or Consequence axis. */
export type Axis = 'L' | 'C';

export type Score = 1 | 2 | 3 | 4 | 5;

/** A well's scores. `null` means unknown: the methodology's per-param unknownScore applies. */
export type Scores = Record<ParamKey, Score | null>;

/**
 * Scores as they may arrive at runtime (older records, partial edits, hand-built fixtures):
 * keys may be missing and values may be junk. The engine scores anything that is not a number
 * in 1..5 as the param's unknownScore, exactly like v2.
 */
export type LooseScores = Readonly<Partial<Record<ParamKey, unknown>>> | null | undefined;

export type Band = { min: number; max: number; label: string; cls: string; color: string };

export type Computed = {
  L: number;
  C: number;
  Lr: number;
  Cr: number;
  cell: number;
  riskIndex: number;
  rank: Band;
  riskScore: number;
  integrity: number;
};

/** The compact computed block stored on a well record (rank flattened to its label). */
export type ComputedBlock = {
  L: number;
  C: number;
  Lr: number;
  Cr: number;
  cell: number;
  riskIndex: number;
  rankLabel: string;
  integrity: number;
};

/**
 * A v1 or v2 well record as stored in wells.json. Only the fields the scoring port touches are
 * named; everything else rides along untouched.
 */
export interface V2WellLike {
  scores?: Record<string, unknown> | null;
  total?: unknown;
  schema?: number;
  computed?: ComputedBlock;
  scoredUnder?: string;
  needsReview?: boolean;
  legacy?: { scores: Record<string, unknown>; total: unknown };
  [key: string]: unknown;
}

/** What migrateV1 returns: the v2 record shape, with the migration fields guaranteed present. */
export interface MigratedWell extends V2WellLike {
  schema: number;
  scores: Scores;
  computed: ComputedBlock;
  scoredUnder: string;
  needsReview: true;
  legacy: { scores: Record<string, unknown>; total: unknown };
}

export type V1Tier = { min: number; max: number; label: string; cls: string };

export type ValidationResult = { ok: boolean; errors: string[] };

export type GoldenWant = {
  L: number;
  C: number;
  cell: number;
  riskIndex: number;
  rank: string;
  integrity: number;
};

/** A golden vector fills every param with one value, or migrates a v1 well; either way `want` is checked. */
export type GoldenVector = { name: string; want: GoldenWant } & (
  | {
      /** Fill every param with this value ('all-null' = every param unknown). */
      scores: 'all-1' | 'all-3' | 'all-5' | 'all-null';
      v1?: undefined;
    }
  | {
      /** Migrate this v1 well and check its computed block. */
      v1: V2WellLike;
      scores?: undefined;
    }
);

export type SelfTestResult = { pass: boolean; failures: string[]; summary: string };
