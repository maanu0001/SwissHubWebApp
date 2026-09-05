'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { RoleSelect } from '@/modules/configuration/components/role-select';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import { createRaffleAction, updateRaffleAction } from '@/modules/level/raffle-actions';
import { formatXp } from './raffle-shared';
import { RafflePreview } from './raffle-preview';

/**
 * Formular für eine Verlosung.
 *
 * Die Vorschau rechts zeigt dieselben Angaben, die später auf der
 * Mitgliederseite und im Discord-Embed stehen - so ist vor dem Speichern
 * sichtbar, was ankommt.
 *
 * Alle Werte werden serverseitig erneut geprüft; was hier passiert, ist
 * Bequemlichkeit, keine Absicherung.
 */

export interface RaffleFormValues {
  raffleId?: string;
  title: string;
  description: string;
  bannerUrl: string;
  prizeKind: 'EXTERNAL_PRIZE' | 'XP_PRIZE' | 'ROLE_PRIZE' | 'TEXT_ONLY';
  prizeDescription: string;
  prizeXp: string;
  prizeRoleId: string;
  entryModel: 'FIXED' | 'PERCENTAGE';
  fixedEntryXp: string;
  percentage: string;
  minimumEntryXp: string;
  maximumEntryXp: string;
  minimumParticipants: string;
  maximumParticipants: string;
  entryStartsAt: string;
  entryEndsAt: string;
  drawScheduledAt: string;
  autoDraw: boolean;
  participantsPublic: boolean;
  autoAnnounceWinner: boolean;
  discordChannelId: string;
}

export const emptyRaffleForm: RaffleFormValues = {
  title: '',
  description: '',
  bannerUrl: '',
  prizeKind: 'EXTERNAL_PRIZE',
  prizeDescription: '',
  prizeXp: '',
  prizeRoleId: '',
  entryModel: 'FIXED',
  fixedEntryXp: '500',
  percentage: '5',
  minimumEntryXp: '',
  maximumEntryXp: '',
  minimumParticipants: '2',
  maximumParticipants: '',
  entryStartsAt: '',
  entryEndsAt: '',
  drawScheduledAt: '',
  autoDraw: false,
  participantsPublic: true,
  autoAnnounceWinner: true,
  discordChannelId: '',
};

