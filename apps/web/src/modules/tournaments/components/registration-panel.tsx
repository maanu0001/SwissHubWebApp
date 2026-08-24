'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, LogIn, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  checkinAction,
  createTeamAction,
  registerAction,
  undoCheckinAction,
  withdrawAction,
} from '@/modules/tournaments/actions';
import { cn } from '@/lib/utils';

export interface Zusatzfrage {
  id: string;
  kind: string;
  label: string;
  description: string | null;
  placeholder: string | null;
  required: boolean;
  options: string[];
  maxLength: number | null;
}

export interface EigenerStand {
  angemeldet: boolean;
  registrationId: string | null;
  status: string | null;
  waitlistPosition: number | null;
  checkinStatus: string | null;
  teamId: string | null;
  teamName: string | null;
  istCaptain: boolean;
}

/**
 * Was ein Mitglied auf der Turnierseite tun kann.
 *
 * Bewusst genau ein Knopf je Lage: anmelden, einchecken, zurueckziehen. Eine
 * Seite, die alle Moeglichkeiten gleichzeitig zeigt, laesst niemanden wissen,
 * was gerade dran ist.
 *
 * Was hier erscheint, ist Bequemlichkeit - jede Aktion prueft serverseitig
 * erneut, ob sie erlaubt ist.
 */
