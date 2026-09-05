'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PartyPopper, SkipForward, Ticket } from 'lucide-react';
import type { XpRaffleStatus } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { enterRaffleAction } from '@/modules/level/raffle-actions';
import { RaffleWheel, type WheelSegment } from './raffle-wheel';
import { formatChance, formatXp } from './raffle-shared';

/**
 * Der Bereich mit Rad, Teilnahme und Gewinner-Enthüllung.
 *
 * Alle Zahlen - Einsatz, Gewinnchance, Gewinner - kommen fertig vom Server.
 * Hier wird nichts nachgerechnet: täte man es, gäbe es zwei Wahrheiten, und
 * die im Browser wäre die manipulierbare.
 */

export interface StagePreview {
  currentXp: number;
  entryXp: number;
  xpAfter: number;
  affordable: boolean;
  estimatedChance: number;
  alreadyEntered: boolean;
  myChance: number | null;
  raisedToMinimum: boolean;
  cappedToMaximum: boolean;
}

export interface StageWinner {
  entryId: string;
  discordId: string;
  name: string;
  avatarHash: string | null;
  entryXp: number;
}

export function RaffleStage({
  csrfToken,
  raffleId,
  status: initialStatus,
  title,
  segments,
  preview,
  winner: initialWinner,
  animationSeed,
  canParticipate,
  entryModelLabel,
  revealOnOpen = false,
  viewerDiscordId,
}: {
  csrfToken: string;
  raffleId: string;
  status: XpRaffleStatus;
  title: string;
  segments: WheelSegment[];
  preview: StagePreview | null;
  winner: StageWinner | null;
  animationSeed: string | null;
  canParticipate: boolean;
  entryModelLabel: string;
  /**
   * Die abgeschlossene Ziehung noch einmal drehen lassen.
   *
   * Wer die Seite erst nach der Bestaetigung oeffnet, saehe sonst nur das
   * Ergebnis - und damit ausgerechnet den Teil nicht, der Spass macht. Der
   * Gewinner steht dabei laengst fest: das Rad zeigt ihn, es waehlt ihn
   * nicht. Ob dieses Fenster noch offen ist, entscheidet der Server.
   */
  revealOnOpen?: boolean;
  /** Wer zusieht - geht nur in den «schon gesehen»-Vermerk im Browser ein. */
  viewerDiscordId: string;
}): React.JSX.Element {
  const router = useRouter();
  const [status, setStatus] = useState<XpRaffleStatus>(initialStatus);
  const [winner, setWinner] = useState<StageWinner | null>(initialWinner);
  const [seed, setSeed] = useState<string | null>(animationSeed);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /**
   * Steht der Gewinner schon auf der Seite?
   *
   * Beginnt bei einer abgebrochenen Verlosung mit `true` - dort gibt es nichts
   * zu enthuellen. Sonst entscheidet der Effekt weiter unten, und bis dahin
   * zeigt die Seite das ruhende Rad: weder eine anlaufende Drehung, die gleich
   * wieder abbricht, noch ein Gewinner, der kurz aufblitzt.
   */
  const [revealed, setRevealed] = useState(initialStatus === 'CANCELLED');
  /**
   * Hat der Stand sich geaendert, waehrend diese Seite offen war?
   *
   * Der Fall, der bisher fehlte: wer schon auf der Seite steht, wenn die
   * Ziehung durchlaeuft, hat kein Nachlauffenster vom Server - das wird beim
   * Laden bestimmt, und geladen wurde vor der Ziehung. Ohne diese Merkung
   * sprang das Rad ohne jede Drehung auf den Gewinner: genau die statische
   * Anzeige, die es nicht sein soll.
   */
  const [liveWechsel, setLiveWechsel] = useState(false);
  /**
   * Hat dieser Mensch die Ziehung schon gesehen?
   *
   * `null`, solange es niemand nachgesehen hat. Die Antwort steht im Browser
   * - sie ist reine Bequemlichkeit und keine Wahrheit ueber die Verlosung.
   * Wer das Fenster wechselt, sieht die Drehung eben noch einmal; wer neu
   * laedt, nicht.
   */
  const [schonGesehen, setSchonGesehen] = useState<boolean | null>(null);

  // Solange etwas läuft, den Stand regelmässig nachladen. So merken alle, die
  // die Seite offen haben, dass die Ziehung begonnen hat.
  const live = status !== 'COMPLETED' && status !== 'CANCELLED' && status !== 'DRAFT';
  useEffect(() => {
    if (!live) {
      return;
    }
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch('/api/level/raffle/state', { cache: 'no-store' });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          raffle: { id: string; status: XpRaffleStatus } | null;
          draw: { winnerEntryId: string; winnerDiscordId: string; animationSeed: string } | null;
        };
        if (!payload.raffle || payload.raffle.id !== raffleId) {
          router.refresh();
          return;
        }
        if (payload.raffle.status !== status) {
          setStatus(payload.raffle.status);
          // Vor unseren Augen geschehen: dafuer gibt es die Drehung, ganz
          // unabhaengig davon, was beim Laden der Seite galt.
          setLiveWechsel(true);
          // Ein Statuswechsel bringt in der Regel neue Zahlen mit.
          router.refresh();
        }
        if (payload.draw && !winner) {
          setSeed(payload.draw.animationSeed);
          router.refresh();
        }
      } catch {
        // Ein verpasster Durchgang ist kein Problem - der nächste kommt.
      }
    };
    const handle = window.setInterval(() => void tick(), 4000);
    return () => window.clearInterval(handle);
  }, [live, raffleId, status, winner, router]);

  useEffect(() => {
    setWinner(initialWinner);
  }, [initialWinner]);

  /**
   * Dem Server folgen, wenn er einen neuen Stand liefert.
   *
   * `router.refresh()` erneuert die Server-Komponenten, laesst diese hier
   * aber stehen - sie behaelt ihren Zustand. Ohne diesen Abgleich blieb
   * `status` auf dem Wert vom Seitenaufbau, waehrend die Seite ringsum
   * bereits die abgeschlossene Verlosung zeigte. Das Rad sah dann keinen
   * Grund zu drehen, und der Gewinner erschien ohne jede Animation.
   *
   * Ein Wechsel nach dem ersten Aufbau ist zugleich der Beleg, dass er vor
   * den Augen dieser Person geschah - dafuer gibt es die Drehung.
   */
  const vorherigerStatus = useRef(initialStatus);
  useEffect(() => {
    if (vorherigerStatus.current === initialStatus) {
      return;
    }
    vorherigerStatus.current = initialStatus;
    setStatus(initialStatus);
    setLiveWechsel(true);
  }, [initialStatus]);

  /**
   * Schluessel des «schon gesehen»-Vermerks.
   *
   * Die Kennung der Person steht mit drin: an einem geteilten Rechner soll
   * nicht der eine um die Drehung gebracht werden, weil der andere sie
   * bereits gesehen hat.
   */
  const gesehenSchluessel = `swisshub:raffle-seen:${viewerDiscordId}:${raffleId}`;

  useEffect(() => {
    // Ausserhalb des Nachlauffensters gibt es nichts zu enthuellen: dann steht
    // das Ergebnis sofort da.
    if (initialStatus === 'COMPLETED' && !revealOnOpen) {
      setSchonGesehen(true);
      setRevealed(true);
      return;
    }
    let gesehen = false;
    try {
      gesehen = window.localStorage.getItem(gesehenSchluessel) === '1';
    } catch {
      // Privater Modus oder gesperrter Speicher: dann eben jedes Mal.
      gesehen = false;
    }
    setSchonGesehen(gesehen);
    if (gesehen && initialStatus === 'COMPLETED') {
      setRevealed(true);
    }
  }, [gesehenSchluessel, initialStatus, revealOnOpen]);

  const merkeGesehen = useCallback(() => {
    try {
      window.localStorage.setItem(gesehenSchluessel, '1');
    } catch {
      // Nicht schlimm - dann laeuft die Drehung beim naechsten Mal erneut.
    }
    setSchonGesehen(true);
  }, [gesehenSchluessel]);

  /**
   * Wann sich das Rad dreht.
   *
   * Waehrend der Ziehung immer. Bei einer bereits abgeschlossenen Verlosung
   * nur, wenn es etwas zu zeigen gibt: das Nachlauffenster ist offen und
   * diese Person hat die Drehung noch nicht gesehen - oder der Wechsel
   * geschah gerade eben vor ihren Augen.
   *
   * Solange `schonGesehen` noch `null` ist, wird nicht gedreht. Das sind
   * wenige Millisekunden, und sie verhindern eine Drehung, die sofort wieder
   * abbricht.
   */
  const darfNachlaufDrehen = (revealOnOpen && schonGesehen === false) || liveWechsel;
  const spinning =
    !revealed &&
    (status === 'DRAWING' || status === 'WINNER_PENDING' || (status === 'COMPLETED' && darfNachlaufDrehen));

  const handleSpinEnd = useCallback(() => {
    setRevealed(true);
    merkeGesehen();
  }, [merkeGesehen]);

  /** Ueberspringen: dasselbe Ergebnis, nur sofort. */
  const ueberspringen = useCallback(() => {
    setRevealed(true);
    merkeGesehen();
  }, [merkeGesehen]);

  const teilnehmen = async (): Promise<void> => {
    const result = await enterRaffleAction({ csrfToken, raffleId });
    if (!result.ok) {
      toast.error(result.error.message);
      throw new Error(result.error.message);
    }
    if (result.data.alreadyEntered) {
      toast.info('Du nimmst bereits teil.');
    } else {
      toast.success(
        `Du bist dabei! ${formatXp(result.data.entryXp)} eingesetzt, Gewinnchance ${formatChance(result.data.chance)}.`,
      );
    }
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <RaffleWheel
        segments={segments}
        /*
         * Solange nicht feststeht, ob diese Person die Drehung schon gesehen
         * hat, bekommt das Rad keinen Gewinner. Ohne das erledigte es den
         * Reveal sofort selbst - «nicht drehen» heisst dort «Ergebnis
         * hinstellen» - und die Drehung kam nie zustande.
         */
        winnerEntryId={schonGesehen === null ? null : (winner?.entryId ?? null)}
        animationSeed={seed}
        spinning={spinning}
        /*
          Ein Lauf je geladener Seite. Frueher zaehlte hier ein Knopf mit, der
          die Drehung noch einmal anstiess - die Ziehung ist aber ein Moment
          und keine Aufzeichnung: was einmal gelaufen ist, ist gelaufen, und
          das Ergebnis steht ohnehin darunter. Der Knopf lud dazu ein, es
          mehrfach anzusehen, und liess die Seite dabei jedes Mal so aussehen,
          als sei die Ziehung noch offen.
        */
        runId={0}
        onSpinEnd={handleSpinEnd}
      />

      {spinning && !revealed ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-sm font-medium text-primary" role="status">
            {status === 'COMPLETED' ? '🎡 Die Verlosung wurde gezogen …' : '🎡 Die Ziehung läuft …'}
          </p>
          {status === 'COMPLETED' ? (
            // Nur beim Nachlauf: waehrend einer echten Ziehung gibt es nichts
            // zu ueberspringen - da wartet die Seite auf den Server.
            <Button variant="ghost" size="sm" onClick={ueberspringen}>
              <SkipForward aria-hidden="true" />
              Überspringen
            </Button>
          ) : null}
        </div>
      ) : null}

      {winner && revealed ? (
        <div
          className="animate-in fade-in zoom-in-95 rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center duration-500"
          role="status"
        >
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
            <PartyPopper className="size-4" aria-hidden="true" />
            GEWINNER
          </p>
          <div className="mt-3 flex flex-col items-center gap-3">
            <DiscordAvatar
              discordId={winner.discordId}
              avatarHash={winner.avatarHash}
              name={winner.name}
              size={96}
            />
            <div>
              <p className="text-2xl font-semibold">{winner.name}</p>
              <p className="text-sm text-muted-foreground">{title}</p>
            </div>
          </div>
          {status === 'WINNER_PENDING' ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Noch nicht bestätigt – die Verwaltung prüft das Ergebnis.
            </p>
          ) : null}
        </div>
      ) : null}

      {preview && canParticipate && status === 'ENTRY_OPEN' ? (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Deine XP</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatXp(preview.currentXp)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dein Einsatz</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatXp(preview.entryXp)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">XP nachher</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatXp(preview.xpAfter)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {preview.alreadyEntered ? 'Deine Gewinnchance' : 'Gewinnchance danach'}
              </dt>
              <dd className="text-lg font-semibold tabular-nums text-primary">
                {formatChance(preview.alreadyEntered ? (preview.myChance ?? 0) : preview.estimatedChance)}
              </dd>
            </div>
          </dl>

          {preview.raisedToMinimum ? (
            <p className="text-xs text-muted-foreground">
              Dein Einsatz wurde auf den Mindesteinsatz angehoben.
            </p>
          ) : null}
          {preview.cappedToMaximum ? (
            <p className="text-xs text-muted-foreground">
              Dein Einsatz wurde auf den Höchsteinsatz begrenzt.
            </p>
          ) : null}

          {preview.alreadyEntered ? (
            <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <Ticket className="size-4 text-primary" aria-hidden="true" />
              Du nimmst teil. Deine Gewinnchance kann sich noch verändern, solange weitere Personen
              dazukommen.
            </p>
          ) : (
            <>
              <Button
                size="lg"
                className="w-full sm:w-auto"
                disabled={!preview.affordable}
                onClick={() => setConfirmOpen(true)}
              >
                <Ticket aria-hidden="true" />
                Jetzt teilnehmen
              </Button>
              {!preview.affordable ? (
                <p className="text-sm text-destructive">
                  Du hast nicht genug XP. Es braucht {formatXp(preview.entryXp)}.
                </p>
              ) : null}
            </>
          )}

          <ConfirmationDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Teilnahme bestätigen?"
            description={
              <div className="space-y-2">
                <p>
                  Einsatzmodell: <strong>{entryModelLabel}</strong>
                </p>
                <p>
                  Dein Einsatz: <strong>{formatXp(preview.entryXp)}</strong>
                </p>
                <p>
                  XP nach der Teilnahme: <strong>{formatXp(preview.xpAfter)}</strong>
                </p>
                <p className="text-xs">
                  Der Einsatz wird sofort abgebucht und steht danach fest. Deine Gewinnchance kann sich bis
                  zum Ende der Teilnahmephase noch verändern, weil weitere Personen dazukommen können.
                </p>
              </div>
            }
            confirmLabel="Teilnahme bestätigen"
            onConfirm={teilnehmen}
          />
        </div>
      ) : null}

      {preview?.alreadyEntered && status !== 'ENTRY_OPEN' ? (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-center text-sm">
          Du hast mit {formatXp(preview.entryXp)} teilgenommen.
        </p>
      ) : null}
    </div>
  );
}
