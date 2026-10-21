import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@lwa/engine';
import {
  DEFAULT_AOR_RADIUS_M,
  blankFormationRow,
  blankInjectorRow,
  formationErrors,
  formationRows,
  injectorErrors,
  injectorRows,
  moveRow,
  newFormationId,
  newInjectorId,
  readDecimal,
  readFormations,
  readInjectors,
  type FormationRow,
  type InjectorRow,
} from '@/lib/settings-edit';

const PINE: Project['injectors'][number] = {
  id: 'INJ-PINE',
  name: 'Pine (proposed)',
  lat: 53.788997,
  lon: -113.249007,
  aorRadius_m: 5000,
};

const injector = (patch: Partial<InjectorRow> = {}): InjectorRow => ({
  id: 'inj_1',
  name: 'Birch',
  lat: '53.7637',
  lon: '-113.2491',
  radius: '5000',
  ...patch,
});

const formation = (patch: Partial<FormationRow> = {}): FormationRow => ({
  id: 'fm_1',
  name: 'Nisku',
  top: '1080',
  base: '1160',
  role: 'reservoir',
  ...patch,
});

describe('readDecimal', () => {
  it.each([
    ['53.7637', 53.7637],
    [' -113.2491 ', -113.2491],
    ['+5', 5],
    ['5.', 5],
    ['.5', 0.5],
    ['-0', 0],
  ])('reads %j as %d', (text, value) => {
    const read = readDecimal(text, { blank: 'Enter it.', example: '1.5' });
    expect(read).toEqual({ ok: true, value });
    if (read.ok) expect(Object.is(read.value, -0)).toBe(false);
  });

  it.each(['0x10', '1e3', '1,5', '1 000', '5m', '--5', '.', 'NaN', 'Infinity'])(
    'refuses %j with a message about the decimal point',
    (text) => {
      const read = readDecimal(text, { blank: 'Enter it.', example: '1463.5' });
      expect(read.ok).toBe(false);
      if (!read.ok) {
        expect(read.message).toMatch(/point/);
        expect(read.message).toContain('1463.5');
      }
    },
  );

  it('uses the blank message for empty text', () => {
    expect(readDecimal('   ', { blank: 'Enter the latitude.', example: '1' })).toEqual({
      ok: false,
      message: 'Enter the latitude.',
    });
  });

  it('refuses a number too large to hold', () => {
    const read = readDecimal('9'.repeat(400), { blank: 'x', example: '1' });
    expect(read).toEqual({ ok: false, message: 'Enter a smaller number.' });
  });
});

describe('ids', () => {
  it('generates injector and formation ids with their prefixes', () => {
    expect(newInjectorId()).toMatch(/^inj_[0-9a-f-]{36}$/);
    expect(newFormationId()).toMatch(/^fm_[0-9a-f-]{36}$/);
    expect(newInjectorId()).not.toBe(newInjectorId());
  });

  describe('on a page without crypto.randomUUID (served over plain HTTP, not a secure context)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('still generates distinct version 4 ids', () => {
      const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
      vi.stubGlobal('crypto', { getRandomValues });
      const v4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
      const injectorId = newInjectorId();
      const formationId = newFormationId();
      expect(injectorId).toMatch(new RegExp(`^inj_${v4}$`));
      expect(formationId).toMatch(new RegExp(`^fm_${v4}$`));
      expect(blankInjectorRow().id).toMatch(new RegExp(`^inj_${v4}$`));
      expect(newInjectorId()).not.toBe(injectorId);
    });
  });
});

