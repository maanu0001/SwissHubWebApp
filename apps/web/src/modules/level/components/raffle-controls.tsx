'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, CheckCircle2, DoorClosed, DoorOpen, Megaphone, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react';
import type { XpRaffleStatus } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  cancelRaffleAction,
  closeEntriesAction,
  confirmWinnerAction,
  deleteRaffleAction,
  openEntriesAction,
  publishRaffleAction,
  redrawAction,
  republishAnnouncementAction,
  startDrawAction,
} from '@/modules/level/raffle-actions';
import { formatNumber, formatXp } from './raffle-shared';

/**
 * Schaltflächen zur Steuerung einer Verlosung.
 *
 * Welche Knöpfe erscheinen, hängt an den Berechtigungen – geprüft wird aber
 * in jedem Fall noch einmal auf dem Server. Folgenreiche Schritte verlangen
 * eine Bestätigung mit den konkreten Zahlen, damit niemand versehentlich
 * hunderte Einsätze zurückzahlt oder eine Ziehung auslöst.
 */
export function RaffleControls({
  csrfToken,
  raffleId,
  status,
  entryCount,
  potXp,
  minimumParticipants,
  hasChannel,
  messageMissing,
  permissions,
}: {
  csrfToken: string;
  raffleId: string;
  status: XpRaffleStatus;
  entryCount: number;
  potXp: number;
  minimumParticipants: number;
  hasChannel: boolean;
  messageMissing: boolean;
  permissions: {
    publish: boolean;
    open: boolean;
    close: boolean;
    draw: boolean;
    redraw: boolean;
    cancel: boolean;
    delete: boolean;
    manage: boolean;
  };
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [drawOpen, setDrawOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [redrawOpen, setRedrawOpen] = useState(false);
  const [redrawReason, setRedrawReason] = useState('');
  const [excludeWinner, setExcludeWinner] = useState(true);

  const run = async (
    key: string,
    action: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>,
    successMessage: string,
  ): Promise<void> => {
    setPending(key);
    try {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(successMessage);
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;
  const zuWenige = entryCount < minimumParticipants;

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'DRAFT' && permissions.publish ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(
              'publish',
              () => publishRaffleAction({ csrfToken, raffleId }),
              'Verlosung veröffentlicht.',
            )
          }
        >
          <Send aria-hidden="true" />
          Veröffentlichen
        </Button>
      ) : null}

      {(status === 'SCHEDULED' || status === 'ENTRY_CLOSED') && permissions.open ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run('open', () => openEntriesAction({ csrfToken, raffleId }), 'Teilnahme geöffnet.')
          }
        >
          <DoorOpen aria-hidden="true" />
          Teilnahme öffnen
        </Button>
      ) : null}

      {status === 'ENTRY_OPEN' && permissions.close ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run('close', () => closeEntriesAction({ csrfToken, raffleId }), 'Teilnahme geschlossen.')
          }
        >
          <DoorClosed aria-hidden="true" />
          Teilnahme schliessen
        </Button>
      ) : null}

      {status === 'ENTRY_CLOSED' && permissions.draw ? (
        <>
          <Button disabled={busy || zuWenige} onClick={() => setDrawOpen(true)}>
            <Sparkles aria-hidden="true" />
            Auslosung starten
          </Button>
          <ConfirmationDialog
            open={drawOpen}
            onOpenChange={setDrawOpen}
            title="Auslosung starten?"
            description={`${formatNumber(entryCount)} Teilnehmende, ${formatXp(potXp)} eingesetzt. Nach dem Start kommt niemand mehr dazu. Den Gewinner bestimmt der Server – nicht die Animation im Browser.`}
            confirmLabel="Auslosung starten"
            onConfirm={() => run('draw', () => startDrawAction({ csrfToken, raffleId }), 'Gewinner gezogen.')}
          />
        </>
      ) : null}

      {status === 'WINNER_PENDING' && permissions.draw ? (
        <Button
          disabled={busy}
          onClick={() =>
            void (async () => {
              setPending('confirm');
              try {
                const result = await confirmWinnerAction({ csrfToken, raffleId });
                if (!result.ok) {
                  toast.error(result.error.message);
                  return;
                }
                toast.success('Gewinner bestätigt.');
                // Eine Rolle als Gewinn kann trotz bestätigtem Gewinner
                // scheitern - etwa weil sie auf Discord über der höchsten
                // Rolle des Bots steht. Das darf nicht untergehen.
                if (result.data.roleProblem) {
                  toast.warning(`Rolle nicht vergeben: ${result.data.roleProblem}`);
                } else if (result.data.roleAwarded) {
                  toast.success('Gewinn-Rolle vergeben.');
                }
                router.refresh();
              } finally {
                setPending(null);
              }
            })()
          }
        >
          <CheckCircle2 aria-hidden="true" />
          Gewinner bestätigen
        </Button>
      ) : null}

      {status === 'WINNER_PENDING' && permissions.redraw ? (
        <>
          <Button variant="outline" disabled={busy} onClick={() => setRedrawOpen(true)}>
            <RefreshCw aria-hidden="true" />
            Neu ziehen
          </Button>
          <ConfirmationDialog
            open={redrawOpen}
            onOpenChange={setRedrawOpen}
            title="Neu ziehen?"
            description="Eine Neuziehung greift in ein bereits gezogenes Ergebnis ein. Die bisherige Ziehung bleibt in der Historie sichtbar."
            confirmLabel="Neu ziehen"
            destructive
            onConfirm={async () => {
              if (redrawReason.trim().length < 5) {
                toast.error('Bitte einen nachvollziehbaren Grund angeben.');
                throw new Error('Grund fehlt');
              }
              await run(
                'redraw',
                () =>
                  redrawAction({
                    csrfToken,
                    raffleId,
                    reason: redrawReason,
                    excludePreviousWinner: excludeWinner,
                  }),
                'Neu gezogen.',
              );
              setRedrawReason('');
            }}
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="redrawReason">Grund (Pflicht)</Label>
                <Input
                  id="redrawReason"
                  value={redrawReason}
                  maxLength={300}
                  onChange={(event) => setRedrawReason(event.target.value)}
                  placeholder="Gewinner ist nicht mehr auf dem Server"
                />
              </div>
              <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Switch checked={excludeWinner} onCheckedChange={setExcludeWinner} />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Bisherigen Gewinner ausschliessen</span>
                  <span className="block text-xs text-muted-foreground">
                    Der Einsatz wird dabei nicht zurückgezahlt – die Teilnahme gilt als ausgeschlossen, nicht
                    als storniert.
                  </span>
                </span>
              </label>
            </div>
          </ConfirmationDialog>
        </>
      ) : null}

      {hasChannel && messageMissing && permissions.manage ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              'announce',
              () => republishAnnouncementAction({ csrfToken, raffleId }),
              'Ankündigung neu veröffentlicht.',
            )
          }
        >
          <Megaphone aria-hidden="true" />
          Neu veröffentlichen
        </Button>
      ) : null}

      {status !== 'COMPLETED' && status !== 'CANCELLED' && permissions.cancel ? (
        <>
          <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>
            <Ban aria-hidden="true" />
            Abbrechen
          </Button>
          <ConfirmationDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title="Verlosung wirklich abbrechen?"
            description={`${formatNumber(entryCount)} Teilnehmende. ${formatXp(potXp)} werden zurückerstattet.`}
            confirmLabel="Abbrechen & XP zurückzahlen"
            destructive
            onConfirm={async () => {
              if (cancelReason.trim().length < 5) {
                toast.error('Bitte einen Grund angeben.');
                throw new Error('Grund fehlt');
              }
              await run(
                'cancel',
                () => cancelRaffleAction({ csrfToken, raffleId, reason: cancelReason }),
                'Verlosung abgebrochen, XP zurückgezahlt.',
              );
              setCancelReason('');
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="cancelReason">Grund (Pflicht)</Label>
              <Input
                id="cancelReason"
                value={cancelReason}
                maxLength={300}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Preis nicht mehr verfügbar"
              />
            </div>
          </ConfirmationDialog>
        </>
      ) : null}

      {(status === 'COMPLETED' || status === 'CANCELLED') && permissions.delete ? (
        <>
          <Button variant="outline" disabled={busy} onClick={() => setDeleteOpen(true)}>
            <Trash2 aria-hidden="true" />
            Löschen
          </Button>
          <ConfirmationDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            title="Verlosung endgültig löschen?"
            description={`Teilnahmen und Ziehungen dieser Verlosung werden entfernt und lassen sich nicht wiederherstellen. Bereits verbuchte XP bleiben unverändert – niemand bekommt XP zurück oder verliert welche. Eine Ankündigung auf Discord bleibt bestehen.`}
            confirmLabel="Endgültig löschen"
            destructive
            onConfirm={async () => {
              if (deleteReason.trim().length < 5) {
                toast.error('Bitte einen Grund angeben.');
                throw new Error('Grund fehlt');
              }
              setPending('delete');
              try {
                const result = await deleteRaffleAction({
                  csrfToken,
                  raffleId,
                  reason: deleteReason,
                });
                if (!result.ok) {
                  toast.error(result.error?.message ?? 'Das hat nicht geklappt.');
                  throw new Error('Löschen fehlgeschlagen');
                }
                toast.success('Verlosung gelöscht.');
                setDeleteReason('');
                // Diese Seite gibt es nicht mehr - `router.refresh()` liefe
                // hier ins 404.
                router.replace('/level/gluecksrad');
              } finally {
                setPending(null);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="deleteReason">Grund (Pflicht)</Label>
              <Input
                id="deleteReason"
                value={deleteReason}
                maxLength={300}
                onChange={(event) => setDeleteReason(event.target.value)}
                placeholder="Aufräumen: Verlosung vom letzten Jahr"
              />
              <p className="text-xs text-muted-foreground">
                Der Grund landet im Audit Log. Nach dem Löschen ist dieser Eintrag die einzige
                verbliebene Auskunft über die Verlosung.
              </p>
            </div>
          </ConfirmationDialog>
        </>
      ) : null}

      {status === 'ENTRY_CLOSED' && zuWenige ? (
        <p className="w-full text-xs text-amber-500">
          Es fehlen Teilnehmende: {formatNumber(entryCount)} von mindestens{' '}
          {formatNumber(minimumParticipants)}. Öffne die Teilnahme erneut oder brich die Verlosung ab.
        </p>
      ) : null}
    </div>
  );
}
