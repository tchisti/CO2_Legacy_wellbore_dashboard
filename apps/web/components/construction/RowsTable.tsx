'use client';

// The construction rows editor (schematic spec 2026-08-07 §7, spec §4.3): TD and KB elevation at
// the top, then one section per list (casings, plugs, perforations, formation tops, packers,
// zones, notes) with a typed input per field (depths in metres), "Add row" and a remove button
// per row. Each row says where it came from (Parsed / Manual / Imported) and, when it was read
// from a report, the text it was read from (truncated; the full text on hover or focus).
// Hovering or focusing a row reports its schematic data-id, so its shape is highlighted, and the
// row the schematic highlights is marked here. Everything is controlled: the values, their errors
// and every edit belong to the editor (lib/construction-edit.ts).
import { useEffect, useId, useRef, type FocusEvent, type ReactNode } from 'react';
import {
  ArrowUpDownIcon,
  FileTextIcon,
  ImportIcon,
  PencilLineIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import type { WellboreOpenHole } from '@lwa/engine';
import { StateBadge } from '@/components/domain/StateBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  KB_FIELD,
  LISTS,
  LIST_KEYS,
  TD_FIELD,
  numberText,
  rowForSvgId,
  rowName,
  rowSource,
  sourceLabel,
  svgIdOf,
  type ConstructionRows,
  type EditRow,
  type FieldError,
  type FieldSpec,
  type FieldWarning,
  type ListKey,
} from '@/lib/construction-edit';
import { fmtDepth } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The select value for "no kind recorded" (Radix Select items cannot have an empty value). */
const NONE = '__none';

const SOURCE_ICON: Readonly<Record<string, LucideIcon>> = {
  Parsed: FileTextIcon,
  Manual: PencilLineIcon,
  Imported: ImportIcon,
};

export type FocusRequest = { key: string; seq: number };

type RowHandlers = {
  onValue: (list: ListKey, key: string, field: string, text: string) => void;
  onRemove: (list: ListKey, key: string) => void;
  /** Exchanges an inverted interval's two depths. */
  onSwap: (list: ListKey, key: string, a: string, b: string) => void;
  /** A row's schematic data-id while the pointer is over it; null when it leaves. */
  onHover: (id: string | null) => void;
  /** A row's schematic data-id while focus is inside it; null when focus leaves. */
  onFocusRow: (id: string | null) => void;
};

function FieldInput({
  field,
  value,
  label,
  errorId,
  placeholder,
  onChange,
}: {
  field: FieldSpec;
  value: string;
  label: string;
  /** The error message's id when the value does not read. */
  errorId?: string;
  placeholder?: string;
  onChange: (text: string) => void;
}) {
  if (field.kind === 'select') {
    const known = value === '' || field.options.some((o) => o.value === value);
    return (
      <Select value={value === '' ? NONE : value} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
        <SelectTrigger size="sm" aria-label={label} className="w-28 text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {field.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          {/* A kind recorded elsewhere (an import) stays choosable as it is. */}
          {known ? null : <SelectItem value={value}>{value}</SelectItem>}
        </SelectContent>
      </Select>
    );
  }
  const number = field.kind === 'number';
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={errorId}
      inputMode={number ? 'decimal' : undefined}
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      className={cn(
        'h-7 px-1.5 text-[13px] md:text-[13px]',
        number ? cn('num text-right', field.integer ? 'w-14' : 'w-[4.5rem]') : field.wide ? 'min-w-28' : 'w-24',
      )}
    />
  );
}

function SourceTag({ row }: { row: EditRow }) {
  const source = rowSource(row);
  const label = sourceLabel(source);
  if (!label) return null;
  return (
    <StateBadge data-source={source} icon={SOURCE_ICON[label] ?? FileTextIcon}>
      {label}
    </StateBadge>
  );
}

/** The text a row was read from, on one line; the whole of it on hover or focus. */
function Verbatim({ text }: { text: string }) {
  return (
    // Absolutely placed, so a long line truncates instead of widening the table.
    <div className="relative h-4">
      <p data-verbatim className="absolute inset-0 flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0">Read from</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="num min-w-0 truncate rounded-sm text-ink/80 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              “{text}”
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="num max-w-md whitespace-pre-wrap">
            {text}
          </TooltipContent>
        </Tooltip>
      </p>
    </div>
  );
}

/** "top", "bottom", "shoe": a field's label without its unit, for the swap button's name. */
const plainLabel = (f: FieldSpec | undefined, key: string): string => (f?.label ?? key).replace(/\s*\(.*\)$/, '').toLowerCase();

