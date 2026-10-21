// Project settings' editing model (spec §4.7): the injectors and the formation column as rows of
// input text, checked before the one save that writes each list. Pure; the editors
// (components/settings/InjectorsEditor.tsx, FormationsEditor.tsx) own the state.
//
// - Numbers are plain decimals with a point ("53.7637"): no hex, no exponent, no thousands
//   separator, no comma. Blank is an error: every field of a row is required.
// - Rows keep the stored id; added rows get a new one (`inj_<uuid>`, `fm_<uuid>`; the engine's
//   newId covers only prj/wel/asm/aud), so ids stay unique and a saved project always re-imports.
// - The formation column is ordered by row position: `order` is the row's index when it is read.
import type { Project } from '@lwa/engine';
import { numberText } from '@/lib/construction-edit';

export type Injector = Project['injectors'][number];
export type Formation = Project['formations'][number];
export type FormationRole = Formation['role'];

/** The AoR radius a new injector row starts with. */
export const DEFAULT_AOR_RADIUS_M = 5000;

export const FORMATION_ROLES: readonly { value: FormationRole; label: string }[] = [
  { value: 'seal', label: 'Seal' },
  { value: 'reservoir', label: 'Reservoir' },
  { value: 'other', label: 'Other' },
];

export type InjectorRow = { id: string; name: string; lat: string; lon: string; radius: string };
export type FormationRow = { id: string; name: string; top: string; base: string; role: FormationRole };

export type InjectorField = 'name' | 'lat' | 'lon' | 'radius';
export type FormationField = 'name' | 'top' | 'base';

/** A row's problems, one message per field. Empty when the row is valid. */
export type RowErrors<F extends string> = Partial<Record<F, string>>;

/** Every row read, or the problems of each invalid row by row id. */
export type ReadRows<T, F extends string> = { ok: true; value: T[] } | { ok: false; errors: Record<string, RowErrors<F>> };

/* ---------- numbers ---------- */

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export type ReadNumber = { ok: true; value: number } | { ok: false; message: string };

/**
 * A required number field's text as a number. Blank gives `blank`; anything but a plain decimal
 * with a point gives a message that names the point, with `example`.
 */
export function readDecimal(text: string, messages: { blank: string; example: string }): ReadNumber {
  const t = text.trim();
  if (t === '') return { ok: false, message: messages.blank };
  if (!DECIMAL.test(t)) {
    return {
      ok: false,
      message: `Use digits only, with a point (.) as the decimal separator, e.g. ${messages.example}.`,
    };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, message: 'Enter a smaller number.' };
  return { ok: true, value: n === 0 ? 0 : n }; // never -0
}

/* ---------- ids ---------- */

export function newInjectorId(): string {
  return `inj_${crypto.randomUUID()}`;
}

export function newFormationId(): string {
  return `fm_${crypto.randomUUID()}`;
}

/* ---------- injectors ---------- */

export function injectorRows(injectors: readonly Injector[]): InjectorRow[] {
  return injectors.map((i) => ({
    id: i.id,
    name: i.name,
    lat: numberText(i.lat),
    lon: numberText(i.lon),
    radius: numberText(i.aorRadius_m),
  }));
}

export function blankInjectorRow(id: string = newInjectorId()): InjectorRow {
  return { id, name: '', lat: '', lon: '', radius: String(DEFAULT_AOR_RADIUS_M) };
}

type CheckedInjector = { errors: RowErrors<InjectorField>; value: Injector | null };

