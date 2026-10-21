'use client';

// The schematic's toolbar (schematic spec 2026-08-07 §6, §8): the depth unit (m | ft; the axis and
// labels are redrawn in it, the geometry is unchanged), zoom (1×, 1.5×, 2×), Export SVG (a
// standalone file with the colours resolved), and Print, which opens the well's report page in a
// new tab so the working copy here is not lost. Export PNG comes with Phase 2.
import Link from 'next/link';
import { DownloadIcon, PrinterIcon } from 'lucide-react';
import type { DepthUnit } from '@lwa/engine';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const ZOOMS = [1, 1.5, 2] as const;
export type Zoom = (typeof ZOOMS)[number];

/** A row of toggle buttons, one of them pressed. */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; text: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center rounded-lg border bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'num h-6 min-w-8 rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50',
            'aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-xs aria-pressed:ring-1 aria-pressed:ring-line',
          )}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

const UNITS: readonly { value: DepthUnit; text: string }[] = [
  { value: 'm', text: 'm' },
  { value: 'ft', text: 'ft' },
];
const ZOOM_OPTIONS: readonly { value: Zoom; text: string }[] = ZOOMS.map((z) => ({ value: z, text: `${z}×` }));

export function SchematicToolbar({
  unit,
  onUnitChange,
  zoom,
  onZoomChange,
  onExport,
  canExport,
  printHref,
}: {
  unit: DepthUnit;
  onUnitChange: (unit: DepthUnit) => void;
  zoom: Zoom;
  onZoomChange: (zoom: Zoom) => void;
  onExport: () => void;
  /** False while there is nothing drawn (no TD). */
  canExport: boolean;
  printHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label="Depth unit" options={UNITS} value={unit} onChange={onUnitChange} />
      <Segmented label="Zoom" options={ZOOM_OPTIONS} value={zoom} onChange={onZoomChange} />
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onExport} disabled={!canExport}>
          <DownloadIcon aria-hidden="true" />
          Export SVG
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href={printHref} target="_blank" rel="noopener">
            <PrinterIcon aria-hidden="true" />
            Print
          </Link>
        </Button>
      </div>
    </div>
  );
}
