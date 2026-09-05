'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { feedbackAction } from '@/modules/tickets/actions';
import { cn } from '@/lib/utils';

/**
 * Rueckmeldung zum abgeschlossenen Ticket.
 *
 * Erscheint nur beim Ersteller, nur bei einem geschlossenen Ticket und nur,
 * solange keine Bewertung vorliegt. Der Server prueft dasselbe noch einmal -
 * eine Statistik aus Bewertungen, die jeder abgeben koennte, waere keine.
 */
export function TicketFeedback({
  ticketId,
  csrfToken,
  vorhanden,
}: {
  ticketId: string;
  csrfToken: string;
  vorhanden: { rating: number; comment: string | null } | null;
}): React.JSX.Element {
  const router = useRouter();
  const [sterne, setSterne] = useState(0);
  const [kommentar, setKommentar] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  if (vorhanden) {
    return (
      <div className="space-y-1.5">
        <p className="flex items-center gap-1" aria-label={`${vorhanden.rating} von 5 Sternen`}>
          {[1, 2, 3, 4, 5].map((wert) => (
            <Star
              key={wert}
              className={cn(
                'size-4',
                wert <= vorhanden.rating ? 'fill-warning text-warning' : 'text-muted-foreground',
              )}
              aria-hidden="true"
            />
          ))}
          <span className="ml-1 text-sm text-muted-foreground">{vorhanden.rating} von 5</span>
        </p>
        {vorhanden.comment ? <p className="text-sm text-muted-foreground">{vorhanden.comment}</p> : null}
      </div>
    );
  }

  async function absenden(): Promise<void> {
    if (sterne === 0) {
      return;
    }
    setLaeuft(true);
    const antwort = await feedbackAction({
      csrfToken,
      ticketId,
      rating: sterne,
      ...(kommentar.trim().length > 0 ? { comment: kommentar.trim() } : {}),
    });
    if (antwort.ok) {
      toast.success('Danke für die Rückmeldung.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
      setLaeuft(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(ereignis) => {
        ereignis.preventDefault();
        void absenden();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm">Wie war der Support?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((wert) => (
            <button
              key={wert}
              type="button"
              aria-label={`${wert} von 5 Sternen`}
              aria-pressed={sterne === wert}
              onClick={() => setSterne(wert)}
              className="rounded-md p-1 transition-colors hover:bg-card"
            >
              <Star
                className={cn(
                  'size-5',
                  wert <= sterne ? 'fill-warning text-warning' : 'text-muted-foreground',
                )}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </fieldset>

      <Textarea
        value={kommentar}
        onChange={(ereignis) => setKommentar(ereignis.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Etwas dazu sagen? (freiwillig)"
        aria-label="Kommentar zur Bewertung"
        disabled={laeuft}
      />

      <Button type="submit" variant="outline" size="sm" disabled={laeuft || sterne === 0}>
        {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Bewertung abgeben
      </Button>
    </form>
  );
}
