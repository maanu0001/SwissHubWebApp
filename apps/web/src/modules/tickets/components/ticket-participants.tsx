'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { addParticipantAction, removeParticipantAction } from '@/modules/tickets/actions';

export interface TicketParticipantEintrag {
  discordId: string;
  username: string;
  /** Der Ersteller wird mitgeführt, lässt sich aber nicht entfernen. */
  ersteller: boolean;
}

/**
 * Wer sieht dieses Ticket.
 *
 * Bewusst mit dem Ersteller in derselben Liste: wer hier hineinschaut, will
 * wissen, wer mitliest - dass der Ersteller aus einem anderen Feld stammt,
 * ist eine Frage der Datenhaltung und nicht seine.
 */
export function TicketParticipants({
  ticketId,
  csrfToken,
  eintraege,
  darfHinzufuegen,
  darfEntfernen,
}: {
  ticketId: string;
  csrfToken: string;
  eintraege: TicketParticipantEintrag[];
  darfHinzufuegen: boolean;
  darfEntfernen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  async function hinzufuegen(): Promise<void> {
    if (!auswahl) {
      return;
    }
    setLaeuft('add');
    const antwort = await addParticipantAction({
      csrfToken,
      ticketId,
      discordId: auswahl.discordId,
      username: auswahl.username,
    });
    if (antwort.ok) {
      toast.success(`${auswahl.username} sieht das Ticket jetzt.`);
      setAuswahl(null);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  async function entfernen(discordId: string, username: string): Promise<void> {
    setLaeuft(discordId);
    const antwort = await removeParticipantAction({ csrfToken, ticketId, discordId });
    if (antwort.ok) {
      toast.success(`${username} wurde entfernt.`);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {eintraege.map((eintrag) => (
          <li key={eintrag.discordId} className="flex items-center gap-2">
            <DiscordAvatar
              discordId={eintrag.discordId}
              name={eintrag.username}
              size={24}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 truncate text-sm">
              {eintrag.username}
              {eintrag.ersteller ? (
                <span className="ml-1.5 text-xs text-muted-foreground">Ersteller</span>
              ) : null}
            </span>
            {darfEntfernen && !eintrag.ersteller ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${eintrag.username} entfernen`}
                disabled={laeuft !== null}
                onClick={() => void entfernen(eintrag.discordId, eintrag.username)}
              >
                {laeuft === eintrag.discordId ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <UserMinus aria-hidden="true" />
                )}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {darfHinzufuegen ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <MemberPicker
            csrfToken={csrfToken}
            value={auswahl}
            onChange={setAuswahl}
            label="Mitglied hinzufügen"
          />
          <Button
            variant="outline"
            className="w-full"
            disabled={auswahl === null || laeuft !== null}
            onClick={() => void hinzufuegen()}
          >
            {laeuft === 'add' ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus aria-hidden="true" />
            )}
            Zum Ticket hinzufügen
          </Button>
        </div>
      ) : null}
    </div>
  );
}
