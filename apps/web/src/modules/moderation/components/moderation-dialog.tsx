'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gavel } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatDuration } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import type { ModerationAbilities } from '@/modules/moderation/abilities';
import { createJailAction } from '@/modules/jail/actions';
import {
  banMemberAction,
  kickMemberAction,
  removeTimeoutAction,
  timeoutMemberAction,
  addModerationNoteAction,
} from '@/modules/moderation/actions';

/** Die Massnahmen, die diese Maske anbietet. */
type Massnahme = 'BAN' | 'KICK' | 'TIMEOUT' | 'TIMEOUT_REMOVE' | 'JAIL' | 'NOTE';

interface MassnahmeBeschreibung {
  wert: Massnahme;
  label: string;
  /** Was passiert - im Bestaetigungsschritt. */
  folge: string;
  darf: keyof ModerationAbilities;
}

const MASSNAHMEN: MassnahmeBeschreibung[] = [
  {
    wert: 'TIMEOUT',
    label: 'Timeout setzen',
    folge: 'Die Person kann für die gewählte Dauer nicht schreiben und nicht sprechen.',
    darf: 'timeout',
  },
  {
    wert: 'TIMEOUT_REMOVE',
    label: 'Timeout aufheben',
    folge: 'Ein laufender Timeout endet sofort.',
    darf: 'timeoutRemove',
  },
  {
    wert: 'KICK',
    label: 'Kicken',
    folge: 'Die Person wird vom Server entfernt und kann sofort wieder beitreten.',
    darf: 'kick',
  },
  {
    wert: 'BAN',
    label: 'Bannen',
    folge: 'Die Person wird vom Server gebannt. Der Bann gilt, bis ihn jemand aufhebt.',
    darf: 'ban',
  },
  {
    wert: 'JAIL',
    label: 'Jailen',
    folge:
      'Die Person bekommt die Jail-Rolle und verliert ihre übrigen Rollen, bis die Zeit abläuft oder jemand sie freilässt.',
    darf: 'jail',
  },
  {
    wert: 'NOTE',
    label: 'Notiz hinterlegen',
    folge: 'Nur ein Eintrag in der Akte. Die Person merkt nichts davon.',
    darf: 'note',
  },
];

/** Dauern, die Discord erlaubt (höchstens 28 Tage). */
const TIMEOUT_DAUERN = [
  { label: '5 Minuten', seconds: 300 },
  { label: '10 Minuten', seconds: 600 },
  { label: '30 Minuten', seconds: 1800 },
  { label: '1 Stunde', seconds: 3600 },
  { label: '6 Stunden', seconds: 21_600 },
  { label: '12 Stunden', seconds: 43_200 },
  { label: '1 Tag', seconds: 86_400 },
  { label: '1 Woche', seconds: 604_800 },
] as const;

/**
 * Dauern fuer den Jail.
 *
 * Bewusst andere als beim Timeout: Discord begrenzt einen Timeout auf 28
 * Tage, der Jail ist eine eigene Rolle und kennt diese Grenze nicht. Die
 * Obergrenze steht in den Jail-Einstellungen und wird serverseitig geprueft.
 */
const JAIL_DAUERN = [
  { label: '30 Minuten', seconds: 1800 },
  { label: '1 Stunde', seconds: 3600 },
  { label: '6 Stunden', seconds: 21_600 },
  { label: '12 Stunden', seconds: 43_200 },
  { label: '1 Tag', seconds: 86_400 },
  { label: '3 Tage', seconds: 259_200 },
  { label: '1 Woche', seconds: 604_800 },
] as const;

const JAIL_PERMANENT = 'permanent';

/** Wie weit zurück ein Bann Nachrichten löscht. Discord erlaubt 7 Tage. */
const LOESCH_DAUERN = [
  { label: 'Keine Nachrichten löschen', seconds: 0 },
  { label: 'Letzte Stunde', seconds: 3600 },
  { label: 'Letzten 24 Stunden', seconds: 86_400 },
  { label: 'Letzten 7 Tage', seconds: 604_800 },
] as const;

interface ModerationDialogProps {
  csrfToken: string;
  abilities: ModerationAbilities;
  /** Vorausgewähltes Mitglied, z.B. aus dem Mitgliederprofil. */
  presetMember?: PickedMember;
  triggerLabel?: string;
  /**
   * Grundvorlagen je Massnahme.
   *
   * Serverseitig aus den Moduleinstellungen der Moderation - eine Liste für
   * alle Masken. Was hier fehlt, zeigt die Maske schlicht nicht an; die
   * freie Eingabe bleibt in jedem Fall.
   */
  grundVorlagen?: Partial<Record<Massnahme, readonly string[]>>;
  variant?: 'button' | 'outline';
}

