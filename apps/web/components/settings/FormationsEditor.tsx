'use client';

// The project's formation column (spec §4.7): each formation's name, top and base depth (m) and
// role (seal, reservoir or other), shallowest first. The order is the row order, changed with Move
// up / Move down; "Save formation column" writes the list with `order` = row position, or, when a
// field does not read, writes nothing and points at it (lib/settings-edit.ts).
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
import { SaveBar, blockedMessage } from '@/components/settings/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FORMATION_ROLES,
  blankFormationRow,
  formationErrors,
  formationRows,
  moveRow,
  readFormations,
  type FormationField,
  type FormationRole,
  type FormationRow,
} from '@/lib/settings-edit';
import { toError, useStore } from '@/lib/store/provider';
import { useDraft } from '@/lib/use-draft';
import { cn } from '@/lib/utils';

/** The text columns: heading, the input's name after "Formation n", and whether it holds a number. */
const FIELDS: readonly { key: FormationField; label: string; aria: string; number: boolean }[] = [
  { key: 'name', label: 'Name', aria: 'name', number: false },
  { key: 'top', label: 'Top (m)', aria: 'top (m)', number: true },
  { key: 'base', label: 'Base (m)', aria: 'base (m)', number: true },
];

const fieldSelector = (rowId: string, field: string): string => `[data-row="${CSS.escape(rowId)}"][data-field="${field}"]`;

/** How a row is named in its buttons: its name, or "formation n" while it has none. */
const rowLabel = (row: FormationRow, n: number): string => row.name.trim() || `formation ${n}`;

export function FormationsEditor({ project }: { project: Project }) {
  const store = useStore();
  const uid = useId();
  const tableRef = useRef<HTMLDivElement>(null);
  const upstream = useMemo(() => formationRows(project.formations), [project.formations]);
  const { draft: rows, setDraft: setRows, dirty, discard, saved } = useDraft(upstream);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ selectors: string[]; seq: number } | null>(null);

  // Focus the first of the requested elements that exists and is enabled (a Move button at the
  // end of the column is disabled, so focus falls back to its partner).
  useEffect(() => {
    if (!focusRequest) return;
    for (const selector of focusRequest.selectors) {
      const el = tableRef.current?.querySelector<HTMLElement>(selector);
      if (el && !(el instanceof HTMLButtonElement && el.disabled)) {
        el.focus();
        return;
      }
    }
  }, [focusRequest]);
  const focus = (...selectors: string[]) => setFocusRequest((r) => ({ selectors, seq: (r?.seq ?? 0) + 1 }));

  const errors = useMemo(() => new Map(rows.map((r) => [r.id, formationErrors(r)])), [rows]);
  const shownError = (row: FormationRow, field: FormationField): string | undefined =>
    attempted || edited.has(`${row.id}:${field}`) ? errors.get(row.id)?.[field] : undefined;

  function change(row: FormationRow, field: FormationField, text: string) {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [field]: text } : r)));
    // A changed top re-checks the base against it, so both count as edited.
    setEdited((s) => {
      const next = new Set(s).add(`${row.id}:${field}`);
      if (field === 'top' && row.base.trim() !== '') next.add(`${row.id}:base`);
      return next;
    });
    setFailure(null);
  }

  function changeRole(row: FormationRow, role: FormationRole) {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, role } : r)));
    setFailure(null);
  }

  function move(index: number, delta: -1 | 1) {
    const row = rows[index];
    if (!row) return;
    setRows(moveRow(rows, index, delta));
    setFailure(null);
    // Reordering moves the row's DOM nodes, which can drop focus: put it back on the same button.
    // At either end that button is disabled, so focus goes to its partner.
    const id = CSS.escape(row.id);
    const [same, other] = delta < 0 ? ['up', 'down'] : ['down', 'up'];
    focus(`[data-move="${same}"][data-for="${id}"]`, `[data-move="${other}"][data-for="${id}"]`);
  }

  function add() {
    const row = blankFormationRow();
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
    const read = readFormations(rows);
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
      const next = await store.projects.update(project.id, { formations: read.value });
      saved(formationRows(next.formations));
      setEdited(new Set());
      setAttempted(false);
      toast.success('Formation column saved');
    } catch (err) {
      setFailure(`The formation column could not be saved: ${toError(err).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <div ref={tableRef} className="grid gap-3">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
            No formations yet. Add the column from the surface down: each formation’s top and base depth and whether it is
            a seal, a reservoir or neither.
          </p>
        ) : (
          <div className="relative overflow-x-auto rounded-lg border bg-surface">
            <table className="w-full min-w-[40rem] text-[13px]">
              <thead className="border-b bg-subtle text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="w-8 px-3 py-2 font-medium">
                    <span className="sr-only">Position</span>
                  </th>
                  {FIELDS.map((f) => (
                    <th key={f.key} scope="col" className={cn('px-2 py-2 font-medium', f.number && 'w-32 text-right')}>
                      {f.label}
                    </th>
                  ))}
                  <th scope="col" className="w-32 px-2 py-2 font-medium">
                    Role
                  </th>
                  <th scope="col" className="w-28 px-2 py-2">
                    <span className="sr-only">Order and remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const n = index + 1;
                  const label = rowLabel(row, n);
                  return (
                    <tr key={row.id} data-formation={row.id} data-role={row.role} className="border-b align-top last:border-b-0">
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
                              aria-label={`Formation ${n} ${f.aria}`}
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
                        <Select value={row.role} onValueChange={(v) => changeRole(row, v as FormationRole)}>
                          <SelectTrigger size="sm" aria-label={`Formation ${n} role`} className="w-full text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FORMATION_ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-move="up"
                            data-for={row.id}
                            aria-label={`Move ${label} up`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUpIcon aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-move="down"
                            data-for={row.id}
                            aria-label={`Move ${label} down`}
                            disabled={index === rows.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDownIcon aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-remove={row.id}
                            aria-label={`Remove ${label}`}
                            onClick={() => remove(index)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </div>
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
            Add formation
          </Button>
          <p className="text-xs text-muted-foreground">Depths in metres, shallowest formation first.</p>
        </div>
      </div>
      <SaveBar saveLabel="Save formation column" dirty={dirty} busy={busy} message={failure} onDiscard={reset} />
    </form>
  );
}