describe('injector rows', () => {
  it('turns stored injectors into rows of text and back without loss', () => {
    const rows = injectorRows([PINE, { ...PINE, id: 'INJ-TINY', lat: 0.0000001, lon: 0 }]);
    expect(rows[0]).toEqual({ id: 'INJ-PINE', name: 'Pine (proposed)', lat: '53.788997', lon: '-113.249007', radius: '5000' });
    expect(rows[1]!.lat).toBe('0.0000001'); // never "1e-7", which would not read back
    expect(readInjectors(rows)).toEqual({ ok: true, value: [PINE, { ...PINE, id: 'INJ-TINY', lat: 0.0000001, lon: 0 }] });
  });

  it('a blank row has a fresh id and the default AoR radius of 5000 m', () => {
    const row = blankInjectorRow();
    expect(row).toMatchObject({ name: '', lat: '', lon: '', radius: '5000' });
    expect(row.id).toMatch(/^inj_/);
    expect(DEFAULT_AOR_RADIUS_M).toBe(5000);
  });

  it('a valid row has no errors and reads with a trimmed name', () => {
    expect(injectorErrors(injector())).toEqual({});
    expect(readInjectors([injector({ name: '  Birch  ' })])).toEqual({
      ok: true,
      value: [{ id: 'inj_1', name: 'Birch', lat: 53.7637, lon: -113.2491, aorRadius_m: 5000 }],
    });
  });

  it('requires a name and every number', () => {
    expect(injectorErrors({ id: 'inj_1', name: ' ', lat: '', lon: '', radius: '' })).toEqual({
      name: 'Enter a name.',
      lat: 'Enter the latitude.',
      lon: 'Enter the longitude.',
      radius: 'Enter the AoR radius.',
    });
  });

  it('keeps latitude within −90 to 90 and longitude within −180 to 180', () => {
    expect(injectorErrors(injector({ lat: '91' })).lat).toBe('Latitude must be from −90 to 90.');
    expect(injectorErrors(injector({ lat: '-90.5' })).lat).toBe('Latitude must be from −90 to 90.');
    expect(injectorErrors(injector({ lat: '90', lon: '-180' }))).toEqual({});
    expect(injectorErrors(injector({ lon: '180.01' })).lon).toBe('Longitude must be from −180 to 180.');
  });

  it('refuses hex, exponents and commas in coordinates', () => {
    expect(injectorErrors(injector({ lat: '0x10' })).lat).toMatch(/point/);
    expect(injectorErrors(injector({ lon: '-1.1e2' })).lon).toMatch(/point/);
    expect(injectorErrors(injector({ lat: '53,76' })).lat).toMatch(/point/);
  });

  it('requires an AoR radius above 0', () => {
    expect(injectorErrors(injector({ radius: '0' })).radius).toBe('The AoR radius must be more than 0 m.');
    expect(injectorErrors(injector({ radius: '-5' })).radius).toBe('The AoR radius must be more than 0 m.');
    expect(injectorErrors(injector({ radius: '0.5' }))).toEqual({});
  });

  it('reports every invalid row by id and reads nothing', () => {
    const read = readInjectors([injector(), injector({ id: 'inj_2', lat: '91' }), injector({ id: 'inj_3', name: '' })]);
    expect(read).toEqual({
      ok: false,
      errors: { inj_2: { lat: 'Latitude must be from −90 to 90.' }, inj_3: { name: 'Enter a name.' } },
    });
  });
});

describe('formation rows', () => {
  const stored: Project['formations'] = [
    { id: 'fm-b', name: 'Calmar', top_m: 1050, base_m: 1080, role: 'seal', order: 1 },
    { id: 'fm-a', name: 'Wabamun', top_m: 1030, base_m: 1050, role: 'other', order: 0 },
  ];

  it('lists formations in their stored order', () => {
    expect(formationRows(stored).map((r) => r.id)).toEqual(['fm-a', 'fm-b']);
    expect(formationRows(stored)[1]).toEqual({ id: 'fm-b', name: 'Calmar', top: '1050', base: '1080', role: 'seal' });
  });

  it('reads rows with order = row position', () => {
    const rows = moveRow(formationRows(stored), 1, -1);
    expect(readFormations(rows)).toEqual({
      ok: true,
      value: [
        { id: 'fm-b', name: 'Calmar', top_m: 1050, base_m: 1080, role: 'seal', order: 0 },
        { id: 'fm-a', name: 'Wabamun', top_m: 1030, base_m: 1050, role: 'other', order: 1 },
      ],
    });
  });

  it('a blank row has a fresh id and the role Other', () => {
    const row = blankFormationRow();
    expect(row).toMatchObject({ name: '', top: '', base: '', role: 'other' });
    expect(row.id).toMatch(/^fm_/);
  });

  it('requires a name, a top and a base, each 0 m or more', () => {
    expect(formationErrors(formation({ name: '', top: '', base: '' }))).toEqual({
      name: 'Enter a name.',
      top: 'Enter the top depth.',
      base: 'Enter the base depth.',
    });
    expect(formationErrors(formation({ top: '-1' })).top).toBe('Depths are 0 m or more.');
    expect(formationErrors(formation({ top: '1e3' })).top).toMatch(/point/);
  });

  it('requires the base at or below the top', () => {
    expect(formationErrors(formation({ top: '1160', base: '1080' }))).toEqual({
      base: 'The base must be as deep as the top or deeper.',
    });
    expect(formationErrors(formation({ top: '1080', base: '1080' }))).toEqual({});
  });

  it('reports every invalid row by id and reads nothing', () => {
    expect(readFormations([formation(), formation({ id: 'fm_2', top: '10', base: '5' })])).toEqual({
      ok: false,
      errors: { fm_2: { base: 'The base must be as deep as the top or deeper.' } },
    });
  });
});

describe('moveRow', () => {
  it('moves a row up or down by one and leaves the input untouched', () => {
    const rows = ['a', 'b', 'c'];
    expect(moveRow(rows, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveRow(rows, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(rows).toEqual(['a', 'b', 'c']);
  });

  it('does nothing past either end', () => {
    expect(moveRow(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveRow(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