/**
 * Die Maske des Moderation Center.
 *
 * Angeboten wird nur, was der Betrachter auch darf - die Auswahlliste
 * entsteht aus seinen Berechtigungen. Das ist Bequemlichkeit, keine
 * Sicherheit: die Server Action prüft dieselbe Berechtigung noch einmal, und
 * der Dienst dahinter prüft zusätzlich die Rollenhierarchie auf Discord.
 *
 * Zwei Schritte, weil ein Bann einen echten Menschen trifft: erst ausfüllen,
 * dann bestätigen, mit der Folge im Klartext.
 */
export function ModerationDialog({
  csrfToken,
  abilities,
  presetMember,
  triggerLabel = 'Massnahme ergreifen',
  grundVorlagen = {},
  variant = 'button',
}: ModerationDialogProps): React.JSX.Element | null {
  const verfuegbar = useMemo(() => MASSNAHMEN.filter((eintrag) => abilities[eintrag.darf]), [abilities]);

  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [member, setMember] = useState<PickedMember | null>(presetMember ?? null);
  const [massnahme, setMassnahme] = useState<Massnahme>(verfuegbar[0]?.wert ?? 'NOTE');
  const [reason, setReason] = useState('');
  const [dauer, setDauer] = useState<string>('3600');
  const [jailDauer, setJailDauer] = useState<string>('3600');
  const [loeschen, setLoeschen] = useState<string>('0');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const router = useRouter();

  const gewaehlt = verfuegbar.find((eintrag) => eintrag.wert === massnahme) ?? verfuegbar[0];

  // Ohne eine einzige erlaubte Massnahme gibt es nichts zu zeigen. Der Aufrufer
  // blendet den Auslöser ohnehin schon aus; das hier ist die zweite Antwort auf
  // dieselbe Frage und macht `gewaehlt` zugleich sicher benutzbar.
  if (!gewaehlt) {
    return null;
  }
  const dauerSekunden = Number(dauer);
  const endet = massnahme === 'TIMEOUT' ? new Date(Date.now() + dauerSekunden * 1000) : null;

  function reset(): void {
    setConfirming(false);
    setPending(false);
    setMember(presetMember ?? null);
    setMassnahme(verfuegbar[0]?.wert ?? 'NOTE');
    setReason('');
    setDauer('3600');
    setJailDauer('3600');
    setLoeschen('0');
    setFieldError(null);
  }

  function handleContinue(): void {
    setFieldError(null);
    if (!member) {
      setFieldError('Bitte ein Mitglied auswählen.');
      return;
    }
    if (reason.trim().length < 3) {
      setFieldError('Bitte einen Grund mit mindestens 3 Zeichen angeben - er steht später in der Akte.');
      return;
    }
    setConfirming(true);
  }

  async function handleConfirm(): Promise<void> {
    if (!member || pending) {
      return;
    }
    setPending(true);

    const basis = { csrfToken, discordId: member.discordId, reason: reason.trim() };
    const antwort = await (massnahme === 'BAN'
      ? banMemberAction({ ...basis, deleteMessageSeconds: Number(loeschen) })
      : massnahme === 'KICK'
        ? kickMemberAction(basis)
        : massnahme === 'TIMEOUT'
          ? timeoutMemberAction({ ...basis, seconds: dauerSekunden })
          : massnahme === 'TIMEOUT_REMOVE'
            ? removeTimeoutAction(basis)
            : massnahme === 'JAIL'
              ? // Dieselbe Aktion wie die Jail-Maske: Policy, Rollen-Snapshot,
                // Discord, Audit und Historie liegen im Jail-Service. Diese
                // Maske sammelt nur die Eingabe.
                createJailAction({
                  csrfToken,
                  targetDiscordId: member.discordId,
                  reason: reason.trim(),
                  idempotencyKey: crypto.randomUUID(),
                  ...(jailDauer === JAIL_PERMANENT
                    ? { type: 'PERMANENT' as const }
                    : { type: 'TEMPORARY' as const, durationSeconds: Number(jailDauer) }),
                })
              : addModerationNoteAction(basis));

    if (antwort.ok) {
      const beschriftung = MASSNAHMEN.find((eintrag) => eintrag.wert === massnahme)?.label ?? 'Massnahme';
      toast.success(`${beschriftung}: ${member.displayName}`);
      setOpen(false);
      reset();
      router.refresh();
    } else {
      toast.error(antwort.error.message);
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) {
          return;
        }
        setOpen(next);
        if (!next) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant === 'outline' ? 'outline' : 'default'}>
          <Gavel aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {confirming && member ? (
          <>
            <DialogHeader>
              <DialogTitle>{gewaehlt.label} bestätigen</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p className="text-foreground">
                    Betroffen: <strong>@{member.username}</strong>
                  </p>
                  <p className="text-muted-foreground">{gewaehlt.folge}</p>
                  {endet ? (
                    <p className="text-muted-foreground">
                      Dauer: <strong>{formatDuration(dauerSekunden * 1000)}</strong> — Ende:{' '}
                      {formatDateTime(endet)}
                    </p>
                  ) : null}
                  {massnahme === 'BAN' && Number(loeschen) > 0 ? (
                    <p className="text-muted-foreground">
                      Nachrichten der letzten {formatDuration(Number(loeschen) * 1000)} werden gelöscht.
                    </p>
                  ) : null}
                  <div className="rounded-md border border-border bg-secondary/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Grund</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{reason.trim()}</p>
                  </div>
                  <p className="text-muted-foreground">
                    Diese Aktion betrifft einen echten Discord-Benutzer und wird im Audit Log gespeichert.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                Zurück
              </Button>
              <Button
                variant={massnahme === 'BAN' || massnahme === 'KICK' ? 'destructive' : 'default'}
                onClick={() => void handleConfirm()}
                loading={pending}
              >
                {gewaehlt.label}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Moderationsmassnahme</DialogTitle>
              <DialogDescription>
                Jede Massnahme braucht einen Grund. Er steht in der Akte des Mitglieds und ist später die
                einzige Erklärung.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {presetMember ? null : (
                <MemberPicker csrfToken={csrfToken} value={member} onChange={setMember} />
              )}

              <div className="space-y-2">
                <Label htmlFor="moderation-type">Massnahme</Label>
                <Select value={massnahme} onValueChange={(wert) => setMassnahme(wert as Massnahme)}>
                  <SelectTrigger id="moderation-type">
                    <SelectValue placeholder="Massnahme wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {verfuegbar.map((eintrag) => (
                      <SelectItem key={eintrag.wert} value={eintrag.wert}>
                        {eintrag.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{gewaehlt.folge}</p>
              </div>

              {massnahme === 'JAIL' ? (
                <div className="space-y-2">
                  <Label htmlFor="moderation-jail-duration">Dauer</Label>
                  <Select value={jailDauer} onValueChange={setJailDauer}>
                    <SelectTrigger id="moderation-jail-duration">
                      <SelectValue placeholder="Dauer wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {JAIL_DAUERN.map((eintrag) => (
                        <SelectItem key={eintrag.seconds} value={String(eintrag.seconds)}>
                          {eintrag.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={JAIL_PERMANENT}>Permanent</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Feinere Abstufungen und eigene Dauern gibt es im Jail-Bereich. Der Grund bleibt
                    intern.
                  </p>
                </div>
              ) : null}

              {massnahme === 'TIMEOUT' ? (
                <div className="space-y-2">
                  <Label htmlFor="moderation-duration">Dauer</Label>
                  <Select value={dauer} onValueChange={setDauer}>
                    <SelectTrigger id="moderation-duration">
                      <SelectValue placeholder="Dauer wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEOUT_DAUERN.map((eintrag) => (
                        <SelectItem key={eintrag.seconds} value={String(eintrag.seconds)}>
                          {eintrag.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Discord erlaubt höchstens 28 Tage. Das ist keine Einstellung, sondern die Grenze der
                    Plattform.
                  </p>
                </div>
              ) : null}

              {massnahme === 'BAN' ? (
                <div className="space-y-2">
                  <Label htmlFor="moderation-purge">Nachrichten löschen</Label>
                  <Select value={loeschen} onValueChange={setLoeschen}>
                    <SelectTrigger id="moderation-purge">
                      <SelectValue placeholder="Zeitraum wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOESCH_DAUERN.map((eintrag) => (
                        <SelectItem key={eintrag.seconds} value={String(eintrag.seconds)}>
                          {eintrag.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="moderation-reason">Grund</Label>

                {/*
                  Vorlagen als Schnellauswahl. Sie füllen das Feld und sind
                  damit fertig - danach lässt sich der Text ergänzen, kürzen
                  oder ganz ersetzen. In die Akte kommt, was am Ende dasteht,
                  nicht die Vorlage.

                  Der Grund, weshalb es sie gibt: derselbe Sachverhalt stand
                  vorher als «Spam», «spam» und «spammt seit Tagen» in der
                  Akte, und keine Auswertung darüber war je etwas wert.
                */}
                {(grundVorlagen[massnahme] ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(grundVorlagen[massnahme] ?? []).map((vorlage) => (
                      <button
                        key={vorlage}
                        type="button"
                        onClick={() => setReason(vorlage)}
                        className={
                          reason === vorlage
                            ? 'min-h-8 rounded-lg border border-primary/40 bg-primary/10 px-2.5 text-xs text-primary'
                            : 'min-h-8 rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted'
                        }
                      >
                        {vorlage}
                      </button>
                    ))}
                  </div>
                ) : null}

                <Textarea
                  id="moderation-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={400}
                  placeholder="z.B. Wiederholte Beleidigungen im Chat"
                />
                <p className="text-xs text-muted-foreground">{reason.length}/400 Zeichen</p>
              </div>

              {fieldError ? (
                <p role="alert" className="text-sm text-destructive">
                  {fieldError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleContinue}>Weiter</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
