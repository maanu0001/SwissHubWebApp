'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publishEventAction } from '@/modules/calendar/actions';

/**
 * Veröffentlichen, dort wo der Entwurf entsteht.
 *
 * Der Knopf gab es bisher nur in der Verwaltungstabelle. Wer ein Event anlegte,
 * landete danach auf dessen Seite - und fand dort keinen Weg, es live zu
 * schalten. Er musste wissen, dass es die Tabelle gibt, und sich seine eigene
 * Zeile darin suchen.
 *
 * Dahinter steckt dieselbe Server Action wie in der Tabelle. Es gibt genau
 * einen Weg vom Entwurf zum veröffentlichten Termin, und dieser Knopf ist nur
 * ein zweiter Zugang dazu.
 *
 * Angezeigt wird er ausschliesslich für einen Entwurf: ein bereits
 * veröffentlichter Termin wird bearbeitet, nicht erneut veröffentlicht.
 */
export function VeroeffentlichenKnopf({
  csrfToken,
  eventId,
  slug,
}: {
  csrfToken: string;
  eventId: string;
  slug: string;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const veroeffentlichen = async (): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await publishEventAction({ csrfToken, eventId });
      if (!ergebnis.ok) {
        // Fehlende Pflichtangaben stehen in der Meldung der Prüfung - sie
        // gehören dorthin, wo der Klick war, und nicht in ein Protokoll.
        toast.error(ergebnis.error?.message ?? 'Das Event konnte nicht veröffentlicht werden.');
        return;
      }
      toast.success('Event veröffentlicht.');
      router.push(`/kalender/${slug}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Button disabled={pending} onClick={() => void veroeffentlichen()}>
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Send aria-hidden="true" />
      )}
      Veröffentlichen
    </Button>
  );
}
