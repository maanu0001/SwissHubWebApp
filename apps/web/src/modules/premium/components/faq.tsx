/**
 * Häufige Fragen.
 *
 * Bewusst ohne erfundene rechtliche Zusagen: beschrieben wird ausschliesslich,
 * was das Modul tatsächlich tut.
 */
const FRAGEN = [
  {
    frage: 'Wie funktioniert die Zahlung?',
    antwort:
      'Du wählst dein Angebot, meldest dich mit Discord an und bezahlst anschliessend mit TWINT. Die Zahlung läuft über unseren Zahlungsanbieter; SwissHub speichert keine Zahlungsdaten.',
  },
  {
    frage: 'Wird mein Abo automatisch verlängert?',
    antwort:
      'Ja. Das Abonnement läuft monatlich weiter, bis du es kündigst. Die Folgezahlung wird jeweils zu Beginn der neuen Periode ausgelöst.',
  },
  {
    frage: 'Wie kann ich kündigen?',
    antwort: 'Unter «Mein Abo» mit einem Klick. Es gibt keine Mindestlaufzeit und keine Kündigungsfrist.',
  },
  {
    frage: 'Was passiert nach einer Kündigung?',
    antwort:
      'Deine Vorteile bleiben bis zum Ende der bereits bezahlten Periode bestehen. Erst danach werden Rolle und Stübli entfernt.',
  },
  {
    frage: 'Wann erhalte ich meine Discord-Rolle?',
    antwort:
      'Sobald der Zahlungsanbieter die Zahlung bestätigt hat - in der Regel unmittelbar danach. Ist Discord gerade nicht erreichbar, holt SwissHub die Vergabe automatisch nach.',
  },
  {
    frage: 'Was ist das Premium-Stübli?',
    antwort:
      'Ein eigener Sprachkanal auf dem SwissHub Discord-Server, der dir allein gehört. Er wird automatisch in der dafür vorgesehenen Kategorie angelegt.',
  },
  {
    frage: 'Bleibt mein Stübli dauerhaft bestehen?',
    antwort:
      'Ja, solange dein Abonnement läuft. Der Kanal wird nicht gelöscht, wenn du offline bist, wenn er leer ist oder wenn Bot und WebApp neu starten.',
  },
  {
    frage: 'Welche Rechte habe ich in meinem Stübli?',
    antwort:
      'Innerhalb deines eigenen Kanals kannst du unter anderem den Kanal verwalten sowie Mitglieder stummschalten, taub schalten und verschieben. Diese Rechte gelten ausschliesslich in deinem Kanal und nirgends sonst auf dem Server.',
  },
  {
    frage: 'Was passiert bei einer fehlgeschlagenen Zahlung?',
    antwort:
      'Deine Vorteile bleiben zunächst bestehen - es läuft eine Schonfrist. Erst wenn diese verstreicht, ohne dass die Zahlung nachgeholt wurde, werden Rolle und Stübli entfernt.',
  },
  {
    frage: 'Kann ich mein Angebot wechseln?',
    antwort:
      'Ja. Du kündigst dein laufendes Abonnement und schliesst anschliessend das gewünschte ab. Ein Wechsel erzeugt nie ein zweites Abonnement.',
  },
  {
    frage: 'Muss ich Mitglied des SwissHub Discord-Servers sein?',
    antwort:
      'Ja. Die Vorteile bestehen aus Discord-Rolle und Sprachkanal auf unserem Server - ohne Mitgliedschaft gibt es nichts zu vergeben.',
  },
] as const;

export function PremiumFaq(): React.JSX.Element {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Häufige Fragen</h2>
      <div className="divide-y divide-border rounded-xl border border-border">
        {FRAGEN.map((eintrag) => (
          <details key={eintrag.frage} className="group px-5 py-4">
            <summary className="cursor-pointer list-none font-medium marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-center justify-between gap-3">
                {eintrag.frage}
                <span
                  className="text-muted-foreground transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{eintrag.antwort}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
