'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Search, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { EmptyState } from '@/components/shared/states';
import { removeEntryAction } from '@/modules/level/raffle-actions';
import { formatChance, formatDateTime, formatXp } from './raffle-shared';

export interface ParticipantRow {
  entryId: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  xpBeforeEntry: number;
  entryXp: number;
  weight: number;
  status: string;
  chance: number;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Nimmt teil',
  REFUNDED: 'Zurückgezahlt',
  DISQUALIFIED: 'Ausgeschlossen',
  WINNER: 'Gewinner',
};

/**
 * Teilnehmerliste einer Verlosung.
 *
 * Die Gewinnchance kommt fertig vom Server – hier wird nichts nachgerechnet,
 * sonst könnten Anzeige und Ziehung auseinanderlaufen.
 */
export function RaffleParticipants({
  csrfToken,
  participants,
  canManage,
  canRemove,
}: {
  csrfToken: string;
  participants: ParticipantRow[];
  canManage: boolean;
  canRemove: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<ParticipantRow | null>(null);
  const [reason, setReason] = useState('');

  const gefiltert = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return participants;
    }
    return participants.filter((row) =>
      [row.displayName, row.username, row.discordId]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [participants, search]);

  if (participants.length === 0) {
    return (
      <EmptyState
        title="Noch keine Teilnahme"
        description="Sobald jemand XP einsetzt, erscheint die Person hier."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name oder Discord-ID suchen …"
          className="pl-9"
          aria-label="Teilnehmende suchen"
        />
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Mitglied
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                XP vorher
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Einsatz
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Gewicht
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Chance
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Teilgenommen
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Status
              </th>
              {canRemove ? (
                <th scope="col" className="px-4 py-2 font-medium">
                  Aktion
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {gefiltert.map((row) => (
              <tr key={row.entryId}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <DiscordAvatar
                      discordId={row.discordId}
                      name={row.displayName ?? row.username ?? row.discordId}
                      size={32}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.displayName ?? row.username ?? 'Unbekannt'}</p>
                      {canManage ? (
                        <p className="truncate text-xs text-muted-foreground">{row.discordId}</p>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">
                  {formatXp(row.xpBeforeEntry)}
                </td>
                <td className="px-4 py-2 tabular-nums font-medium">{formatXp(row.entryXp)}</td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">{row.weight}</td>
                <td className="px-4 py-2 tabular-nums">{formatChance(row.chance)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                <td className="px-4 py-2">
                  <Badge variant={row.status === 'ACTIVE' ? 'default' : 'outline'}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </Badge>
                </td>
                {canRemove ? (
                  <td className="px-4 py-2">
                    {row.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTarget(row);
                          setReason('');
                        }}
                      >
                        <UserMinus aria-hidden="true" />
                        Entfernen
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {gefiltert.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Treffer für „{search}“.</p>
      ) : null}

      <ConfirmationDialog
        open={target !== null}
        onOpenChange={(next) => {
          if (!next) {
            setTarget(null);
          }
        }}
        title="Teilnahme entfernen?"
        description={
          target
            ? `${target.displayName ?? target.username ?? target.discordId} erhält ${formatXp(target.entryXp)} zurück. Die Teilnahme bleibt in der Historie sichtbar und zählt nicht mehr zur Ziehung.`
            : ''
        }
        confirmLabel="Entfernen & XP zurückzahlen"
        destructive
        onConfirm={async () => {
          if (!target) {
            return;
          }
          if (reason.trim().length < 5) {
            toast.error('Bitte einen Grund angeben.');
            throw new Error('Grund fehlt');
          }
          const result = await removeEntryAction({ csrfToken, entryId: target.entryId, reason });
          if (!result.ok) {
            toast.error(result.error.message);
            throw new Error(result.error.message);
          }
          toast.success(`${formatXp(result.data.refunded)} zurückgezahlt.`);
          setTarget(null);
          router.refresh();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="removeReason">Grund (Pflicht)</Label>
          <Input
            id="removeReason"
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Mehrfachkonto"
          />
        </div>
      </ConfirmationDialog>
    </div>
  );
}
