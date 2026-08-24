'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Flag,
  Loader2,
  Megaphone,
  Pause,
  Play,
  Radio,
  Swords,
  Users,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { StatCard } from '@/components/shared/stat-card';
import {
  cancelTournamentAction,
  publishTournamentAction,
  setStatusAction,
} from '@/modules/tournaments/admin-actions';
import { STATUS_LABEL } from './tournament-badges';
import { cn } from '@/lib/utils';

export interface LiveZustand {
  status: string;
  runde: number | null;
  abschnitt: string | null;
  matchesLive: number;
  matchesWartend: number;
  matchesOffen: number;
  matchesFertig: number;
  einspruecheOffen: number;
  eingecheckt: number;
  bestaetigt: number;
}

export interface Startcheck {
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
}

/**
 * Welcher Zustand nach diesem kommt.
 *
 * Bewusst genau ein Weg vorwärts je Zustand: der Leitstand soll sagen, was
 * jetzt dran ist, nicht alle neun Möglichkeiten anbieten. Die vollständige
 * Übergangstabelle steht im Modul und entscheidet weiterhin - hier steht nur,
 * was angeboten wird.
 */
const NAECHSTER_SCHRITT: Record<string, { status: string; label: string; icon: typeof Play } | undefined> = {
  REGISTRATION_OPEN: {
    status: 'REGISTRATION_CLOSED',
    label: 'Anmeldung schliessen',
    icon: Flag,
  },
  REGISTRATION_CLOSED: { status: 'CHECKIN_OPEN', label: 'Check-in öffnen', icon: Megaphone },
  CHECKIN_OPEN: { status: 'CHECKIN_CLOSED', label: 'Check-in schliessen', icon: Flag },
  CHECKIN_CLOSED: { status: 'READY', label: 'Als startbereit markieren', icon: CheckCircle2 },
  READY: { status: 'RUNNING', label: 'Turnier starten', icon: Play },
  PAUSED: { status: 'RUNNING', label: 'Fortsetzen', icon: Play },
};

/**
 * Der Leitstand eines Turniers.
 *
 * Zeigt den Live-Stand und genau die Knöpfe, die im aktuellen Zustand etwas
 * bewirken. Der Stand kommt über einen Ereignisstrom nach - während eines
 * laufenden Turniers ist eine Seite, die man von Hand neu laden muss, keine
 * Hilfe.
 *
 * Jeder Knopf hier prüft serverseitig erneut Berechtigung, Zuständigkeit und
 * Zustandsübergang. Was hier fehlt, ist deshalb nur aufgeräumt, nicht gesperrt.
 */
