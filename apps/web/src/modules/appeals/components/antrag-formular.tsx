'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { reicheAppealEinAction } from '@/modules/appeals/actions';

export interface FormularFrage {
  key: string;
  label: string;
  hilfe: string;
  min: number;
  max: number;
  pflicht: boolean;
}

/**
 * Das Antragsformular (§10, §11, §12).
 *
 * Zwei Schritte, und der zweite ist der wichtigere: vor dem Absenden bekommt
 * der Antragsteller seine eigenen Antworten noch einmal zu lesen. Nach dem
 * Absenden sind sie eingefroren - Ergänzungen gehen als Nachricht in den Fall,
 * nicht als stille Änderung an einer Aussage, über die schon jemand
 * nachgedacht hat.
 *
 * Der Entwurf liegt im Browser (`sessionStorage`), nicht in der Datenbank: ein
 * unfertiger Antrag ist noch kein Antrag, und ein Entwurf in der Datenbank
 * wäre ein Datensatz über jemanden, der sich noch gar nicht entschieden hat.
 * Er verschwindet mit dem Tab - das ist der Preis, und er ist klein gegen die
 * Alternative.
 */
export function AntragFormular({
  csrfToken,
  fragen,
}: {
  csrfToken: string;
  fragen: FormularFrage[];
}): React.JSX.Element {
  const router = useRouter();
  const [antworten, setAntworten] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    try {
      const gemerkt = window.sessionStorage.getItem('swisshub.appeal.entwurf');
      return gemerkt ? (JSON.parse(gemerkt) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [schritt, setSchritt] = useState<'formular' | 'pruefen'>('formular');
  const [bestaetigt, setBestaetigt] = useState(false);
  const [pending, setPending] = useState(false);
  const [fehler, setFehler] = useState<Record<string, string>>({});

  /**
   * Der Schlüssel gegen den Doppelklick (§30, §59).
   *
   * Einmal je geöffnetem Formular. Zwei Klicks auf «Absenden» tragen denselben
   * Schlüssel und erzeugen deshalb einen Antrag, nicht zwei.
   */
  const idempotencyKey = useMemo(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    [],
  );

  const setzeAntwort = (key: string, wert: string): void => {
    const naechste = { ...antworten, [key]: wert };
    setAntworten(naechste);
    setFehler((aktuell) => {
      if (!(key in aktuell)) {
        return aktuell;
      }
      const { [key]: _weg, ...rest } = aktuell;
      return rest;
    });
    try {
      window.sessionStorage.setItem('swisshub.appeal.entwurf', JSON.stringify(naechste));
    } catch {
      // Kein Speicher - der Entwurf geht dann beim Neuladen verloren. Kein
      // Grund, das Formular deswegen anzuhalten.
    }
  };

  const pruefeLokal = (): boolean => {
    const gefunden: Record<string, string> = {};
    for (const frage of fragen) {
      const wert = (antworten[frage.key] ?? '').trim();
      if (frage.pflicht && wert.length < frage.min) {
        gefunden[frage.key] = `Bitte mindestens ${frage.min} Zeichen.`;
      } else if (!frage.pflicht && wert.length > 0 && wert.length < frage.min) {
        gefunden[frage.key] = `Bitte mindestens ${frage.min} Zeichen - oder ganz leer lassen.`;
      }
    }
    setFehler(gefunden);
    return Object.keys(gefunden).length === 0;
  };

  const absenden = async (): Promise<void> => {
    if (!bestaetigt || pending) {
      return;
    }
    setPending(true);
    try {
      const antwort = await reicheAppealEinAction({
        csrfToken,
        antworten,
        bestaetigt: true,
        idempotencyKey,
      });

      if (!antwort.ok) {
        // Serverseitige Feldfehler zurück ins Formular - der Server ist die
        // massgebliche Prüfung, die im Browser nur die Bequemlichkeit.
        const felder = antwort.error.details?.fieldErrors;
        if (typeof felder === 'object' && felder !== null) {
          setFehler(felder as Record<string, string>);
          setSchritt('formular');
        }
        toast.error(antwort.error.message);
        return;
      }

      try {
        window.sessionStorage.removeItem('swisshub.appeal.entwurf');
      } catch {
        // Nicht schlimm.
      }
      toast.success(
        antwort.data.neu ? 'Dein Antrag ist eingegangen.' : 'Dein Antrag lag bereits vor.',
      );
      router.push(`/entbannung/${antwort.data.id}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  if (schritt === 'pruefen') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bitte prüfe deine Angaben</CardTitle>
          <CardDescription>
            Nach dem Absenden lassen sich diese Antworten nicht mehr ändern. Ergänzen kannst du
            später über den Nachrichtenbereich deines Antrags.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {fragen.map((frage) => {
            const wert = (antworten[frage.key] ?? '').trim();
            if (wert.length === 0) {
              return null;
            }
            return (
              <div key={frage.key} className="space-y-1">
                <p className="text-sm font-medium">{frage.label}</p>
                <p className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {wert}
                </p>
              </div>
            );
          })}

          <label className="flex items-start gap-3 rounded-md border border-border px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={bestaetigt}
              onChange={(event) => setBestaetigt(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>Ich bestätige, dass meine Angaben nach bestem Wissen korrekt sind.</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void absenden()} loading={pending} disabled={!bestaetigt}>
              <Send aria-hidden="true" />
              Antrag absenden
            </Button>
            <Button variant="outline" onClick={() => setSchritt('formular')} disabled={pending}>
              <ArrowLeft aria-hidden="true" />
              Zurück zum Bearbeiten
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Dein Antrag</CardTitle>
        <CardDescription>
          Schreib in eigenen Worten - abgeschriebene Texte erkennt man. Was hier fehlt, können wir
          später über die Nachrichten nachfragen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {fragen.map((frage) => {
          const wert = antworten[frage.key] ?? '';
          const id = `frage-${frage.key}`;
          return (
            <div key={frage.key} className="space-y-1.5">
              <Label htmlFor={id}>
                {frage.label}
                {frage.pflicht ? <span className="ml-1 text-destructive">*</span> : null}
              </Label>
              <textarea
                id={id}
                value={wert}
                maxLength={frage.max}
                rows={fragen.length === 1 ? 12 : 5}
                onChange={(event) => setzeAntwort(frage.key, event.target.value)}
                className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/60"
              />
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{frage.hilfe}</span>
                <span className="tabular-nums text-muted-foreground">
                  {wert.length} / {frage.max}
                </span>
              </div>
              {fehler[frage.key] ? (
                <p className="text-xs text-destructive">{fehler[frage.key]}</p>
              ) : null}
            </div>
          );
        })}

        <Button
          onClick={() => {
            if (pruefeLokal()) {
              setSchritt('pruefen');
            }
          }}
        >
          Weiter zur Übersicht
        </Button>
      </CardContent>
    </Card>
  );
}
