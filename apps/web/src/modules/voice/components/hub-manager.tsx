'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { MultiSelect } from '@/modules/configuration/components/multi-select';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import { createHubAction, deleteHubAction, updateHubAction } from '@/modules/voice/admin-actions';

export interface HubZeile {
  id: string;
  name: string;
  discordChannelId: string;
  targetCategoryId: string;
  overflowCategoryId: string | null;
  presetId: string;
  presetName: string;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  enabled: boolean;
  /** Was der Gesundheitsprüfung an diesem Hub auffällt. */
  hinweise: string[];
}

interface Entwurf {
  name: string;
  discordChannelId: string;
  targetCategoryId: string;
  overflowCategoryId: string;
  presetId: string;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  enabled: boolean;
}

const LEER: Entwurf = {
  name: '',
  discordChannelId: '',
  targetCategoryId: '',
  overflowCategoryId: '',
  presetId: '',
  allowedRoleIds: [],
  blockedRoleIds: [],
  enabled: true,
};

/**
 * Hub-Channels verwalten.
 *
 * Ausgewählt wird über die Discord-Listen, nicht über Kennungen von Hand: eine
 * abgetippte Channel-ID ist eine Fehlerquelle, die erst beim ersten Beitritt
 * auffällt - und dann als «es passiert nichts».
 */
