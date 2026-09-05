'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { MultiSelect } from '@/modules/configuration/components/multi-select';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import { createPresetAction, deletePresetAction, updatePresetAction } from '@/modules/voice/admin-actions';

export interface PresetZeile {
  id: string;
  name: string;
  nameTemplate: string;
  userLimit: number;
  maxUserLimit: number;
  bitrate: number | null;
  lockedDefault: boolean;
  hiddenDefault: boolean;
  targetCategoryId: string | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  deleteGraceSeconds: number;
  renameCooldownSeconds: number;
  ownerModeration: boolean;
  /** Hubs, die dieses Preset verwenden - dann lässt es sich nicht löschen. */
  hubs: number;
}

type Entwurf = Omit<PresetZeile, 'id' | 'hubs'>;

const LEER: Entwurf = {
  name: '',
  nameTemplate: "🔊 {username}'s Talk",
  userLimit: 0,
  maxUserLimit: 99,
  bitrate: null,
  lockedDefault: false,
  hiddenDefault: false,
  targetCategoryId: null,
  allowedRoleIds: [],
  blockedRoleIds: [],
  deleteGraceSeconds: 30,
  renameCooldownSeconds: 300,
  ownerModeration: true,
};

/** Die Platzhalter, die eine Namensvorlage kennt. */
const PLATZHALTER = ['{username}', '{displayName}', '{game}', '{number}'];

/**
 * Vorlagen für neue Talks.
 *
 * Ein Preset beantwortet die Fragen, die sonst bei jedem Talk neu zu stellen
 * wären. Die Namensvorlage braucht einen Platzhalter - ohne ihn hiessen alle
 * Talks gleich, und in der Kanalliste liesse sich keiner auseinanderhalten.
 */
