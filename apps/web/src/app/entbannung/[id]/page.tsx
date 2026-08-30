import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import { resolveGuildId } from '@swisshub/discord';
import { appeals, isModuleEnabled } from '@swisshub/modules';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AntragGespraech } from '@/modules/appeals/components/antrag-gespraech';
import { csrfTokenFor, requireAuth } from '@/server/auth';

export const metadata: Metadata = { title: 'Mein Entbannungsantrag' };
export const dynamic = 'force-dynamic';

/**
 * Die Fallansicht des Antragstellers (§13).
 *
 * Sie zeigt eine **Teilmenge**, und die entsteht nicht hier, sondern in
 * `holeAntragstellerSicht`: interne Kommentare werden nicht geladen, die
 * Zeitleiste wird in der Datenbank auf `PUBLIC` gefiltert, und aus dem
 * Moderator wird «SwissHub Team».
 *
 * Diese Seite kann deshalb gar nichts Internes anzeigen - sie bekommt es
 * nicht. Das ist der Unterschied zwischen «wird nicht angezeigt» und «ist
 * nicht da».
 */
export default async function MeinAntragPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requireAuth();
  const { id } = await params;

  if (!(await isModuleEnabled(appeals.APPEALS_MODULE_ID))) {
    notFound();
  }

  const guildId = await resolveGuildId();
  // Die Kennung aus der Sitzung steht in der Abfrage. Ein fremder Antrag wird
  // nicht gefunden - und «nicht gefunden» ist die richtige Antwort: ein
  // anderer Code verriete, dass es ihn gibt (§4, IDOR).
  const sicht = await appeals.holeAntragstellerSicht(guildId, id, context.user.discordId);
  if (!sicht) {
    notFound();
  }

  const datum = (wert: Date | null): string =>
    wert ? wert.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-lg">Entbannungsantrag {sicht.fallnummer}</CardTitle>
              <CardDescription>
                Eingereicht am {datum(sicht.eingereichtAm)} · zuletzt aktualisiert am{' '}
                {datum(sicht.aktualisiertAm)}
              </CardDescription>
            </div>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              {sicht.statusLabel}
            </span>
          </div>
        </CardHeader>

        {sicht.entscheidung ? (
          <CardContent>
            <p className="mb-1 text-sm font-medium">Entscheidung</p>
            <p className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
              {sicht.entscheidung}
            </p>
            {sicht.naechsteMoeglichkeitAm ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Ein erneuter Antrag ist ab dem {datum(sicht.naechsteMoeglichkeitAm)} möglich.
              </p>
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verlauf</CardTitle>
        </CardHeader>
        <CardContent>
          {sicht.zeitleiste.length === 0 ? (
            <p className="text-sm text-muted-foreground">Noch nichts geschehen.</p>
          ) : (
            <ol className="space-y-3">
              {sicht.zeitleiste.map((eintrag, index) => {
                const letzter = index === sicht.zeitleiste.length - 1;
                const laufend = letzter && !sicht.abgeschlossenAm;
                return (
                  <li key={eintrag.id} className="flex items-start gap-3 text-sm">
                    {laufend ? (
                      <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                      <CheckCircle2
                        className="mt-0.5 size-4 shrink-0 text-emerald-500"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p>{eintrag.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {eintrag.am.toLocaleString('de-CH')}
                      </p>
                    </div>
                  </li>
                );
              })}
              {!sicht.abgeschlossenAm ? (
                <li className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Circle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  Entscheidung steht noch aus
                </li>
              ) : null}
            </ol>
          )}
        </CardContent>
      </Card>

      <AntragGespraech
        csrfToken={csrfTokenFor(context)}
        appealId={sicht.id}
        nachrichten={sicht.nachrichten.map((nachricht) => ({
          id: nachricht.id,
          von: nachricht.von,
          inhalt: nachricht.inhalt,
          am: nachricht.am.toISOString(),
        }))}
        darfAntworten={sicht.darfAntworten}
        darfZurueckziehen={sicht.darfZurueckziehen}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deine Angaben</CardTitle>
          <CardDescription>
            So, wie du sie eingereicht hast. Ergänzungen gehen über die Nachrichten oben.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {appeals.APPEAL_FRAGEN.map((frage) => {
            const wert = sicht.antworten[frage.key];
            if (!wert) {
              return null;
            }
            return (
              <div key={frage.key} className="space-y-1">
                <p className="text-sm font-medium">{frage.label}</p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{wert}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div>
        <Button variant="outline" asChild>
          <Link href="/entbannung">Zurück</Link>
        </Button>
      </div>
    </>
  );
}
