import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AssessmentSchema,
  AuditEventSchema,
  CLASSIFICATIONS,
  JustificationsSchema,
  MethodologyRecordSchema,
  ProjectExportSchema,
  ProjectInputSchema,
  ProjectSchema,
  ReviewerProfileSchema,
  STATUSES,
  ScoresSchema,
  SuggestionsSchema,
  TRAJECTORIES,
  WELL_TYPES,
  WellInputSchema,
  WellSchema,
  type Assessment,
  type AuditEvent,
  type MethodologyRecord,
  type Project,
  type ProjectExport,
  type ProjectInput,
  type ReviewerProfile,
  type Well,
  type WellInput,
} from './domain';
import { newId } from './ids';
import * as engine from './index';
import { DEFAULT_METHODOLOGY, PARAM_KEYS, computeWell, emptyScores } from './scoring';
import { suggest, type Suggestions } from './suggest';
import type { Scores } from './types';
import type { Wellbore } from './wellbore';

const T0 = '2026-10-20T09:00:00.000Z';
const T1 = '2026-10-20T10:30:00.000Z';
const ACTOR = 'Tahir Chisti';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;

const issuePaths = (schema: z.ZodType, value: unknown): string[] => {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

const scores: Scores = {
  plugQuality: 4,
  cement: 3,
  barriers: null,
  scvf: 1,
  age: 5,
  complexity: 2,
  data: 3,
  penetration: 5,
  plume: 4,
  usdw: 1,
  access: null,
};

// Output form of a stored construction record (arrays filled, rows carry provenance).
const construction: Wellbore = {
  td: 1850,
  kbElev: 702.4,
  casings: [{ name: 'Surface', od_mm: 244.5, shoe_m: 320, source: 'manual' }],
  plugs: [
    {
      n: 1,
      kind: 'cement',
      top_m: 1200,
      bottom_m: 1300,
      sacks: 40,
      source: 'parsed',
      verbatim: 'Plug #1 1200-1300 m 40 sx',
    },
  ],
  perforations: [],
  formations: [],
  packers: [],
  zones: [],
  notes: [],
  source: 'manual',
  sourceText: null,
};

const well: Well = {
  id: 'wel_1',
  projectId: 'prj_1',
  licence: '0012345',
  name: 'Smith 5-12',
  operator: 'Acme Energy',
  lat: 51.05,
  lon: -114.07,
  spudYear: 1978,
  type: 'Oil Producer',
  trajectory: 'Vertical',
  status: 'Abandoned (P&A)',
  classification: 'Type 3',
  td_m: 1850,
  notes: 'Tagged cement at 1190 m',
  construction,
  legacyV1: { scores: { casing: 3, cement: 4 }, total: 27 },
  createdAt: T0,
  createdBy: ACTOR,
  updatedAt: T1,
  updatedBy: ACTOR,
};

const project: Project = {
  id: 'prj_1',
  name: 'Quest AOR review',
  jurisdiction: 'AER',
  description: 'Legacy wells inside the storage complex',
  injectors: [{ id: 'inj_1', name: 'Quest 8-19', lat: 51.1, lon: -114.1, aorRadius_m: 5000 }],
  formations: [
    { id: 'fm_1', name: 'Basal Cambrian Sandstone', top_m: 1900, base_m: 2050, role: 'reservoir', order: 0 },
    { id: 'fm_2', name: 'Lower Shale', top_m: 1750, base_m: 1900, role: 'seal', order: 1 },
  ],
  requireApproval: false,
  createdAt: T0,
  createdBy: ACTOR,
  updatedAt: T0,
  updatedBy: ACTOR,
};

const computedFor = (s: Scores) => {
  const c = computeWell(s, DEFAULT_METHODOLOGY);
  return {
    L: c.L,
    C: c.C,
    Lr: c.Lr,
    Cr: c.Cr,
    cell: c.cell,
    riskIndex: c.riskIndex,
    rank: c.rank.label,
  };
};

const finalAssessment: Assessment = {
  id: 'asm_1',
  wellId: 'wel_1',
  methodologyRevision: DEFAULT_METHODOLOGY.revision,
  scores,
  justifications: { plugQuality: 'No tag or log on file', age: 'Suggested: from spud year 1978' },
  suggestions: { age: { score: 3, source: 'derived', basis: 'from spud year 1978' } },
  computed: computedFor(scores),
  recommendedAction: { auto: 'Re-enter and re-plug', override: null },
  status: 'final',
  reviewerName: ACTOR,
  assessedAt: T1,
  supersedesId: null,
  approvedByName: null,
  approvedAt: null,
  createdAt: T0,
  updatedAt: T1,
};

const draftAssessment: Assessment = {
  ...finalAssessment,
  id: 'asm_2',
  computed: null,
  status: 'draft',
  assessedAt: null,
  supersedesId: 'asm_1',
};

const methodologyRecord: MethodologyRecord = {
  revision: DEFAULT_METHODOLOGY.revision,
  methodology: DEFAULT_METHODOLOGY,
  note: 'Initial publication',
  publishedAt: T0,
  publishedBy: ACTOR,
};

const auditEvent: AuditEvent = {
  id: 'aud_1',
  at: T1,
  actorName: ACTOR,
  projectId: 'prj_1',
  entity: 'assessment',
  entityId: 'asm_1',
  action: 'finalise',
  diff: { before: null, after: { status: 'final' } },
};

const reviewer: ReviewerProfile = { name: 'Tahir Chisti', initials: 'TC' };

const fullExport: ProjectExport = {
  format: 'lwa-project',
  version: 1,
  exportedAt: T1,
  exportedBy: ACTOR,
  project,
  wells: [well],
  assessments: [finalAssessment, draftAssessment],
  methodologies: [methodologyRecord],
  auditEvents: [auditEvent],
};

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('enum tuples', () => {
  it('carries the exact values', () => {
    expect(WELL_TYPES).toEqual([
      'Oil Producer',
      'Gas Producer',
      'Injection',
      'Disposal',
      'Strat Test',
      'Observation',
      'Unknown',
    ]);
    expect(TRAJECTORIES).toEqual(['Vertical', 'Deviated', 'Horizontal', 'Unknown']);
    expect(STATUSES).toEqual(['Active', 'Suspended', 'Abandoned (P&A)', 'Orphaned', 'Unknown']);
    expect(CLASSIFICATIONS).toEqual([
      'Type 1',
      'Type 2',
      'Type 3',
      'Type 4',
      'Type 5',
      'Type 6',
      'Type 7',
      'Type 8',
      'Type 9',
    ]);
  });
});

describe('ScoresSchema', () => {
  it('has exactly the PARAM_KEYS, in order', () => {
    expect(Object.keys(ScoresSchema.shape)).toEqual([...PARAM_KEYS]);
  });

  it('accepts 1..5 and null for every param, and the empty scores', () => {
    expect(ScoresSchema.parse(scores)).toEqual(scores);
    const typed: Scores = ScoresSchema.parse(emptyScores());
    expect(Object.values(typed).every((v) => v === null)).toBe(true);
  });

  it('rejects a missing key, 0, 6, a fraction, a string and undefined', () => {
    const { plume: _omitted, ...missing } = scores;
    expect(ok(ScoresSchema, missing)).toBe(false);
    for (const bad of [0, 6, 2.5, '3', undefined]) {
      expect(ok(ScoresSchema, { ...scores, cement: bad })).toBe(false);
    }
  });
});

describe('JustificationsSchema and SuggestionsSchema', () => {
  it('accepts a partial record of strings, including empty', () => {
    expect(JustificationsSchema.parse({})).toEqual({});
    expect(JustificationsSchema.parse({ age: 'x' })).toEqual({ age: 'x' });
  });

  it('rejects non-string values and keys that are not params', () => {
    expect(ok(JustificationsSchema, { age: 3 })).toBe(false);
    expect(ok(JustificationsSchema, { notAParam: 'x' })).toBe(false);
  });

  it('accepts what suggest() produces and rejects non-derived or out-of-range suggestions', () => {
    const derived: Suggestions = SuggestionsSchema.parse(
      suggest({ classification: 'Type 3', spudYear: 1978, trajectory: 'Vertical' }),
    );
    expect(Object.keys(derived).length).toBeGreaterThan(0);
    expect(ok(SuggestionsSchema, { age: { score: 3, source: 'extractor', basis: 'x' } })).toBe(false);
    expect(ok(SuggestionsSchema, { age: { score: 6, source: 'derived', basis: 'x' } })).toBe(false);
    expect(ok(SuggestionsSchema, { age: { score: 3, source: 'derived' } })).toBe(false);
    expect(ok(SuggestionsSchema, { notAParam: { score: 3, source: 'derived', basis: 'x' } })).toBe(false);
  });
});

describe('WellSchema', () => {
  it('accepts a complete well and round-trips through JSON', () => {
    expect(WellSchema.parse(well)).toEqual(well);
    expect(WellSchema.parse(roundTrip(well))).toEqual(well);
  });

  it('rejects a classification outside Type 1-9 and a lat outside +-90', () => {
    for (const c of ['Type 0', 'Type 10', 'type 1', '']) {
      expect(ok(WellSchema, { ...well, classification: c })).toBe(false);
    }
    expect(ok(WellSchema, { ...well, lat: 90.0001 })).toBe(false);
    expect(ok(WellSchema, { ...well, lat: -90.0001 })).toBe(false);
  });

  it('bounds lon, spudYear and td_m, and accepts the boundary values and null', () => {
    expect(ok(WellSchema, { ...well, lon: 180.5 })).toBe(false);
    expect(ok(WellSchema, { ...well, lon: -180.5 })).toBe(false);
    expect(ok(WellSchema, { ...well, lat: 90, lon: -180 })).toBe(true);
    expect(ok(WellSchema, { ...well, lat: -90, lon: 180 })).toBe(true);
    for (const y of [1849, 2101, 1990.5]) expect(ok(WellSchema, { ...well, spudYear: y })).toBe(false);
    for (const y of [1850, 2100, null]) expect(ok(WellSchema, { ...well, spudYear: y })).toBe(true);
    for (const d of [-0.1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(ok(WellSchema, { ...well, td_m: d })).toBe(false);
    }
    expect(ok(WellSchema, { ...well, td_m: 0 })).toBe(true);
    expect(ok(WellSchema, { ...well, lat: null, lon: null, spudYear: null, td_m: null })).toBe(true);
  });

  it('requires a non-empty licence and trims it', () => {
    expect(ok(WellSchema, { ...well, licence: '' })).toBe(false);
    expect(ok(WellSchema, { ...well, licence: '   ' })).toBe(false);
    expect(WellSchema.parse({ ...well, licence: ' 0012345 ' }).licence).toBe('0012345');
  });

  it('requires non-empty ids and ISO-8601 UTC timestamps', () => {
    expect(ok(WellSchema, { ...well, id: '' })).toBe(false);
    expect(ok(WellSchema, { ...well, projectId: '' })).toBe(false);
    for (const t of ['2026-10-20', 'yesterday', '2026-10-20T12:00:00+02:00', '2026-10-20T12:00:00']) {
      expect(ok(WellSchema, { ...well, createdAt: t })).toBe(false);
      expect(ok(WellSchema, { ...well, updatedAt: t })).toBe(false);
    }
    expect(ok(WellSchema, { ...well, createdAt: '2026-10-20T12:00:00Z' })).toBe(true);
  });

  it('composes WellboreSchema for construction (a plug survives) and accepts null', () => {
    const parsed = WellSchema.parse(well);
    expect(parsed.construction?.plugs).toHaveLength(1);
    expect(parsed.construction?.plugs[0]?.top_m).toBe(1200);
    expect(WellSchema.parse({ ...well, construction: null }).construction).toBeNull();
    expect(ok(WellSchema, { ...well, construction: { casings: 'nope' } })).toBe(false);
  });

  it('allows legacyV1 to be absent or null but not malformed', () => {
    const { legacyV1: _drop, ...withoutLegacy } = well;
    expect(ok(WellSchema, withoutLegacy)).toBe(true);
    expect(ok(WellSchema, { ...well, legacyV1: null })).toBe(true);
    expect(ok(WellSchema, { ...well, legacyV1: { scores: { a: 'x' }, total: 3 } })).toBe(false);
    expect(ok(WellSchema, { ...well, legacyV1: { scores: {} } })).toBe(false);
  });

  it('rejects an unknown type, trajectory or status', () => {
    expect(ok(WellSchema, { ...well, type: 'Producer' })).toBe(false);
    expect(ok(WellSchema, { ...well, trajectory: 'Slanted' })).toBe(false);
    expect(ok(WellSchema, { ...well, status: 'Abandoned' })).toBe(false);
  });
});

describe('WellSchema stores no defaults', () => {
  const omit = <T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> => {
    const { [key]: _removed, ...rest } = obj;
    return rest;
  };

  it('rejects a stored well that is missing any field, naming the field', () => {
    const fields = [
      'name',
      'operator',
      'lat',
      'lon',
      'spudYear',
      'type',
      'trajectory',
      'status',
      'classification',
      'td_m',
      'notes',
      'construction',
    ] as const;
    for (const field of fields) {
      const bad = omit(well, field);
      expect(ok(WellSchema, bad), field).toBe(false);
      expect(issuePaths(WellSchema, bad), field).toContain(field);
    }
  });

  it('does not stamp a bare well (id, projectId, licence, audit fields) with Type 1 or anything else', () => {
    const bare = {
      id: 'wel_bare',
      projectId: 'prj_1',
      licence: '0012345',
      createdAt: T0,
      createdBy: ACTOR,
      updatedAt: T0,
      updatedBy: ACTOR,
    };
    expect(ok(WellSchema, bare)).toBe(false);
    expect(issuePaths(WellSchema, bare)).toContain('classification');
    // ...while the same facts through the input schema are filled in on purpose.
    expect(WellInputSchema.parse({ licence: '0012345' }).classification).toBe('Type 1');
  });

  it('rejects an export whose well is missing its classification', () => {
    const bad = { ...fullExport, wells: [omit(well, 'classification')] };
    expect(ok(ProjectExportSchema, bad)).toBe(false);
    expect(issuePaths(ProjectExportSchema, bad)).toContain('wells.0.classification');
  });

  it('still accepts null for the nullable fields when they are present', () => {
    expect(
      ok(WellSchema, { ...well, lat: null, lon: null, spudYear: null, td_m: null, construction: null }),
    ).toBe(true);
  });
});

describe('WellInputSchema', () => {
  it('applies defaults: Unknown type/trajectory/status, Type 1, empty text, null geometry and construction', () => {
    expect(WellInputSchema.parse({ licence: '0012345' })).toEqual({
      licence: '0012345',
      name: '',
      operator: '',
      lat: null,
      lon: null,
      spudYear: null,
      type: 'Unknown',
      trajectory: 'Unknown',
      status: 'Unknown',
      classification: 'Type 1',
      td_m: null,
      notes: '',
      construction: null,
    });
  });

  it('requires a licence', () => {
    expect(ok(WellInputSchema, {})).toBe(false);
    expect(ok(WellInputSchema, { licence: '  ' })).toBe(false);
  });

  it('does not carry id, projectId, timestamps or actors', () => {
    const parsed = WellInputSchema.parse(well);
    for (const key of ['id', 'projectId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']) {
      expect(key in parsed).toBe(false);
    }
    expect(parsed.construction?.plugs).toHaveLength(1);
  });

  it('enforces the same field rules as WellSchema', () => {
    expect(ok(WellInputSchema, { licence: 'X', lat: 91 })).toBe(false);
    expect(ok(WellInputSchema, { licence: 'X', classification: 'Type 10' })).toBe(false);
  });

  it('types the input with defaults optional and the output with them filled', () => {
    const minimal: WellInput = { licence: 'X' };
    const filled = WellInputSchema.parse(minimal);
    const status: (typeof STATUSES)[number] = filled.status;
    expect(status).toBe('Unknown');
  });
});

describe('ProjectSchema and ProjectInputSchema', () => {
  it('round-trips a complete project', () => {
    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(ProjectSchema.parse(roundTrip(project))).toEqual(project);
  });

  it('rejects a stored project that is missing requireApproval or any other defaulted field', () => {
    for (const field of ['jurisdiction', 'description', 'injectors', 'formations', 'requireApproval'] as const) {
      const { [field]: _removed, ...bad } = project;
      expect(ok(ProjectSchema, bad), field).toBe(false);
      expect(issuePaths(ProjectSchema, bad), field).toContain(field);
    }
    const { requireApproval: _drop, ...noApproval } = project;
    expect(ok(ProjectExportSchema, { ...fullExport, project: noApproval })).toBe(false);
  });

  it('ProjectInputSchema requires a name and applies defaults', () => {
    expect(ProjectInputSchema.parse({ name: 'Quest' })).toEqual({
      name: 'Quest',
      jurisdiction: 'both',
      description: '',
      injectors: [],
      formations: [],
      requireApproval: false,
    });
    expect(ok(ProjectInputSchema, {})).toBe(false);
    expect(ok(ProjectInputSchema, { name: '' })).toBe(false);
    expect(ok(ProjectInputSchema, { name: '   ' })).toBe(false);
  });

  it('ProjectInputSchema does not carry id, timestamps or actors', () => {
    const parsed = ProjectInputSchema.parse(project);
    for (const key of ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']) {
      expect(key in parsed).toBe(false);
    }
    const input: ProjectInput = { name: 'Quest' };
    expect(input.name).toBe('Quest');
  });

  it('rejects an unknown jurisdiction', () => {
    expect(ok(ProjectSchema, { ...project, jurisdiction: 'USA' })).toBe(false);
    for (const j of ['AER', 'EPA', 'both']) expect(ok(ProjectSchema, { ...project, jurisdiction: j })).toBe(true);
  });

  it('validates injectors: ranges, positive AOR radius, non-empty id and name', () => {
    const inj = project.injectors[0];
    const withInjector = (patch: object) => ({ ...project, injectors: [{ ...inj, ...patch }] });
    expect(ok(ProjectSchema, withInjector({ lat: 91 }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ lon: -181 }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ lat: null }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ aorRadius_m: 0 }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ aorRadius_m: -5 }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ id: '' }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ name: '' }))).toBe(false);
    expect(ok(ProjectSchema, withInjector({ lat: -90, lon: 180, aorRadius_m: 0.5 }))).toBe(true);
  });

  it('validates formations: base_m >= top_m >= 0, role, integer order >= 0, non-empty name', () => {
    const fm = project.formations[0];
    const withFormation = (patch: object) => ({ ...project, formations: [{ ...fm, ...patch }] });
    expect(ok(ProjectSchema, withFormation({ top_m: 2000, base_m: 1999 }))).toBe(false);
    expect(ok(ProjectSchema, withFormation({ top_m: -1 }))).toBe(false);
    expect(ok(ProjectSchema, withFormation({ role: 'cap' }))).toBe(false);
    expect(ok(ProjectSchema, withFormation({ order: -1 }))).toBe(false);
    expect(ok(ProjectSchema, withFormation({ order: 1.5 }))).toBe(false);
    expect(ok(ProjectSchema, withFormation({ name: '' }))).toBe(false);
    expect(ok(ProjectSchema, withFormation({ top_m: 0, base_m: 0, role: 'other' }))).toBe(true);
    expect(issuePaths(ProjectSchema, withFormation({ top_m: 2000, base_m: 1999 }))).toContain(
      'formations.0.base_m',
    );
  });
});

