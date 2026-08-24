'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Crown, Loader2, Shield, UserMinus, UserPlus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import {
  inviteToTeamAction,
  removeMemberAction,
  respondInviteAction,
  revokeInviteAction,
  setMemberRoleAction,
  transferCaptaincyAction,
} from '@/modules/tournaments/actions';

const ROLLE_LABEL: Record<string, string> = {
  CAPTAIN: 'Captain',
  PLAYER: 'Stammspieler',
  SUBSTITUTE: 'Ersatz',
  COACH: 'Coach',
};

export interface TeamMitglied {
  discordId: string;
  username: string;
  role: string;
}

export interface TeamEinladung {
  id: string;
  discordId: string;
  username: string;
  role: string;
}

/**
 * Das eigene Team verwalten.
 *
 * Nur fuer den Captain - und auch dort prueft der Server bei jeder Aktion
 * erneut, wem das Team gehoert. Eine Team-Kennung aus dem Browser ist keine
 * Berechtigung.
 */
export function TeamPanel({
  teamId,
  csrfToken,
  mitglieder,
  einladungen,
  istCaptain,
  rosterOffen,
  maxSpieler,
  maxErsatz,
}: {
  teamId: string;
  csrfToken: string;
  mitglieder: TeamMitglied[];
  einladungen: TeamEinladung[];
  istCaptain: boolean;
  rosterOffen: boolean;
  maxSpieler: number;
  maxErsatz: number;
}): React.JSX.Element {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [rolle, setRolle] = useState<'PLAYER' | 'SUBSTITUTE' | 'COACH'>('PLAYER');
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [uebergabe, setUebergabe] = useState<TeamMitglied | null>(null);

  const stammspieler = mitglieder.filter(
    (mitglied) => mitglied.role === 'CAPTAIN' || mitglied.role === 'PLAYER',
  );
  const ersatz = mitglieder.filter((mitglied) => mitglied.role === 'SUBSTITUTE');

  async function fuehreAus(
    name: string,
    arbeit: () => Promise<{ ok: boolean; fehler?: string }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(name);
    const ergebnis = await arbeit();
    if (ergebnis.ok) {
      toast.success(erfolg);
      router.refresh();
    } else {
      toast.error(ergebnis.fehler ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Stammspieler {stammspieler.length} / {maxSpieler}
          {maxErsatz > 0 ? ` · Ersatz ${ersatz.length} / ${maxErsatz}` : ''}
        </p>

        <ul className="space-y-1.5">
          {mitglieder.map((mitglied) => (
            <li key={mitglied.discordId} className="flex items-center gap-2">
              <DiscordAvatar
                discordId={mitglied.discordId}
                name={mitglied.username}
                size={24}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-sm">{mitglied.username}</span>

              {mitglied.role === 'CAPTAIN' ? (
                <Badge variant="default">
                  <Crown className="mr-1 size-3" aria-hidden="true" />
                  Captain
                </Badge>
              ) : istCaptain && rosterOffen ? (
                <Select
                  value={mitglied.role}
                  onValueChange={(naechste) =>
                    void fuehreAus(
                      `rolle-${mitglied.discordId}`,
                      async () => {
                        const antwort = await setMemberRoleAction({
                          csrfToken,
                          teamId,
                          discordId: mitglied.discordId,
                          role: naechste as 'PLAYER' | 'SUBSTITUTE' | 'COACH',
                        });
                        return {
                          ok: antwort.ok,
                          fehler: antwort.ok ? undefined : antwort.error.message,
                        };
                      },
                      'Rolle geändert.',
                    )
                  }
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLAYER">Stammspieler</SelectItem>
                    <SelectItem value="SUBSTITUTE">Ersatz</SelectItem>
                    <SelectItem value="COACH">Coach</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="outline">{ROLLE_LABEL[mitglied.role] ?? mitglied.role}</Badge>
              )}

              {istCaptain && rosterOffen && mitglied.role !== 'CAPTAIN' ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Führung an ${mitglied.username} übergeben`}
                    title="Führung übergeben"
                    disabled={laeuft !== null}
                    onClick={() => setUebergabe(mitglied)}
                  >
                    <Shield aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${mitglied.username} entfernen`}
                    disabled={laeuft !== null}
                    onClick={() =>
                      void fuehreAus(
                        `entfernen-${mitglied.discordId}`,
                        async () => {
                          const antwort = await removeMemberAction({
                            csrfToken,
                            teamId,
                            discordId: mitglied.discordId,
                          });
                          return {
                            ok: antwort.ok,
                            fehler: antwort.ok ? undefined : antwort.error.message,
                          };
                        },
                        `${mitglied.username} entfernt.`,
                      )
                    }
                  >
                    {laeuft === `entfernen-${mitglied.discordId}` ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <UserMinus aria-hidden="true" />
                    )}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {einladungen.length > 0 ? (
        <div className="space-y-2 border-t border-border/60 pt-4">
          <p className="text-xs font-medium text-muted-foreground">Offene Einladungen</p>
          <ul className="space-y-1.5">
            {einladungen.map((einladung) => (
              <li key={einladung.id} className="flex items-center gap-2">
                <DiscordAvatar
                  discordId={einladung.discordId}
                  name={einladung.username}
                  size={24}
                  className="shrink-0"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {einladung.username}
                </span>
                <Badge variant="outline">{ROLLE_LABEL[einladung.role] ?? einladung.role}</Badge>
                {istCaptain ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Einladung an ${einladung.username} zurückziehen`}
                    disabled={laeuft !== null}
                    onClick={() =>
                      void fuehreAus(
                        `revoke-${einladung.id}`,
                        async () => {
                          const antwort = await revokeInviteAction({
                            csrfToken,
                            inviteId: einladung.id,
                          });
                          return {
                            ok: antwort.ok,
                            fehler: antwort.ok ? undefined : antwort.error.message,
                          };
                        },
                        'Einladung zurückgezogen.',
                      )
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {istCaptain && rosterOffen ? (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <MemberPicker
            csrfToken={csrfToken}
            value={auswahl}
            onChange={setAuswahl}
            label="Mitspieler einladen"
          />
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="einladung-rolle">Als</Label>
              <Select
                value={rolle}
                onValueChange={(naechste) => setRolle(naechste as 'PLAYER' | 'SUBSTITUTE' | 'COACH')}
              >
                <SelectTrigger id="einladung-rolle" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLAYER">Stammspieler</SelectItem>
                  {maxErsatz > 0 ? <SelectItem value="SUBSTITUTE">Ersatz</SelectItem> : null}
                  <SelectItem value="COACH">Coach</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={auswahl === null || laeuft !== null}
              onClick={() =>
                void fuehreAus(
                  'invite',
                  async () => {
                    const antwort = await inviteToTeamAction({
                      csrfToken,
                      teamId,
                      discordId: auswahl!.discordId,
                      username: auswahl!.username,
                      role: rolle,
                    });
                    if (antwort.ok) {
                      setAuswahl(null);
                    }
                    return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                  },
                  'Einladung verschickt.',
                )
              }
            >
              {laeuft === 'invite' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <UserPlus aria-hidden="true" />
              )}
              Einladen
            </Button>
          </div>
        </div>
      ) : null}

      {!rosterOffen ? (
        <p className="border-t border-border/60 pt-4 text-sm text-muted-foreground">
          Das Roster ist gesperrt. Änderungen laufen jetzt über die Turnierleitung.
        </p>
      ) : null}

      <ConfirmationDialog
        open={uebergabe !== null}
        onOpenChange={(naechste) => (naechste ? undefined : setUebergabe(null))}
        title="Führung übergeben?"
        description={
          uebergabe
            ? `${uebergabe.username} wird Captain und verwaltet ab dann das Team. Du bleibst Stammspieler.`
            : ''
        }
        confirmLabel="Übergeben"
        onConfirm={async () => {
          if (!uebergabe) {
            return;
          }
          const antwort = await transferCaptaincyAction({
            csrfToken,
            teamId,
            discordId: uebergabe.discordId,
          });
          if (antwort.ok) {
            toast.success(`${uebergabe.username} führt das Team.`);
            setUebergabe(null);
            router.refresh();
          } else {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
        }}
      />
    </div>
  );
}

/**
 * Offene Einladungen einer Person.
 *
 * Steht auf der Turnierseite, nicht in einem eigenen Postfach: dort sucht
 * niemand danach, und eine Einladung, die niemand sieht, ist keine.
 */
export function InviteInbox({
  csrfToken,
  einladungen,
}: {
  csrfToken: string;
  einladungen: Array<{ id: string; teamName: string; turnier: string; role: string }>;
}): React.JSX.Element | null {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);

  if (einladungen.length === 0) {
    return null;
  }

  async function antworten(inviteId: string, annehmen: boolean): Promise<void> {
    setLaeuft(inviteId);
    const antwort = await respondInviteAction({ csrfToken, inviteId, annehmen });
    if (antwort.ok) {
      toast.success(annehmen ? 'Du bist im Team.' : 'Einladung abgelehnt.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-5">
      <p className="font-medium">
        {einladungen.length === 1 ? 'Du wurdest eingeladen' : 'Du wurdest eingeladen'}
      </p>
      <ul className="space-y-2">
        {einladungen.map((einladung) => (
          <li key={einladung.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{einladung.teamName}</span>
              <span className="text-muted-foreground">
                {' '}
                · {einladung.turnier} · {ROLLE_LABEL[einladung.role] ?? einladung.role}
              </span>
            </span>
            <Button size="sm" disabled={laeuft !== null} onClick={() => void antworten(einladung.id, true)}>
              {laeuft === einladung.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Annehmen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={laeuft !== null}
              onClick={() => void antworten(einladung.id, false)}
            >
              Ablehnen
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