function RowBody({
  list,
  row,
  index,
  errors,
  warnings,
  highlighted,
  handlers,
}: {
  list: ListKey;
  row: EditRow;
  index: number;
  errors: readonly FieldError[];
  warnings: readonly FieldWarning[];
  highlighted: boolean;
  handlers: RowHandlers;
}) {
  const baseId = useId();
  const spec = LISTS[list];
  const name = rowName(list, index);
  const id = svgIdOf(list, index);
  const verbatim = typeof row.original.verbatim === 'string' && row.original.verbatim ? row.original.verbatim : null;
  const type = typeof row.original.type === 'string' ? row.original.type : undefined;
  /** The error a field belongs to: its own, or an inverted interval it is half of. */
  const errorOf = (field: string) => errors.find((e) => e.field === field || e.swap?.includes(field));
  const fieldOf = (key: string) => spec.fields.find((f) => f.key === key);
  const errorIdOf = (field: string): string | undefined => {
    const e = errorOf(field);
    return e ? `${baseId}-${e.field}` : undefined;
  };
  const leave = (e: FocusEvent<HTMLElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) handlers.onFocusRow(null);
  };
  return (
    <tbody
      data-row
      data-row-key={row.key}
      data-highlighted={highlighted || undefined}
      onMouseEnter={() => handlers.onHover(id)}
      onMouseLeave={() => handlers.onHover(null)}
      onFocus={() => handlers.onFocusRow(id)}
      onBlur={leave}
      className="border-t transition-colors data-highlighted:bg-accent/70 [&[data-highlighted]>tr:first-child>td:first-child]:shadow-[inset_2px_0_0_var(--accent)]"
    >
      <tr>
        {spec.fields.map((f) => (
          <td key={f.key} className="px-1 py-1 align-top">
            <FieldInput
              field={f}
              value={row.values[f.key] ?? ''}
              label={`${name}: ${f.label}`}
              errorId={errorIdOf(f.key)}
              placeholder={f.key === 'name' ? type : undefined}
              onChange={(text) => handlers.onValue(list, row.key, f.key, text)}
            />
          </td>
        ))}
        <td className="px-1.5 py-1 align-top">
          <div className="flex h-7 items-center justify-end gap-1">
            <SourceTag row={row} />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${name.toLowerCase()}`}
              onClick={() => handlers.onRemove(list, row.key)}
              className="text-muted-foreground hover:text-ink"
            >
              <XIcon aria-hidden="true" />
            </Button>
          </div>
        </td>
      </tr>
      {verbatim || errors.length > 0 || warnings.length > 0 ? (
        <tr>
          <td colSpan={spec.fields.length + 1} className="px-2 pt-0 pb-1.5">
            {errors.map((e) => (
              <p key={`${e.kind}-${e.field}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-danger">
                <span id={`${baseId}-${e.field}`}>
                  {e.kind === 'input' ? `${fieldOf(e.field)?.label ?? e.field}: ${e.message}` : e.message}
                </span>
                {e.swap ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handlers.onSwap(list, row.key, e.swap![0], e.swap![1])}
                    className="h-5 text-ink"
                  >
                    <ArrowUpDownIcon aria-hidden="true" />
                    Swap
                    <span className="sr-only">
                      {' '}
                      {plainLabel(fieldOf(e.swap[0]), e.swap[0])} and {plainLabel(fieldOf(e.swap[1]), e.swap[1])}
                    </span>
                  </Button>
                ) : null}
              </p>
            ))}
            {warnings.map((w) => (
              <p key={`warn-${w.field}`} className="flex items-center gap-1 text-xs text-warn">
                <TriangleAlertIcon aria-hidden="true" className="size-3 shrink-0" />
                {w.message}
              </p>
            ))}
            {verbatim ? <Verbatim text={verbatim} /> : null}
          </td>
        </tr>
      ) : null}
    </tbody>
  );
}

function ListSection({
  list,
  rows,
  errors,
  warnings,
  highlightIndex,
  onAdd,
  handlers,
}: {
  list: ListKey;
  rows: readonly EditRow[];
  errors: readonly FieldError[];
  warnings: readonly FieldWarning[];
  /** The row the schematic highlights, if it is in this list. */
  highlightIndex: number | null;
  onAdd: (list: ListKey) => void;
  handlers: RowHandlers;
}) {
  const headingId = useId();
  const spec = LISTS[list];
  return (
    <section aria-labelledby={headingId} className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h3 id={headingId} className="text-sm font-medium text-ink">
            {spec.title}
          </h3>
          {rows.length > 0 ? <span className="num text-xs text-muted-foreground">{rows.length}</span> : null}
        </div>
        <Button variant="ghost" size="xs" onClick={() => onAdd(list)} className="text-muted-foreground hover:text-ink">
          <PlusIcon aria-hidden="true" />
          Add row<span className="sr-only"> to {spec.title}</span>
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No {spec.title.toLowerCase()} recorded.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <table aria-labelledby={headingId} className="w-full border-collapse text-[13px]">
            <thead className="bg-subtle">
              <tr>
                {spec.fields.map((f) => (
                  <th
                    key={f.key}
                    scope="col"
                    title={f.short ? f.label : undefined}
                    className={cn(
                      'h-7 px-2 text-xs font-normal whitespace-nowrap text-muted-foreground',
                      f.kind === 'number' ? 'text-right' : 'text-left',
                    )}
                  >
                    {f.short ?? f.label}
                  </th>
                ))}
                <th scope="col" className="h-7 w-px px-1.5">
                  <span className="sr-only">Source and remove</span>
                </th>
              </tr>
            </thead>
            {rows.map((row, i) => (
              <RowBody
                key={row.key}
                list={list}
                row={row}
                index={i}
                errors={errors.filter((e) => e.rowKey === row.key)}
                warnings={warnings.filter((w) => w.rowKey === row.key)}
                highlighted={highlightIndex === i}
                handlers={handlers}
              />
            ))}
          </table>
        </div>
      )}
    </section>
  );
}