describe('AssessmentSchema', () => {
  it('accepts a final with computed and a draft with computed null', () => {
    expect(AssessmentSchema.parse(finalAssessment)).toEqual(finalAssessment);
    expect(AssessmentSchema.parse(draftAssessment)).toEqual(draftAssessment);
  });

  it('rejects a final with computed null, naming computed', () => {
    const bad = { ...finalAssessment, computed: null };
    expect(ok(AssessmentSchema, bad)).toBe(false);
    expect(issuePaths(AssessmentSchema, bad)).toContain('computed');
  });

  it('rejects a draft with computed non-null, naming computed', () => {
    const bad = { ...draftAssessment, computed: finalAssessment.computed };
    expect(ok(AssessmentSchema, bad)).toBe(false);
    expect(issuePaths(AssessmentSchema, bad)).toContain('computed');
  });

  it('rejects a final with assessedAt null, naming assessedAt', () => {
    const bad = { ...finalAssessment, assessedAt: null };
    expect(ok(AssessmentSchema, bad)).toBe(false);
    expect(issuePaths(AssessmentSchema, bad)).toContain('assessedAt');
  });

  it('rejects an unknown status', () => {
    expect(ok(AssessmentSchema, { ...finalAssessment, status: 'approved' })).toBe(false);
  });

  it('requires finite computed numbers, integer Lr/Cr/cell and a string rank', () => {
    const c = finalAssessment.computed;
    const withComputed = (patch: object) => ({ ...finalAssessment, computed: { ...c, ...patch } });
    expect(ok(AssessmentSchema, withComputed({ L: Number.NaN }))).toBe(false);
    expect(ok(AssessmentSchema, withComputed({ riskIndex: Number.POSITIVE_INFINITY }))).toBe(false);
    expect(ok(AssessmentSchema, withComputed({ Lr: 2.5 }))).toBe(false);
    expect(ok(AssessmentSchema, withComputed({ Cr: 2.5 }))).toBe(false);
    expect(ok(AssessmentSchema, withComputed({ cell: 9.5 }))).toBe(false);
    expect(ok(AssessmentSchema, withComputed({ rank: 3 }))).toBe(false);
    expect(ok(AssessmentSchema, withComputed({ rank: undefined }))).toBe(false);
  });

  it('validates scores, justifications, suggestions and recommendedAction', () => {
    const { plume: _omitted, ...missing } = scores;
    expect(ok(AssessmentSchema, { ...finalAssessment, scores: missing })).toBe(false);
    expect(ok(AssessmentSchema, { ...finalAssessment, justifications: { age: 5 } })).toBe(false);
    expect(
      ok(AssessmentSchema, { ...finalAssessment, suggestions: { age: { score: 9, source: 'derived', basis: 'x' } } }),
    ).toBe(false);
    expect(
      ok(AssessmentSchema, { ...finalAssessment, recommendedAction: { auto: 'Monitor', override: 'Re-plug' } }),
    ).toBe(true);
    expect(ok(AssessmentSchema, { ...finalAssessment, recommendedAction: { auto: 'Monitor' } })).toBe(false);
  });

  it('allows approval fields to be set on a final', () => {
    expect(
      ok(AssessmentSchema, { ...finalAssessment, approvedByName: 'Jo Admin', approvedAt: T1 }),
    ).toBe(true);
    expect(ok(AssessmentSchema, { ...finalAssessment, approvedAt: 'not a date' })).toBe(false);
  });
});