export function ControlCenter({
  tournamentId,
  csrfToken,
  anfangsZustand,
  startcheck,
  darfSteuern,
}: {
  tournamentId: string;
  csrfToken: string;
  anfangsZustand: LiveZustand;
  /** Der Startcheck der aktuellen Phase; leer, wenn keiner ansteht. */
  startcheck: Startcheck[];
  darfSteuern: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [zustand, setZustand] = useState(anfangsZustand);
  const [verbunden, setVerbunden] = useState(false);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [absageOffen, setAbsageOffen] = useState(false);
  const [absageGrund, setAbsageGrund] = useState('');

  useEffect(() => {
    const quelle = new EventSource(`/api/tournaments/${tournamentId}/live`);

    quelle.addEventListener('open', () => setVerbunden(true));
    quelle.addEventListener('zustand', (ereignis) => {
      try {
        setZustand(JSON.parse((ereignis as MessageEvent<string>).data) as LiveZustand);
        setVerbunden(true);
      } catch {
        // Eine unlesbare Nachricht ist kein Grund, den Strom aufzugeben.
      }
    });
    quelle.addEventListener('error', () => setVerbunden(false));

    return () => quelle.close();
  }, [tournamentId]);

  // Ändert sich der Zustand des Turniers selbst, stimmt die restliche Seite
  // nicht mehr - dann lohnt sich das Nachladen.
  useEffect(() => {
    if (zustand.status !== anfangsZustand.status) {
      router.refresh();
    }
  }, [zustand.status, anfangsZustand.status, router]);

  async function fuehreAus(
    name: string,
    arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>,
    erfolg: string,
  ): Promise<void> {
    setLaeuft(name);
    const antwort = await arbeit();
    if (antwort.ok) {
      toast.success(erfolg);
      router.refresh();
    } else {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(null);
  }

  const schritt = NAECHSTER_SCHRITT[zustand.status];
  const blocker = startcheck.filter((eintrag) => eintrag.status === 'error');
  const warnungen = startcheck.filter((eintrag) => eintrag.status === 'warning');
  const laufend = zustand.status === 'RUNNING' || zustand.status === 'PAUSED';
  const beendbar = zustand.status === 'RUNNING' && zustand.matchesOffen === 0 && zustand.matchesLive === 0;
  const absagbar =
    zustand.status !== 'COMPLETED' && zustand.status !== 'CANCELLED' && zustand.status !== 'ARCHIVED';

  return (
    <div className="space-y-6">
      {/* --- Kennzahlen ------------------------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bestätigt"
          value={zustand.bestaetigt}
          hint={`${zustand.eingecheckt} eingecheckt`}
          icon={<Users className="size-4" aria-hidden="true" />}
        />
        <StatCard
          label="Matches live"
          value={zustand.matchesLive}
          hint={`${zustand.matchesOffen} offen · ${zustand.matchesFertig} fertig`}
          icon={<Swords className="size-4" aria-hidden="true" />}
          tone={zustand.matchesLive > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Resultat offen"
          value={zustand.matchesWartend}
          hint={zustand.abschnitt ? `${zustand.abschnitt}, Runde ${zustand.runde}` : 'Kein Bracket'}
          icon={<CircleDot className="size-4" aria-hidden="true" />}
          tone={zustand.matchesWartend > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Einsprüche"
          value={zustand.einspruecheOffen}
          hint={zustand.einspruecheOffen > 0 ? 'Warten auf Entscheid' : 'Nichts offen'}
          icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          tone={zustand.einspruecheOffen > 0 ? 'destructive' : 'default'}
        />
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Radio
          className={cn('size-3.5', verbunden ? 'text-success' : 'text-muted-foreground')}
          aria-hidden="true"
        />
        {verbunden
          ? 'Der Stand aktualisiert sich selbst.'
          : 'Kein Live-Stand - die Zahlen stammen vom Seitenaufbau.'}
      </p>

      {/* --- Startcheck ------------------------------------------------ */}
      {startcheck.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-border p-5">
          <h2 className="text-sm font-semibold">Startcheck</h2>
          <ul className="space-y-1.5">
            {startcheck.map((eintrag) => (
              <li key={eintrag.label} className="flex items-start gap-2 text-sm">
                {eintrag.status === 'ok' ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : eintrag.status === 'warning' ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span className="min-w-0">
                  <span className="font-medium">{eintrag.label}: </span>
                  <span className="text-muted-foreground">{eintrag.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {blocker.length > 0 ? (
            <p className="text-xs text-destructive">
              {blocker.length === 1
                ? 'Ein Punkt muss erledigt sein, bevor es weitergeht.'
                : `${blocker.length} Punkte müssen erledigt sein, bevor es weitergeht.`}
            </p>
          ) : warnungen.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Die Hinweise halten nichts auf - sie sind einen Blick wert.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* --- Steuerung ------------------------------------------------- */}
      {darfSteuern ? (
        <section className="space-y-3 rounded-2xl border border-border p-5">
          <h2 className="text-sm font-semibold">Steuerung</h2>
          <p className="text-xs text-muted-foreground">
            Zustand: {STATUS_LABEL[zustand.status] ?? zustand.status}
          </p>

          <div className="flex flex-wrap gap-2">
            {zustand.status === 'DRAFT' ? (
              <Button
                disabled={laeuft !== null || blocker.length > 0}
                onClick={() =>
                  fuehreAus(
                    'publish',
                    () => publishTournamentAction({ csrfToken, tournamentId }),
                    'Turnier veröffentlicht.',
                  )
                }
              >
                {laeuft === 'publish' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Megaphone aria-hidden="true" />
                )}
                Veröffentlichen
              </Button>
            ) : null}

            {schritt ? (
              <Button
                disabled={laeuft !== null || (schritt.status === 'RUNNING' && blocker.length > 0)}
                onClick={() =>
                  fuehreAus(
                    'schritt',
                    () =>
                      setStatusAction({
                        csrfToken,
                        tournamentId,
                        status: schritt.status as never,
                      }),
                    `${schritt.label} erledigt.`,
                  )
                }
              >
                {laeuft === 'schritt' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <schritt.icon aria-hidden="true" />
                )}
                {schritt.label}
              </Button>
            ) : null}

            {zustand.status === 'RUNNING' ? (
              <Button
                variant="outline"
                disabled={laeuft !== null}
                onClick={() =>
                  fuehreAus(
                    'pause',
                    () => setStatusAction({ csrfToken, tournamentId, status: 'PAUSED' }),
                    'Turnier pausiert.',
                  )
                }
              >
                {laeuft === 'pause' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Pause aria-hidden="true" />
                )}
                Pausieren
              </Button>
            ) : null}

            {laufend ? (
              <Button
                variant="outline"
                disabled={laeuft !== null || !beendbar}
                title={beendbar ? undefined : 'Es sind noch Matches offen. Sie müssen erst entschieden sein.'}
                onClick={() =>
                  fuehreAus(
                    'ende',
                    () => setStatusAction({ csrfToken, tournamentId, status: 'COMPLETED' }),
                    'Turnier abgeschlossen. Platzierungen und Preise sind vergeben.',
                  )
                }
              >
                {laeuft === 'ende' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 aria-hidden="true" />
                )}
                Turnier abschliessen
              </Button>
            ) : null}

            {zustand.status === 'COMPLETED' ? (
              <Button
                variant="outline"
                disabled={laeuft !== null}
                onClick={() =>
                  fuehreAus(
                    'archiv',
                    () => setStatusAction({ csrfToken, tournamentId, status: 'ARCHIVED' }),
                    'Turnier archiviert.',
                  )
                }
              >
                {laeuft === 'archiv' ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Flag aria-hidden="true" />
                )}
                Archivieren
              </Button>
            ) : null}

            {absagbar ? (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={laeuft !== null}
                onClick={() => setAbsageOffen(true)}
              >
                <XCircle aria-hidden="true" />
                Absagen
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConfirmationDialog
        open={absageOffen}
        onOpenChange={setAbsageOffen}
        title="Turnier absagen?"
        description="Alle Angemeldeten werden auf Discord benachrichtigt. Eine Absage lässt sich nicht zurücknehmen."
        confirmLabel="Turnier absagen"
        destructive
        onConfirm={async () => {
          const antwort = await cancelTournamentAction({
            csrfToken,
            tournamentId,
            reason: absageGrund,
          });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Turnier abgesagt.');
          setAbsageGrund('');
          router.refresh();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="absage-grund">Grund</Label>
          <Textarea
            id="absage-grund"
            rows={3}
            minLength={5}
            maxLength={500}
            value={absageGrund}
            onChange={(e) => setAbsageGrund(e.target.value)}
            placeholder="Zu wenige Anmeldungen."
          />
          <p className="text-xs text-muted-foreground">
            Der Grund steht in der Ankündigung. Mindestens fünf Zeichen.
          </p>
        </div>
      </ConfirmationDialog>
    </div>
  );
}
