'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowUpCircle, Check, Hand, MessageSquare, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import type { AppealPriority, AppealStatus } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  fasseAppealZusammenAction,
  genehmigeAppealAction,
  lehneAppealAbAction,
  schreibeAppealNachrichtAction,
  setzeAppealPrioritaetAction,
  setzeAppealStatusAction,
  uebernimmAppealAction,
  wiederholeEntbannungAction,
} from '@/modules/appeals/actions';

export interface FallNachricht {
  id: string;
  vonTeam: boolean;
  autor: string;
  inhalt: string;
  am: string;
}

export interface FallRechte {
  review: boolean;
  assign: boolean;
  message: boolean;
  priority: boolean;
  approve: boolean;
  reject: boolean;
  unban: boolean;
}

/**
 * Die Schnellaktionen und das Gespräch (§15).
 *
 * Jeder Knopf hier hat sein Gegenstück in einer Server Action mit eigener
 * Berechtigung. Was jemand nicht darf, wird nicht angezeigt - abgewiesen wird
 * es serverseitig. Das Verstecken ist Bequemlichkeit, nicht Sicherheit (§21).
 *
 * Die Entscheidung liegt hinter einem Bestätigungsdialog mit Pflichtbegründung:
 * sie geht an einen Menschen hinaus und lässt sich nicht zurücknehmen.
 */
