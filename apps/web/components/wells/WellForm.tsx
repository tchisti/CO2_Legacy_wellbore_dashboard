'use client';

// A well's record (spec §5: identity, location, type, status, classification, depth, notes; no
// scores and no construction). Validated with the engine's WellInputSchema, so the form, the store
// and the CSV import share one set of rules. Used by /wells/new and by EditWellDialog.
import { useId, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldError, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CLASSIFICATIONS,
  DEFAULT_METHODOLOGY,
  STATUSES,
  TRAJECTORIES,
  WELL_TYPES,
  WellInputSchema,
  type Methodology,
  type WellInput,
} from '@lwa/engine';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toError } from '@/lib/store/provider';
import { DuplicateLicenceError } from '@/lib/store/store';
import { cn } from '@/lib/utils';
import { wellRecordFields, type WellRecordFields } from '@/lib/wells-view';

type ParsedWellInput = ReturnType<(typeof WellInputSchema)['parse']>;

/** Readable messages for the fields a person can get wrong (the selects cannot be). */
const MESSAGES: Partial<Record<keyof WellRecordFields, string>> = {
  licence: 'Enter the licence or UWI.',
  lat: 'Latitude must be a number from −90 to 90.',
  lon: 'Longitude must be a number from −180 to 180.',
  spudYear: 'Spud year must be a whole year from 1850 to 2100.',
  td_m: 'Total depth must be a number of metres, 0 or more.',
};

export const DUPLICATE_LICENCE_MESSAGE = 'A well with this licence already exists in this project.';

const schemaResolver = zodResolver(WellInputSchema);

/** The schema's verdict, with each field's message replaced by the readable one. */
const resolver: Resolver<WellInput, unknown, ParsedWellInput> = async (values, context, options) => {
  const result = await schemaResolver(values, context, options);
  for (const [field, message] of Object.entries(MESSAGES) as [keyof WellRecordFields, string][]) {
    const error: FieldError | undefined = result.errors[field];
    if (error) error.message = message;
  }
  return result;
};

/** Text from a number input: blank is "not known" (null); anything else must read as a number. */
const toNumberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const text = String(v).trim();
  return text === '' ? null : Number(text);
};

const BLANK: WellInput = {
  licence: '',
  name: '',
  operator: '',
  lat: null,
  lon: null,
  spudYear: null,
  type: 'Unknown',
  trajectory: 'Unknown',
  status: 'Unknown',
  classification: 'Type 1',
  td_m: null,
  notes: '',
};

function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** aria wiring for a control whose Field shows `error` or `hint`. */
function describedBy(id: string, error: string | undefined, hint: boolean) {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const;
}