export function RaffleForm({
  csrfToken,
  initial,
  channels,
  roles,
  lockedEntryModel,
}: {
  csrfToken: string;
  initial: RaffleFormValues;
  channels: ChannelOption[];
  roles: RoleOption[];
  /** Gesetzt, sobald jemand bezahlt hat - dann stehen die Beträge fest. */
  lockedEntryModel?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [values, setValues] = useState<RaffleFormValues>(initial);
  const [pending, setPending] = useState(false);
  const isEdit = Boolean(initial.raffleId);

  const set = <K extends keyof RaffleFormValues>(key: K, value: RaffleFormValues[K]): void =>
    setValues((current) => ({ ...current, [key]: value }));

  // Beispielrechnung, damit der Anteil greifbar wird.
  const beispiel = useMemo(() => {
    if (values.entryModel === 'FIXED') {
      return null;
    }
    const percent = Number(values.percentage) || 0;
    const minimum = Number(values.minimumEntryXp) || 0;
    const maximum = Number(values.maximumEntryXp) || 0;
    const rechne = (xp: number): number => {
      let cost = Math.max(1, Math.ceil((xp * percent) / 100));
      if (minimum > 0 && cost < minimum) {
        cost = minimum;
      }
      if (maximum > 0 && cost > maximum) {
        cost = maximum;
      }
      return cost;
    };
    return [4000, 20_000, 160_000].map((xp) => ({ xp, cost: rechne(xp) }));
  }, [values.entryModel, values.percentage, values.minimumEntryXp, values.maximumEntryXp]);

  const submit = async (): Promise<void> => {
    setPending(true);
    try {
      const payload = {
        csrfToken,
        title: values.title,
        description: values.description,
        bannerUrl: values.bannerUrl,
        prizeKind: values.prizeKind,
        prizeDescription: values.prizeDescription,
        prizeXp: values.prizeXp,
        prizeRoleId: values.prizeRoleId,
        entryModel: values.entryModel,
        fixedEntryXp: values.fixedEntryXp,
        percentage: values.percentage,
        minimumEntryXp: values.minimumEntryXp,
        maximumEntryXp: values.maximumEntryXp,
        minimumParticipants: values.minimumParticipants,
        maximumParticipants: values.maximumParticipants,
        entryStartsAt: values.entryStartsAt,
        entryEndsAt: values.entryEndsAt,
        drawScheduledAt: values.drawScheduledAt,
        autoDraw: values.autoDraw,
        participantsPublic: values.participantsPublic,
        autoAnnounceWinner: values.autoAnnounceWinner,
        discordChannelId: values.discordChannelId,
      };

      const result = isEdit
        ? await updateRaffleAction({ ...payload, raffleId: initial.raffleId! })
        : await createRaffleAction(payload);

      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      toast.success(isEdit ? 'Verlosung gespeichert.' : 'Entwurf angelegt.');
      router.push(`/level/gluecksrad/${result.data.raffleId}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="space-y-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-2 text-sm font-semibold">Verlosung</legend>

          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              value={values.title}
              maxLength={120}
              required
              onChange={(event) => set('title', event.target.value)}
              placeholder="Gaming Gear Giveaway"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beschreibung</Label>
            <textarea
              id="description"
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={values.description}
              maxLength={2000}
              onChange={(event) => set('description', event.target.value)}
              placeholder="Kurze Beschreibung für die Mitgliederseite und das Discord-Embed"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bannerUrl">Banner (Adresse)</Label>
            <Input
              id="bannerUrl"
              value={values.bannerUrl}
              maxLength={1000}
              onChange={(event) => set('bannerUrl', event.target.value)}
              placeholder="https://…"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Erscheint auf der Mitgliederseite und im Discord-Embed.
            </p>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-2 text-sm font-semibold">Gewinn</legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prizeKind">Art</Label>
              <Select
                value={values.prizeKind}
                onValueChange={(next) => set('prizeKind', next as RaffleFormValues['prizeKind'])}
              >
                <SelectTrigger id="prizeKind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXTERNAL_PRIZE">Sachpreis</SelectItem>
                  <SelectItem value="XP_PRIZE">XP-Gutschrift</SelectItem>
                  <SelectItem value="ROLE_PRIZE">Discord-Rolle</SelectItem>
                  <SelectItem value="TEXT_ONLY">Nur Ankündigung</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {values.prizeKind === 'XP_PRIZE' ? (
              <div className="space-y-2">
                <Label htmlFor="prizeXp">XP-Gutschrift</Label>
                <Input
                  id="prizeXp"
                  type="number"
                  min={1}
                  value={values.prizeXp}
                  onChange={(event) => set('prizeXp', event.target.value)}
                />
              </div>
            ) : null}

            {values.prizeKind === 'ROLE_PRIZE' ? (
              <div className="space-y-2">
                <Label htmlFor="prizeRoleId">Rolle</Label>
                <RoleSelect
                  id="prizeRoleId"
                  value={values.prizeRoleId}
                  roles={roles}
                  requireManageable
                  onChange={(next) => set('prizeRoleId', next ?? '')}
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="prizeDescription">Beschreibung des Gewinns</Label>
            <Input
              id="prizeDescription"
              value={values.prizeDescription}
              maxLength={500}
              required
              onChange={(event) => set('prizeDescription', event.target.value)}
              placeholder="1 Monat Discord Nitro"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-2 text-sm font-semibold">Einsatz</legend>

          {lockedEntryModel ? (
            <p className="flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Es haben bereits Mitglieder bezahlt. Einsatzmodell und Beträge stehen deshalb fest – sonst
                hätten die bisherigen Teilnahmen zu anderen Bedingungen stattgefunden als die künftigen, und
                die ausgewiesene Gewinnchance wäre falsch.
              </span>
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="entryModel">Modell</Label>
            <Select
              value={values.entryModel}
              disabled={lockedEntryModel}
              onValueChange={(next) => set('entryModel', next as RaffleFormValues['entryModel'])}
            >
              <SelectTrigger id="entryModel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FIXED">Festbetrag – alle zahlen gleich viel</SelectItem>
                <SelectItem value="PERCENTAGE">Anteil – Chance folgt dem Einsatz</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {values.entryModel === 'FIXED' ? (
            <div className="space-y-2">
              <Label htmlFor="fixedEntryXp">Teilnahmekosten in XP</Label>
              <Input
                id="fixedEntryXp"
                type="number"
                min={0}
                value={values.fixedEntryXp}
                disabled={lockedEntryModel}
                onChange={(event) => set('fixedEntryXp', event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Jede teilnehmende Person zahlt denselben Betrag und hat dieselbe Gewinnchance.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="percentage">Anteil in %</Label>
                  <Input
                    id="percentage"
                    type="number"
                    min={0.01}
                    max={100}
                    step="0.01"
                    value={values.percentage}
                    disabled={lockedEntryModel}
                    onChange={(event) => set('percentage', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minimumEntryXp">Mindesteinsatz</Label>
                  <Input
                    id="minimumEntryXp"
                    type="number"
                    min={0}
                    value={values.minimumEntryXp}
                    disabled={lockedEntryModel}
                    onChange={(event) => set('minimumEntryXp', event.target.value)}
                    placeholder="ohne"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maximumEntryXp">Höchsteinsatz</Label>
                  <Input
                    id="maximumEntryXp"
                    type="number"
                    min={0}
                    value={values.maximumEntryXp}
                    disabled={lockedEntryModel}
                    onChange={(event) => set('maximumEntryXp', event.target.value)}
                    placeholder="ohne"
                  />
                </div>
              </div>

              {beispiel ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="mb-2 text-xs font-medium">Beispielrechnung</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {beispiel.map((zeile) => (
                      <li key={zeile.xp} className="flex justify-between tabular-nums">
                        <span>{formatXp(zeile.xp)} Punktestand</span>
                        <span className="font-medium text-foreground">{formatXp(zeile.cost)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Gerundet wird immer aufwärts, damit kleine Anteile nicht auf 0 XP fallen.
                  </p>
                </div>
              ) : null}
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="minimumParticipants">Mindestteilnehmer</Label>
              <Input
                id="minimumParticipants"
                type="number"
                min={1}
                value={values.minimumParticipants}
                onChange={(event) => set('minimumParticipants', event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Wird diese Zahl nicht erreicht, lässt sich nicht ziehen.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maximumParticipants">Höchstteilnehmer</Label>
              <Input
                id="maximumParticipants"
                type="number"
                min={1}
                value={values.maximumParticipants}
                onChange={(event) => set('maximumParticipants', event.target.value)}
                placeholder="unbegrenzt"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-2 text-sm font-semibold">Zeitraum</legend>
          <p className="text-xs text-muted-foreground">Alle Zeiten in Europe/Zurich.</p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="entryStartsAt">Teilnahme startet</Label>
              <Input
                id="entryStartsAt"
                type="datetime-local"
                value={values.entryStartsAt}
                onChange={(event) => set('entryStartsAt', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entryEndsAt">Teilnahme endet</Label>
              <Input
                id="entryEndsAt"
                type="datetime-local"
                value={values.entryEndsAt}
                onChange={(event) => set('entryEndsAt', event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Leer: du schliesst die Teilnahme selbst.</p>
            </div>
            {/*
              Der Auslosungszeitpunkt gehoert zur automatischen Ziehung und
              nur zu ihr. Wer selbst zieht, startet die Auslosung dann, wenn
              Publikum da ist - ein Feld fuer einen Zeitpunkt, den es nicht
              gibt, ist eine Huerde ohne Zweck. Umgekehrt ist er dann Pflicht:
              eine automatische Verlosung ohne ihn zoege nie.
            */}
            {values.autoDraw ? (
              <div className="space-y-2">
                <Label htmlFor="drawScheduledAt">Auslosung</Label>
                <Input
                  id="drawScheduledAt"
                  type="datetime-local"
                  required
                  value={values.drawScheduledAt}
                  onChange={(event) => set('drawScheduledAt', event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Fruehestens zum Ende der Teilnahme.</p>
              </div>
            ) : null}
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch checked={values.autoDraw} onCheckedChange={(next) => set('autoDraw', next)} />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Auslosung automatisch starten</span>
              <span className="block text-xs text-muted-foreground">
                Aus: du startest die Ziehung selbst, wenn Publikum da ist - dann braucht es keinen
                Zeitpunkt. Ein: das System zieht zur eingetragenen Zeit, sobald die Teilnahme
                geschlossen ist.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border border-border bg-card p-5">
          <legend className="px-2 text-sm font-semibold">Discord und Sichtbarkeit</legend>

          <div className="space-y-2">
            <Label htmlFor="discordChannelId">Ankündigung in Channel</Label>
            <ChannelSelect
              id="discordChannelId"
              value={values.discordChannelId}
              channels={channels}
              onChange={(next) => set('discordChannelId', next ?? '')}
              placeholder="Keine Ankündigung"
            />
            <p className="text-xs text-muted-foreground">
              Ohne Channel läuft die Verlosung nur über die Webseite.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              checked={values.participantsPublic}
              onCheckedChange={(next) => set('participantsPublic', next)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Teilnehmerliste für Mitglieder sichtbar</span>
              <span className="block text-xs text-muted-foreground">
                Zeigt Name, Einsatz und Gewinnchance – nur angemeldeten SwissHub-Mitgliedern.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              checked={values.autoAnnounceWinner}
              onCheckedChange={(next) => set('autoAnnounceWinner', next)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium">Gewinner auf Discord verkünden</span>
              <span className="block text-xs text-muted-foreground">
                Nach der Bestätigung durch die Verwaltung – nicht schon beim Ziehen.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Speichern …' : isEdit ? 'Änderungen speichern' : 'Entwurf anlegen'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
            Abbrechen
          </Button>
        </div>
      </form>

      <RafflePreview values={values} channels={channels} />
    </div>
  );
}
