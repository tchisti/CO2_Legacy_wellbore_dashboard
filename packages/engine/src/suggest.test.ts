import { describe, expect, it } from 'vitest';
import type { Injector } from './geo';
import { suggest, type SuggestInput } from './suggest';

// Metres per degree of latitude on the 6,371,008.8 m mean-radius sphere the engine uses.
const METRES_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const WELL = { lat: 53.5, lon: -113.25 };

/** An injector exactly `distance_m` due north of WELL. */
function injectorAt(name: string, distance_m: number, aorRadius_m: number): Injector {
  return { name, lat: WELL.lat + distance_m / METRES_PER_DEG, lon: WELL.lon, aorRadius_m };
}

describe('suggest: penetration from well classification', () => {
  it.each([
    ['Type 1', 5],
    ['Type 3', 5],
    ['Type 4', 3],
    ['Type 7', 3],
    ['Type 8', 1],
    ['Type 9', 1],
  ] as const)('classification %s → penetration %i', (classification, score) => {
    expect(suggest({ classification }).penetration).toEqual({
      score,
      source: 'derived',
      basis: `from ${classification}`,
    });
  });

  it.each([['Type 0'], ['Type 10'], ['type 3'], ['Type3'], [' Type 3'], ['Type 3 '], [''], [null], [undefined]])(
    'classification %j → no penetration suggestion',
    (classification) => {
      expect(suggest({ classification }).penetration).toBeUndefined();
    },
  );
});

describe('suggest: age from spud year', () => {
  it.each([
    [2010, 1],
    [1995, 1],
    [1980, 3],
    [1965, 3],
    [1949, 5],
  ] as const)('spudYear %i → age %i', (spudYear, score) => {
    expect(suggest({ spudYear }).age).toEqual({
      score,
      source: 'derived',
      basis: `from spud year ${spudYear}`,
    });
  });

  it.each([[1980.5], [Number.NaN], [Number.POSITIVE_INFINITY], [null], [undefined]])(
    'spudYear %j → no age suggestion',
    (spudYear) => {
      expect(suggest({ spudYear }).age).toBeUndefined();
    },
  );
});

describe('suggest: complexity from trajectory', () => {
  it('Vertical → 1', () => {
    expect(suggest({ trajectory: 'Vertical' }).complexity).toEqual({
      score: 1,
      source: 'derived',
      basis: 'from trajectory Vertical',
    });
  });

  it('Deviated → 3', () => {
    expect(suggest({ trajectory: 'Deviated' }).complexity).toEqual({
      score: 3,
      source: 'derived',
      basis: 'from trajectory Deviated',
    });
  });

  it('Horizontal → 3', () => {
    expect(suggest({ trajectory: 'Horizontal' }).complexity).toEqual({
      score: 3,
      source: 'derived',
      basis: 'from trajectory Horizontal',
    });
  });

  it.each([['Unknown'], ['vertical'], ['Directional'], [''], [null], [undefined]])(
    'trajectory %j → no complexity suggestion',
    (trajectory) => {
      expect(suggest({ trajectory }).complexity).toBeUndefined();
    },
  );
});

describe('suggest: barriers from casing count', () => {
  it.each([
    [3, 1, 'from 3 casing strings'],
    [2, 1, 'from 2 casing strings'],
    [1, 3, 'from 1 casing string'],
    [0, 5, 'from 0 casing strings'],
  ] as const)('casingCount %i → barriers %i (%s)', (casingCount, score, basis) => {
    expect(suggest({ casingCount }).barriers).toEqual({ score, source: 'derived', basis });
  });

  it.each([[-1], [1.5], [Number.NaN], [null], [undefined]])('casingCount %j → no barriers suggestion', (casingCount) => {
    expect(suggest({ casingCount }).barriers).toBeUndefined();
  });
});

describe('suggest: plume from nearest injector and AoR', () => {
  it('1000 m from an injector → 5, basis names the corridor rule, the injector and the distance', () => {
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 1000, 3200)] }).plume).toEqual({
      score: 5,
      source: 'derived',
      basis: 'within 1.6 km of INJ-A, 1.0 km away',
    });
  });

  it('2500 m, inside the AoR → 3', () => {
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 2500, 3200)] }).plume).toEqual({
      score: 3,
      source: 'derived',
      basis: 'from 2.5 km to INJ-A, inside the AoR',
    });
  });

  it('4000 m, outside the AoR → 1', () => {
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 4000, 3200)] }).plume).toEqual({
      score: 1,
      source: 'derived',
      basis: 'from 4.0 km to INJ-A, outside the AoR',
    });
  });

  it('the 1,600 m cut-off is strict: 1,599 m → 5, 1,601 m → 3', () => {
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 1599, 3200)] }).plume?.score).toBe(5);
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 1601, 3200)] }).plume?.score).toBe(3);
  });

  it('aorRadius 5000, well 4000 m away → 3 (inside the AoR)', () => {
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 4000, 5000)] }).plume).toEqual({
      score: 3,
      source: 'derived',
      basis: 'from 4.0 km to INJ-A, inside the AoR',
    });
  });

  it('two injectors: nearest is 2000 m away with aorRadius 1500, the other is 6000 m away with aorRadius 7000 → 3', () => {
    const plume = suggest({
      ...WELL,
      injectors: [injectorAt('Far', 6000, 7000), injectorAt('Near', 2000, 1500)],
    }).plume;
    expect(plume).toEqual({
      score: 3,
      source: 'derived',
      basis: 'from 2.0 km to Near, inside the AoR',
    });
  });

  it('within 1,600 m of an injector but outside its tiny AoR still scores 5, and the basis says why (never "outside the AoR")', () => {
    expect(suggest({ ...WELL, injectors: [injectorAt('INJ-A', 1200, 1000)] }).plume).toEqual({
      score: 5,
      source: 'derived',
      basis: 'within 1.6 km of INJ-A, 1.2 km away',
    });
  });

  it('no lat/lon → no plume', () => {
    expect(suggest({ injectors: [injectorAt('INJ-A', 1000, 3200)] }).plume).toBeUndefined();
    expect(suggest({ lat: WELL.lat, lon: null, injectors: [injectorAt('INJ-A', 1000, 3200)] }).plume).toBeUndefined();
  });

  it('no injectors → no plume', () => {
    expect(suggest({ ...WELL }).plume).toBeUndefined();
    expect(suggest({ ...WELL, injectors: [] }).plume).toBeUndefined();
  });
});

describe('suggest: shape', () => {
  const full: SuggestInput = {
    classification: 'Type 3',
    spudYear: 1972,
    trajectory: 'Vertical',
    casingCount: 2,
    ...WELL,
    injectors: [injectorAt('INJ-A', 1000, 3200)],
  };

  it('an empty input suggests nothing', () => {
    expect(suggest({})).toEqual({});
  });

  it('only the five derivable parameters are ever suggested', () => {
    expect(Object.keys(suggest(full)).sort()).toEqual(['age', 'barriers', 'complexity', 'penetration', 'plume']);
  });

  it('every suggestion has source "derived" and a non-empty basis', () => {
    const entries = Object.values(suggest(full));
    expect(entries).toHaveLength(5);
    for (const s of entries) {
      expect(s.source).toBe('derived');
      expect(s.basis.length).toBeGreaterThan(0);
    }
  });
});
