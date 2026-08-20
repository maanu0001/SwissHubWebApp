'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import type { SettingsField } from '@swisshub/modules';
import { formatDuration } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { updateModuleSettingsAction } from '@/modules/configuration/actions';
import { ChannelSelect } from './channel-select';
import { MultiSelect } from './multi-select';
import { RoleSelect } from './role-select';
import { roleColor, type ChannelOption, type RoleOption } from './discord-option-types';

/**
 * Generische Einstellungsoberfläche.
 *
 * Sie entsteht vollständig aus der Feldbeschreibung des Moduls. Ein neues Modul
 * bringt seine Felder mit und bekommt dadurch automatisch eine Seite - ohne
 * eigenes Formular und ohne ID-Eingabefelder.
 */
export interface SettingsGroupView {
  group: string;
  fields: SettingsField[];
}

export function SettingsForm({
  moduleId,
  csrfToken,
  groups,
  values: initialValues,
  roles,
  channels,
  disabled = false,
}: {
  moduleId: string;
  csrfToken: string;
  groups: SettingsGroupView[];
  values: Record<string, unknown>;
  roles: RoleOption[];
  channels: ChannelOption[];
  disabled?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Kanonischer Vergleich: der Server liefert die Felder in Schema-Reihenfolge,
  // lokale Änderungen hängen neue Schlüssel hinten an. Ohne Normalisierung
  // gälte das Formular nach dem Speichern fälschlich weiter als geändert.
  const baseline = useMemo(() => stableStringify(initialValues), [initialValues]);
  const dirty = stableStringify(values) !== baseline;

  const setValue = (key: string, value: unknown): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) {
        return current;
      }
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || disabled) {
      return;
    }
    setPending(true);
    const response = await updateModuleSettingsAction({ csrfToken, moduleId, values });
    setPending(false);

    if (response.ok) {
      setErrors({});
      for (const warning of response.data.warnings) {
        toast.warning(warning.message);
      }
      toast.success('Einstellungen gespeichert.');
      router.refresh();
      return;
    }

    const fieldErrors = response.error.details?.fieldErrors;
    setErrors(
      typeof fieldErrors === 'object' && fieldErrors !== null ? (fieldErrors as Record<string, string>) : {},
    );
    toast.error(response.error.message);
  }

  const roleOptions = roles.map((role) => ({
    id: role.id,
    label: role.name,
    color: roleColor(role.color),
    hint: role.deleted ? 'gelöscht' : undefined,
  }));

  const channelOptionsFor = (field: SettingsField): ChannelOption[] =>
    'channelKinds' in field && field.channelKinds
      ? channels.filter(
          (channel) => channel.kind !== null && field.channelKinds?.includes(channel.kind as never),
        )
      : channels;

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-8">
      {groups.map((group) => (
        <section key={group.group} className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {group.group}
          </h3>
          <div className="grid gap-5 lg:grid-cols-2">
            {group.fields.map((field) => (
              <div
                key={field.key}
                className={
                  field.type === 'discord-role-list' ||
                  field.type === 'discord-channel-list' ||
                  field.type === 'textarea'
                    ? 'lg:col-span-2'
                    : undefined
                }
              >
                <FieldRow
                  field={field}
                  value={values[field.key]}
                  onChange={(next) => setValue(field.key, next)}
                  roles={roles}
                  roleOptions={roleOptions}
                  channels={channelOptionsFor(field)}
                  error={errors[field.key]}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button type="submit" loading={pending} disabled={disabled || !dirty}>
          Speichern
        </Button>
        {dirty ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending || disabled}
            onClick={() => {
              setValues(initialValues);
              setErrors({});
            }}
          >
            Verwerfen
          </Button>
        ) : null}
        {dirty ? (
          <span className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            Es gibt ungespeicherte Änderungen.
          </span>
        ) : null}
        {disabled ? (
          <span className="text-xs text-muted-foreground">Zum Ändern fehlt dir die nötige Berechtigung.</span>
        ) : null}
      </div>
    </form>
  );
}

/** Vergleichbare Darstellung eines Wertes - Schlüsselreihenfolge spielt keine Rolle. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined && entry !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function FieldRow({
  field,
  value,
  onChange,
  roles,
  roleOptions,
  channels,
  error,
  disabled,
}: {
  field: SettingsField;
  value: unknown;
  onChange: (next: unknown) => void;
  roles: RoleOption[];
  roleOptions: Array<{ id: string; label: string; color?: string; hint?: string }>;
  channels: ChannelOption[];
  error?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const id = `field-${field.key}`;
  const list = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const text = typeof value === 'string' ? value : '';

  return (
    <div className="space-y-1.5">
      {field.type === 'boolean' ? null : (
        <Label htmlFor={id}>
          {field.label}
          {field.required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
      )}

      {field.type === 'discord-role' ? (
        <RoleSelect
          id={id}
          value={text}
          roles={roles}
          onChange={(next) => onChange(next ?? '')}
          disabled={disabled}
          requireManageable={field.mustBeManageable}
        />
      ) : null}

      {field.type === 'discord-role-list' ? (
        <MultiSelect
          options={roleOptions}
          selected={list}
          onChange={onChange}
          disabled={disabled}
          searchPlaceholder="Rolle suchen …"
        />
      ) : null}

      {field.type === 'discord-channel' ? (
        <ChannelSelect
          id={id}
          value={text}
          channels={channels}
          onChange={(next) => onChange(next ?? '')}
          disabled={disabled}
        />
      ) : null}

      {field.type === 'discord-channel-list' ? (
        <MultiSelect
          options={channels.map((channel) => ({ id: channel.id, label: `#${channel.name}` }))}
          selected={list}
          onChange={onChange}
          disabled={disabled}
          searchPlaceholder="Channel suchen …"
        />
      ) : null}

      {field.type === 'boolean' ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
          <div>
            <Label htmlFor={id}>{field.label}</Label>
            {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
          </div>
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
          />
        </div>
      ) : null}

      {field.type === 'number' ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            value={typeof value === 'number' ? value : ''}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
            disabled={disabled}
          />
          {field.unit ? <span className="text-sm text-muted-foreground">{field.unit}</span> : null}
        </div>
      ) : null}

      {field.type === 'duration' ? (
        <DurationInput
          id={id}
          seconds={typeof value === 'number' ? value : undefined}
          presets={field.presets ?? []}
          min={field.min}
          max={field.max}
          onChange={onChange}
          disabled={disabled}
        />
      ) : null}

      {field.type === 'text' ? (
        <Input
          id={id}
          value={text}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {field.type === 'textarea' ? (
        <textarea
          id={id}
          value={text}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          rows={4}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
        />
      ) : null}

      {field.description && field.type !== 'boolean' ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

/** Dauer als Auswahl aus Vorschlägen plus freier Eingabe in Minuten. */
function DurationInput({
  id,
  seconds,
  presets,
  min,
  max,
  onChange,
  disabled,
}: {
  id: string;
  seconds: number | undefined;
  presets: number[];
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const CUSTOM = '__custom__';
  const isPreset = seconds !== undefined && presets.includes(seconds);
  const [mode, setMode] = useState(isPreset || seconds === undefined ? 'preset' : 'custom');

  if (presets.length === 0 || mode === 'custom') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            min={min ? Math.ceil(min / 60) : 1}
            max={max ? Math.floor(max / 60) : undefined}
            value={seconds !== undefined ? Math.round(seconds / 60) : ''}
            onChange={(event) => onChange(Math.max(1, Number(event.target.value)) * 60)}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">Minuten</span>
        </div>
        {presets.length > 0 ? (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setMode('preset')}
          >
            Vorschläge anzeigen
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Select
        value={seconds !== undefined && isPreset ? String(seconds) : CUSTOM}
        onValueChange={(next) => (next === CUSTOM ? setMode('custom') : onChange(Number(next)))}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset} value={String(preset)}>
              {formatDuration(preset * 1000)}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Eigene Dauer …</SelectItem>
        </SelectContent>
      </Select>
      {seconds !== undefined && !isPreset ? (
        <p className="text-xs text-muted-foreground">Aktuell: {formatDuration(seconds * 1000)}</p>
      ) : null}
    </div>
  );
}
