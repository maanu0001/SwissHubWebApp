'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { StatCard } from '@/components/shared/stat-card';
import { adminCheckinAction, closeCheckinAction } from '@/modules/tournaments/admin-actions';
import { CheckinStatusBadge } from './tournament-badges';

export interface CheckinZeile {
  id: string;
  discordId: string;
  username: string;
  teamName: string | null;
  checkinStatus: string;
}

/**
 * Der Check-in.
 *
 * Die Leitung sieht, wer da ist, und kann einzeln bestätigen - jemand, dessen
 * Discord gerade streikt, soll nicht deswegen aus dem Turnier fallen.
 *
 * Das Schliessen ist der einzige unumkehrbare Schritt hier, und was es
 * bewirkt, hängt an der Turniereinstellung: ohne «selbsttätig entfernen»
 * bleiben Verpasste im Turnier und die Leitung entscheidet einzeln.
 */
export function CheckinAdmin({
  tournamentId,
  csrfToken,
  uebersicht,
  zeilen,
  darfVerwalten,
  autoEntfernen,
  offen,
}: {
  tournamentId: string;
  csrfToken: string;
  uebersicht: { bestaetigt: number; eingecheckt: number; offen: number; verpasst: number; quote: number };
  zeilen: CheckinZeile[];
  darfVerwalten: boolean;
  autoEntfernen: boolean;
  /** Läuft der Check-in gerade? Nur dann lässt er sich schliessen. */
  offen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [schliessenOffen, setSchliessenOffen] = useState(false);

  async function bestaetigen(zeile: CheckinZeile): Promise<void> {
    setLaeuft(zeile.id);
    const antwort = await adminCheckinAction({ csrfToken, registrationId: zeile.id });
    if (antwort.ok) {
      toast.success(`${zeile.teamName ?? zeile.username} ist eingecheckt.`);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Bestätigt" value={uebersicht.bestaetigt} />
        <StatCard
          label="Eingecheckt"
          value={uebersicht.eingecheckt}
          hint={`${uebersicht.quote}%`}
          tone="success"
        />
        <StatCard
          label="Noch offen"
          value={uebersicht.offen}
          tone={uebersicht.offen > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Verpasst"
          value={uebersicht.verpasst}
          tone={uebersicht.verpasst > 0 ? 'destructive' : 'default'}
        />
      </div>

      {darfVerwalten && offen ? (
        <div className="flex justify-end">
          <Button variant="outline" disabled={laeuft !== null} onClick={() => setSchliessenOffen(true)}>
            <LockKeyhole aria-hidden="true" />
            Check-in schliessen
          </Button>
        </div>
      ) : null}

      {zeilen.length === 0 ? (
        <EmptyState
          title="Niemand bestätigt"
          description="Der Check-in betrifft nur bestätigte Anmeldungen."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {zeilen.map((zeile) => (
            <li key={zeile.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <DiscordAvatar
                discordId={zeile.discordId}
                name={zeile.username}
                size={32}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">
                  {zeile.teamName ?? zeile.username}
                </span>
                {zeile.teamName ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    Captain: {zeile.username}
                  </span>
                ) : null}
              </span>
              <CheckinStatusBadge status={zeile.checkinStatus} />
              {darfVerwalten &&
              zeile.checkinStatus !== 'CHECKED_IN' &&
              zeile.checkinStatus !== 'ADMIN_CONFIRMED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={laeuft !== null}
                  onClick={() => void bestaetigen(zeile)}
                >
                  {laeuft === zeile.id ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 aria-hidden="true" />
                  )}
                  Bestätigen
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmationDialog
        open={schliessenOffen}
        onOpenChange={setSchliessenOffen}
        title="Check-in schliessen?"
        description={
          autoEntfernen
            ? `${uebersicht.offen} noch nicht Eingecheckte werden aus dem Turnier genommen, die Warteliste rückt nach.`
            : `${uebersicht.offen} noch nicht Eingecheckte werden als «verpasst» vermerkt und bleiben im Turnier. Über ihren Verbleib entscheidest du einzeln.`
        }
        confirmLabel="Check-in schliessen"
        destructive={autoEntfernen}
        onConfirm={async () => {
          const antwort = await closeCheckinAction({ csrfToken, tournamentId });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Check-in geschlossen.');
          router.refresh();
        }}
      />
    </div>
  );
}
