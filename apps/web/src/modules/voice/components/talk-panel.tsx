'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Check,
  Crown,
  ExternalLink,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import {
  allowMemberAction,
  clearAccessAction,
  deleteTalkAction,
  denyMemberAction,
  kickMemberAction,
  renameTalkAction,
  repairPanelAction,
  setLimitAction,
  setLockedAction,
  transferTalkAction,
} from '@/modules/voice/actions';

export interface TalkMitglied {
  discordId: string;
  username: string;
  isBot: boolean;
}

export interface TalkAusnahme {
  discordId: string;
  username: string | null;
  kind: 'ALLOW' | 'DENY';
}

export interface TalkAnsicht {
  id: string;
  name: string;
  userLimit: number;
  maxUserLimit: number;
  locked: boolean;
  hidden: boolean;
  gameName: string | null;
  ownerDiscordId: string;
  ownerUsername: string;
  discordChannelId: string | null;
  hatBedienfeld: boolean;
}

/**
 * Die Verwaltung eines Talks im Dashboard.
 *
 * Dieselben Knoepfe wie im Discord-Bedienfeld, und dieselben Dienste
 * dahinter. Wer hier sperrt, sperrt genauso wie dort - es gibt nur eine
 * Fassung der Regel.
 *
 * Was hier erscheint, ist Bequemlichkeit: jede Aktion prueft serverseitig
 * erneut, wem der Talk gehoert und was der Aufrufende darf.
 */
