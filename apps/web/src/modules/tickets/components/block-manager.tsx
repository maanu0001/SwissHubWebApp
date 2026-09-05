'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, ShieldOff, Undo2 } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/states';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { blockMemberAction, liftBlockAction } from '@/modules/tickets/admin-actions';

export interface SperreZeile {
  id: string;
  discordId: string;
  username: string | null;
  reason: string;
  createdAt: string;
  expiresAt: string | null;
  liftedAt: string | null;
  aktiv: boolean;
}

/**
 * Sperren.
 *
 * Eine Sperre verhindert das Eroeffnen neuer Tickets. Bestehende bleiben
 * bearbeitbar - niemand wird mitten im Gespraech abgeschnitten.
 */
export function BlockManager({
  csrfToken,
  sperren,
}: {
  csrfToken: string;
  sperren: SperreZeile[];
}): React.JSX.Element {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [grund, setGrund] = useState('');
  const [tage, setTage] = useState(0);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  async function sperren_(): Promise<void> {
    if (!auswahl) {
      return;
    }
    setLaeuft('create');
    const antwort = await blockMemberAction({
      csrfToken,
      discordId: auswahl.discordId,
      username: auswahl.username,
      reason: grund.trim(),
      days: tage,
    });
    if (antwort.ok) {
      toast.success(`${auswahl.username} kann keine neuen Tickets mehr eröffnen.`);
      setAuswahl(null);
      setGrund('');
      setTage(0);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  async function aufheben(blockId: string): Promise<void> {
    setLaeuft(blockId);
    const antwort = await liftBlockAction({ csrfToken, blockId });
    if (antwort.ok) {
      toast.success('Sperre aufgehoben.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <>
      <form
        className="space-y-3 rounded-xl border border-border/60 p-4"
        onSubmit={(ereignis) => {
          ereignis.preventDefault();
          void sperren_();
        }}
      >
        <MemberPicker csrfToken={csrfToken} value={auswahl} onChange={setAuswahl} label="Mitglied sperren" />
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1">
            <Label htmlFor="sperre-grund">Grund</Label>
            <Input
              id="sperre-grund"
              value={grund}
              onChange={(ereignis) => setGrund(ereignis.target.value)}
              minLength={3}
              maxLength={500}
              required
              placeholder="Wird im Protokoll festgehalten."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sperre-tage">Dauer (Tage)</Label>
            <Input
              id="sperre-tage"
              type="number"
              min={0}
              max={3650}
              value={tage}
              onChange={(ereignis) => {
                const gelesen = Number.parseInt(ereignis.target.value, 10);
                setTage(Number.isFinite(gelesen) ? Math.min(3650, Math.max(0, gelesen)) : 0);
              }}
            />
            <p className="text-xs text-muted-foreground">0 = unbefristet</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="outline"
            disabled={auswahl === null || grund.trim().length < 3 || laeuft !== null}
          >
            {laeuft === 'create' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldOff aria-hidden="true" />
            )}
            Sperren
          </Button>
        </div>
      </form>

      {sperren.length === 0 ? (
        <EmptyState
          title="Keine Sperren"
          description="Niemand ist derzeit vom Ticketsystem ausgeschlossen."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {sperren.map((sperre) => (
            <li key={sperre.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <DiscordAvatar
                discordId={sperre.discordId}
                name={sperre.username ?? sperre.discordId}
                size={32}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">{sperre.username ?? sperre.discordId}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {sperre.reason} · seit {formatDateTime(sperre.createdAt)}
                  {sperre.expiresAt ? ` · bis ${formatDateTime(sperre.expiresAt)}` : ' · unbefristet'}
                </span>
              </span>
              <Badge variant={sperre.aktiv ? 'destructive' : 'outline'}>
                {sperre.aktiv ? 'Aktiv' : sperre.liftedAt ? 'Aufgehoben' : 'Abgelaufen'}
              </Badge>
              {sperre.aktiv ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={laeuft !== null}
                  onClick={() => void aufheben(sperre.id)}
                >
                  {laeuft === sperre.id ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Undo2 aria-hidden="true" />
                  )}
                  Aufheben
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