describe('MethodologyRecordSchema', () => {
  it('accepts a published methodology and round-trips through JSON', () => {
    expect(MethodologyRecordSchema.parse(methodologyRecord)).toEqual(methodologyRecord);
    expect(MethodologyRecordSchema.parse(roundTrip(methodologyRecord))).toEqual(methodologyRecord);
  });

  it('rejects a malformed methodology, a blank revision and a bad publishedAt', () => {
    expect(ok(MethodologyRecordSchema, { ...methodologyRecord, methodology: { revision: '2.0.0' } })).toBe(false);
    expect(ok(MethodologyRecordSchema, { ...methodologyRecord, revision: '' })).toBe(false);
    expect(ok(MethodologyRecordSchema, { ...methodologyRecord, publishedAt: 'today' })).toBe(false);
  });

  it('refuses a band class other than low, mod, high, crit, with a readable message', () => {
    const bands = methodologyRecord.methodology.matrix.bands.map((b) => (b.cls === 'crit' ? { ...b, cls: 'critical' } : b));
    const parsed = MethodologyRecordSchema.safeParse({
      ...methodologyRecord,
      methodology: { ...methodologyRecord.methodology, matrix: { bands } },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['methodology.matrix.bands.3.cls', 'band class must be one of low, mod, high, crit'],
    ]);
  });
});

