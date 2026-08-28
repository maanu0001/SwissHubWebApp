'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { ConditionNode } from '@swisshub/automation';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AutomationBausteine } from '@/server/automation';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import { FeldZeile } from './feld-zeile';

/**
 * Der Bedingungsbaum im Builder.
 *
 * Eine Liste hätte nur «alles muss zutreffen» ausdrücken können. Gebraucht
 * wird aber die Klammer:
 *
 *   Mitglied ist kein Bot UND ( Level >= 20 ODER Rolle = Premium )
 *
 * Deshalb Gruppen mit UND/ODER und ein Schalter «Umkehren» je Knoten. Mehr
 * Ebenen als diese sind selten nötig und würden die Anzeige unlesbar machen -
 * der Server erlaubt sechs, der Builder bietet zwei an.
 */
export function BedingungsBaum({
  knoten,
  bedingungen,
  roles,
  channels,
  disabled,
  onChange,
  tiefe = 0,
}: {
  knoten: ConditionNode | null;
  bedingungen: AutomationBausteine['bedingungen'];
  roles: RoleOption[];
  channels: ChannelOption[];
  disabled?: boolean;
  onChange: (naechster: ConditionNode | null) => void;
  tiefe?: number;
}): React.JSX.Element {
  if (!knoten) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Keine Bedingung - die Automation läuft bei jedem Auslöser.
        </p>
        {disabled ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({ art: 'gruppe', verknuepfung: 'UND', kinder: [] })
            }
          >
            <Plus aria-hidden="true" />
            Bedingung hinzufügen
          </Button>
        )}
      </div>
    );
  }

  if (knoten.art === 'bedingung') {
    const definition = bedingungen.find((eintrag) => eintrag.id === knoten.typ);
    return (
      <div className="rounded-lg border border-border/60 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {definition?.label ?? knoten.typ}
          </span>
          <div className="flex items-center gap-2">
            <Label htmlFor={`negiert-${knoten.typ}-${tiefe}`} className="text-xs">
              Umkehren
            </Label>
            <Switch
              id={`negiert-${knoten.typ}-${tiefe}`}
              checked={knoten.negiert === true}
              onCheckedChange={(an) => onChange({ ...knoten, negiert: an })}
              disabled={disabled}
            />
          </div>
          {disabled ? null : (
            <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)}>
              <Trash2 aria-hidden="true" />
              <span className="sr-only">Entfernen</span>
            </Button>
          )}
        </div>
        {definition ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {definition.fields.map((feld) => (
              <FeldZeile
                key={feld.key}
                feld={feld}
                wert={knoten.config[feld.key]}
                onChange={(naechster: unknown) =>
                  onChange({ ...knoten, config: { ...knoten.config, [feld.key]: naechster } })
                }
                roles={roles}
                channels={channels}
                disabled={disabled}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-destructive">
            Die Bedingung «{knoten.typ}» gibt es nicht mehr.
          </p>
        )}
      </div>
    );
  }

  const setzeKind = (index: number, naechster: ConditionNode | null): void => {
    const kinder = naechster
      ? knoten.kinder.map((kind, i) => (i === index ? naechster : kind))
      : knoten.kinder.filter((_, i) => i !== index);
    onChange({ ...knoten, kinder });
  };

  const fuegeHinzu = (typ: string): void => {
    const definition = bedingungen.find((eintrag) => eintrag.id === typ);
    if (!definition) {
      return;
    }
    const config: Record<string, unknown> = {};
    for (const feld of definition.fields) {
      if (feld.default !== undefined) {
        config[feld.key] = feld.default;
      }
    }
    onChange({ ...knoten, kinder: [...knoten.kinder, { art: 'bedingung', typ, config }] });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={knoten.verknuepfung}
          onValueChange={(naechster) =>
            onChange({ ...knoten, verknuepfung: naechster as 'UND' | 'ODER' })
          }
          disabled={disabled}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="UND">Alles muss zutreffen</SelectItem>
            <SelectItem value="ODER">Eines genügt</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label htmlFor={`gruppe-negiert-${tiefe}`} className="text-xs">
            Umkehren
          </Label>
          <Switch
            id={`gruppe-negiert-${tiefe}`}
            checked={knoten.negiert === true}
            onCheckedChange={(an) => onChange({ ...knoten, negiert: an })}
            disabled={disabled}
          />
        </div>
        {disabled || knoten.kinder.length > 0 ? null : (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Bedingungen entfernen
          </Button>
        )}
      </div>

      <div className="space-y-2 border-l-2 border-border/60 pl-3">
        {knoten.kinder.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Bedingung.</p>
        ) : null}
        {knoten.kinder.map((kind, index) => (
          <BedingungsBaum
            key={index}
            knoten={kind}
            bedingungen={bedingungen}
            roles={roles}
            channels={channels}
            disabled={disabled}
            tiefe={tiefe + 1}
            onChange={(naechster) => setzeKind(index, naechster)}
          />
        ))}
      </div>

      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value="" onValueChange={fuegeHinzu}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Bedingung hinzufügen …" />
            </SelectTrigger>
            <SelectContent>
              {bedingungen.map((bedingung) => (
                <SelectItem key={bedingung.id} value={bedingung.id}>
                  {bedingung.group} · {bedingung.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tiefe < 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...knoten,
                  kinder: [
                    ...knoten.kinder,
                    { art: 'gruppe', verknuepfung: 'ODER', kinder: [] },
                  ],
                })
              }
            >
              <Plus aria-hidden="true" />
              Klammer
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
