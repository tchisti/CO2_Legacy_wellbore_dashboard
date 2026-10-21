'use client';

// The register's filters as chips (spec §4.2): a text search, then one chip per facet — rank,
// status, class, assessment state, reviewer, "unknown ≥ n" — and the matrix cell when a link set
// one. Each chip opens a menu of options with how many wells have each. Presentational: the page
// owns the filters (in the URL) and passes changes back.
import { useMemo, type CSSProperties } from 'react';
import { CirclePlusIcon, SearchIcon, XIcon } from 'lucide-react';
import { CLASSIFICATIONS, STATUSES } from '@lwa/engine';
import { rankColour } from '@/components/domain/RankBadge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  ASSESSMENT_FILTER_STATES,
  EMPTY_FILTERS,
  STATE_LABELS,
  applyFilters,
  hasActiveFilters,
  type AssessmentFilterState,
  type Filters,
  type WellRow,
} from '@/lib/wells-view';

/** "Unknown ≥ n" choices offered in the menu (a link may carry any n from 1 to 11). */
const UNKNOWN_STEPS = [1, 2, 3, 4, 5] as const;

type Option = { value: string; label: string; count: number };

/** How many of `rows` each option would keep on its own. */
function optionsFor(rows: readonly WellRow[], values: readonly string[], keep: (v: string) => Filters, labels?: Record<string, string>): Option[] {
  return values.map((value) => ({ value, label: labels?.[value] ?? value, count: applyFilters(rows, keep(value)).length }));
}

/** Filters with only `patch` set. */
const only = (patch: Partial<Filters>): Filters => ({ ...EMPTY_FILTERS, ...patch });

