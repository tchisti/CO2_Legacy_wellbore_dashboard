// Wellbore construction record: the v2 `wellbore` object (spec 2026-08-07 §2)
// with v3 provenance. All depths are metres. The Zod schemas are the source
// of truth for the stored shape; the TypeScript types are inferred from them.
import { z } from 'zod';

export type DepthUnit = 'm' | 'ft';

/** Where a wellbore, or one of its rows, came from. */
export const WELLBORE_SOURCES = ['parsed', 'manual', 'extractor', 'bridge'] as const;
export const WellboreSourceSchema = z.enum(WELLBORE_SOURCES);
export type WellboreSource = z.infer<typeof WellboreSourceSchema>;

// Every array row may carry provenance: `verbatim` is the text the row was read from.
const provenance = {
  source: WellboreSourceSchema.optional(),
  verbatim: z.string().optional(),
};

// Rows are loose objects: fields the schema does not know are kept, because
// the rows editor round-trips fields it does not edit (e.g. a casing `type`).
export const WellboreCasingSchema = z.looseObject({
  name: z.string().optional(),
  type: z.string().optional(),
  od_mm: z.number().optional(),
  grade: z.string().optional(),
  weight_kgm: z.number().optional(),
  top_m: z.number().optional(),
  shoe_m: z.number().optional(),
  toc_m: z.number().optional(),
  ...provenance,
});

export const WellborePlugSchema = z.looseObject({
  n: z.number().optional(),
  kind: z.string().optional(), // 'cement' | 'bridge' | 'cibp'
  top_m: z.number().optional(),
  bottom_m: z.number().optional(),
  sacks: z.number().optional(),
  additives: z.string().optional(),
  notes: z.string().optional(),
  ...provenance,
});

export const WellborePerforationSchema = z.looseObject({
  top_m: z.number().optional(),
  bottom_m: z.number().optional(),
  status: z.string().optional(),
  ...provenance,
});

export const WellboreFormationSchema = z.looseObject({
  name: z.string().optional(),
  top_m: z.number().optional(),
  ...provenance,
});

export const WellborePackerSchema = z.looseObject({
  depth_m: z.number().optional(),
  ...provenance,
});

export const WellboreZoneSchema = z.looseObject({
  kind: z.string().optional(), // 'salt' | 'hydrocarbon'
  top_m: z.number().optional(),
  bottom_m: z.number().optional(),
  ...provenance,
});

export const WellboreNoteSchema = z.looseObject({
  depth_m: z.number().nullable().optional(),
  text: z.string().optional(),
  ...provenance,
});

/** `{}` is the parser's structured "open hole, depths unknown" signal. No provenance. */
export const WellboreOpenHoleSchema = z.looseObject({
  top_m: z.number().optional(),
  bottom_m: z.number().optional(),
});

export type WellboreCasing = z.output<typeof WellboreCasingSchema>;
export type WellborePlug = z.output<typeof WellborePlugSchema>;
export type WellborePerforation = z.output<typeof WellborePerforationSchema>;
export type WellboreFormation = z.output<typeof WellboreFormationSchema>;
export type WellborePacker = z.output<typeof WellborePackerSchema>;
export type WellboreZone = z.output<typeof WellboreZoneSchema>;
export type WellboreNote = z.output<typeof WellboreNoteSchema>;
export type WellboreOpenHole = z.output<typeof WellboreOpenHoleSchema>;

// A stored row list: missing → [], null/undefined entries dropped on read.
function rows<T extends z.ZodType>(row: T) {
  return z
    .array(row.nullish())
    .default([])
    .transform((xs) => xs.filter((x): x is NonNullable<z.output<T>> => x != null));
}

export const WellboreSchema = z.object({
  td: z.number().nullable().optional(),
  kbElev: z.number().nullable().optional(),
  casings: rows(WellboreCasingSchema),
  plugs: rows(WellborePlugSchema),
  perforations: rows(WellborePerforationSchema),
  formations: rows(WellboreFormationSchema),
  packers: rows(WellborePackerSchema),
  zones: rows(WellboreZoneSchema),
  notes: rows(WellboreNoteSchema),
  openHole: WellboreOpenHoleSchema.nullable().optional(),
  source: WellboreSourceSchema.optional(),
  sourceText: z.string().nullable().optional(),
});

/** The stored construction record (`well.construction`): arrays of non-null rows. */
export type Wellbore = z.output<typeof WellboreSchema>;

// Loose input accepted by the renderer, stats and depth helpers: any field
// may be missing or null, and a list may hold null entries. Skipped null
// entries keep their original index in the SVG `data-id`.
type LooseRow<T> = { readonly [K in keyof T]?: T[K] | null };
type LooseList<T> = ReadonlyArray<LooseRow<T> | null | undefined> | null;

export type WellboreInput = {
  readonly td?: number | null;
  readonly kbElev?: number | null;
  readonly casings?: LooseList<WellboreCasing>;
  readonly plugs?: LooseList<WellborePlug>;
  readonly perforations?: LooseList<WellborePerforation>;
  readonly formations?: LooseList<WellboreFormation>;
  readonly packers?: LooseList<WellborePacker>;
  readonly zones?: LooseList<WellboreZone>;
  readonly notes?: LooseList<WellboreNote>;
  readonly openHole?: LooseRow<WellboreOpenHole> | null;
  readonly source?: WellboreSource | null;
  readonly sourceText?: string | null;
};
