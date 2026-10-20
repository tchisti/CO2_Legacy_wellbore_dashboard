'use client';

// The reviewer profile: the name and initials stamped on every assessment and change made in this
// browser (spec §6.1: there is no sign-in in Phase 1, so the profile is unverified). `required`
// makes the dialog impossible to dismiss until a profile is saved.
import { useId, useState, type FormEvent } from 'react';
import { ReviewerProfileSchema, type ReviewerProfile } from '@lwa/engine';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toError, useProfile } from '@/lib/store/provider';

type FieldErrors = { name?: string; initials?: string; form?: string };

const MESSAGES = { name: 'Enter at least 2 characters.', initials: 'Use 2 or 3 letters.' } as const;

function validate(name: string, initials: string): { profile: ReviewerProfile } | { errors: FieldErrors } {
  const parsed = ReviewerProfileSchema.safeParse({ name, initials: initials.trim().toUpperCase() });
  if (parsed.success) return { profile: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === 'name' || field === 'initials') errors[field] = MESSAGES[field];
  }
  return { errors };
}

function ProfileForm({
  initial,
  required,
  onSaved,
  onCancel,
}: {
  initial: ReviewerProfile | null;
  required: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { setProfile } = useProfile();
  const id = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [initials, setInitials] = useState(initial?.initials ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = validate(name, initials);
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await setProfile(result.profile);
      onSaved();
    } catch (err) {
      setErrors({ form: toError(err).message });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-name`}>Your name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          autoFocus
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${id}-name-error` : undefined}
        />
        {errors.name ? (
          <p id={`${id}-name-error`} className="text-xs text-destructive">
            {errors.name}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-initials`}>Initials</Label>
        <Input
          id={`${id}-initials`}
          value={initials}
          onChange={(e) => setInitials(e.target.value)}
          maxLength={3}
          autoComplete="off"
          className="w-20 uppercase"
          aria-invalid={errors.initials ? true : undefined}
          aria-describedby={errors.initials ? `${id}-initials-hint ${id}-initials-error` : `${id}-initials-hint`}
        />
        <p id={`${id}-initials-hint`} className="text-xs text-muted-foreground">
          Shown next to your assessments, e.g. TC.
        </p>
        {errors.initials ? (
          <p id={`${id}-initials-error`} className="text-xs text-destructive">
            {errors.initials}
          </p>
        ) : null}
      </div>
      {errors.form ? (
        <p role="alert" className="text-xs text-destructive">
          {errors.form}
        </p>
      ) : null}
      <DialogFooter>
        {required ? null : (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={busy}>
          Save profile
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ProfileDialog({
  open,
  onOpenChange,
  required = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** No close button, Escape or outside click: the app needs a profile before anyone writes. */
  required?: boolean;
  onSaved?: () => void;
}) {
  const { profile } = useProfile();
  const block = required ? (e: Event) => e.preventDefault() : undefined;
  return (
    <Dialog open={open} onOpenChange={required ? undefined : onOpenChange}>
      <DialogContent
        showCloseButton={!required}
        onEscapeKeyDown={block}
        onInteractOutside={block}
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{required ? 'Set up your reviewer profile' : 'Edit profile'}</DialogTitle>
          <DialogDescription>
            Your name and initials are recorded on every assessment and change you make in this browser. They are not
            verified.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so it starts from the saved profile every time. */}
        <ProfileForm
          initial={profile}
          required={required}
          onSaved={() => {
            onSaved?.();
            onOpenChange?.(false);
          }}
          onCancel={() => onOpenChange?.(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
