'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Send, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  antworteAlsAntragstellerAction,
  ziehAppealZurueckAction,
} from '@/modules/appeals/actions';

export interface GespraechsNachricht {
  id: string;
  von: 'TEAM' | 'DU';
  inhalt: string;
  am: string;
}

/**
 * Der Nachrichtenbereich des Antragstellers (§21).
 *
 * Die Gegenseite heisst «SwissHub Team» und nicht anders. Das ist keine
 * Anzeigefrage - der Name kommt gar nicht erst aus der Datenbank heraus
 * (siehe `holeAntragstellerSicht`). Wer entschieden hat, steht im Audit, und
 * dort gehört es hin (§22).
 *
 * Der Inhalt wird als Text gerendert, nie als Markup: hier schreiben zwei
 * Seiten, und eine davon ist gerade gebannt.
 */
export function AntragGespraech({
  csrfToken,
  appealId,
  nachrichten,
  darfAntworten,
  darfZurueckziehen,
}: {
  csrfToken: string;
  appealId: string;
  nachrichten: GespraechsNachricht[];
  darfAntworten: boolean;
  darfZurueckziehen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [rueckzug, setRueckzug] = useState(false);

  const senden = async (): Promise<void> => {
    if (text.trim().length < 2 || pending) {
      return;
    }
    setPending(true);
    try {
      const antwort = await antworteAlsAntragstellerAction({ csrfToken, appealId, inhalt: text });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      setText('');
      toast.success('Deine Antwort ist eingegangen.');
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nachrichten mit dem SwissHub Team</CardTitle>
        <CardDescription>
          Hier meldet sich das Team, wenn etwas offen ist. Antworten hilft deinem Antrag.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {nachrichten.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Nachrichten.</p>
        ) : (
          <ul className="space-y-3">
            {nachrichten.map((nachricht) => (
              <li
                key={nachricht.id}
                className={
                  nachricht.von === 'DU'
                    ? 'ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary/10 px-3 py-2'
                    : 'mr-auto max-w-[85%] rounded-lg rounded-bl-sm border border-border/60 bg-muted/30 px-3 py-2'
                }
              >
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {nachricht.von === 'DU' ? 'Du' : 'SwissHub Team'}
                  {' · '}
                  {new Date(nachricht.am).toLocaleString('de-CH')}
                </p>
                {/* Als Text, nie als Markup. */}
                <p className="whitespace-pre-wrap text-sm">{nachricht.inhalt}</p>
              </li>
            ))}
          </ul>
        )}

        {darfAntworten ? (
          <div className="space-y-2 border-t border-border pt-4">
            <textarea
              value={text}
              maxLength={4000}
              rows={4}
              placeholder="Deine Antwort …"
              onChange={(event) => setText(event.target.value)}
              className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button onClick={() => void senden()} loading={pending} disabled={text.trim().length < 2}>
                <Send aria-hidden="true" />
                Senden
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {text.length} / 4000
              </span>
            </div>
          </div>
        ) : null}

        {darfZurueckziehen ? (
          <div className="border-t border-border pt-4">
            <Button variant="ghost" size="sm" onClick={() => setRueckzug(true)}>
              <XCircle aria-hidden="true" />
              Antrag zurückziehen
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ConfirmationDialog
        open={rueckzug}
        onOpenChange={setRueckzug}
        title="Antrag wirklich zurückziehen?"
        description="Dein Antrag wird geschlossen und nicht weiter geprüft. Rückgängig machen lässt sich das nicht."
        confirmLabel="Zurückziehen"
        destructive
        onConfirm={async () => {
          const antwort = await ziehAppealZurueckAction({ csrfToken, appealId });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          toast.success('Dein Antrag wurde zurückgezogen.');
          setRueckzug(false);
          router.refresh();
        }}
      />
    </Card>
  );
}