export function WellForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  wellTypes = DEFAULT_METHODOLOGY.wellTypes,
  autoFocus = false,
}: {
  /** The record being edited; a new well starts blank (schema defaults). */
  initial?: WellRecordFields;
  submitLabel: string;
  /** Saves the record. A DuplicateLicenceError is shown on the licence field; any other error above the buttons. */
  onSubmit: (fields: WellRecordFields) => Promise<void>;
  onCancel: () => void;
  /** Hint text per classification (the methodology's wellTypes). */
  wellTypes?: Methodology['wellTypes'];
  autoFocus?: boolean;
}) {
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<WellInput, unknown, ParsedWellInput>({
    resolver,
    defaultValues: initial ? wellRecordFields(initial) : BLANK,
  });

  const submit = handleSubmit(async (parsed) => {
    try {
      await onSubmit(wellRecordFields(parsed));
    } catch (err) {
      if (err instanceof DuplicateLicenceError) {
        setError('licence', { type: 'duplicate', message: DUPLICATE_LICENCE_MESSAGE }, { shouldFocus: true });
      } else {
        setError('root', { message: toError(err).message });
      }
    }
  });

  const classification = useWatch({ control, name: 'classification' });
  const typeInfo = classification ? wellTypes[classification] : undefined;
  const numberField = { setValueAs: toNumberOrNull };
  const msg = (field: keyof WellRecordFields) => errors[field]?.message;

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field id={id('licence')} label="Licence / UWI" error={msg('licence')} hint="Unique within the project.">
          <Input
            id={id('licence')}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            {...describedBy(id('licence'), msg('licence'), true)}
            {...register('licence')}
          />
        </Field>
        <Field id={id('name')} label="Name">
          <Input id={id('name')} autoComplete="off" {...register('name')} />
        </Field>
        <Field id={id('operator')} label="Operator" className="sm:col-span-2">
          <Input id={id('operator')} autoComplete="off" {...register('operator')} />
        </Field>

        <Field id={id('lat')} label="Latitude" error={msg('lat')} hint="Decimal degrees (WGS84). Leave blank if unknown.">
          <Input
            id={id('lat')}
            inputMode="decimal"
            autoComplete="off"
            className="num"
            {...describedBy(id('lat'), msg('lat'), true)}
            {...register('lat', numberField)}
          />
        </Field>
        <Field id={id('lon')} label="Longitude" error={msg('lon')} hint="Negative west of Greenwich, e.g. −113.24.">
          <Input
            id={id('lon')}
            inputMode="decimal"
            autoComplete="off"
            className="num"
            {...describedBy(id('lon'), msg('lon'), true)}
            {...register('lon', numberField)}
          />
        </Field>

        <Field id={id('spudYear')} label="Spud year" error={msg('spudYear')}>
          <Input
            id={id('spudYear')}
            inputMode="numeric"
            autoComplete="off"
            className="num"
            {...describedBy(id('spudYear'), msg('spudYear'), false)}
            {...register('spudYear', numberField)}
          />
        </Field>
        <Field id={id('td_m')} label="Total depth (m)" error={msg('td_m')}>
          <Input
            id={id('td_m')}
            inputMode="decimal"
            autoComplete="off"
            className="num"
            {...describedBy(id('td_m'), msg('td_m'), false)}
            {...register('td_m', numberField)}
          />
        </Field>

        <Field id={id('type')} label="Type">
          <EnumSelect id={id('type')} name="type" control={control} options={WELL_TYPES} />
        </Field>
        <Field id={id('trajectory')} label="Trajectory">
          <EnumSelect id={id('trajectory')} name="trajectory" control={control} options={TRAJECTORIES} />
        </Field>
        <Field id={id('status')} label="Status">
          <EnumSelect id={id('status')} name="status" control={control} options={STATUSES} />
        </Field>
        <Field
          id={id('classification')}
          label="Classification"
          hint={
            typeInfo ? (
              <>
                <span className="font-medium text-ink">{typeInfo.short}</span>
                <span className="mt-0.5 block">{typeInfo.prot}</span>
              </>
            ) : undefined
          }
        >
          <EnumSelect
            id={id('classification')}
            name="classification"
            control={control}
            options={CLASSIFICATIONS}
            describe={(o) => wellTypes[o]?.short}
            describedBy={typeInfo ? `${id('classification')}-hint` : undefined}
          />
        </Field>

        <Field id={id('notes')} label="Notes" className="sm:col-span-2">
          <Textarea id={id('notes')} rows={3} {...register('notes')} />
        </Field>
      </div>

      {errors.root?.message ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {errors.root.message}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

type EnumField = 'type' | 'trajectory' | 'status' | 'classification';

function EnumSelect({
  id,
  name,
  control,
  options,
  describe,
  describedBy: hintId,
}: {
  id: string;
  name: EnumField;
  control: Control<WellInput, unknown, ParsedWellInput>;
  options: readonly string[];
  /** A short description shown beside each option in the list (not in the closed control). */
  describe?: (option: string) => string | undefined;
  describedBy?: string;
}) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <Select value={field.value ?? undefined} onValueChange={field.onChange}>
          <SelectTrigger id={id} ref={field.ref} onBlur={field.onBlur} aria-describedby={hintId} className="w-full">
            <SelectValue>{field.value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => {
              const description = describe?.(o);
              return (
                <SelectItem key={o} value={o}>
                  {o}
                  {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
    />
  );
}