export function TalkPanel({
  csrfToken,
  guildId,
  talk,
  mitglieder,
  ausnahmen,
  darfVerwalten,
  darfMitglieder,
  darfUebergeben,
  darfSchliessen,
  alsVerwaltung = false,
}: {
  csrfToken: string;
  /** Fuer den Sprung nach Discord - ohne Serverkennung gibt es keinen Link. */
  guildId: string;
  talk: TalkAnsicht;
  mitglieder: TalkMitglied[];
  ausnahmen: TalkAusnahme[];
  darfVerwalten: boolean;
  darfMitglieder: boolean;
  darfUebergeben: boolean;
  darfSchliessen: boolean;
  /** Verwaltet jemand einen fremden Talk? Dann ändert sich der Ton. */
  alsVerwaltung?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [name, setName] = useState(talk.name);
  const [limit, setLimit] = useState(talk.userLimit);
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [uebergabe, setUebergabe] = useState<PickedMember | null>(null);
  const [loeschen, setLoeschen] = useState(false);

  async function fuehreAus(
    schluessel: string,
    arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(schluessel);
    const antwort = await arbeit();
    if (antwort.ok) {
      toast.success(erfolg);
      router.refresh();
    } else {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  const menschen = mitglieder.filter((mitglied) => !mitglied.isBot);

  return (
    <div className="space-y-6">
      {/* --- Kopf ------------------------------------------------------- */}
      <div className="space-y-3 rounded-2xl border border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{talk.name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {alsVerwaltung ? `Besitzer: ${talk.ownerUsername} · ` : ''}
              {menschen.length}
              {talk.userLimit > 0 ? ` / ${talk.userLimit}` : ''} im Talk
              {talk.gameName ? ` · ${talk.gameName}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={talk.locked ? 'warning' : 'success'}>
              {talk.locked ? 'Gesperrt' : 'Offen'}
            </Badge>
            <Badge variant={talk.hidden ? 'secondary' : 'outline'}>
              {talk.hidden ? 'Versteckt' : 'Sichtbar'}
            </Badge>
            {talk.discordChannelId ? (
              <Button size="sm" variant="outline" asChild>
                <a
                  href={`https://discord.com/channels/${guildId}/${talk.discordChannelId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink aria-hidden="true" />
                  Auf Discord öffnen
                </a>
              </Button>
            ) : null}
          </div>
        </div>

        {darfVerwalten ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={laeuft !== null}
              onClick={() =>
                fuehreAus(
                  'lock',
                  () => setLockedAction({ csrfToken, kanalId: talk.id, locked: !talk.locked }),
                  talk.locked ? 'Talk ist wieder offen.' : 'Talk ist gesperrt.',
                )
              }
            >
              {laeuft === 'lock' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : talk.locked ? (
                <LockOpen aria-hidden="true" />
              ) : (
                <Lock aria-hidden="true" />
              )}
              {talk.locked ? 'Entsperren' : 'Sperren'}
            </Button>

            {!talk.hatBedienfeld ? (
              <Button
                size="sm"
                variant="outline"
                disabled={laeuft !== null}
                onClick={() =>
                  fuehreAus(
                    'repair',
                    () => repairPanelAction({ csrfToken, kanalId: talk.id }),
                    'Bedienfeld erneuert.',
                  )
                }
              >
                {laeuft === 'repair' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw aria-hidden="true" />
                )}
                Bedienfeld reparieren
              </Button>
            ) : null}

            {darfSchliessen ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={laeuft !== null}
                onClick={() => setLoeschen(true)}
              >
                <Trash2 aria-hidden="true" />
                Talk schliessen
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* --- Name und Limit --------------------------------------------- */}
      {darfVerwalten ? (
        <div className="grid gap-4 rounded-2xl border border-border p-5 sm:grid-cols-2">
          <form
            className="space-y-1.5"
            onSubmit={(ereignis) => {
              ereignis.preventDefault();
              void fuehreAus(
                'rename',
                () => renameTalkAction({ csrfToken, kanalId: talk.id, name }),
                'Talk umbenannt.',
              );
            }}
          >
            <Label htmlFor="talk-name">Name</Label>
            <div className="flex gap-2">
              <Input
                id="talk-name"
                value={name}
                maxLength={100}
                onChange={(ereignis) => setName(ereignis.target.value)}
              />
              <Button type="submit" variant="outline" disabled={laeuft !== null || name === talk.name}>
                {laeuft === 'rename' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Discord bremst häufige Umbenennungen - zwischen zwei liegt eine Wartezeit.
            </p>
          </form>

          <form
            className="space-y-1.5"
            onSubmit={(ereignis) => {
              ereignis.preventDefault();
              void fuehreAus(
                'limit',
                () => setLimitAction({ csrfToken, kanalId: talk.id, limit }),
                'Limit gesetzt.',
              );
            }}
          >
            <Label htmlFor="talk-limit">Teilnehmerlimit</Label>
            <div className="flex gap-2">
              <Input
                id="talk-limit"
                type="number"
                min={0}
                max={talk.maxUserLimit}
                value={limit}
                onChange={(ereignis) => {
                  const zahl = Number.parseInt(ereignis.target.value, 10);
                  setLimit(Number.isFinite(zahl) ? zahl : 0);
                }}
              />
              <Button
                type="submit"
                variant="outline"
                disabled={laeuft !== null || limit === talk.userLimit}
              >
                {laeuft === 'limit' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Check aria-hidden="true" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              0 = unbegrenzt. Höchstens {talk.maxUserLimit}.
            </p>
          </form>
        </div>
      ) : null}

      {/* --- Wer drin ist ----------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4" aria-hidden="true" />
          Im Talk
        </h3>
        {mitglieder.length === 0 ? (
          <p className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
            Gerade ist niemand da.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {mitglieder.map((mitglied) => (
              <li
                key={mitglied.discordId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
              >
                <DiscordAvatar
                  discordId={mitglied.discordId}
                  name={mitglied.username}
                  size={28}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{mitglied.username}</span>
                {mitglied.discordId === talk.ownerDiscordId ? (
                  <Badge variant="default">
                    <Crown className="size-3" aria-hidden="true" />
                    Besitzer
                  </Badge>
                ) : null}
                {mitglied.isBot ? <Badge variant="outline">Bot</Badge> : null}
                {darfMitglieder && mitglied.discordId !== talk.ownerDiscordId && !mitglied.isBot ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={laeuft !== null}
                    onClick={() =>
                      fuehreAus(
                        `kick-${mitglied.discordId}`,
                        () =>
                          kickMemberAction({
                            csrfToken,
                            kanalId: talk.id,
                            discordId: mitglied.discordId,
                          }),
                        `${mitglied.username} ist aus dem Talk.`,
                      )
                    }
                  >
                    {laeuft === `kick-${mitglied.discordId}` ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <UserMinus aria-hidden="true" />
                    )}
                    Entfernen
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Zugriff ------------------------------------------------------ */}
      {darfMitglieder ? (
        <section className="space-y-3 rounded-2xl border border-border p-5">
          <h3 className="text-sm font-semibold">Zugriff</h3>
          <MemberPicker
            csrfToken={csrfToken}
            value={auswahl}
            onChange={setAuswahl}
            label="Mitglied wählen"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={auswahl === null || laeuft !== null}
              onClick={() =>
                auswahl &&
                fuehreAus(
                  'allow',
                  () =>
                    allowMemberAction({
                      csrfToken,
                      kanalId: talk.id,
                      discordId: auswahl.discordId,
                      username: auswahl.username,
                    }),
                  `${auswahl.username} darf herein.`,
                ).then(() => setAuswahl(null))
              }
            >
              <UserPlus aria-hidden="true" />
              Zulassen
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={auswahl === null || laeuft !== null}
              onClick={() =>
                auswahl &&
                fuehreAus(
                  'deny',
                  () =>
                    denyMemberAction({
                      csrfToken,
                      kanalId: talk.id,
                      discordId: auswahl.discordId,
                      username: auswahl.username,
                      auchEntfernen: true,
                    }),
                  `${auswahl.username} ist gesperrt.`,
                ).then(() => setAuswahl(null))
              }
            >
              <UserMinus aria-hidden="true" />
              Sperren
            </Button>
          </div>

          {ausnahmen.length > 0 ? (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
              {ausnahmen.map((eintrag) => (
                <li
                  key={eintrag.discordId}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <Badge variant={eintrag.kind === 'ALLOW' ? 'success' : 'destructive'}>
                    {eintrag.kind === 'ALLOW' ? 'Zugelassen' : 'Gesperrt'}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {eintrag.username ?? eintrag.discordId}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={laeuft !== null}
                    onClick={() =>
                      fuehreAus(
                        `clear-${eintrag.discordId}`,
                        () =>
                          clearAccessAction({
                            csrfToken,
                            kanalId: talk.id,
                            discordId: eintrag.discordId,
                          }),
                        'Ausnahme entfernt.',
                      )
                    }
                  >
                    Aufheben
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              Keine persönlichen Ausnahmen. Wer hereinkommt, entscheidet die Sperre.
            </p>
          )}
        </section>
      ) : null}

      {/* --- Übergeben ---------------------------------------------------- */}
      {darfUebergeben ? (
        <section className="space-y-3 rounded-2xl border border-border p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Crown className="size-4" aria-hidden="true" />
            Talk übergeben
          </h3>
          <MemberPicker
            csrfToken={csrfToken}
            value={uebergabe}
            onChange={setUebergabe}
            label="Neuer Besitzer"
          />
          <Button
            size="sm"
            disabled={uebergabe === null || laeuft !== null}
            onClick={() =>
              uebergabe &&
              fuehreAus(
                'transfer',
                () =>
                  transferTalkAction({
                    csrfToken,
                    kanalId: talk.id,
                    discordId: uebergabe.discordId,
                    username: uebergabe.username,
                  }),
                `Der Talk gehört jetzt ${uebergabe.username}.`,
              ).then(() => setUebergabe(null))
            }
          >
            {laeuft === 'transfer' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Crown aria-hidden="true" />
            )}
            Übergeben
          </Button>
          <p className="text-xs text-muted-foreground">
            Danach kannst du den Talk nicht mehr verwalten - ausser du bekommst ihn zurück.
          </p>
        </section>
      ) : null}

      <ConfirmationDialog
        open={loeschen}
        onOpenChange={setLoeschen}
        title="Talk schliessen?"
        description={
          menschen.length > 0
            ? `Es sind noch ${menschen.length} Personen im Talk. Der Kanal verschwindet sofort.`
            : 'Der Sprachkanal wird gelöscht.'
        }
        confirmLabel="Talk schliessen"
        destructive
        onConfirm={async () => {
          const antwort = await deleteTalkAction({ csrfToken, kanalId: talk.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Talk geschlossen.');
          router.refresh();
        }}
      />
    </div>
  );
}