function HeaderField({
  id,
  label,
  children,
  note,
}: {
  id: string;
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
      {note}
    </div>
  );
}

function openHoleText(oh: WellboreOpenHole): string {
  if (typeof oh.top_m === 'number' && typeof oh.bottom_m === 'number') {
    return `Open hole ${fmtDepth(oh.top_m, 'm')} to ${fmtDepth(oh.bottom_m, 'm')}`;
  }
  return 'Open hole below the last casing (depths not given)';
}

export function RowsTable({
  rows,
  errors,
  warnings,
  fallbackTd,
  tdMessageId,
  highlightId,
  focusRequest,
  onHeader,
  onAdd,
  ...handlers
}: {
  rows: ConstructionRows;
  errors: readonly FieldError[];
  /** Depths below TD: shown on their rows, never blocking. */
  warnings: readonly FieldWarning[];
  /** The well record's TD: drawn with when the record has none, and shown as the TD input's placeholder. */
  fallbackTd: number | null;
  /** The schematic's "add a total depth" message, which then describes the TD input. */
  tdMessageId?: string;
  highlightId: string | null;
  /** Focus the first input of this row (a row just added, or one clicked on the schematic). */
  focusRequest: FocusRequest | null;
  onHeader: (field: 'td' | 'kbElev', text: string) => void;
  onAdd: (list: ListKey) => void;
} & RowHandlers) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const highlighted = highlightId ? rowForSvgId(highlightId) : null;
  const headerError = (field: string) => errors.find((e) => e.list === null && e.field === field);
  const tdError = headerError(TD_FIELD.key);
  const kbError = headerError(KB_FIELD.key);
  const usingFallback = rows.td.trim() === '' && fallbackTd !== null;
  const { openHole, sourceText } = rows.base;

  useEffect(() => {
    if (!focusRequest) return;
    const row = boxRef.current?.querySelector(`[data-row-key="${CSS.escape(focusRequest.key)}"]`);
    row?.querySelector<HTMLElement>('input, [role="combobox"]')?.focus();
  }, [focusRequest]);

  const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

  return (
    <div ref={boxRef} className="grid gap-5">
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <HeaderField
            id={`${id}-td`}
            label={TD_FIELD.label}
            note={
              tdError ? (
                <p id={`${id}-td-error`} className="text-xs text-danger">
                  {tdError.message}
                </p>
              ) : usingFallback ? (
                <p id={`${id}-td-note`} className="text-xs text-muted-foreground">
                  Empty: the well record&apos;s TD is used.
                </p>
              ) : null
            }
          >
            <Input
              id={`${id}-td`}
              value={rows.td}
              onChange={(e) => onHeader('td', e.target.value)}
              placeholder={fallbackTd !== null ? numberText(fallbackTd) : undefined}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={tdError ? true : undefined}
              aria-describedby={describedBy(
                tdError && `${id}-td-error`,
                !tdError && usingFallback && `${id}-td-note`,
                rows.td.trim() === '' && fallbackTd === null && tdMessageId,
              )}
              className="num"
            />
          </HeaderField>
          <HeaderField
            id={`${id}-kb`}
            label={KB_FIELD.label}
            note={
              kbError ? (
                <p id={`${id}-kb-error`} className="text-xs text-danger">
                  {kbError.message}
                </p>
              ) : null
            }
          >
            <Input
              id={`${id}-kb`}
              value={rows.kbElev}
              onChange={(e) => onHeader('kbElev', e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={kbError ? true : undefined}
              aria-describedby={kbError ? `${id}-kb-error` : undefined}
              className="num"
            />
          </HeaderField>
        </div>
        {openHole ? (
          <p className="text-xs text-muted-foreground">
            {openHoleText(openHole)} <span className="text-muted-foreground/80">· kept as recorded</span>
          </p>
        ) : null}
        {sourceText?.trim() ? (
          <details className="text-xs">
            <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/50">
              Pasted report text
            </summary>
            <pre className="num mt-1.5 max-h-48 overflow-auto rounded-lg border bg-subtle px-3 py-2 whitespace-pre-wrap text-ink">
              {sourceText}
            </pre>
          </details>
        ) : null}
      </div>

      {LIST_KEYS.map((list) => (
        <ListSection
          key={list}
          list={list}
          rows={rows.lists[list]}
          errors={errors.filter((e) => e.list === list)}
          warnings={warnings.filter((w) => w.list === list)}
          highlightIndex={highlighted?.list === list ? highlighted.index : null}
          onAdd={onAdd}
          handlers={handlers}
        />
      ))}
    </div>
  );
}