export function PresetManager({
  csrfToken,
  presets,
  channels,
  roles,
}: {
  csrfToken: string;
  presets: PresetZeile[];
  channels: ChannelOption[];
  roles: RoleOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [entwurf, setEntwurf] = useState<Entwurf>(LEER);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [loeschen, setLoeschen] = useState<PresetZeile | null>(null);

  const kategorien = channels.filter((kanal) => kanal.kind === 'category');
  const hatPlatzhalter = PLATZHALTER.some((platz) => entwurf.nameTemplate.includes(platz));

  async function speichern(presetId: string | null): Promise<void> {
    setLaeuft(presetId ?? 'create');
    const eingabe = { csrfToken, ...entwurf, name: entwurf.name.trim() };
    const antwort = presetId
      ? await updatePresetAction({ ...eingabe, presetId })
      : await createPresetAction(eingabe);

    if (antwort.ok) {
      toast.success(presetId ? 'Preset gespeichert.' : 'Preset angelegt.');
      setEntwurf(LEER);
      setBearbeitet(null);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-2xl border border-border p-5"
        onSubmit={(ereignis) => {
          ereignis.preventDefault();
          void speichern(bearbeitet);
        }}
      >
        <h2 className="text-sm font-semibold">{bearbeitet ? 'Preset bearbeiten' : 'Preset hinzufügen'}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              required
              maxLength={60}
              value={entwurf.name}
              onChange={(e) => setEntwurf({ ...entwurf, name: e.target.value })}
              placeholder="Standard Talk"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preset-template">Namensvorlage</Label>
            <Input
              id="preset-template"
              required
              maxLength={100}
              value={entwurf.nameTemplate}
              onChange={(e) => setEntwurf({ ...entwurf, nameTemplate: e.target.value })}
            />
            <p className={hatPlatzhalter ? 'text-xs text-muted-foreground' : 'text-xs text-warning'}>
              {hatPlatzhalter
                ? `Platzhalter: ${PLATZHALTER.join(', ')}`
                : 'Ohne Platzhalter heissen alle Talks gleich.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preset-limit">Standardlimit</Label>
            <Input
              id="preset-limit"
              type="number"
              min={0}
              max={99}
              value={entwurf.userLimit}
              onChange={(e) =>
                setEntwurf({ ...entwurf, userLimit: Number.parseInt(e.target.value, 10) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">0 = unbegrenzt.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preset-max">Höchstlimit</Label>
            <Input
              id="preset-max"
              type="number"
              min={1}
              max={99}
              value={entwurf.maxUserLimit}
              onChange={(e) =>
                setEntwurf({ ...entwurf, maxUserLimit: Number.parseInt(e.target.value, 10) || 1 })
              }
            />
            <p className="text-xs text-muted-foreground">So hoch darf der Besitzer selbst gehen.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preset-grace">Leeren Talk löschen nach</Label>
            <Input
              id="preset-grace"
              type="number"
              min={0}
              max={3600}
              value={entwurf.deleteGraceSeconds}
              onChange={(e) =>
                setEntwurf({
                  ...entwurf,
                  deleteGraceSeconds: Number.parseInt(e.target.value, 10) || 0,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Sekunden. Zu kurz, und eine Verbindungsstörung zerstört den Talk.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preset-cooldown">Wartezeit fürs Umbenennen</Label>
            <Input
              id="preset-cooldown"
              type="number"
              min={0}
              max={3600}
              value={entwurf.renameCooldownSeconds}
              onChange={(e) =>
                setEntwurf({
                  ...entwurf,
                  renameCooldownSeconds: Number.parseInt(e.target.value, 10) || 0,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Sekunden. Discord lässt zwei Umbenennungen je zehn Minuten zu.
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="preset-category">Eigene Zielkategorie</Label>
            <ChannelSelect
              id="preset-category"
              value={entwurf.targetCategoryId ?? ''}
              channels={kategorien}
              onChange={(wert) => setEntwurf({ ...entwurf, targetCategoryId: wert ?? null })}
              placeholder="Die des Hubs"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Nur diese Rollen</Label>
            <MultiSelect
              options={roles.map((rolle) => ({ id: rolle.id, label: rolle.name }))}
              selected={entwurf.allowedRoleIds}
              onChange={(naechste) => setEntwurf({ ...entwurf, allowedRoleIds: naechste })}
              searchPlaceholder="Rolle suchen …"
              emptyLabel="Keine Rollen vorhanden."
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Schalter
            label="Startet gesperrt"
            hinweis="Niemand Neues kommt herein."
            an={entwurf.lockedDefault}
            aendern={(an) => setEntwurf({ ...entwurf, lockedDefault: an })}
          />
          <Schalter
            label="Startet versteckt"
            hinweis="Für andere nicht sichtbar."
            an={entwurf.hiddenDefault}
            aendern={(an) => setEntwurf({ ...entwurf, hiddenDefault: an })}
          />
          <Schalter
            label="Besitzer darf moderieren"
            hinweis="Stummschalten und verschieben im eigenen Talk."
            an={entwurf.ownerModeration}
            aendern={(an) => setEntwurf({ ...entwurf, ownerModeration: an })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={laeuft !== null}>
            {laeuft !== null ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : bearbeitet ? (
              <Save aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {bearbeitet ? 'Speichern' : 'Preset hinzufügen'}
          </Button>
          {bearbeitet ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setBearbeitet(null);
                setEntwurf(LEER);
              }}
            >
              Abbrechen
            </Button>
          ) : null}
        </div>
      </form>

      {presets.length === 0 ? (
        <EmptyState title="Noch kein Preset" description="Lege oben eine Vorlage an." />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {presets.map((preset) => (
            <li key={preset.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">{preset.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {preset.nameTemplate}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {preset.userLimit === 0 ? 'Unbegrenzt' : `Limit ${preset.userLimit}`}
                {preset.lockedDefault ? ' · gesperrt' : ''}
                {preset.hiddenDefault ? ' · versteckt' : ''}
                {' · '}
                {preset.deleteGraceSeconds}s Schonfrist
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBearbeitet(preset.id);
                  const { id: _id, hubs: _hubs, ...rest } = preset;
                  setEntwurf(rest);
                }}
              >
                Bearbeiten
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={preset.hubs > 0}
                title={preset.hubs > 0 ? 'Wird von einem Hub verwendet.' : undefined}
                onClick={() => setLoeschen(preset)}
                aria-label={`${preset.name} entfernen`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setLoeschen(null);
          }
        }}
        title={`Preset «${loeschen?.name ?? ''}» entfernen?`}
        description="Laufende Talks behalten ihre Einstellungen - sie sind ohnehin schon eingerichtet."
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await deletePresetAction({ csrfToken, presetId: loeschen.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Preset entfernt.');
          setLoeschen(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function Schalter({
  label,
  hinweis,
  an,
  aendern,
}: {
  label: string;
  hinweis: string;
  an: boolean;
  aendern: (an: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hinweis}</p>
      </div>
      <Switch checked={an} onCheckedChange={aendern} aria-label={label} />
    </div>
  );
}
