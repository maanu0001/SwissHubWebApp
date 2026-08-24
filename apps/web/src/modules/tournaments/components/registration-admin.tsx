'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowUpFromLine, Check, Loader2, X } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import {
  approveRegistrationAction,
  promoteWaitlistAction,
  rejectRegistrationAction,
} from '@/modules/tournaments/admin-actions';
import { CheckinStatusBadge, RegistrationStatusBadge } from './tournament-badges';

export interface AnmeldungZeile {
  id: string;
  discordId: string;
  username: string;
  teamName: string | null;
  status: string;
  checkinStatus: string;
  waitlistPosition: number | null;
  createdAt: string;
  reason: string | null;
  antworten: Array<{ label: string; wert: string }>;
}

/**
 * Anmeldungen verwalten.
 *
 * Freigeben, ablehnen, nachrücken lassen. Die Warteliste rückt sonst nur
 * dann nach, wenn jemand zurücktritt - hier lässt sie sich anstossen, etwa
 * nachdem die Obergrenze erhöht wurde.
 *
 * Jeder Knopf prüft serverseitig erneut, ob er an diesem Turnier erlaubt ist.
 */
export function RegistrationAdmin({
  tournamentId,
  csrfToken,
  anmeldungen,
  darfVerwalten,
  wartelisteVorhanden,
}: {
  tournamentId: string;
  csrfToken: string;
  anmeldungen: AnmeldungZeile[];
  darfVerwalten: boolean;
  wartelisteVorhanden: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [ablehnung, setAblehnung] = useState<AnmeldungZeile | null>(null);
  const [grund, setGrund] = useState('');

  async function freigeben(zeile: AnmeldungZeile): Promise<void> {
    setLaeuft(zeile.id);
    const antwort = await approveRegistrationAction({ csrfToken, registrationId: zeile.id });
    if (antwort.ok) {
      toast.success(`${zeile.teamName ?? zeile.username} ist dabei.`);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  async function nachruecken(): Promise<void> {
    setLaeuft('promote');
    const antwort = await promoteWaitlistAction({ csrfToken, tournamentId });
    if (antwort.ok) {
      toast.success(
        antwort.data.nachgerueckt === 0
          ? 'Es ist kein Platz frei.'
          : `${antwort.data.nachgerueckt} nachgerückt.`,
      );
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  if (anmeldungen.length === 0) {
    return (
      <EmptyState
        title="Noch keine Anmeldungen"
        description="Sobald sich jemand anmeldet, steht die Anmeldung hier."
      />
    );
  }

  return (
    <div className="space-y-4">
      {darfVerwalten && wartelisteVorhanden ? (
        <div className="flex justify-end">
          <Button variant="outline" disabled={laeuft !== null} onClick={() => void nachruecken()}>
            {laeuft === 'promote' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUpFromLine aria-hidden="true" />
            )}
            Warteliste nachrücken lassen
          </Button>
        </div>
      ) : null}

      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
        {anmeldungen.map((zeile) => (
          <li key={zeile.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
                <span className="block truncate text-xs text-muted-foreground">
                  {zeile.teamName ? `Captain: ${zeile.username} · ` : ''}
                  {formatDateTime(zeile.createdAt)}
                  {zeile.waitlistPosition !== null ? ` · Warteplatz ${zeile.waitlistPosition}` : ''}
                </span>
              </span>

              <RegistrationStatusBadge status={zeile.status} />
              <CheckinStatusBadge status={zeile.checkinStatus} />

              {darfVerwalten && (zeile.status === 'PENDING' || zeile.status === 'WAITLISTED') ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={laeuft !== null}
                  onClick={() => void freigeben(zeile)}
                >
                  {laeuft === zeile.id ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Check aria-hidden="true" />
                  )}
                  Freigeben
                </Button>
              ) : null}

              {darfVerwalten && zeile.status !== 'REJECTED' && zeile.status !== 'CANCELLED' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={laeuft !== null}
                  onClick={() => {
                    setAblehnung(zeile);
                    setGrund('');
                  }}
                >
                  <X aria-hidden="true" />
                  Entfernen
                </Button>
              ) : null}
            </div>

            {zeile.reason ? (
              <p className="text-xs text-muted-foreground">Grund: {zeile.reason}</p>
            ) : null}

            {zeile.antworten.length > 0 ? (
              <dl className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                {zeile.antworten.map((antwort) => (
                  <div key={antwort.label} className="flex gap-2">
                    <dt className="text-muted-foreground">{antwort.label}:</dt>
                    <dd className="min-w-0 truncate">{antwort.wert}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        open={ablehnung !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setAblehnung(null);
          }
        }}
        title={`${ablehnung?.teamName ?? ablehnung?.username ?? ''} entfernen?`}
        description="Der Platz wird frei und die Warteliste rückt nach."
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!ablehnung) {
            return;
          }
          const antwort = await rejectRegistrationAction({
            csrfToken,
            registrationId: ablehnung.id,
            reason: grund,
          });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Anmeldung entfernt.');
          setAblehnung(null);
          router.refresh();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ablehnung-grund">Grund</Label>
          <Input
            id="ablehnung-grund"
            minLength={3}
            maxLength={500}
            value={grund}
            onChange={(e) => setGrund(e.target.value)}
            placeholder="Wird der Person mitgeteilt."
          />
        </div>
      </ConfirmationDialog>
    </div>
  );
}