function checkInjector(row: InjectorRow): CheckedInjector {
  const errors: RowErrors<InjectorField> = {};
  const name = row.name.trim();
  if (name === '') errors.name = 'Enter a name.';

  const lat = readDecimal(row.lat, { blank: 'Enter the latitude.', example: '53.7637' });
  if (!lat.ok) errors.lat = lat.message;
  else if (lat.value < -90 || lat.value > 90) errors.lat = 'Latitude must be from −90 to 90.';

  const lon = readDecimal(row.lon, { blank: 'Enter the longitude.', example: '-113.2491' });
  if (!lon.ok) errors.lon = lon.message;
  else if (lon.value < -180 || lon.value > 180) errors.lon = 'Longitude must be from −180 to 180.';

  const radius = readDecimal(row.radius, { blank: 'Enter the AoR radius.', example: '5000' });
  if (!radius.ok) errors.radius = radius.message;
  else if (radius.value <= 0) errors.radius = 'The AoR radius must be more than 0 m.';

  const value =
    Object.keys(errors).length === 0 && lat.ok && lon.ok && radius.ok
      ? { id: row.id, name, lat: lat.value, lon: lon.value, aorRadius_m: radius.value }
      : null;
  return { errors, value };
}

export function injectorErrors(row: InjectorRow): RowErrors<InjectorField> {
  return checkInjector(row).errors;
}

export function readInjectors(rows: readonly InjectorRow[]): ReadRows<Injector, InjectorField> {
  return readAll(rows, checkInjector);
}

/* ---------- formations ---------- */

/** The formation column top to bottom: by stored `order` (ties keep their stored sequence). */
export function formationRows(formations: readonly Formation[]): FormationRow[] {
  return [...formations]
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ id: f.id, name: f.name, top: numberText(f.top_m), base: numberText(f.base_m), role: f.role }));
}

export function blankFormationRow(id: string = newFormationId()): FormationRow {
  return { id, name: '', top: '', base: '', role: 'other' };
}

type CheckedFormation = { errors: RowErrors<FormationField>; value: Omit<Formation, 'order'> | null };

function readDepth(text: string, blank: string): ReadNumber {
  const read = readDecimal(text, { blank, example: '1080.5' });
  if (read.ok && read.value < 0) return { ok: false, message: 'Depths are 0 m or more.' };
  return read;
}

function checkFormation(row: FormationRow): CheckedFormation {
  const errors: RowErrors<FormationField> = {};
  const name = row.name.trim();
  if (name === '') errors.name = 'Enter a name.';
  const top = readDepth(row.top, 'Enter the top depth.');
  if (!top.ok) errors.top = top.message;
  const base = readDepth(row.base, 'Enter the base depth.');
  if (!base.ok) errors.base = base.message;
  else if (top.ok && base.value < top.value) errors.base = 'The base must be as deep as the top or deeper.';

  const value =
    Object.keys(errors).length === 0 && top.ok && base.ok
      ? { id: row.id, name, top_m: top.value, base_m: base.value, role: row.role }
      : null;
  return { errors, value };
}

export function formationErrors(row: FormationRow): RowErrors<FormationField> {
  return checkFormation(row).errors;
}

/** The column as stored: `order` is each row's position. */
export function readFormations(rows: readonly FormationRow[]): ReadRows<Formation, FormationField> {
  const read = readAll(rows, checkFormation);
  return read.ok ? { ok: true, value: read.value.map((f, order) => ({ ...f, order })) } : read;
}

/* ---------- shared ---------- */

function readAll<R extends { id: string }, T, F extends string>(
  rows: readonly R[],
  check: (row: R) => { errors: RowErrors<F>; value: T | null },
): ReadRows<T, F> {
  const value: T[] = [];
  const errors: Record<string, RowErrors<F>> = {};
  for (const row of rows) {
    const checked = check(row);
    if (checked.value === null) errors[row.id] = checked.errors;
    else value.push(checked.value);
  }
  return Object.keys(errors).length === 0 ? { ok: true, value } : { ok: false, errors };
}

/** The rows with the one at `index` moved one place up (-1) or down (+1); unchanged past either end. */
export function moveRow<T>(rows: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  const next = [...rows];
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return next;
  const [row] = next.splice(index, 1) as [T];
  next.splice(target, 0, row);
  return next;
}
