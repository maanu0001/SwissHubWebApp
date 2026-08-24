'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Gavel,
  Hash,
  Loader2,
  MessageSquareWarning,
  Send,
  ShieldCheck,
  ThumbsUp,
  X,
} from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  confirmResultAction,
  openDisputeAction,
  rejectResultAction,
  reportResultAction,
  setReadyAction,
} from '@/modules/tournaments/actions';
import {
  createMatchChannelAction,
  overrideResultAction,
  resolveDisputeAction,
  scheduleMatchAction,
  setMatchStreamAction,
} from '@/modules/tournaments/admin-actions';
import { fuerZeitfeld } from '@/modules/tournaments/zeitfeld';

export interface MatchMeldung {
  id: string;
  slot: string;
  reportedByUsername: string;
  scoreA: number;
  scoreB: number;
  comment: string | null;
  evidenceUrl: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface MatchEinspruch {
  id: string;
  openedByUsername: string;
  reason: string;
  status: string;
  resolution: string | null;
  createdAt: string;
}

/**
 * Was die beiden Seiten eines Matches tun können.
 *
 * Bereit melden, Resultat melden, Gegenmeldung bestätigen oder bestreiten,
 * Einspruch erheben. Welche Seite jemand ist, sagt der Server - `slot` kommt
 * aus der Teamzugehörigkeit, nicht aus dem Browser, und jede Aktion prüft es
 * erneut.
 */
export function MatchParticipantPanel({
  matchId,
  csrfToken,
  slot,
  status,
  nameA,
  nameB,
  scoreA,
  scoreB,
  bestOf,
  readyA,
  readyB,
  offeneMeldung,
}: {
  matchId: string;
  csrfToken: string;
  slot: 'A' | 'B';
  status: string;
  nameA: string;
  nameB: string;
  scoreA: number;
  scoreB: number;
  bestOf: number;
  readyA: boolean;
  readyB: boolean;
  /** Eine Meldung der Gegenseite, die auf Antwort wartet. */
  offeneMeldung: MatchMeldung | null;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meineA, setMeineA] = useState(scoreA);
  const [meineB, setMeineB] = useState(scoreB);
  const [kommentar, setKommentar] = useState('');
  const [beleg, setBeleg] = useState('');
  const [widerspruch, setWiderspruch] = useState(false);
  const [einspruch, setEinspruch] = useState(false);
  const [grund, setGrund] = useState('');

  const eigenBereit = slot === 'A' ? readyA : readyB;
  const entschieden = status === 'COMPLETED' || status === 'FORFEIT' || status === 'CANCELLED';

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

  if (entschieden) {
    return (
      <div className="rounded-xl border border-border p-5 text-sm text-muted-foreground">
        Dieses Match ist entschieden. Wenn etwas nicht stimmt, wende dich an die Turnierleitung.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-primary/40 bg-primary/5 p-5">
      <h2 className="text-sm font-semibold">Du sprichst für {slot === 'A' ? nameA : nameB}</h2>

      {/* --- Bereitmeldung ------------------------------------------- */}
      {status === 'READY' || status === 'SCHEDULED' || status === 'PENDING' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={eigenBereit ? 'outline' : 'default'}
            disabled={laeuft !== null}
            onClick={() =>
              fuehreAus(
                'ready',
                () => setReadyAction({ csrfToken, matchId, bereit: !eigenBereit }),
                eigenBereit ? 'Bereitmeldung zurückgenommen.' : 'Du bist bereit gemeldet.',
              )
            }
          >
            {laeuft === 'ready' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ThumbsUp aria-hidden="true" />
            )}
            {eigenBereit ? 'Doch nicht bereit' : 'Bereit'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {nameA}: {readyA ? 'bereit' : 'wartet'} · {nameB}: {readyB ? 'bereit' : 'wartet'}
          </p>
        </div>
      ) : null}

      {/* --- Gegenmeldung beantworten -------------------------------- */}
      {offeneMeldung && offeneMeldung.slot !== slot ? (
        <div className="space-y-3 rounded-xl border border-warning/50 bg-warning/5 p-4">
          <p className="text-sm">
            <span className="font-medium">{offeneMeldung.reportedByUsername}</span> hat{' '}
            <span className="font-semibold tabular-nums">
              {offeneMeldung.scoreA}:{offeneMeldung.scoreB}
            </span>{' '}
            gemeldet.
            {offeneMeldung.comment ? ` «${offeneMeldung.comment}»` : ''}
          </p>
          {offeneMeldung.evidenceUrl ? (
            <a
              href={offeneMeldung.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-xs text-primary underline underline-offset-2"
            >
              Beleg ansehen
            </a>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={laeuft !== null}
              onClick={() =>
                fuehreAus('confirm', () => confirmResultAction({ csrfToken, matchId }), 'Resultat bestätigt.')
              }
            >
              {laeuft === 'confirm' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              Stimmt so
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={laeuft !== null}
              onClick={() => {
                setWiderspruch(true);
                setGrund('');
              }}
            >
              <X aria-hidden="true" />
              Stimmt nicht
            </Button>
          </div>
        </div>
      ) : null}

      {/* --- Resultat melden ----------------------------------------- */}
      {status !== 'DISPUTED' ? (
        <form
          className="space-y-3"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            void fuehreAus(
              'report',
              () =>
                reportResultAction({
                  csrfToken,
                  matchId,
                  scoreA: meineA,
                  scoreB: meineB,
                  games: [],
                  ...(kommentar.trim() !== '' ? { comment: kommentar.trim() } : {}),
                  ...(beleg.trim() !== '' ? { evidenceUrl: beleg.trim() } : {}),
                }),
              'Resultat gemeldet.',
            );
          }}
        >
          <p className="text-sm font-medium">Resultat melden</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="score-a" className="text-xs">
                {nameA}
              </Label>
              <Input
                id="score-a"
                type="number"
                min={0}
                max={99}
                className="w-20"
                value={meineA}
                onChange={(e) => setMeineA(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <span className="pb-2.5 text-muted-foreground">:</span>
            <div className="space-y-1">
              <Label htmlFor="score-b" className="text-xs">
                {nameB}
              </Label>
              <Input
                id="score-b"
                type="number"
                min={0}
                max={99}
                className="w-20"
                value={meineB}
                onChange={(e) => setMeineB(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
            {bestOf > 1 ? (
              <p className="pb-2.5 text-xs text-muted-foreground">
                Best of {bestOf} – wer {Math.floor(bestOf / 2) + 1} Karten gewinnt.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="report-kommentar" className="text-xs">
                Kommentar
              </Label>
              <Input
                id="report-kommentar"
                maxLength={1000}
                value={kommentar}
                onChange={(e) => setKommentar(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-beleg" className="text-xs">
                Beleg (Link)
              </Label>
              <Input
                id="report-beleg"
                type="url"
                maxLength={500}
                value={beleg}
                onChange={(e) => setBeleg(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>

          <Button type="submit" disabled={laeuft !== null}>
            {laeuft === 'report' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Send aria-hidden="true" />
            )}
            Melden
          </Button>
          <p className="text-xs text-muted-foreground">
            Erst wenn beide Seiten dasselbe melden, zählt das Resultat. Bei Widerspruch entscheidet die
            Turnierleitung.
          </p>
        </form>
      ) : null}

      {/* --- Einspruch ----------------------------------------------- */}
      {status !== 'DISPUTED' ? (
        <Button
          variant="outline"
          size="sm"
          disabled={laeuft !== null}
          onClick={() => {
            setEinspruch(true);
            setGrund('');
          }}
        >
          <MessageSquareWarning aria-hidden="true" />
          Einspruch erheben
        </Button>
      ) : (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Dieses Match ist strittig. Die Turnierleitung entscheidet.
        </p>
      )}

      <ConfirmationDialog
        open={widerspruch}
        onOpenChange={setWiderspruch}
        title="Resultat bestreiten?"
        description="Die Turnierleitung sieht sich das an und entscheidet."
        confirmLabel="Bestreiten"
        destructive
        onConfirm={async () => {
          const antwort = await rejectResultAction({ csrfToken, matchId, reason: grund });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Widerspruch festgehalten.');
          router.refresh();
        }}
      >
        <GrundFeld id="widerspruch-grund" wert={grund} aendern={setGrund} />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={einspruch}
        onOpenChange={setEinspruch}
        title="Einspruch erheben?"
        description="Das Match wird als strittig markiert und die Turnierleitung entscheidet."
        confirmLabel="Einspruch erheben"
        onConfirm={async () => {
          const antwort = await openDisputeAction({ csrfToken, matchId, reason: grund });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Einspruch erhoben.');
          router.refresh();
        }}
      >
        <GrundFeld id="einspruch-grund" wert={grund} aendern={setGrund} />
      </ConfirmationDialog>
    </div>
  );
}

function GrundFeld({
  id,
  wert,
  aendern,
}: {
  id: string;
  wert: string;
  aendern: (wert: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Was stimmt nicht?</Label>
      <Textarea
        id={id}
        rows={3}
        minLength={5}
        maxLength={2000}
        value={wert}
        onChange={(e) => aendern(e.target.value)}
        placeholder="Beschreibe kurz, was passiert ist."
      />
      <p className="text-xs text-muted-foreground">Mindestens fünf Zeichen.</p>
    </div>
  );
}

/**
 * Was die Turnierleitung an einem Match tun kann.
 *
 * Ansetzen, Kanal anlegen, Stream setzen, Resultat korrigieren, Einspruch
 * entscheiden. Die Korrektur verlangt einen Grund und nimmt ein bereits
 * erfolgtes Weiterkommen zurück - der Server lehnt sie ab, wenn das
 * Folgematch schon gespielt ist.
 */
export function MatchStaffPanel({
  matchId,
  csrfToken,
  status,
  nameA,
  nameB,
  scoreA,
  scoreB,
  scheduledAt,
  hatKanal,
  streamStatus,
  streamUrl,
  offeneEinsprueche,
  darfKorrigieren,
  darfEinsprueche,
  darfStream,
  darfMatches,
}: {
  matchId: string;
  csrfToken: string;
  status: string;
  nameA: string;
  nameB: string;
  scoreA: number;
  scoreB: number;
  scheduledAt: string | null;
  hatKanal: boolean;
  streamStatus: string;
  streamUrl: string | null;
  offeneEinsprueche: MatchEinspruch[];
  darfKorrigieren: boolean;
  darfEinsprueche: boolean;
  darfStream: boolean;
  darfMatches: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [zeit, setZeit] = useState(scheduledAt ? fuerZeitfeld(new Date(scheduledAt)) : '');
  const [korrekturA, setKorrekturA] = useState(scoreA);
  const [korrekturB, setKorrekturB] = useState(scoreB);
  const [korrekturGrund, setKorrekturGrund] = useState('');
  const [korrekturArt, setKorrekturArt] = useState<'PLAYED' | 'FORFEIT' | 'NO_SHOW' | 'ADMIN_DECISION'>(
    'ADMIN_DECISION',
  );
  const [korrekturOffen, setKorrekturOffen] = useState(false);
  const [entscheid, setEntscheid] = useState<MatchEinspruch | null>(null);
  const [entscheidText, setEntscheidText] = useState('');
  const [notiz, setNotiz] = useState('');
  const [strom, setStrom] = useState(streamUrl ?? '');

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

  return (
    <div className="space-y-5 rounded-2xl border border-border p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4" aria-hidden="true" />
        Turnierleitung
      </h2>

      {/* --- Offene Einsprüche --------------------------------------- */}
      {offeneEinsprueche.length > 0 ? (
        <div className="space-y-2">
          {offeneEinsprueche.map((einspruch) => (
            <div
              key={einspruch.id}
              className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
            >
              <p className="text-sm">
                <span className="font-medium">{einspruch.openedByUsername}</span> ·{' '}
                {formatDateTime(einspruch.createdAt)}
              </p>
              <p className="text-sm text-muted-foreground">{einspruch.reason}</p>
              {darfEinsprueche ? (
                <Button
                  size="sm"
                  disabled={laeuft !== null}
                  onClick={() => {
                    setEntscheid(einspruch);
                    setEntscheidText('');
                    setNotiz('');
                  }}
                >
                  <Gavel aria-hidden="true" />
                  Entscheiden
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* --- Ansetzen und Kanal -------------------------------------- */}
      {darfMatches ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="match-zeit" className="text-xs">
              Angesetzt auf
            </Label>
            <Input
              id="match-zeit"
              type="datetime-local"
              value={zeit}
              onChange={(e) => setZeit(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            disabled={laeuft !== null}
            onClick={() =>
              fuehreAus(
                'schedule',
                () =>
                  scheduleMatchAction({
                    csrfToken,
                    matchId,
                    scheduledAt: zeit === '' ? null : new Date(zeit).toISOString(),
                  }),
                zeit === '' ? 'Ansetzung entfernt.' : 'Match angesetzt.',
              )
            }
          >
            {laeuft === 'schedule' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock aria-hidden="true" />
            )}
            Ansetzen
          </Button>

          {!hatKanal ? (
            <Button
              variant="outline"
              disabled={laeuft !== null}
              onClick={() =>
                fuehreAus(
                  'channel',
                  () => createMatchChannelAction({ csrfToken, matchId }),
                  'Match-Kanal angelegt.',
                )
              }
            >
              {laeuft === 'channel' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Hash aria-hidden="true" />
              )}
              Match-Kanal anlegen
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* --- Stream --------------------------------------------------- */}
      {darfStream ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="match-stream" className="text-xs">
              Stream (Link)
            </Label>
            <Input
              id="match-stream"
              type="url"
              maxLength={500}
              value={strom}
              onChange={(e) => setStrom(e.target.value)}
              placeholder="https://twitch.tv/…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="match-streamstatus" className="text-xs">
              Zustand
            </Label>
            <select
              id="match-streamstatus"
              defaultValue={streamStatus}
              onChange={(e) =>
                void fuehreAus(
                  'stream',
                  () =>
                    setMatchStreamAction({
                      csrfToken,
                      matchId,
                      status: e.target.value as 'NOT_STREAMED' | 'PLANNED' | 'LIVE' | 'FINISHED',
                      streamUrl: strom.trim() === '' ? null : strom.trim(),
                    }),
                  'Stream gespeichert.',
                )
              }
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
            >
              <option value="NOT_STREAMED">Kein Stream</option>
              <option value="PLANNED">Geplant</option>
              <option value="LIVE">Live</option>
              <option value="FINISHED">Beendet</option>
            </select>
          </div>
        </div>
      ) : null}

      {/* --- Resultat korrigieren ------------------------------------ */}
      {darfKorrigieren && status !== 'CANCELLED' ? (
        <div>
          <Button
            variant="outline"
            disabled={laeuft !== null}
            onClick={() => {
              setKorrekturA(scoreA);
              setKorrekturB(scoreB);
              setKorrekturGrund('');
              setKorrekturOffen(true);
            }}
          >
            <Gavel aria-hidden="true" />
            Resultat setzen oder korrigieren
          </Button>
        </div>
      ) : null}

      <ConfirmationDialog
        open={korrekturOffen}
        onOpenChange={setKorrekturOffen}
        title="Resultat setzen"
        description="Ein bereits erfolgtes Weiterkommen wird zurückgenommen. Ist das Folgematch schon gespielt, lehnt der Server ab."
        confirmLabel="Resultat setzen"
        destructive
        onConfirm={async () => {
          const antwort = await overrideResultAction({
            csrfToken,
            matchId,
            scoreA: korrekturA,
            scoreB: korrekturB,
            reason: korrekturArt,
            grund: korrekturGrund,
          });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Resultat gesetzt.');
          router.refresh();
        }}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="korrektur-a" className="text-xs">
                {nameA}
              </Label>
              <Input
                id="korrektur-a"
                type="number"
                min={0}
                max={99}
                className="w-20"
                value={korrekturA}
                onChange={(e) => setKorrekturA(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <span className="pb-2.5 text-muted-foreground">:</span>
            <div className="space-y-1">
              <Label htmlFor="korrektur-b" className="text-xs">
                {nameB}
              </Label>
              <Input
                id="korrektur-b"
                type="number"
                min={0}
                max={99}
                className="w-20"
                value={korrekturB}
                onChange={(e) => setKorrekturB(Number.parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="korrektur-art">Wie kam es zustande?</Label>
            <select
              id="korrektur-art"
              value={korrekturArt}
              onChange={(e) =>
                setKorrekturArt(e.target.value as 'PLAYED' | 'FORFEIT' | 'NO_SHOW' | 'ADMIN_DECISION')
              }
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
            >
              <option value="ADMIN_DECISION">Entscheid der Leitung</option>
              <option value="PLAYED">Ausgespielt</option>
              <option value="FORFEIT">Forfait</option>
              <option value="NO_SHOW">Nicht angetreten</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="korrektur-grund">Begründung</Label>
            <Textarea
              id="korrektur-grund"
              rows={3}
              minLength={5}
              maxLength={1000}
              value={korrekturGrund}
              onChange={(e) => setKorrekturGrund(e.target.value)}
              placeholder="Steht im Protokoll und im Turnierverlauf."
            />
          </div>
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={entscheid !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setEntscheid(null);
          }
        }}
        title="Einspruch entscheiden"
        description="Die Entscheidung ist für die Beteiligten sichtbar. Setze das Resultat danach über die Korrektur."
        confirmLabel="Entscheidung festhalten"
        onConfirm={async () => {
          if (!entscheid) {
            return;
          }
          const antwort = await resolveDisputeAction({
            csrfToken,
            disputeId: entscheid.id,
            entscheidung: entscheidText,
            ablehnen: false,
            ...(notiz.trim() !== '' ? { staffNote: notiz.trim() } : {}),
          });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Einspruch entschieden.');
          setEntscheid(null);
          router.refresh();
        }}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="entscheid-text">Entscheidung</Label>
            <Textarea
              id="entscheid-text"
              rows={3}
              minLength={5}
              maxLength={2000}
              value={entscheidText}
              onChange={(e) => setEntscheidText(e.target.value)}
              placeholder="Wird den Beteiligten mitgeteilt."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="entscheid-notiz">Interne Notiz</Label>
            <Textarea
              id="entscheid-notiz"
              rows={2}
              maxLength={2000}
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              placeholder="Nur für die Turnierleitung sichtbar."
            />
          </div>
        </div>
      </ConfirmationDialog>
    </div>
  );
}