export function HubManager({
  csrfToken,
  hubs,
  presets,
  channels,
  roles,
}: {
  csrfToken: string;
  hubs: HubZeile[];
  presets: Array<{ id: string; name: string }>;
  channels: ChannelOption[];
  roles: RoleOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [entwurf, setEntwurf] = useState<Entwurf>({ ...LEER, presetId: presets[0]?.id ?? '' });
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [loeschen, setLoeschen] = useState<HubZeile | null>(null);

  const sprachkanaele = channels.filter((kanal) => kanal.kind === 'voice');
  const kategorien = channels.filter((kanal) => kanal.kind === 'category');

  async function speichern(hubId: string | null): Promise<void> {
    if (entwurf.discordChannelId === '' || entwurf.targetCategoryId === '' || entwurf.presetId === '') {
      toast.error('Channel, Zielkategorie und Preset müssen gesetzt sein.');
      return;
    }

    setLaeuft(hubId ?? 'create');
    const eingabe = {
      csrfToken,
      name: entwurf.name.trim(),
      discordChannelId: entwurf.discordChannelId,
      targetCategoryId: entwurf.targetCategoryId,
      overflowCategoryId: entwurf.overflowCategoryId === '' ? null : entwurf.overflowCategoryId,
      presetId: entwurf.presetId,
      allowedRoleIds: entwurf.allowedRoleIds,
      blockedRoleIds: entwurf.blockedRoleIds,
      enabled: entwurf.enabled,
    };

    const antwort = hubId ? await updateHubAction({ ...eingabe, hubId }) : await createHubAction(eingabe);

    if (antwort.ok) {
      toast.success(hubId ? 'Hub gespeichert.' : 'Hub angelegt.');
      setEntwurf({ ...LEER, presetId: presets[0]?.id ?? '' });
      setBearbeitet(null);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  function bearbeite(hub: HubZeile): void {
    setBearbeitet(hub.id);
    setEntwurf({
      name: hub.name,
      discordChannelId: hub.discordChannelId,
      targetCategoryId: hub.targetCategoryId,
      overflowCategoryId: hub.overflowCategoryId ?? '',
      presetId: hub.presetId,
      allowedRoleIds: hub.allowedRoleIds,
      blockedRoleIds: hub.blockedRoleIds,
      enabled: hub.enabled,
    });
  }

  if (presets.length === 0) {
    return (
      <EmptyState
        title="Zuerst ein Preset"
        description="Ein Hub braucht eine Vorlage, aus der die Talks entstehen. Lege zuerst unter «Presets» eine an."
      />
    );
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
        <h2 className="text-sm font-semibold">{bearbeitet ? 'Hub bearbeiten' : 'Hub hinzufügen'}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="hub-name">Name</Label>
            <Input
              id="hub-name"
              required
              maxLength={60}
              value={entwurf.name}
              onChange={(ereignis) => setEntwurf({ ...entwurf, name: ereignis.target.value })}
              placeholder="Eigenen Talk erstellen"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hub-preset">Preset</Label>
            <select
              id="hub-preset"
              value={entwurf.presetId}
              onChange={(ereignis) => setEntwurf({ ...entwurf, presetId: ereignis.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hub-channel">Hub-Channel</Label>
            <ChannelSelect
              id="hub-channel"
              value={entwurf.discordChannelId}
              channels={sprachkanaele}
              onChange={(wert) => setEntwurf({ ...entwurf, discordChannelId: wert ?? '' })}
              placeholder="Sprachkanal wählen"
            />
            <p className="text-xs text-muted-foreground">
              Wer diesen Kanal betritt, bekommt seinen eigenen Talk.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hub-category">Zielkategorie</Label>
            <ChannelSelect
              id="hub-category"
              value={entwurf.targetCategoryId}
              channels={kategorien}
              onChange={(wert) => setEntwurf({ ...entwurf, targetCategoryId: wert ?? '' })}
              placeholder="Kategorie wählen"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="hub-overflow">Ausweichkategorie</Label>
            <ChannelSelect
              id="hub-overflow"
              value={entwurf.overflowCategoryId}
              channels={kategorien}
              onChange={(wert) => setEntwurf({ ...entwurf, overflowCategoryId: wert ?? '' })}
              placeholder="Keine"
            />
            <p className="text-xs text-muted-foreground">
              Discord erlaubt 50 Kanäle je Kategorie. Ohne Ausweich steht der Betrieb, wenn die erste voll
              ist.
            </p>
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
            <p className="text-xs text-muted-foreground">Leer = alle dürfen.</p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Diese Rollen nicht</Label>
            <MultiSelect
              options={roles.map((rolle) => ({ id: rolle.id, label: rolle.name }))}
              selected={entwurf.blockedRoleIds}
              onChange={(naechste) => setEntwurf({ ...entwurf, blockedRoleIds: naechste })}
              searchPlaceholder="Rolle suchen …"
              emptyLabel="Keine Rollen vorhanden."
            />
            <p className="text-xs text-muted-foreground">Ein Verbot sticht die Erlaubnis.</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
          <div>
            <p className="text-sm font-medium">Aktiv</p>
            <p className="text-xs text-muted-foreground">Abgeschaltet passiert beim Betreten nichts.</p>
          </div>
          <Switch
            checked={entwurf.enabled}
            onCheckedChange={(an) => setEntwurf({ ...entwurf, enabled: an })}
            aria-label="Hub aktiv"
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
            {bearbeitet ? 'Speichern' : 'Hub hinzufügen'}
          </Button>
          {bearbeitet ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setBearbeitet(null);
                setEntwurf({ ...LEER, presetId: presets[0]?.id ?? '' });
              }}
            >
              Abbrechen
            </Button>
          ) : null}
        </div>
      </form>

      {hubs.length === 0 ? (
        <EmptyState
          title="Noch kein Hub"
          description="Lege oben einen an - danach entsteht beim Betreten des Channels ein Talk."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {hubs.map((hub) => (
            <li key={hub.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block truncate font-medium">{hub.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Vorlage «{hub.presetName}»
                  </span>
                </span>
                <Badge variant={hub.enabled ? 'success' : 'outline'}>{hub.enabled ? 'Aktiv' : 'Aus'}</Badge>
                <Button size="sm" variant="outline" onClick={() => bearbeite(hub)}>
                  Bearbeiten
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setLoeschen(hub)}
                  aria-label={`${hub.name} entfernen`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>

              {hub.hinweise.length > 0 ? (
                <ul className="space-y-1">
                  {hub.hinweise.map((hinweis) => (
                    <li key={hinweis} className="text-xs text-warning">
                      ⚠ {hinweis}
                    </li>
                  ))}
                </ul>
              ) : null}
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
        title={`Hub «${loeschen?.name ?? ''}» entfernen?`}
        description="Laufende Talks bleiben bestehen und verschwinden wie üblich, sobald sie leer sind."
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await deleteHubAction({ csrfToken, hubId: loeschen.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Hub entfernt.');
          setLoeschen(null);
          router.refresh();
        }}
      />
    </div>
  );
}
