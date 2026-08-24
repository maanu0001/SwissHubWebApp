'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Lock, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { internalNoteAction, replyAction } from '@/modules/tickets/actions';
import { cn } from '@/lib/utils';

const ANTWORT_MAX = 1800;
const NOTIZ_MAX = 4000;

/**
 * Antwortfeld und Notizfeld.
 *
 * Beide sind sichtbar getrennt und nie im selben Feld. Ein gemeinsames Feld
 * mit einem Schalter daneben waere kuerzer - und genau der Schalter wird
 * irgendwann uebersehen, worauf eine interne Notiz im Ticket-Kanal landet.
 * Deshalb zwei Felder mit eigener Farbe, eigener Beschriftung und eigenem
 * Knopf.
 */
export interface AntwortVorlage {
  id: string;
  title: string;
  content: string;
}

export function TicketComposer({
  ticketId,
  csrfToken,
  darfAntworten,
  darfNotieren,
  geschlossen,
  vorlagen = [],
}: {
  ticketId: string;
  csrfToken: string;
  darfAntworten: boolean;
  darfNotieren: boolean;
  geschlossen: boolean;
  vorlagen?: AntwortVorlage[];
}): React.JSX.Element | null {
  const router = useRouter();
  const [antwort, setAntwort] = useState('');
  const [notiz, setNotiz] = useState('');
  const [laeuft, setLaeuft] = useState<'antwort' | 'notiz' | null>(null);

  if (!darfAntworten && !darfNotieren) {
    return null;
  }

  async function senden(): Promise<void> {
    const text = antwort.trim();
    if (text.length === 0) {
      return;
    }
    setLaeuft('antwort');
    const antwortResultat = await replyAction({ csrfToken, ticketId, content: text });
    if (antwortResultat.ok) {
      setAntwort('');
      toast.success('Antwort gesendet.');
      router.refresh();
    } else {
      toast.error(antwortResultat.error.message);
    }
    setLaeuft(null);
  }

  async function notieren(): Promise<void> {
    const text = notiz.trim();
    if (text.length === 0) {
      return;
    }
    setLaeuft('notiz');
    const notizResultat = await internalNoteAction({ csrfToken, ticketId, content: text });
    if (notizResultat.ok) {
      setNotiz('');
      toast.success('Notiz gespeichert. Sie erscheint nicht auf Discord.');
      router.refresh();
    } else {
      toast.error(notizResultat.error.message);
    }
    setLaeuft(null);
  }

  if (geschlossen) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Dieses Ticket ist geschlossen. Es kann nicht mehr geantwortet werden.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {darfAntworten ? (
        <form
          className="space-y-2"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            void senden();
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="ticket-antwort" className="text-sm font-medium">
              Antwort
            </label>
            {vorlagen.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Vorlage:</span>
                {vorlagen.map((vorlage) => (
                  <button
                    key={vorlage.id}
                    type="button"
                    // Eingesetzt statt gesendet: die Vorlage ist ein Anfang,
                    // kein fertiger Text - wer sie unverändert abschickt,
                    // hat das entschieden.
                    onClick={() => setAntwort(vorlage.content)}
                    disabled={laeuft !== null}
                    className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                  >
                    {vorlage.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Textarea
            id="ticket-antwort"
            value={antwort}
            onChange={(ereignis) => setAntwort(ereignis.target.value)}
            maxLength={ANTWORT_MAX}
            rows={4}
            placeholder="Deine Antwort erscheint im Ticket-Kanal auf Discord."
            disabled={laeuft !== null}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                'text-xs tabular-nums',
                antwort.length > ANTWORT_MAX - 100 ? 'text-warning' : 'text-muted-foreground',
              )}
            >
              {antwort.length} / {ANTWORT_MAX} Zeichen
            </span>
            <Button type="submit" disabled={laeuft !== null || antwort.trim().length === 0}>
              {laeuft === 'antwort' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              Antwort senden
            </Button>
          </div>
        </form>
      ) : null}

      {darfNotieren ? (
        <form
          className="space-y-2 rounded-xl border border-warning/40 bg-warning/5 p-4"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            void notieren();
          }}
        >
          <label
            htmlFor="ticket-notiz"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-warning"
          >
            <Lock className="size-3.5" aria-hidden="true" />
            Interne Notiz
          </label>
          <p className="text-xs text-muted-foreground">
            Nur für das Team. Erscheint nicht auf Discord und nicht für das Mitglied.
          </p>
          <Textarea
            id="ticket-notiz"
            value={notiz}
            onChange={(ereignis) => setNotiz(ereignis.target.value)}
            maxLength={NOTIZ_MAX}
            rows={3}
            placeholder="Was das Team wissen sollte."
            disabled={laeuft !== null}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {notiz.length} / {NOTIZ_MAX} Zeichen
            </span>
            <Button
              type="submit"
              variant="outline"
              disabled={laeuft !== null || notiz.trim().length === 0}
            >
              {laeuft === 'notiz' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Notiz speichern
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