describe('AuditEventSchema', () => {
  it('accepts an event with and without a project', () => {
    expect(AuditEventSchema.parse(auditEvent)).toEqual(auditEvent);
    expect(ok(AuditEventSchema, { ...auditEvent, projectId: null, entity: 'methodology' })).toBe(true);
  });

  it('accepts every entity and action, and rejects others', () => {
    for (const entity of ['project', 'well', 'assessment', 'methodology']) {
      expect(ok(AuditEventSchema, { ...auditEvent, entity })).toBe(true);
    }
    for (const action of ['create', 'update', 'finalise', 'delete', 'import', 'export']) {
      expect(ok(AuditEventSchema, { ...auditEvent, action })).toBe(true);
    }
    expect(ok(AuditEventSchema, { ...auditEvent, entity: 'document' })).toBe(false);
    expect(ok(AuditEventSchema, { ...auditEvent, action: 'approve' })).toBe(false);
  });

  it('requires diff.before and diff.after to be present and not undefined (JSON drops undefined)', () => {
    expect(ok(AuditEventSchema, { ...auditEvent, diff: { before: null, after: null } })).toBe(true);
    expect(ok(AuditEventSchema, { ...auditEvent, diff: { before: { a: 1 }, after: [1, 2] } })).toBe(true);
    expect(ok(AuditEventSchema, { ...auditEvent, diff: { after: 1 } })).toBe(false);
    expect(ok(AuditEventSchema, { ...auditEvent, diff: { before: undefined, after: 1 } })).toBe(false);
    expect(ok(AuditEventSchema, { ...auditEvent, diff: undefined })).toBe(false);
  });

  it('rejects an empty id and a non-UTC timestamp', () => {
    expect(ok(AuditEventSchema, { ...auditEvent, id: '' })).toBe(false);
    expect(ok(AuditEventSchema, { ...auditEvent, at: '2026-10-20' })).toBe(false);
  });
});

