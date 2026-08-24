'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Tag, UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/modules/configuration/components/multi-select';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { assignAction, setTagsAction } from '@/modules/tickets/actions';

/**
 * Zuweisung und Schlagwoerter.
 *
 * Beides aendert nicht den Verlauf, sondern die Einordnung - deshalb steht es
 * beisammen und getrennt von den Knoepfen, die ein Ticket weiterbewegen.
 */
export function TicketAssignment({
  ticketId,
  csrfToken,
  zugewiesenAn,
  darfZuweisen,
  tags,
  gesetzteTags,
  darfSchlagwoerter,
}: {
  ticketId: string;
  csrfToken: string;
  zugewiesenAn: string | null;
  darfZuweisen: boolean;
  tags: Array<{ id: string; name: string }>;
  gesetzteTags: string[];
  darfSchlagwoerter: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [ausgewaehlteTags, setAusgewaehlteTags] = useState<string[]>(gesetzteTags);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  if (!darfZuweisen && !darfSchlagwoerter) {
    return null;
  }

  async function zuweisen(ziel: PickedMember | null): Promise<void> {
    setLaeuft('assign');
    const antwort = await assignAction({
      csrfToken,
      ticketId,
      discordId: ziel?.discordId ?? null,
      username: ziel?.username ?? null,
    });
    if (antwort.ok) {
      toast.success(ziel ? `An ${ziel.username} übergeben.` : 'Zuweisung aufgehoben.');
      setAuswahl(null);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  async function schlagwoerterSpeichern(naechste: string[]): Promise<void> {
    setAusgewaehlteTags(naechste);
    setLaeuft('tags');
    const antwort = await setTagsAction({ csrfToken, ticketId, tagIds: naechste });
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      // Zurücksetzen: sonst zeigte die Auswahl etwas an, das nicht
      // gespeichert wurde.
      setAusgewaehlteTags(gesetzteTags);
    }
    setLaeuft(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {darfZuweisen ? (
        <div className="space-y-2">
          <Label className="inline-flex items-center gap-1.5">
            <UserCog className="size-3.5" aria-hidden="true" />
            Zuweisen
          </Label>
          <MemberPicker
            csrfToken={csrfToken}
            value={auswahl}
            onChange={setAuswahl}
            label="Mitglied des Teams"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={auswahl === null || laeuft !== null}
              onClick={() => void zuweisen(auswahl)}
            >
              {laeuft === 'assign' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Übergeben
            </Button>
            {zugewiesenAn ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={laeuft !== null}
                onClick={() => void zuweisen(null)}
              >
                Zuweisung aufheben
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {darfSchlagwoerter ? (
        <div className="space-y-2">
          <Label className="inline-flex items-center gap-1.5">
            <Tag className="size-3.5" aria-hidden="true" />
            Schlagwörter
          </Label>
          <MultiSelect
            options={tags.map((tag) => ({ id: tag.id, label: tag.name }))}
            selected={ausgewaehlteTags}
            onChange={(naechste) => void schlagwoerterSpeichern(naechste)}
            disabled={laeuft !== null}
            emptyLabel="Noch keine Schlagwörter angelegt."
            searchPlaceholder="Schlagwort suchen …"
          />
        </div>
      ) : null}
    </div>
  );
}
