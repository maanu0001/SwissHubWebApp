import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CalendarClock, CheckCircle2, Info, ShieldOff } from 'lucide-react';
import { resolveGuildId } from '@swisshub/discord';
import { appeals, isModuleEnabled } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AntragFormular } from '@/modules/appeals/components/antrag-formular';
import { csrfTokenFor, requireAuth } from '@/server/auth';

export const metadata: Metadata = { title: 'Entbannungsantrag' };
export const dynamic = 'force-dynamic';

/**
 * Der Einstieg für gebannte Mitglieder.
 *
 * `requireAuth()` statt `requireMember()` - **die entscheidende Zeile des
 * ganzen Moduls**. Sie verlangt eine Anmeldung und sonst nichts. Wer gebannt
 * ist, hat eine gültige Sitzung (die Anmeldung erzeugt sie auch für
 * Nicht-Mitglieder), aber keine Mitgliedschaft. Mit `requireMember()` landete
 * er auf `/access-denied` - genau dort, wo er ohnehin schon war.
 *
 * Was er hier sieht, hängt vom Befund ab:
 *
 * - kein Bann      → eine klare Auskunft, kein Formular
 * - Antrag läuft   → sein Antrag
 * - Sperrfrist     → das Datum, ab dem es wieder geht
 * - zulässig       → das Formular
 */
export default async function EntbannungPage(): Promise<React.JSX.Element> {
  const context = await requireAuth();

  if (!(await isModuleEnabled(appeals.APPEALS_MODULE_ID))) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Anträge sind derzeit nicht möglich</CardTitle>
          <CardDescription>
            Der Bereich für Entbannungsanträge ist zurzeit nicht in Betrieb. Bitte versuche es
            später erneut.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const guildId = await resolveGuildId();

  // Läuft bereits ein Antrag, geht es direkt dorthin - ein zweites Formular
  // wäre eine Einladung zum zweiten Antrag.
  const laufend = await appeals.aktuellerAppeal(guildId, context.user.discordId);
  if (laufend && laufend.status !== 'DRAFT') {
    const offen = !['APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'RESOLVED_EXTERNALLY', 'CLOSED'].includes(
      laufend.status,
    );
    if (offen) {
      redirect(`/entbannung/${laufend.id}`);
    }
  }

  const befund = appeals.fuerAntragsteller(
    await appeals.pruefeZulaessigkeit(context.user.discordId, { guildId }),
  );

  if (!befund.erlaubt) {
    return (
      <>
        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <span className="rounded-full bg-muted p-2 text-muted-foreground">
              {befund.naechsteMoeglichkeitAm ? (
                <CalendarClock className="size-5" aria-hidden="true" />
              ) : (
                <ShieldOff className="size-5" aria-hidden="true" />
              )}
            </span>
            <div className="space-y-1">
              <CardTitle className="text-lg">Kein Antrag möglich</CardTitle>
              <CardDescription>{befund.grund}</CardDescription>
            </div>
          </CardHeader>
          {befund.naechsteMoeglichkeitAm ? (
            <CardContent className="text-sm">
              Eine erneute Prüfung ist ab dem{' '}
              <strong>
                {new Date(befund.naechsteMoeglichkeitAm).toLocaleDateString('de-CH', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </strong>{' '}
              möglich.
            </CardContent>
          ) : null}
        </Card>

        {laufend ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dein letzter Antrag</CardTitle>
              <CardDescription>
                <a href={`/entbannung/${laufend.id}`} className="text-primary hover:underline">
                  {appeals.formatFallnummer(laufend.caseYear, laufend.caseNumber)} ansehen
                </a>
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="rounded-full bg-primary/10 p-2 text-primary">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-lg">Du kannst einen Antrag stellen</CardTitle>
            <CardDescription>
              Nimm dir Zeit dafür. Ein Antrag wird von Menschen gelesen, und ein sorgfältig
              geschriebener wird sorgfältig geprüft.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Bleib sachlich und schreibe wahrheitsgemäss. Beides fällt auf.
            </li>
            <li className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Mehrfache Anträge beschleunigen nichts.
            </li>
            <li className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Eine erneute Prüfung ist keine Zusage auf eine Entbannung.
            </li>
            <li className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Das Team kann Rückfragen stellen. Du wirst hier davon erfahren.
            </li>
          </ul>
        </CardContent>
      </Card>

      <AntragFormular csrfToken={csrfTokenFor(context)} fragen={[...appeals.APPEAL_FRAGEN]} />
    </>
  );
}
