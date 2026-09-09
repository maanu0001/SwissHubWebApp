'use client';

import type { AutomationField } from '@swisshub/automation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { RoleSelect } from '@/modules/configuration/components/role-select';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';

/**
 * Ein Eingabefeld einer Trigger-, Bedingungs- oder Aktionskonfiguration.
 *
 * Dieselben Bausteine wie in den Moduleinstellungen - `RoleSelect` und
 * `ChannelSelect` sind dieselben Komponenten. Eine zweite Rollenauswahl zu
 * bauen hiesse, zwei zu pflegen: eine, die gelöschte Rollen erkennt, und
 * eine, die es irgendwann vergisst.
 */
export const WOCHENTAGE = [
  { wert: 1, kurz: 'Mo' },
  { wert: 2, kurz: 'Di' },
  { wert: 3, kurz: 'Mi' },
  { wert: 4, kurz: 'Do' },
  { wert: 5, kurz: 'Fr' },
  { wert: 6, kurz: 'Sa' },
  { wert: 0, kurz: 'So' },
] as const;

export function FeldZeile({
  feld,
  wert,
  onChange,
  roles,
  channels,
  disabled,
}: {
  feld: AutomationField;
  wert: unknown;
  onChange: (naechster: unknown) => void;
  roles: RoleOption[];
  channels: ChannelOption[];
  disabled?: boolean;
}): React.JSX.Element {
  const id = `automation-feld-${feld.key}`;
  const text = typeof wert === 'string' ? wert : '';
  const liste = Array.isArray(wert) ? wert.filter((eintrag) => typeof eintrag === 'number') : [];
  const rollenListe = Array.isArray(wert) ? wert.filter((eintrag) => typeof eintrag === 'string') : [];

  return (
    <div className="space-y-1.5">
      {feld.type === 'boolean' ? null : (
        <Label htmlFor={id}>
          {feld.label}
          {feld.required ? <span className="ml-1 text-destructive">*</span> : null}
        </Label>
      )}

      {feld.type === 'text' ? (
        <Input
          id={id}
          value={text}
          placeholder={feld.placeholder}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {feld.type === 'textarea' ? (
        <textarea
          id={id}
          value={text}
          placeholder={feld.placeholder}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
        />
      ) : null}

      {feld.type === 'number' ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            min={feld.min}
            max={feld.max}
            step={feld.step ?? 1}
            value={typeof wert === 'number' ? wert : ''}
            onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
            disabled={disabled}
          />
          {feld.unit ? <span className="text-sm text-muted-foreground">{feld.unit}</span> : null}
        </div>
      ) : null}

      {feld.type === 'time' ? (
        <Input
          id={id}
          type="time"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {feld.type === 'boolean' ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
          <div>
            <Label htmlFor={id}>{feld.label}</Label>
            {feld.description ? <p className="text-xs text-muted-foreground">{feld.description}</p> : null}
          </div>
          <Switch
            id={id}
            checked={wert === true}
            onCheckedChange={(an) => onChange(an)}
            disabled={disabled}
          />
        </div>
      ) : null}

      {feld.type === 'select' ? (
        <Select
          value={text || String(feld.default ?? '')}
          onValueChange={(naechster) => onChange(naechster)}
          disabled={disabled}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Bitte wählen …" />
          </SelectTrigger>
          <SelectContent>
            {(feld.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {feld.type === 'discord-role' ? (
        <RoleSelect
          id={id}
          value={text}
          roles={roles}
          onChange={(naechster) => onChange(naechster ?? '')}
          disabled={disabled}
        />
      ) : null}

      {feld.type === 'discord-role-multi' ? (
        <div className="space-y-2">
          <RoleSelect
            id={id}
            value=""
            roles={roles.filter((rolle) => !rollenListe.includes(rolle.id))}
            onChange={(naechster) => {
              if (naechster) {
                onChange([...rollenListe, naechster]);
              }
            }}
            disabled={disabled}
          />
          {rollenListe.length === 0 ? (
            /*
              Ausdrücklich, weil die umgekehrte Lesart naheliegt: eine leere
              Liste heisst «niemand», nicht «alle». Ohne diesen Satz könnte
              man eine Automation für freigegeben halten, die niemand starten
              kann - oder schlimmer: sie für gesperrt halten, wenn es anders
              wäre.
            */
            <p className="text-xs text-warning">
              Noch keine Rolle freigegeben - so kann niemand die Automation aus Discord starten.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {rollenListe.map((rolleId) => {
                const rolle = roles.find((eintrag) => eintrag.id === rolleId);
                return (
                  <li key={rolleId}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(rollenListe.filter((eintrag) => eintrag !== rolleId))}
                      className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs transition-colors hover:border-destructive/60 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {rolle?.name ?? rolleId}
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">entfernen</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {feld.type === 'discord-channel' ? (
        <ChannelSelect
          id={id}
          value={text}
          channels={channels}
          onChange={(naechster) => onChange(naechster ?? '')}
          disabled={disabled}
        />
      ) : null}

      {feld.type === 'discord-user' ? (
        <Input
          id={id}
          value={text}
          placeholder="Discord-ID"
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}

      {feld.type === 'weekdays' ? (
        <div className="flex flex-wrap gap-1.5">
          {WOCHENTAGE.map((tag) => {
            const aktiv = liste.includes(tag.wert);
            return (
              <button
                key={tag.wert}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    aktiv
                      ? liste.filter((eintrag) => eintrag !== tag.wert)
                      : [...liste, tag.wert].sort((a, b) => a - b),
                  )
                }
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  aktiv
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                }`}
              >
                {tag.kurz}
              </button>
            );
          })}
        </div>
      ) : null}

      {feld.type === 'duration' ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            min={feld.min ?? 1}
            max={feld.max}
            value={typeof wert === 'number' ? wert : ''}
            onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">{feld.unit ?? 'Sekunden'}</span>
        </div>
      ) : null}

      {feld.description && feld.type !== 'boolean' ? (
        <p className="text-xs text-muted-foreground">{feld.description}</p>
      ) : null}
      {feld.supportsTemplate ? (
        <p className="text-xs text-muted-foreground">
          Platzhalter erlaubt, z.B. <code className="rounded bg-muted px-1">{'{{payload.displayName}}'}</code>
        </p>
      ) : null}
    </div>
  );
}
