'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, LockKeyhole, LockKeyholeOpen, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { disqualifyTeamAction, unlockRosterAction } from '@/modules/tournaments/admin-actions';

export interface TeamZeile {
  id: string;
  name: string;
  tag: string | null;
  captainUsername: string;
  status: string;
  rosterOffen: boolean;
  mitglieder: Array<{ username: string; role: string }>;
  angemeldet: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  FORMING: 'Im Aufbau',
  READY: 'Vollständig',
  REGISTERED: 'Angemeldet',
  DISQUALIFIED: 'Disqualifiziert',
  WITHDRAWN: 'Zurückgezogen',
};

/**
 * Die Teams eines Turniers.
 *
 * Die Leitung kann ein Roster nach dem Lock wieder öffnen - jemand, dessen
 * Spieler kurzfristig ausfällt, soll nicht deswegen aus dem Turnier fallen -
 * und ein Team disqualifizieren. Beides mit Rückfrage und Grund.
 */
export function TeamAdmin({
  csrfToken,
  teams,
  darfVerwalten,
}: {
  csrfToken: string;
  teams: TeamZeile[];
  darfVerwalten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [disqualifikation, setDisqualifikation] = useState<TeamZeile | null>(null);
  const [grund, setGrund] = useState('');

  async function rosterUmschalten(team: TeamZeile): Promise<void> {
    setLaeuft(team.id);
    const antwort = await unlockRosterAction({
      csrfToken,
      teamId: team.id,
      offen: !team.rosterOffen,
    });
    if (antwort.ok) {
      toast.success(team.rosterOffen ? 'Roster geschlossen.' : 'Roster geöffnet.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  if (teams.length === 0) {
    return (
      <EmptyState
        title="Noch keine Teams"
        description="Sobald jemand ein Team gründet, steht es hier."
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
        {teams.map((team) => (
          <li key={team.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">
                  {team.name}
                  {team.tag ? (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {team.tag}
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  Captain: {team.captainUsername} · {team.mitglieder.length} Mitglieder
                </span>
              </span>

              <Badge variant={team.status === 'DISQUALIFIED' ? 'destructive' : 'secondary'}>
                {STATUS_LABEL[team.status] ?? team.status}
              </Badge>

              {darfVerwalten && team.status !== 'DISQUALIFIED' ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={laeuft !== null}
                    onClick={() => void rosterUmschalten(team)}
                  >
                    {laeuft === team.id ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : team.rosterOffen ? (
                      <LockKeyhole aria-hidden="true" />
                    ) : (
                      <LockKeyholeOpen aria-hidden="true" />
                    )}
                    {team.rosterOffen ? 'Roster schliessen' : 'Roster öffnen'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={laeuft !== null}
                    onClick={() => {
                      setDisqualifikation(team);
                      setGrund('');
                    }}
                  >
                    <ShieldOff aria-hidden="true" />
                    Disqualifizieren
                  </Button>
                </>
              ) : null}
            </div>

            <p className="truncate text-xs text-muted-foreground">
              {team.mitglieder
                .map((mitglied) =>
                  mitglied.role === 'SUBSTITUTE'
                    ? `${mitglied.username} (Ersatz)`
                    : mitglied.role === 'COACH'
                      ? `${mitglied.username} (Coach)`
                      : mitglied.username,
                )
                .join(', ')}
            </p>
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        open={disqualifikation !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setDisqualifikation(null);
          }
        }}
        title={`${disqualifikation?.name ?? ''} disqualifizieren?`}
        description="Das Team scheidet aus. Laufende Matches werden für die Gegenseite gewertet."
        confirmLabel="Disqualifizieren"
        destructive
        onConfirm={async () => {
          if (!disqualifikation) {
            return;
          }
          const antwort = await disqualifyTeamAction({
            csrfToken,
            teamId: disqualifikation.id,
            reason: grund,
          });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Team disqualifiziert.');
          setDisqualifikation(null);
          router.refresh();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="dq-grund">Grund</Label>
          <Input
            id="dq-grund"
            minLength={5}
            maxLength={500}
            value={grund}
            onChange={(e) => setGrund(e.target.value)}
            placeholder="Steht im Turnierverlauf."
          />
        </div>
      </ConfirmationDialog>
    </>
  );
}
