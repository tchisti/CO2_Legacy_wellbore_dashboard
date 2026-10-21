'use client';

// The wellbore schematic (schematic spec 2026-08-07 §5, §6): the engine's SVG for a construction
// record. It is drawn at the size of its box, so the engine's 11 px labels stay 11 px and at 1×
// the whole well is in view (taller, and scrolled, only when the depth ticks would crowd: the
// height never depends on the unit, so m and ft share one viewBox). 1.5× and 2× enlarge the
// drawing inside the box, scrolled. Hovering or clicking a drawn component (an element with
// data-kind and data-id) is reported by its data-id ("plug:0"), so the rows editor can mark the
// matching row; `highlightId` gives that component the engine's accent stroke. The caption under
// the drawing reads the highlighted component's own description (its aria-label). Without a
// positive TD the engine draws nothing, and the schematic says what is missing instead.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { RulerIcon } from 'lucide-react';
import { depthScale, renderWellboreSVG, type DepthUnit, type WellboreInput } from '@lwa/engine';
import { cn } from '@/lib/utils';

export const NO_TD_MESSAGE = 'Add a total depth to draw the schematic';

/** The drawing's box (literal class lists, so Tailwind reads them from here). */
const SIZES = {
  editor: 'h-[calc(100vh-17.5rem)] min-h-[26rem]',
  sheet: 'h-[60vh] xl:h-[calc(100vh-13rem)]',
} as const;

/** The engine's margins (axis title, surface, bottom) and the room its gutters and bore need. */
const MARGINS_Y = 80;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 320;
/** Tick labels are 11 px; closer than this they run into each other. */
const TICK_SPACING = 11;

/**
 * The pixel size to draw at: the box, but tall enough for the (denser) foot ticks in either unit.
 * The printed dossier draws at this size too, for a box of its own.
 */
export function drawingSize(box: { w: number; h: number } | null, td: number | null | undefined) {
  if (!box) return {};
  const ticks = typeof td === 'number' && td > 0 ? depthScale(td, 1).ticks('ft').length : 0;
  return {
    width: Math.max(MIN_WIDTH, Math.floor(box.w)),
    height: Math.max(MIN_HEIGHT, Math.floor(box.h), MARGINS_Y + ticks * TICK_SPACING),
  };
}

export type SchematicSize = keyof typeof SIZES;

/** The drawn component an event happened on, if any. */
function componentId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-kind][data-id]')?.getAttribute('data-id') ?? null;
}

export function Schematic({
  wellbore,
  unit,
  highlightId = null,
  onHover,
  onSelect,
  zoom = 1,
  size = 'editor',
  hint = 'Hover a component for its details.',
  emptyMessageId,
  className,
}: {
  /** What to draw (the TD fallback already applied); null draws nothing. */
  wellbore: WellboreInput | null;
  unit: DepthUnit;
  /** The data-id to draw with the accent stroke. */
  highlightId?: string | null;
  /** The data-id under the pointer, or null when it leaves the components. */
  onHover?: (id: string | null) => void;
  /** The data-id clicked, or null for a click on empty space. */
  onSelect?: (id: string | null) => void;
  zoom?: number;
  size?: SchematicSize;
  /** The caption while nothing is highlighted. */
  hint?: string;
  /** An id for the no-TD message, so the TD input can point at it (aria-describedby). */
  emptyMessageId?: string;
  className?: string;
}) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const { width, height } = drawingSize(box, wellbore?.td);
  const svg = useMemo(
    () => (wellbore ? renderWellboreSVG(wellbore, { unit, highlightId, width, height }) : ''),
    [wellbore, unit, highlightId, width, height],
  );
  const hostRef = useRef<HTMLDivElement>(null);
  // The box's inner size, kept current (ResizeObserver reports before the frame is painted).
  const viewportRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const next = { w: el.clientWidth, h: el.clientHeight };
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const captionRef = useRef<HTMLParagraphElement>(null);
  const hovered = useRef<string | null>(null);

  // The caption is written straight into its node once the new drawing is in the DOM (it reads
  // the aria-label the browser has decoded), so a hover costs no extra render.
  useLayoutEffect(() => {
    const caption = captionRef.current;
    if (!caption) return;
    const el = highlightId ? hostRef.current?.querySelector(`[data-id="${CSS.escape(highlightId)}"]`) : null;
    caption.textContent = el?.getAttribute('aria-label') ?? hint;
  }, [svg, highlightId, hint]);

  if (!svg) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-surface px-6 py-16 text-center',
          className,
        )}
      >
        <span className="grid size-9 place-items-center rounded-full bg-subtle text-muted-foreground">
          <RulerIcon aria-hidden="true" className="size-4.5" />
        </span>
        <p id={emptyMessageId} className="text-sm text-ink">
          {NO_TD_MESSAGE}
        </p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The drawing is to scale from the surface to TD, so it needs the record&apos;s TD or the well&apos;s.
        </p>
      </div>
    );
  }

  const over = (e: MouseEvent) => {
    const id = componentId(e.target);
    if (id === hovered.current) return;
    hovered.current = id;
    onHover?.(id);
  };
  const leave = () => {
    if (hovered.current === null) return;
    hovered.current = null;
    onHover?.(null);
  };

  return (
    <div role="group" aria-label="Wellbore schematic" className={cn('grid min-w-0 gap-1.5', className)}>
      <div ref={viewportRef} className={cn('overflow-auto rounded-lg border bg-surface', SIZES[size])}>
        <div
          ref={hostRef}
          onMouseOver={over}
          onMouseLeave={leave}
          onClick={onSelect ? (e) => onSelect(componentId(e.target)) : undefined}
          style={zoom === 1 ? undefined : { width: `${zoom * 100}%` }}
          className={cn(
            'text-ink [&>svg]:block [&>svg]:h-auto [&>svg]:w-full',
            // The engine draws packers black, which vanishes on the dark surface: use the ink colour.
            '[&_[data-kind=packer]_polygon]:fill-ink',
            onSelect && '[&_[data-id]]:cursor-pointer',
          )}
          // Safe to inject: renderWellboreSVG builds the markup from numbers and from text it
          // escapes itself (every label, name and note goes through its `esc`), never raw input.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <p ref={captionRef} data-caption className="min-h-4 truncate px-0.5 text-xs text-muted-foreground" />
    </div>
  );
}