export function RegistrationPanel({
  tournamentId,
  csrfToken,
  status,
  mode,
  rulesVersion,
  fragen,
  eigenerStand,
  eigeneTeams,
  angemeldet,
  eignung,
}: {
  tournamentId: string;
  csrfToken: string;
  status: string;
  mode: 'SOLO' | 'TEAM';
  rulesVersion: number;
  fragen: Zusatzfrage[];
  eigenerStand: EigenerStand;
  /** Teams, die diese Person in diesem Turnier führt. */
  eigeneTeams: Array<{ id: string; name: string; spieler: number; mindestens: number }>;
  /** Angemeldet in der WebApp? Ohne Anmeldung führt der Knopf zum Login. */
  angemeldet: boolean;
  /** Was der Teilnahme entgegensteht; leer = alles in Ordnung. */
  eignung: string[];
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamTag, setTeamTag] = useState('');
  const [gewaehltesTeam, setGewaehltesTeam] = useState(eigeneTeams[0]?.id ?? '');
  const [antworten, setAntworten] = useState<Record<string, string>>({});
  const [regelnAkzeptiert, setRegelnAkzeptiert] = useState(false);
  const [rueckzugDialog, setRueckzugDialog] = useState(false);

  if (!angemeldet) {
    return (
      <div className="space-y-3 rounded-xl border border-border p-5">
        <p className="text-sm text-muted-foreground">
          Zum Anmelden brauchst du dein Discord-Konto.
        </p>
        <Button asChild>
          <a href={`/login?redirect=/turniere`}>
            <LogIn aria-hidden="true" />
            Mit Discord anmelden
          </a>
        </Button>
      </div>
    );
  }

  if (eignung.length > 0 && !eigenerStand.angemeldet) {
    return (
      <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-5">
        <p className="text-sm font-medium text-warning">Du kannst hier nicht mitspielen</p>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          {eignung.map((grund) => (
            <li key={grund}>{grund}</li>
          ))}
        </ul>
      </div>
    );
  }

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

  // --- Bereits angemeldet ----------------------------------------------
  if (eigenerStand.angemeldet) {
    const checkinOffen = status === 'CHECKIN_OPEN';
    const eingecheckt =
      eigenerStand.checkinStatus === 'CHECKED_IN' ||
      eigenerStand.checkinStatus === 'ADMIN_CONFIRMED';

    return (
      <div className="space-y-4 rounded-xl border border-border p-5">
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            {eigenerStand.status === 'WAITLISTED'
              ? `Du stehst auf der Warteliste${eigenerStand.waitlistPosition ? ` (Platz ${eigenerStand.waitlistPosition})` : ''}.`
              : eigenerStand.status === 'PENDING'
                ? 'Deine Anmeldung wartet auf Freigabe.'
                : 'Du bist angemeldet.'}
          </p>
          {eigenerStand.teamName ? (
            <p className="text-sm text-muted-foreground">
              Team: <span className="text-foreground">{eigenerStand.teamName}</span>
            </p>
          ) : null}
        </div>

        {checkinOffen && eigenerStand.status === 'CONFIRMED' ? (
          eingecheckt ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="inline-flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Eingecheckt
              </p>
              <Button
                variant="ghost"
                size="sm"
                disabled={laeuft !== null}
                onClick={() =>
                  void fuehreAus(
                    'undo',
                    async () => {
                      const antwort = await undoCheckinAction({ csrfToken, tournamentId });
                      return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                    },
                    'Check-in zurückgenommen.',
                  )
                }
              >
                Zurücknehmen
              </Button>
            </div>
          ) : (
            <Button
              disabled={laeuft !== null || (mode === 'TEAM' && !eigenerStand.istCaptain)}
              onClick={() =>
                void fuehreAus(
                  'checkin',
                  async () => {
                    const antwort = await checkinAction({ csrfToken, tournamentId });
                    return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
                  },
                  'Check-in erledigt.',
                )
              }
            >
              {laeuft === 'checkin' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              {mode === 'TEAM' ? 'Team einchecken' : 'Jetzt einchecken'}
            </Button>
          )
        ) : null}

        {mode === 'TEAM' && !eigenerStand.istCaptain && checkinOffen && !eingecheckt ? (
          <p className="text-sm text-muted-foreground">
            Der Check-in läuft über deinen Captain.
          </p>
        ) : null}

        {['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECKIN_OPEN', 'CHECKIN_CLOSED'].includes(
          status,
        ) && eigenerStand.registrationId ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={laeuft !== null}
              onClick={() => setRueckzugDialog(true)}
            >
              Anmeldung zurückziehen
            </Button>
            <ConfirmationDialog
              open={rueckzugDialog}
              onOpenChange={setRueckzugDialog}
              destructive
              title="Anmeldung zurückziehen?"
              description={
                mode === 'TEAM'
                  ? 'Das ganze Team wird abgemeldet. Ein Platz auf der Warteliste rückt nach.'
                  : 'Ein Platz auf der Warteliste rückt nach.'
              }
              confirmLabel="Zurückziehen"
              onConfirm={async () => {
                const antwort = await withdrawAction({
                  csrfToken,
                  registrationId: eigenerStand.registrationId!,
                });
                if (antwort.ok) {
                  toast.success('Abgemeldet.');
                  router.refresh();
                } else {
                  toast.error(antwort.error.message);
                  throw new Error(antwort.error.message);
                }
              }}
            />
          </>
        ) : null}
      </div>
    );
  }

  // --- Anmeldung geschlossen -------------------------------------------
  if (status !== 'REGISTRATION_OPEN') {
    return (
      <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
        {status === 'DRAFT'
          ? 'Dieses Turnier ist noch nicht veröffentlicht.'
          : 'Die Anmeldung für dieses Turnier ist geschlossen.'}
      </div>
    );
  }

  // --- Team gründen ----------------------------------------------------
  if (mode === 'TEAM' && eigeneTeams.length === 0) {
    return (
      <form
        className="space-y-4 rounded-xl border border-border p-5"
        onSubmit={(ereignis) => {
          ereignis.preventDefault();
          void fuehreAus(
            'team',
            async () => {
              const antwort = await createTeamAction({
                csrfToken,
                tournamentId,
                name: teamName.trim(),
                ...(teamTag.trim() ? { tag: teamTag.trim() } : {}),
              });
              return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
            },
            'Team gegründet. Lade jetzt deine Mitspieler ein.',
          );
        }}
      >
        <div className="space-y-1">
          <p className="inline-flex items-center gap-2 font-medium">
            <Users className="size-4" aria-hidden="true" />
            Team gründen
          </p>
          <p className="text-sm text-muted-foreground">
            Du wirst Captain. Danach lädst du deine Mitspieler ein und meldest das Team an.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div className="space-y-1">
            <Label htmlFor="team-name">Teamname</Label>
            <Input
              id="team-name"
              value={teamName}
              onChange={(ereignis) => setTeamName(ereignis.target.value)}
              minLength={2}
              maxLength={60}
              required
              placeholder="Team Helvetia"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-tag">Kürzel</Label>
            <Input
              id="team-tag"
              value={teamTag}
              onChange={(ereignis) => setTeamTag(ereignis.target.value)}
              maxLength={8}
              placeholder="HEL"
            />
          </div>
        </div>

        <Button type="submit" disabled={laeuft !== null || teamName.trim().length < 2}>
          {laeuft === 'team' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          Team gründen
        </Button>
      </form>
    );
  }

  // --- Anmelden --------------------------------------------------------
  const team = eigeneTeams.find((eintrag) => eintrag.id === gewaehltesTeam);
  const teamZuKlein = mode === 'TEAM' && team !== undefined && team.spieler < team.mindestens;

  return (
    <form
      className="space-y-4 rounded-xl border border-border p-5"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        void fuehreAus(
          'register',
          async () => {
            const antwort = await registerAction({
              csrfToken,
              tournamentId,
              ...(mode === 'TEAM' ? { teamId: gewaehltesTeam } : {}),
              rulesVersion,
              rulesAccepted: true,
              answers: antworten,
            });
            return { ok: antwort.ok, fehler: antwort.ok ? undefined : antwort.error.message };
          },
          'Angemeldet.',
        );
      }}
    >
      {mode === 'TEAM' && eigeneTeams.length > 0 ? (
        <div className="space-y-1">
          <Label htmlFor="anmeldung-team">Team</Label>
          <Select value={gewaehltesTeam} onValueChange={setGewaehltesTeam}>
            <SelectTrigger id="anmeldung-team">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eigeneTeams.map((eintrag) => (
                <SelectItem key={eintrag.id} value={eintrag.id}>
                  {eintrag.name} ({eintrag.spieler} Spieler)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {teamZuKlein ? (
            <p className="text-xs text-warning">
              Das Team braucht mindestens {team!.mindestens} Spieler - aktuell sind es{' '}
              {team!.spieler}.
            </p>
          ) : null}
        </div>
      ) : null}

      {fragen.map((frage) => (
        <div key={frage.id} className="space-y-1">
          <Label htmlFor={`frage-${frage.id}`}>
            {frage.label}
            {frage.required ? <span className="ml-1 text-destructive">*</span> : null}
          </Label>
          {frage.description ? (
            <p className="text-xs text-muted-foreground">{frage.description}</p>
          ) : null}

          {frage.kind === 'LONG_TEXT' ? (
            <Textarea
              id={`frage-${frage.id}`}
              value={antworten[frage.id] ?? ''}
              onChange={(ereignis) =>
                setAntworten((vorher) => ({ ...vorher, [frage.id]: ereignis.target.value }))
              }
              rows={3}
              required={frage.required}
              maxLength={frage.maxLength ?? 2000}
              placeholder={frage.placeholder ?? ''}
            />
          ) : frage.kind === 'SELECT' ? (
            <Select
              value={antworten[frage.id] ?? ''}
              onValueChange={(wert) =>
                setAntworten((vorher) => ({ ...vorher, [frage.id]: wert }))
              }
            >
              <SelectTrigger id={`frage-${frage.id}`}>
                <SelectValue placeholder="Bitte wählen" />
              </SelectTrigger>
              <SelectContent>
                {frage.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`frage-${frage.id}`}
              type={frage.kind === 'URL' ? 'url' : 'text'}
              value={antworten[frage.id] ?? ''}
              onChange={(ereignis) =>
                setAntworten((vorher) => ({ ...vorher, [frage.id]: ereignis.target.value }))
              }
              required={frage.required}
              maxLength={frage.maxLength ?? 200}
              placeholder={frage.placeholder ?? ''}
            />
          )}
        </div>
      ))}

      <label
        className={cn(
          'flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2',
          regelnAkzeptiert ? 'border-primary/50 bg-primary/5' : '',
        )}
      >
        <input
          type="checkbox"
          checked={regelnAkzeptiert}
          onChange={(ereignis) => setRegelnAkzeptiert(ereignis.target.checked)}
          className="mt-0.5 size-4 accent-[color:var(--primary)]"
          required
        />
        <span className="text-sm">
          Ich habe das Regelwerk gelesen und akzeptiere es.
        </span>
      </label>

      <Button
        type="submit"
        disabled={laeuft !== null || !regelnAkzeptiert || teamZuKlein || (mode === 'TEAM' && !gewaehltesTeam)}
      >
        {laeuft === 'register' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {mode === 'TEAM' ? 'Team anmelden' : 'Jetzt anmelden'}
      </Button>
    </form>
  );
}
