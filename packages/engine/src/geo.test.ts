import { describe, expect, it } from 'vitest';
import { haversineMetres, nearestInjector, type Injector } from './geo';

// Metres per degree of latitude on the 6,371,008.8 m mean-radius sphere the engine uses.
const METRES_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const WELL = { lat: 53.5, lon: -113.25 };

/** An injector exactly `distance_m` due north of WELL. */
function injectorAt(name: string, distance_m: number, aorRadius_m: number): Injector {
  return { name, lat: WELL.lat + distance_m / METRES_PER_DEG, lon: WELL.lon, aorRadius_m };
}

describe('haversineMetres', () => {
  it('Manning 13-6 to Enbridge 8-19 is 4,100 m within 50 m', () => {
    const d = haversineMetres({ lat: 53.728872, lon: -113.269667 }, { lat: 53.763685, lon: -113.249104 });
    expect(Math.abs(d - 4100)).toBeLessThan(50);
  });

  it('is zero between identical points', () => {
    expect(haversineMetres(WELL, WELL)).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 53.728872, lon: -113.269667 };
    const b = { lat: 53.763685, lon: -113.249104 };
    expect(haversineMetres(a, b)).toBe(haversineMetres(b, a));
  });

  it('one degree of latitude is 111,195.08 m on the mean-radius sphere', () => {
    expect(haversineMetres({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195.08, 1);
  });
});

describe('nearestInjector', () => {
  it('returns null when the well has no lat/lon', () => {
    const injectors = [injectorAt('INJ-1', 1000, 3200)];
    expect(nearestInjector({ injectors })).toBeNull();
    expect(nearestInjector({ lat: null, lon: null, injectors })).toBeNull();
    expect(nearestInjector({ lat: WELL.lat, injectors })).toBeNull();
    expect(nearestInjector({ lon: WELL.lon, injectors })).toBeNull();
    expect(nearestInjector({ lat: Number.NaN, lon: WELL.lon, injectors })).toBeNull();
  });

  it('returns null when there are no injectors', () => {
    expect(nearestInjector({ ...WELL })).toBeNull();
    expect(nearestInjector({ ...WELL, injectors: [] })).toBeNull();
  });

  it('returns the nearest injector with its distance', () => {
    const near = nearestInjector({
      ...WELL,
      injectors: [injectorAt('Far', 6000, 7000), injectorAt('Near', 2000, 1500)],
    });
    expect(near?.name).toBe('Near');
    expect(near?.distance_m).toBeCloseTo(2000, 3);
  });

  it('insideAoR is true when the well is within the nearest injector AoR radius', () => {
    const r = nearestInjector({ ...WELL, injectors: [injectorAt('INJ-1', 2999, 3000)] });
    expect(r?.insideAoR).toBe(true);
  });

  it('insideAoR is false when the well is beyond every injector AoR radius', () => {
    const r = nearestInjector({
      ...WELL,
      injectors: [injectorAt('INJ-1', 3001, 3000), injectorAt('INJ-2', 9001, 9000)],
    });
    expect(r?.insideAoR).toBe(false);
  });

  it('ignores injectors with non-finite coordinates, for the nearest one and for insideAoR', () => {
    const broken: Injector[] = [
      { name: 'No lat', lat: Number.NaN, lon: WELL.lon, aorRadius_m: 1e9 },
      { name: 'No lon', lat: WELL.lat, lon: Number.POSITIVE_INFINITY, aorRadius_m: 1e9 },
    ];
    const r = nearestInjector({ ...WELL, injectors: [...broken, injectorAt('Real', 5000, 1000)] });
    expect(r?.name).toBe('Real');
    expect(r?.distance_m).toBeCloseTo(5000, 3);
    expect(r?.insideAoR).toBe(false);
    expect(nearestInjector({ ...WELL, injectors: broken })).toBeNull();
  });

  it('insideAoR is true when the well is inside a farther injector AoR but outside the nearest one', () => {
    const r = nearestInjector({
      ...WELL,
      injectors: [injectorAt('Near', 2000, 1500), injectorAt('Far', 6000, 7000)],
    });
    expect(r?.name).toBe('Near');
    expect(r?.insideAoR).toBe(true);
  });
});
