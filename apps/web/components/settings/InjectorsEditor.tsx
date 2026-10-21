'use client';

// The project's CO₂ injectors (spec §4.7): name, latitude, longitude and area-of-review radius,
// one row each. The Score flow measures a well's distance to the nearest one to suggest Position
// vs Plume (engine suggest.ts). Rows are edited as text and checked as they change
// (lib/settings-edit.ts); "Save injectors" writes the whole list, or, when a field does not read,
// writes nothing and points at it.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
import { SaveBar, blockedMessage } from '@/components/settings/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  blankInjectorRow,
  injectorErrors,
  injectorRows,
  readInjectors,
  type InjectorField,
  type InjectorRow,
} from '@/lib/settings-edit';
import { toError, useStore } from '@/lib/store/provider';
import { useDraft } from '@/lib/use-draft';
import { cn } from '@/lib/utils';

/** The columns: heading, the input's name after "Injector n" ("Injector 2 latitude"), and whether it holds a number. */
const FIELDS: readonly { key: InjectorField; label: string; aria: string; number: boolean }[] = [
  { key: 'name', label: 'Name', aria: 'name', number: false },
  { key: 'lat', label: 'Latitude', aria: 'latitude', number: true },
  { key: 'lon', label: 'Longitude', aria: 'longitude', number: true },
  { key: 'radius', label: 'AoR radius (m)', aria: 'AoR radius (m)', number: true },
];

/** A field's input, found by its row and field (the inputs carry both as data attributes). */
function fieldSelector(rowId: string, field: string): string {
  return `[data-row="${CSS.escape(rowId)}"][data-field="${field}"]`;
}

export function InjectorsEditor({ project }: { project: Project }) {
  const store = useStore();
  const uid = useId();
  const tableRef = useRef<HTMLDivElement>(null);
  const upstream = useMemo(() => injectorRows(project.injectors), [project.injectors]);
  const { draft: rows, setDraft: setRows, dirty, discard, saved } = useDraft(upstream);
  /** `${rowId}:${field}` of every field edited since the last save: their errors show as they type. */
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  /** After a blocked save every error shows, edited or not. */
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ selector: string; seq: number } | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    tableRef.current?.querySelector<HTMLElement>(focusRequest.selector)?.focus();
  }, [focusRequest]);
  const focus = (selector: string) => setFocusRequest((r) => ({ selector, seq: (r?.seq ?? 0) + 1 }));

  const errors = useMemo(() => new Map(rows.map((r) => [r.id, injectorErrors(r)])), [rows]);
  const shownError = (row: InjectorRow, field: InjectorField): string | undefined =>
    attempted || edited.has(`${row.id}:${field}`) ? errors.get(row.id)?.[field] : undefined;

  function change(row: InjectorRow, field: InjectorField, text: string) {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [field]: text } : r)));
    setEdited((s) => new Set(s).add(`${row.id}:${field}`));
    setFailure(null);
  }

  function add() {
    const row = blankInjectorRow();
    setRows((rs) => [...rs, row]);
    setFailure(null);
    focus(fieldSelector(row.id, 'name'));
  }

  function remove(index: number) {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);
    setFailure(null);
    const neighbour = next[index] ?? next[index - 1];
    focus(neighbour ? `[data-remove="${CSS.escape(neighbour.id)}"]` : '[data-add]');
  }

  function reset() {
    discard();
    setEdited(new Set());
    setAttempted(false);
    setFailure(null);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const read = readInjectors(rows);
    if (!read.ok) {
      setAttempted(true);
      const invalid = rows.flatMap((r) => FIELDS.filter((f) => read.errors[r.id]?.[f.key]).map((f) => ({ row: r, field: f.key })));
      setFailure(blockedMessage(invalid.length));
      const first = invalid[0];
      if (first) focus(fieldSelector(first.row.id, first.field));
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const next = await store.projects.update(project.id, { injectors: read.value });
      saved(injectorRows(next.injectors));
      setEdited(new Set());
      setAttempted(false);
      toast.success('Injectors saved');
    } catch (err) {
      setFailure(`The injectors could not be saved: ${toError(err).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <div ref={tableRef} className="grid gap-3">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
            No injectors yet. Add the project’s CO₂ injectors so the Score flow can suggest Position vs Plume from each
            well’s distance to the nearest one.
          </p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border bg-surface">
            <table className="w-full min-w-[38rem] text-[13px]" aria-describedby={`${uid}-units`}>
              <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-8 px-3 py-2 font-medium">
                    <span className="sr-only">Number</span>
                  </th>
                  {FIELDS.map((f) => (
                    <th key={f.key} scope="col" className={cn('px-2 py-2 font-medium', f.number && 'w-36 text-right')}>
                      {f.label}
                    </th>
                  ))}
                  <th scope="col" className="w-10 px-2 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const n = index + 1;
                  return (
                    <tr key={row.id} data-injector={row.id} className="border-b align-top last:border-b-0">
                      <td className="num px-3 py-2.5 text-xs text-muted-foreground">{n}</td>
                      {FIELDS.map((f) => {
                        const error = shownError(row, f.key);
                        const errorId = `${uid}-${index}-${f.key}-error`;
                        return (
                          <td key={f.key} className="px-2 py-1.5">
                            <Input
                              data-row={row.id}
                              data-field={f.key}
                              value={row[f.key]}
                              onChange={(e) => change(row, f.key, e.target.value)}
                              aria-label={`Injector ${n} ${f.aria}`}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? errorId : undefined}
                              inputMode={f.number ? 'decimal' : undefined}
                              autoComplete="off"
                              spellCheck={false}
                              className={cn('h-7 px-2 text-[13px] md:text-[13px]', f.number && 'num text-right')}
                            />
                            {error ? (
                              <p id={errorId} className="mt-1 text-xs text-destructive">
                                {error}
                              </p>
                            ) : null}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          data-remove={row.id}
                          aria-label={`Remove ${row.name.trim() || `injector ${n}`}`}
                          onClick={() => remove(index)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" data-add onClick={add}>
            <PlusIcon aria-hidden="true" />
            Add injector
          </Button>
          <p id={`${uid}-units`} className="text-xs text-muted-foreground">
            Decimal degrees (WGS84), negative west of Greenwich; radius in metres.
          </p>
        </div>
      </div>
      <SaveBar saveLabel="Save injectors" dirty={dirty} busy={busy} message={failure} onDiscard={reset} />
    </form>
  );
}
