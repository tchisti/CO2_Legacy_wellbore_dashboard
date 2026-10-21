'use client';

// The project's identity (spec §4.7): its name (required), the jurisdiction it is reviewed under
// and a description. One save writes the three; the store records the change in the history.
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { Project } from '@lwa/engine';
import { SaveBar, blockedMessage } from '@/components/settings/SettingsSection';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toError, useStore } from '@/lib/store/provider';
import { useDraft } from '@/lib/use-draft';

type Jurisdiction = Project['jurisdiction'];

export const JURISDICTIONS: readonly { value: Jurisdiction; label: string }[] = [
  { value: 'AER', label: 'AER' },
  { value: 'EPA', label: 'EPA' },
  { value: 'both', label: 'AER + EPA' },
];

type Details = { name: string; jurisdiction: Jurisdiction; description: string };

const NAME_REQUIRED = 'Enter a project name.';

export function ProjectForm({ project }: { project: Project }) {
  const store = useStore();
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const upstream = useMemo<Details>(
    () => ({ name: project.name, jurisdiction: project.jurisdiction, description: project.description }),
    [project.name, project.jurisdiction, project.description],
  );
  const { draft, setDraft, dirty, discard, saved } = useDraft(upstream);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const nameError = draft.name.trim() === '' && (attempted || draft.name !== upstream.name) ? NAME_REQUIRED : null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const name = draft.name.trim();
    if (name === '') {
      setAttempted(true);
      setFailure(blockedMessage(1));
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const next = await store.projects.update(project.id, { ...draft, name });
      saved({ name: next.name, jurisdiction: next.jurisdiction, description: next.description });
      setAttempted(false);
      toast.success('Project details saved');
    } catch (err) {
      setFailure(`The project details could not be saved: ${toError(err).message}`);
    } finally {
      setBusy(false);
    }
  }

  function edit(patch: Partial<Details>) {
    setDraft((d) => ({ ...d, ...patch }));
    setFailure(null);
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-name`}>Project name</Label>
          <Input
            ref={nameRef}
            id={`${id}-name`}
            value={draft.name}
            onChange={(e) => edit({ name: e.target.value })}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
          />
          {nameError ? (
            <p id={`${id}-name-error`} className="text-xs text-destructive">
              {nameError}
            </p>
          ) : null}
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${id}-jurisdiction`}>Jurisdiction</Label>
          <Select value={draft.jurisdiction} onValueChange={(v) => edit({ jurisdiction: v as Jurisdiction })}>
            <SelectTrigger id={`${id}-jurisdiction`} className="w-full" aria-describedby={`${id}-jurisdiction-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JURISDICTIONS.map((j) => (
                <SelectItem key={j.value} value={j.value}>
                  {j.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${id}-jurisdiction-hint`} className="text-xs text-muted-foreground">
            The regulator the review answers to.
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          id={`${id}-description`}
          rows={3}
          value={draft.description}
          onChange={(e) => edit({ description: e.target.value })}
          placeholder="The area of review, the storage complex, the purpose of the review."
        />
      </div>
      <SaveBar
        saveLabel="Save project details"
        dirty={dirty}
        busy={busy}
        message={failure}
        onDiscard={() => {
          discard();
          setAttempted(false);
          setFailure(null);
        }}
      />
    </form>
  );
}
