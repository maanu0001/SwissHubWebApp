'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Clock, LogOut, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { registerAction, unregisterAction } from '@/modules/calendar/actions';

/**
 * An- und Abmeldung auf der Detailseite.
 *
 * Der Knopf bietet nur an, was tatsaechlich moeglich ist: ist die Frist
 * abgelaufen oder das Event abgesagt, steht dort der Grund statt eines
 * Knopfes, der beim Druecken einen Fehler zeigt.
 *
 * Bewusst kein vorgezogener Zustandswechsel im Browser: ob eine Anmeldung
 * bestaetigt wird oder auf der Warteliste landet, entscheidet erst der
 * Server - beim letzten freien Platz weiss der Browser es nicht besser.
 */
export function AnmeldeBereich({
  csrfToken,
  eventId,
  darfTeilnehmen,
  gesperrtGrund,
  abmeldenGrund,
  meine,
  belegung,
  wartelisteMoeglich,
  fragen,
}: {
  csrfToken: string;
  eventId: string;
  darfTeilnehmen: boolean;
  gesperrtGrund: string | null;
  abmeldenGrund: string | null;
  meine: { status: 'CONFIRMED' | 'WAITLIST' | 'CANCELLED'; position: number | null } | null;
  belegung: { confirmed: number; capacity: number; waitlist: number; full: boolean };
  wartelisteMoeglich: boolean;
  fragen: Array<{
    id: string;
    label: string;
    hint: string | null;
    required: boolean;
    choices: string[];
  }>;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [abmeldenOffen, setAbmeldenOffen] = useState(false);
  const [antworten, setAntworten] = useState<Record<string, string>>({});

  const anmelden = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await registerAction({ csrfToken, eventId, answers: antworten });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(
        ergebnis.data?.waitlisted
          ? `Du stehst auf der Warteliste (Platz ${ergebnis.data.position}).`
          : 'Du bist angemeldet.',
      );
      setAntworten({});
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const abmelden = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await unregisterAction({ csrfToken, eventId });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        throw new Error('Abmeldung fehlgeschlagen');
      }
      toast.success('Deine Teilnahme wurde zurückgezogen.');
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const plaetze =
    belegung.capacity > 0
      ? `${belegung.confirmed} / ${belegung.capacity}`
      : `${belegung.confirmed}`;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Teilnahme</h2>
        <span className="tabular-nums text-sm text-muted-foreground">{plaetze}</span>
      </div>

      {belegung.waitlist > 0 ? (
        <p className="text-xs text-muted-foreground">
          {belegung.waitlist} Person(en) auf der Warteliste.
        </p>
      ) : null}

      {meine ? (
        <>
          <p
            className={
              meine.status === 'CONFIRMED'
                ? 'flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500'
                : 'flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500'
            }
          >
            {meine.status === 'CONFIRMED' ? (
              <>
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                Du bist angemeldet.
              </>
            ) : (
              <>
                <Clock className="size-4 shrink-0" aria-hidden="true" />
                Du stehst auf der Warteliste
                {meine.position ? ` (Platz ${meine.position})` : null}.
              </>
            )}
          </p>

          {abmeldenGrund ? (
            <p className="text-xs text-muted-foreground">{abmeldenGrund}</p>
          ) : (
            <>
              <Button
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={() => setAbmeldenOffen(true)}
              >
                <LogOut aria-hidden="true" />
                Teilnahme zurückziehen
              </Button>
              <ConfirmationDialog
                open={abmeldenOffen}
                onOpenChange={setAbmeldenOffen}
                title="Teilnahme zurückziehen?"
                description={
                  meine.status === 'CONFIRMED' && belegung.waitlist > 0
                    ? 'Dein Platz geht an die erste Person auf der Warteliste. Eine erneute Anmeldung landet dann hinten.'
                    : 'Du kannst dich später wieder anmelden, solange Plätze frei sind und die Frist läuft.'
                }
                confirmLabel="Teilnahme zurückziehen"
                destructive
                onConfirm={abmelden}
              />
            </>
          )}
        </>
      ) : gesperrtGrund ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {gesperrtGrund}
        </p>
      ) : !darfTeilnehmen ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Für die Anmeldung fehlt dir die Berechtigung.
        </p>
      ) : belegung.full && !wartelisteMoeglich ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Dieses Event ist ausgebucht.
        </p>
      ) : (
        <>
          {fragen.length > 0 ? (
            <div className="space-y-3">
              {fragen.map((frage) => (
                <div key={frage.id} className="space-y-1.5">
                  <Label htmlFor={`frage-${frage.id}`}>
                    {frage.label}
                    {frage.required ? ' *' : ''}
                  </Label>
                  {frage.choices.length > 0 ? (
                    <select
                      id={`frage-${frage.id}`}
                      value={antworten[frage.id] ?? ''}
                      onChange={(event) =>
                        setAntworten((wert) => ({ ...wert, [frage.id]: event.target.value }))
                      }
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                    >
                      <option value="">Bitte wählen</option>
                      {frage.choices.map((auswahl) => (
                        <option key={auswahl} value={auswahl}>
                          {auswahl}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`frage-${frage.id}`}
                      value={antworten[frage.id] ?? ''}
                      maxLength={500}
                      onChange={(event) =>
                        setAntworten((wert) => ({ ...wert, [frage.id]: event.target.value }))
                      }
                    />
                  )}
                  {frage.hint ? (
                    <p className="text-xs text-muted-foreground">{frage.hint}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <Button className="w-full" disabled={pending} onClick={() => void anmelden()}>
            <UserPlus aria-hidden="true" />
            {belegung.full ? 'Auf Warteliste setzen' : 'Teilnehmen'}
          </Button>

          {belegung.full ? (
            <p className="text-xs text-muted-foreground">
              Das Event ist voll. Wird ein Platz frei, rückt die erste Person der Warteliste
              automatisch nach.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
