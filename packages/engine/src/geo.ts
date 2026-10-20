// Great-circle distance and nearest-injector lookup. Pure maths, no I/O.

export type LatLon = { lat: number; lon: number };

/** A CO2 injector and the radius of its area of review (AoR), in metres. */
export type Injector = { name: string; lat: number; lon: number; aorRadius_m: number };

/** The slice of a well the injector lookup needs; lat/lon may be absent on a record. */
export type NearestInjectorInput = {
  lat?: number | null;
  lon?: number | null;
  injectors?: readonly Injector[];
};

export type NearestInjector = {
  name: string;
  /** Distance from the well to the nearest injector, in metres. */
  distance_m: number;
  /** True when the well is within `aorRadius_m` of ANY injector, not only the nearest one. */
  insideAoR: boolean;
};

/** Mean Earth radius (IUGG), in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres (haversine, mean-radius sphere). */
export function haversineMetres(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const isCoord = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The nearest injector to the well, or null when the well has no usable lat/lon or there is no
 * injector to measure against. Injectors with non-finite coordinates are ignored. A well exactly
 * `aorRadius_m` from an injector counts as inside its AoR.
 */
export function nearestInjector(input: NearestInjectorInput): NearestInjector | null {
  const { lat, lon } = input;
  if (!isCoord(lat) || !isCoord(lon)) return null;
  const well: LatLon = { lat, lon };

  let nearest: { name: string; distance_m: number } | null = null;
  let insideAoR = false;
  for (const inj of input.injectors ?? []) {
    if (!isCoord(inj.lat) || !isCoord(inj.lon)) continue;
    const distance_m = haversineMetres(well, inj);
    if (nearest === null || distance_m < nearest.distance_m) nearest = { name: inj.name, distance_m };
    if (distance_m <= inj.aorRadius_m) insideAoR = true;
  }
  return nearest === null ? null : { ...nearest, insideAoR };
}
