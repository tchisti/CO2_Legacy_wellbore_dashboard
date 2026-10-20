import { mToFt } from './units';
import type { DepthUnit } from './types';

export type DepthTick = { m: number; label: string };
export type DepthScale = {
  yOf: (m: number) => number;
  ticks: (unit: DepthUnit) => DepthTick[];
};

/** Linear depth scale surface(0) → td mapped onto 0 → pxHeight, with ticks
 * every 50 m or 100 ft (step doubled until there are at most 200 steps). */
export function depthScale(td: number, pxHeight: number): DepthScale {
  const yOf = (m: number): number => (td > 0 ? (m / td) * pxHeight : 0);
  const MAX_TICKS = 200; // cap tick count so a corrupt/absurd td can't hang the tab
  const ticks = (unit: DepthUnit): DepthTick[] => {
    const out: DepthTick[] = [];
    if (unit === 'ft') {
      let stepFt = 100;
      while (td > 0 && td / (stepFt * 0.3048) > MAX_TICKS) stepFt *= 2;
      const stepM = stepFt * 0.3048;
      for (let m = 0; m <= td + 1e-9; m += stepM) {
        out.push({ m: +m.toFixed(2), label: String(Math.round(mToFt(m))) });
      }
    } else {
      let stepM = 50;
      while (td > 0 && td / stepM > MAX_TICKS) stepM *= 2;
      for (let m = 0; m <= td + 1e-9; m += stepM) {
        out.push({ m: +m.toFixed(2), label: String(Math.round(m)) });
      }
    }
    return out;
  };
  return { yOf, ticks };
}
