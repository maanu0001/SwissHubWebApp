'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Lock, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/shared/panel';
import { schreibeInternenKommentarAction } from '@/modules/appeals/actions';

export interface InterneNotiz {
  id: string;
  autor: string;
  inhalt: string;
  am: string;
}

/**
 * Interne Notizen (§20).
 *
 * Diese Komponente wird in der Antragstellersicht nicht eingebunden - und
 * selbst wenn jemand es täte, bekäme sie keine Daten: die Abfrage des
 * Antragstellers lädt die Kommentare nicht. Das Schloss im Kopf ist eine
 * Erinnerung für das Team, keine Sicherheitsmassnahme.
 */
export function InterneNotizen({
  csrfToken,
  appealId,
  notizen,
  darfSchreiben,
}: {
  csrfToken: string;
  appealId: string;
  notizen: InterneNotiz[];
  darfSchreiben: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);

  const senden = async (): Promise<void> => {
    if (text.trim().length < 2 || pending) {
      return;
    }
    setPending(true);
    try {
      const antwort = await schreibeInternenKommentarAction({ csrfToken, appealId, inhalt: text });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      setText('');
      toast.success('Notiz gespeichert.');
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel
      title="Interne Notizen"
      description="Der Antragsteller sieht davon nichts."
      icon={<Lock className="size-4" aria-hidden="true" />}
    >
      {notizen.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Notizen.</p>
      ) : (
        <ul className="space-y-3">
          {notizen.map((notiz) => (
            <li key={notiz.id} className="rounded-lg border border-border/60 px-3 py-2">
              <p className="mb-1 text-xs text-muted-foreground">
                {notiz.autor} · {new Date(notiz.am).toLocaleString('de-CH')}
              </p>
              <p className="whitespace-pre-wrap text-sm">{notiz.inhalt}</p>
            </li>
          ))}
        </ul>
      )}

      {darfSchreiben ? (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <textarea
            value={text}
            maxLength={4000}
            rows={3}
            placeholder="Notiz für das Team …"
            onChange={(event) => setText(event.target.value)}
            className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
          />
          <Button size="sm" onClick={() => void senden()} loading={pending} disabled={text.trim().length < 2}>
            <Send aria-hidden="true" />
            Notiz speichern
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
