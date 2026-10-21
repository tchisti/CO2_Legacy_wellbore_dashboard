// Driver contribution (spec §4.1): which parameters carry the risk across the current
// assessments. One horizontal bar per parameter, largest first, in one neutral colour (rank colours
// are for rank only, spec §7), each with its name and its value to two decimals. One vector SVG
// whose x positions are percentages, so it fills any width without scaling its text; the same
// numbers are in a visually hidden table for screen readers.
import type { Driver } from '@/lib/portfolio';

const ROW = 30; // per parameter: the label line, then the bar
const LABEL_Y = 12;
const BAR_Y = 18;
const BAR_H = 7;
const END_RADIUS = 3; // rounded at the data end, square at the baseline

export const DRIVER_CAPTION =
  "Average weighted contribution (weight × score) across current assessments; Unknown counts at the parameter's unknown score.";

const fmt2 = (n: number): string => n.toFixed(2);

export function DriverBars({ drivers }: { drivers: readonly Driver[] }) {
  const max = Math.max(0, ...drivers.map((d) => d.avgContribution));
  return (
    <>
      <svg width="100%" height={drivers.length * ROW} aria-hidden="true" className="block overflow-visible">
        {drivers.map((d, i) => {
          const y = i * ROW;
          const pct = max > 0 ? (d.avgContribution / max) * 100 : 0;
          return (
            <g key={d.key} data-driver={d.key}>
              <title>{`${d.name}: ${fmt2(d.avgContribution)}`}</title>
              <text x="0" y={y + LABEL_Y} className="fill-ink text-xs">
                {d.name}
              </text>
              <text x="100%" y={y + LABEL_Y} textAnchor="end" className="num fill-ink text-xs">
                {fmt2(d.avgContribution)}
              </text>
              {pct > 0 ? (
                // The bar's own viewport (width = its length) clips the square-baseline patch to the bar.
                <svg x="0" y={y + BAR_Y} width={`${pct}%`} height={BAR_H}>
                  <rect width="100%" height={BAR_H} rx={END_RADIUS} className="fill-muted-foreground" />
                  <rect width={END_RADIUS} height={BAR_H} className="fill-muted-foreground" />
                </svg>
              ) : null}
            </g>
          );
        })}
      </svg>
      {/* The wrapper is the visually hidden box: a table ignores the 1 px width sr-only gives it, and
          would widen a phone page. */}
      <div className="sr-only">
        <table>
          <caption>Driver contribution by parameter, largest first</caption>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Average contribution</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.name}</th>
                <td>{fmt2(d.avgContribution)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