describe('ReviewerProfileSchema', () => {
  it('accepts a 2+ character name and 2-3 character initials, trimming both', () => {
    expect(ReviewerProfileSchema.parse(reviewer)).toEqual(reviewer);
    expect(ReviewerProfileSchema.parse({ name: '  Al  ', initials: ' ABC ' })).toEqual({
      name: 'Al',
      initials: 'ABC',
    });
  });

  it('rejects a short name and out-of-range initials, judged after trimming', () => {
    for (const name of ['', 'A', '  A  ', '   ']) {
      expect(ok(ReviewerProfileSchema, { ...reviewer, name })).toBe(false);
    }
    for (const initials of ['', 'T', ' T ', 'TCRA']) {
      expect(ok(ReviewerProfileSchema, { ...reviewer, initials })).toBe(false);
    }
  });
});

describe('ProjectExportSchema', () => {
  const minimal: ProjectExport = {
    format: 'lwa-project',
    version: 1,
    exportedAt: T1,
    exportedBy: ACTOR,
    project,
    wells: [],
    assessments: [],
    methodologies: [],
    auditEvents: [],
  };

  it('round-trips a minimal export: parse(JSON.parse(JSON.stringify(x))) deep-equals x', () => {
    expect(ProjectExportSchema.parse(roundTrip(minimal))).toEqual(minimal);
  });

  it('round-trips a full export whose well has a non-null construction with a plug', () => {
    const parsed = ProjectExportSchema.parse(roundTrip(fullExport));
    expect(parsed).toEqual(fullExport);
    expect(parsed.wells[0]?.construction?.plugs).toHaveLength(1);
    expect(parsed.assessments.map((a) => a.status)).toEqual(['final', 'draft']);
  });

  it('rejects a different format or version', () => {
    expect(ok(ProjectExportSchema, { ...minimal, format: 'something-else' })).toBe(false);
    expect(ok(ProjectExportSchema, { ...minimal, version: 2 })).toBe(false);
    expect(ok(ProjectExportSchema, { ...minimal, version: '1' })).toBe(false);
  });

  it('requires all five arrays', () => {
    for (const key of ['wells', 'assessments', 'methodologies', 'auditEvents'] as const) {
      const { [key]: _removed, ...without } = minimal;
      expect(ok(ProjectExportSchema, without)).toBe(false);
    }
    const { project: _project, ...noProject } = minimal;
    expect(ok(ProjectExportSchema, noProject)).toBe(false);
  });

  it('rejects an invalid nested record and names where', () => {
    const bad = { ...fullExport, wells: [{ ...well, lat: 200 }] };
    expect(ok(ProjectExportSchema, bad)).toBe(false);
    expect(issuePaths(ProjectExportSchema, bad)).toContain('wells.0.lat');
    const badAssessment = { ...fullExport, assessments: [{ ...finalAssessment, computed: null }] };
    expect(issuePaths(ProjectExportSchema, badAssessment)).toContain('assessments.0.computed');
  });

  it('rejects a bad exportedAt', () => {
    expect(ok(ProjectExportSchema, { ...minimal, exportedAt: 'now' })).toBe(false);
  });
});

describe('newId', () => {
  it.each(['prj', 'wel', 'asm', 'aud'] as const)('newId("%s") matches /^%s_[0-9a-f-]{36}$/', (prefix) => {
    expect(newId(prefix)).toMatch(new RegExp(`^${prefix}_[0-9a-f-]{36}$`));
  });

  it('wraps a version-4 UUID', () => {
    expect(newId('wel')).toMatch(/^wel_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('asm')));
    expect(ids.size).toBe(500);
  });

  it('only accepts the four prefixes', () => {
    // @ts-expect-error 'doc' is not an id prefix
    const bad = (): string => newId('doc');
    expect(typeof bad).toBe('function');
  });
});

describe('public surface', () => {
  it('re-exports the schemas and newId from the package index', () => {
    expect(engine.WellSchema).toBe(WellSchema);
    expect(engine.ProjectExportSchema).toBe(ProjectExportSchema);
    expect(engine.AssessmentSchema).toBe(AssessmentSchema);
    expect(engine.newId).toBe(newId);
    expect(engine.WELL_TYPES).toBe(WELL_TYPES);
  });
});
