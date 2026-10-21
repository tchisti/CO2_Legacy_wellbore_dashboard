'use client';

// The 5×5 risk matrix (spec §4.1): current finals counted per cell, likelihood up the side (5 at
// the top), consequence along the bottom (1 at the left). Each cell carries its band's rank colour
// as a light tint (spec §7: rank colours only for rank), stronger where wells sit, with the count
// in mono and the cell value (L × C) small in the corner. Drawn as one vector SVG, so it prints
// crisply. With `hrefFor`, every cell that holds wells is a link (Tab, then Enter) into the Wells
// register filtered to that cell; empty cells are not links.
import type { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { bandFor, type Methodology } from '@lwa/engine';
import { rankColour } from '@/components/domain/RankBadge';
import { plural } from '@/lib/format';
import { MATRIX_SIZE } from '@/lib/portfolio';
import { cn } from '@/lib/utils';

/* Geometry, in viewBox units (drawn at about 1:1 by the width cap below). */
const CELL = 52;
const GAP = 3; // the surface gap between cells
const PLOT_X = 46; // room for the likelihood title and ticks
const PLOT_Y = 2;
const PLOT = MATRIX_SIZE * CELL + (MATRIX_SIZE - 1) * GAP;
const WIDTH = PLOT_X + PLOT + 2;
const HEIGHT = PLOT_Y + PLOT + 42; // room for the consequence ticks and title

const RATINGS = Array.from({ length: MATRIX_SIZE }, (_, i) => i + 1);
const cellX = (Cr: number) => PLOT_X + (Cr - 1) * (CELL + GAP);
const cellY = (Lr: number) => PLOT_Y + (MATRIX_SIZE - Lr) * (CELL + GAP);

/** The accessible name and tooltip of a cell: "L 2 × C 3, cell 6, Moderate: 1 well". */
export function cellLabel(Lr: number, Cr: number, band: string, count: number): string {
  return `L ${Lr} × C ${Cr}, cell ${Lr * Cr}, ${band}: ${count === 0 ? 'no wells' : plural(count, 'well')}`;
}

/** Client-side navigation for a plain left click on an SVG link; modified clicks keep the browser's behaviour. */
function useLinkClick(): (e: MouseEvent<Element>, href: string) => void {
  const router = useRouter();
  return (e, href) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(href);
  };
}

export function Matrix5x5({
  counts,
  methodology,
  hrefFor,
  labelledBy,
  className,
}: {
  /** Current finals per cell, `counts[Lr - 1][Cr - 1]` (PortfolioStats.matrix). */
  counts: readonly (readonly number[])[];
  /** The current methodology: its bands colour and name the cells. */
  methodology: Methodology;
  /** Where a cell with wells links to; without it no cell is a link (print). */
  hrefFor?: (Lr: number, Cr: number) => string;
  /** The id of the heading that names the matrix. */
  labelledBy?: string;
  className?: string;
}) {
  const onLinkClick = useLinkClick();
  const bands = methodology.matrix.bands;

  return (
    <div className={cn('grid justify-items-center gap-3', className)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-labelledby={labelledBy}
        className="h-auto w-full max-w-[22rem] overflow-visible"
      >
        {RATINGS.map((Lr) => (
          <text
            key={`l${Lr}`}
            aria-hidden="true"
            x={PLOT_X - 8}
            y={cellY(Lr) + CELL / 2}
            textAnchor="end"
            dominantBaseline="central"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {Lr}
          </text>
        ))}
        {RATINGS.map((Cr) => (
          <text
            key={`c${Cr}`}
            aria-hidden="true"
            x={cellX(Cr) + CELL / 2}
            y={PLOT_Y + PLOT + 15}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {Cr}
          </text>
        ))}
        <text
          x={12}
          y={PLOT_Y + PLOT / 2}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(-90 12 ${PLOT_Y + PLOT / 2})`}
          className="fill-ink text-[11px] font-medium"
        >
          Likelihood (L)
        </text>
        <text x={PLOT_X + PLOT / 2} y={HEIGHT - 4} textAnchor="middle" className="fill-ink text-[11px] font-medium">
          Consequence (C)
        </text>

        {RATINGS.flatMap((Lr) =>
          RATINGS.map((Cr) => {
            const count = counts[Lr - 1]?.[Cr - 1] ?? 0;
            const band = bandFor(Lr * Cr, methodology);
            const colour = rankColour(band.label) ?? band.color;
            const x = cellX(Cr);
            const y = cellY(Lr);
            const label = cellLabel(Lr, Cr, band.label, count);
            const body = (
              <>
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={4}
                  style={{ fill: colour, fillOpacity: count > 0 ? 0.38 : 0.14 }}
                />
                <text x={x + 5} y={y + 12} aria-hidden="true" className="fill-muted-foreground font-mono text-[9px]">
                  {Lr * Cr}
                </text>
                {count > 0 ? (
                  <text
                    x={x + CELL / 2}
                    y={y + CELL / 2 + 3}
                    aria-hidden="true"
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-ink font-mono text-[17px] font-semibold"
                  >
                    {count}
                  </text>
                ) : null}
              </>
            );
            const key = `${Lr}-${Cr}`;
            if (count === 0 || !hrefFor) {
              return (
                <g key={key} data-cell={key} data-count={count} aria-hidden={count === 0 || undefined}>
                  <title>{label}</title>
                  {body}
                </g>
              );
            }
            const href = hrefFor(Lr, Cr);
            return (
              <a
                key={key}
                href={href}
                data-cell={key}
                data-count={count}
                aria-label={label}
                onClick={(e) => onLinkClick(e, href)}
                className="group cursor-pointer outline-none"
              >
                <title>{label}</title>
                {body}
                {/* hover and keyboard focus: an outline drawn inside the cell, so neighbours keep their gap */}
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={CELL - 2}
                  height={CELL - 2}
                  rx={3.5}
                  className="fill-none stroke-ink/40 opacity-0 group-hover:opacity-100 group-focus-visible:stroke-ring group-focus-visible:opacity-100"
                  strokeWidth={2}
                />
              </a>
            );
          }),
        )}
      </svg>

      <ul aria-label="Bands" className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {bands.map((b) => (
          <li key={b.label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[2px]"
              style={{ backgroundColor: rankColour(b.label) ?? b.color }}
            />
            <span className="text-ink">{b.label}</span>
            <span className="num">
              {b.min}–{b.max}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