function FacetChip({
  label,
  options,
  selected,
  onChange,
  swatch,
}: {
  label: string;
  options: Option[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  /** A colour cue per option (rank only). */
  swatch?: (value: string) => string | undefined;
}) {
  const active = selected.length > 0;
  const toggle = (value: string, on: boolean) =>
    onChange(on ? options.map((o) => o.value).filter((v) => v === value || selected.includes(v)) : selected.filter((v) => v !== value));
  const summary =
    selected.length <= 2 ? selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ') : `${selected.length} selected`;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-1.5 font-normal', active ? 'border-line-strong' : 'border-dashed text-muted-foreground')}
        >
          {active ? null : <CirclePlusIcon aria-hidden="true" />}
          <span className={cn(active && 'text-muted-foreground')}>{label}</span>
          {active ? (
            <>
              <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
              <span className="sr-only">: </span>
              <span className="max-w-48 truncate font-medium text-ink">{summary}</span>
            </>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{label}</DropdownMenuLabel>
        {options.length === 0 ? (
          <p className="px-1.5 py-1 text-sm text-muted-foreground">Nothing to filter by yet.</p>
        ) : (
          options.map((o) => {
            const colour = swatch?.(o.value);
            return (
              <DropdownMenuCheckboxItem
                key={o.value}
                checked={selected.includes(o.value)}
                onCheckedChange={(on) => toggle(o.value, on === true)}
                onSelect={(e) => e.preventDefault()} // keep the menu open to pick several
              >
                {colour ? (
                  <span
                    aria-hidden="true"
                    style={{ '--rank': colour } as CSSProperties}
                    className="size-2 shrink-0 rounded-[2px] bg-(--rank)"
                  />
                ) : null}
                <span className="truncate">{o.label}</span>
                <span className="num ml-auto text-xs text-muted-foreground">{o.count}</span>
              </DropdownMenuCheckboxItem>
            );
          })
        )}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])} className="justify-center text-muted-foreground">
              Clear {label.toLowerCase()} filter
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UnknownChip({
  value,
  rows,
  onChange,
}: {
  value: number | undefined;
  rows: readonly WellRow[];
  onChange: (next: number | undefined) => void;
}) {
  const active = value !== undefined;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-1.5 font-normal', active ? 'border-line-strong' : 'border-dashed text-muted-foreground')}
        >
          {active ? null : <CirclePlusIcon aria-hidden="true" />}
          <span className={cn(active && 'text-muted-foreground')}>Unknowns</span>
          {active ? (
            <>
              <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
              <span className="sr-only">: </span>
              <span className="font-medium text-ink">≥ {value}</span>
            </>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Parameters scored “unknown” in the current assessment
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={active ? String(value) : 'any'}
          onValueChange={(v) => onChange(v === 'any' ? undefined : Number(v))}
        >
          <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
          {UNKNOWN_STEPS.map((n) => (
            <DropdownMenuRadioItem key={n} value={String(n)}>
              <span>At least {n}</span>
              <span className="num ml-auto text-xs text-muted-foreground">
                {applyFilters(rows, only({ minUnknown: n })).length}
              </span>
            </DropdownMenuRadioItem>
          ))}
          {active && !(UNKNOWN_STEPS as readonly number[]).includes(value) ? (
            <DropdownMenuRadioItem value={String(value)}>At least {value}</DropdownMenuRadioItem>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WellFilters({
  rows,
  filters,
  rankLabels,
  onTextChange,
  onChange,
  onClear,
}: {
  /** Every well of the project (unfiltered), for the options and their counts. */
  rows: readonly WellRow[];
  filters: Filters;
  /** The methodology's band labels, lowest risk first. */
  rankLabels: readonly string[];
  onTextChange: (text: string) => void;
  onChange: (next: Filters) => void;
  onClear: () => void;
}) {
  const options = useMemo(() => {
    const reviewers = [...new Set(rows.map((r) => r.reviewerName).filter((n): n is string => n !== null))].sort((a, b) =>
      a.localeCompare(b),
    );
    return {
      rank: optionsFor(rows, rankLabels, (v) => only({ rank: [v] })),
      status: optionsFor(rows, STATUSES, (v) => only({ status: [v] })),
      classification: optionsFor(rows, CLASSIFICATIONS, (v) => only({ classification: [v] })),
      state: optionsFor(rows, ASSESSMENT_FILTER_STATES, (v) => only({ state: [v as AssessmentFilterState] }), STATE_LABELS),
      reviewer: optionsFor(rows, reviewers, (v) => only({ reviewer: [v] })),
    };
  }, [rows, rankLabels]);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const cell = filters.cell;
  const cellLabel = cell ? `matrix cell L${cell.Lr} × C${cell.Cr}` : '';

  return (
    <div role="search" aria-label="Filter wells" className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search wells"
          placeholder="Licence, name or operator"
          value={filters.text}
          onChange={(e) => onTextChange(e.target.value)}
          className="h-7 pl-7 text-[13px] md:text-[13px]"
        />
      </div>
      <FacetChip
        label="Rank"
        options={options.rank}
        selected={filters.rank}
        onChange={(rank) => set({ rank })}
        swatch={rankColour}
      />
      <FacetChip label="Status" options={options.status} selected={filters.status} onChange={(status) => set({ status })} />
      <FacetChip
        label="Class"
        options={options.classification}
        selected={filters.classification}
        onChange={(classification) => set({ classification })}
      />
      <FacetChip
        label="Assessment"
        options={options.state}
        selected={filters.state}
        onChange={(state) => set({ state: state as AssessmentFilterState[] })}
      />
      <FacetChip
        label="Reviewer"
        options={options.reviewer}
        selected={filters.reviewer}
        onChange={(reviewer) => set({ reviewer })}
      />
      <UnknownChip value={filters.minUnknown} rows={rows} onChange={(minUnknown) => set({ minUnknown })} />
      {cell ? (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line-strong pr-0.5 pl-2.5 text-[0.8rem]">
          <span className="text-muted-foreground">Matrix cell</span>
          <span aria-hidden="true" className="h-3.5 w-px bg-line-strong" />
          <span className="font-medium">
            L{cell.Lr} × C{cell.Cr}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove filter: ${cellLabel}`}
            onClick={() => set({ cell: undefined })}
          >
            <XIcon />
          </Button>
        </span>
      ) : null}
      {hasActiveFilters(filters) ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