export function FallAktionen({
  csrfToken,
  appealId,
  status,
  istZugewiesenAnMich,
  istZugewiesen,
  prioritaet,
  unbanStatus,
  vorschlagVon,
  vorschlagVonMir,
  rechte,
  nachrichten,
}: {
  csrfToken: string;
  appealId: string;
  status: AppealStatus;
  istZugewiesenAnMich: boolean;
  istZugewiesen: boolean;
  prioritaet: AppealPriority;
  unbanStatus: string | null;
  vorschlagVon: string | null;
  vorschlagVonMir: boolean;
  rechte: FallRechte;
  nachrichten: FallNachricht[];
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [text, setText] = useState('');
  const [entscheidung, setEntscheidung] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [begruendung, setBegruendung] = useState('');
  const [intern, setIntern] = useState('');
  const [erneutErlaubt, setErneutErlaubt] = useState(true);
  const [entbannen, setEntbannen] = useState(true);
  const [ki, setKi] = useState<{
    zusammenfassung: string;
    kernaussagen: string[];
    offeneFragen: string[];
  } | null>(null);

  const offen = !['APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'RESOLVED_EXTERNALLY', 'CLOSED'].includes(
    status,
  );

  const mit = async (arbeit: () => Promise<{ ok: boolean; error?: { message: string } }>): Promise<void> => {
    setPending(true);
    try {
      const antwort = await arbeit();
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const senden = async (): Promise<void> => {
    if (text.trim().length < 2) {
      return;
    }
    await mit(async () => {
      const antwort = await schreibeAppealNachrichtAction({ csrfToken, appealId, inhalt: text });
      if (antwort.ok) {
        setText('');
        toast.success('Rückfrage gesendet - der Antrag wartet jetzt auf eine Antwort.');
      }
      return antwort;
    });
  };

  const zusammenfassen = async (): Promise<void> => {
    setPending(true);
    try {
      const antwort = await fasseAppealZusammenAction({ csrfToken, appealId });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      if (!antwort.data.ok) {
        toast.error(antwort.data.fehler ?? 'Die AI konnte nicht antworten.');
        return;
      }
      setKi({
        zusammenfassung: antwort.data.zusammenfassung ?? '',
        kernaussagen: antwort.data.kernaussagen ?? [],
        offeneFragen: antwort.data.offeneFragen ?? [],
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Panel title="Bearbeitung">
        <div className="flex flex-wrap items-center gap-2">
          {rechte.review && offen ? (
            <Button
              size="sm"
              variant={istZugewiesenAnMich ? 'outline' : 'default'}
              disabled={pending}
              onClick={() =>
                void mit(() => uebernimmAppealAction({ csrfToken, appealId, freigeben: istZugewiesenAnMich }))
              }
            >
              <Hand aria-hidden="true" />
              {istZugewiesenAnMich ? 'Freigeben' : istZugewiesen ? 'Übernehmen' : 'Übernehmen'}
            </Button>
          ) : null}

          {rechte.review && offen && status !== 'UNDER_REVIEW' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void mit(() => setzeAppealStatusAction({ csrfToken, appealId, nach: 'UNDER_REVIEW' }))
              }
            >
              Prüfung beginnen
            </Button>
          ) : null}

          {rechte.review && offen && status !== 'ESCALATED' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void mit(() => setzeAppealStatusAction({ csrfToken, appealId, nach: 'ESCALATED' }))
              }
            >
              <ArrowUpCircle aria-hidden="true" />
              Eskalieren
            </Button>
          ) : null}

          {rechte.priority ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="prio" className="text-xs text-muted-foreground">
                Priorität
              </Label>
              <Select
                value={prioritaet}
                disabled={pending}
                onValueChange={(naechste) =>
                  void mit(() =>
                    setzeAppealPrioritaetAction({
                      csrfToken,
                      appealId,
                      prioritaet: naechste as AppealPriority,
                    }),
                  )
                }
              >
                <SelectTrigger id="prio" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Niedrig</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">Hoch</SelectItem>
                  <SelectItem value="URGENT">Dringend</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {rechte.unban && (unbanStatus === 'PARTIAL' || unbanStatus === 'FAILED') ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                void mit(async () => {
                  const antwort = await wiederholeEntbannungAction({ csrfToken, appealId });
                  if (antwort.ok) {
                    toast[antwort.data.hinweis ? 'warning' : 'success'](
                      antwort.data.hinweis ?? 'Entbannung durchgeführt.',
                    );
                  }
                  return antwort;
                })
              }
            >
              <RefreshCw aria-hidden="true" />
              Entbannung erneut versuchen
            </Button>
          ) : null}

          {rechte.review ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => void zusammenfassen()}>
              <Sparkles aria-hidden="true" />
              AI-Zusammenfassung
            </Button>
          ) : null}
        </div>

        {ki ? (
          <div className="mt-4 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI-generierte Zusammenfassung — die Entscheidung trifft das Team.
            </p>
            <p className="text-sm">{ki.zusammenfassung}</p>
            {ki.kernaussagen.length > 0 ? (
              <ul className="ml-4 list-disc text-sm text-muted-foreground">
                {ki.kernaussagen.map((aussage, index) => (
                  <li key={index}>{aussage}</li>
                ))}
              </ul>
            ) : null}
            {ki.offeneFragen.length > 0 ? (
              <>
                <p className="text-xs font-medium text-muted-foreground">Offene Fragen</p>
                <ul className="ml-4 list-disc text-sm text-muted-foreground">
                  {ki.offeneFragen.map((frage, index) => (
                    <li key={index}>{frage}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        {vorschlagVon && status === 'DECISION_PENDING' ? (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">Eine Entscheidung wartet auf Bestätigung</p>
            <p className="text-muted-foreground">
              Vorgeschlagen von {vorschlagVon}.
              {vorschlagVonMir
                ? ' Den eigenen Vorschlag darf niemand selbst bestätigen - es braucht eine zweite Person.'
                : ' Du kannst ihn bestätigen.'}
            </p>
          </div>
        ) : null}

        {(rechte.approve || rechte.reject) && offen ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
            {rechte.approve ? (
              <Button
                disabled={pending || vorschlagVonMir}
                onClick={() => {
                  setEntscheidung('APPROVE');
                  setBegruendung('');
                }}
              >
                <Check aria-hidden="true" />
                Entbannung genehmigen
              </Button>
            ) : null}
            {rechte.reject ? (
              <Button
                variant="outline"
                disabled={pending || vorschlagVonMir}
                onClick={() => {
                  setEntscheidung('REJECT');
                  setBegruendung('');
                }}
              >
                <X aria-hidden="true" />
                Ablehnen
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel
        title="Kommunikation mit dem Antragsteller"
        description="Diese Nachrichten gehen hinaus - der Antragsteller sieht sie als «SwissHub Team»."
        icon={<MessageSquare className="size-4" aria-hidden="true" />}
      >
        {nachrichten.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Nachrichten.</p>
        ) : (
          <ul className="space-y-3">
            {nachrichten.map((nachricht) => (
              <li
                key={nachricht.id}
                className={
                  nachricht.vonTeam
                    ? 'ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary/10 px-3 py-2'
                    : 'mr-auto max-w-[85%] rounded-lg rounded-bl-sm border border-border/60 bg-muted/30 px-3 py-2'
                }
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {nachricht.autor} · {new Date(nachricht.am).toLocaleString('de-CH')}
                </p>
                <p className="whitespace-pre-wrap text-sm">{nachricht.inhalt}</p>
              </li>
            ))}
          </ul>
        )}

        {rechte.message && offen ? (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <textarea
              value={text}
              maxLength={4000}
              rows={3}
              placeholder="Rückfrage an den Antragsteller …"
              onChange={(event) => setText(event.target.value)}
              className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
            />
            <Button
              size="sm"
              onClick={() => void senden()}
              loading={pending}
              disabled={text.trim().length < 2}
            >
              <Send aria-hidden="true" />
              Senden
            </Button>
          </div>
        ) : null}
      </Panel>

      <ConfirmationDialog
        open={entscheidung !== null}
        onOpenChange={(auf) => {
          if (!auf) {
            setEntscheidung(null);
          }
        }}
        title={entscheidung === 'APPROVE' ? 'Entbannung genehmigen?' : 'Antrag ablehnen?'}
        description={
          entscheidung === 'APPROVE'
            ? 'Der Antragsteller wird entbannt und kann zurück auf den Server. Die Begründung geht an ihn.'
            : 'Der Bann bleibt bestehen. Die Begründung geht an den Antragsteller.'
        }
        confirmLabel={entscheidung === 'APPROVE' ? 'Genehmigen' : 'Ablehnen'}
        destructive={entscheidung === 'REJECT'}
        onConfirm={async () => {
          if (begruendung.trim().length < 10) {
            toast.error('Bitte eine Begründung angeben - sie geht an den Antragsteller.');
            throw new Error('Begründung fehlt');
          }
          const antwort =
            entscheidung === 'APPROVE'
              ? await genehmigeAppealAction({
                  csrfToken,
                  appealId,
                  publicDecision: begruendung,
                  internalDecision: intern || undefined,
                  entbannen,
                })
              : await lehneAppealAbAction({
                  csrfToken,
                  appealId,
                  publicDecision: begruendung,
                  internalDecision: intern || undefined,
                  erneutErlaubt,
                });

          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }

          // Die beiden Aktionen liefern verwandte, aber nicht gleiche Formen.
          // Ein gemeinsamer Blick darauf ist ehrlicher als eine Verengung, die
          // beim naechsten Feld auseinanderfaellt.
          const daten = antwort.data as { vorgeschlagen?: boolean; hinweis?: string | null };

          if (daten.vorgeschlagen) {
            toast.success('Vorschlag eingereicht - eine zweite Person muss bestätigen.');
          } else if (daten.hinweis) {
            toast.warning(daten.hinweis);
          } else {
            toast.success(entscheidung === 'APPROVE' ? 'Genehmigt.' : 'Abgelehnt.');
          }

          setEntscheidung(null);
          setBegruendung('');
          setIntern('');
          router.refresh();
        }}
      >
        <div className="space-y-3 text-left">
          <div className="space-y-1.5">
            <Label htmlFor="begruendung">Begründung für den Antragsteller *</Label>
            <textarea
              id="begruendung"
              value={begruendung}
              maxLength={4000}
              rows={4}
              onChange={(event) => setBegruendung(event.target.value)}
              className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="intern">Interne Begründung (bleibt beim Team)</Label>
            <textarea
              id="intern"
              value={intern}
              maxLength={4000}
              rows={2}
              onChange={(event) => setIntern(event.target.value)}
              className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </div>

          {entscheidung === 'APPROVE' && rechte.unban ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={entbannen}
                onChange={(event) => setEntbannen(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Bann jetzt auf Discord aufheben
            </label>
          ) : null}

          {entscheidung === 'REJECT' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={erneutErlaubt}
                onChange={(event) => setErneutErlaubt(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Ein erneuter Antrag ist später möglich
            </label>
          ) : null}
        </div>
      </ConfirmationDialog>
    </>
  );
}
