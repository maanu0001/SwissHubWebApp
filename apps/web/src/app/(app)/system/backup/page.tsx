import type { Metadata } from 'next';
import { AlertTriangle, CheckCircle2, CircleSlash, Info, Terminal } from 'lucide-react';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/shared/stat-card';
import { EmptyState } from '@/components/shared/states';
import { requirePagePermission } from '@/server/auth';
import { ladeBackupUebersicht } from '@/modules/backup/status';
import { SicherungsTabelle, groesse } from '@/modules/backup/components/sicherungs-tabelle';

export const metadata: Metadata = { title: 'Backup & Recovery' };
export const dynamic = 'force-dynamic';

/**
 * Backup & Recovery - Auskunft, keine Bedienung.
 *
 * ## Warum hier keine Schaltflaeche steht
 *
 * Diese Seite laeuft im WebApp-Container, als unprivilegierter Benutzer, ohne
 * Docker-Socket und ohne Zugang zu `/var/backups`. Das ist kein Mangel, das ist
 * der Entwurf: eine Anwendung, die aus dem Internet erreichbar ist, soll keine
 * Systembackups ausloesen und keine Datenbank ueberschreiben koennen.
 *
 * Eine Schaltflaeche «Backup erstellen» braeuchte einen Weg aus dem Container
 * heraus - einen Socket, einen privilegierten Helfer, einen sudo-Eintrag. Jeder
 * dieser Wege ist eine dauerhafte Rechteerweiterung fuer eine Bequemlichkeit,
 * die einmal im Monat gebraucht wird. Der Befehl fuer die CLI steht unten.
 *
 * ## Was sie zeigt
 *
 * Ausschliesslich, was in den Manifesten steht. Keine Beispielwerte, keine
 * Platzhalter: ist nichts eingerichtet, sagt die Seite das und nennt die
 * Schritte.
 */
export default async function BackupSystemPage(): Promise<React.JSX.Element> {
  await requirePagePermission('backup.view');

  const uebersicht = await ladeBackupUebersicht();

  if (!uebersicht.eingerichtet) {
    /*
     * Der Normalfall direkt nach einem Deployment: die Oberflaeche ist da, der
     * Systemdienst noch nicht. Kein Fehler, keine rote Seite - eine Anleitung.
     * Und ausdruecklich keine erfundenen Zahlen: eine Uebersicht mit
     * Beispielwerten waere hier das Schlimmste, weil sie aussieht wie ein
     * eingerichtetes Backup.
     */
    return (
      <div className="flex flex-col gap-6">
        <EmptyState
          title="Der Backup-Dienst ist auf diesem Server noch nicht eingerichtet"
          description={`Die WebApp liest den Zustand aus ${uebersicht.statusVerzeichnis}. Dort liegt noch nichts. Solange das so ist, gibt es keine automatischen Sicherungen - unabhängig davon, dass diese Seite funktioniert.`}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" aria-hidden="true" />
              Einrichten
            </CardTitle>
            <CardDescription>
              Auf dem Server, einmal. Vollständig beschrieben in{' '}
              <code className="font-mono text-xs">deploy/backup/README.md</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
              {[
                'sudo mkdir -p /etc/swisshub',
                'sudo cp /opt/swisshub/deploy/backup/swisshub-backup.env.example \\',
                '  /etc/swisshub/backup.env',
                'sudo chmod 600 /etc/swisshub/backup.env',
                '',
                'sudo cp /opt/swisshub/deploy/backup/systemd/* /etc/systemd/system/',
                'sudo systemctl daemon-reload',
                'sudo systemctl enable --now swisshub-backup.timer',
                'sudo systemctl enable --now swisshub-backup-verify.timer',
                'sudo systemctl enable --now swisshub-restore-test.timer',
                '',
                '# Einmal von Hand, um zuzusehen:',
                'sudo systemctl start swisshub-backup.service',
                'sudo journalctl -u swisshub-backup.service -f',
              ].join('\n')}
            </pre>
            <p className="text-muted-foreground">
              Danach erscheinen hier die Sicherungen. Diese Seite braucht keinen Neustart.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { zustand, befund, sicherungen } = uebersicht;
  const erfolgreich = zustand?.letzterLaufStatus === 'erfolgreich';
  const externEingerichtet = (zustand?.extern ?? 'nicht eingerichtet') !== 'nicht eingerichtet';

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Letzter Lauf"
          value={uebersicht.letzterLauf ? formatDateTime(uebersicht.letzterLauf) : '–'}
          tone={erfolgreich ? 'success' : 'destructive'}
          hint={erfolgreich ? 'erfolgreich' : (zustand?.letzterLaufStatus ?? 'unbekannt')}
        />
        <StatCard
          label="Letzte erfolgreiche Sicherung"
          value={uebersicht.letzterErfolg ? formatDateTime(uebersicht.letzterErfolg) : 'noch keine'}
          hint={zustand?.letzteKennung ?? undefined}
          tone={uebersicht.letzterErfolg ? 'default' : 'warning'}
        />
        <StatCard
          label="Nächste Sicherung"
          value={uebersicht.naechsteSicherung ? formatDateTime(uebersicht.naechsteSicherung) : '–'}
          // Aus der Vorgabe des Timers gerechnet. Die WebApp hat keinen Zugang
          // zu systemd - sie soll keinen bekommen -, deshalb ist das eine
          // Erwartung und wird auch so beschriftet.
          hint="erwartet, laut Vorgabe des Timers"
        />
        <StatCard
          label="Sicherungen"
          value={sicherungen.length}
          hint={`${groesse(uebersicht.bytes)} belegt · Aufbewahrung ${zustand?.aufbewahrung ?? '–'}`}
        />
        <StatCard
          label="Letzte Integritätsprüfung"
          value={uebersicht.letztePruefung ? formatDateTime(uebersicht.letztePruefung) : 'noch keine'}
          tone={
            zustand?.letztePruefungStatus === 'bestanden'
              ? 'success'
              : zustand?.letztePruefungStatus === 'gescheitert'
                ? 'destructive'
                : 'warning'
          }
          hint={zustand?.letztePruefungMeldung ?? undefined}
        />
        <StatCard
          label="Letzter Restore-Test"
          value={
            uebersicht.letzterRestoreTest ? formatDateTime(uebersicht.letzterRestoreTest) : 'noch keiner'
          }
          tone={
            zustand?.letzterRestoreTestStatus === 'bestanden'
              ? 'success'
              : zustand?.letzterRestoreTestStatus === 'gescheitert'
                ? 'destructive'
                : 'warning'
          }
          hint={zustand?.letzterRestoreTestMeldung ?? undefined}
        />
        <StatCard
          label="Letzter Fehler"
          value={uebersicht.letzterFehlerAm ? formatDateTime(uebersicht.letzterFehlerAm) : 'keiner'}
          tone={uebersicht.letzterFehlerAm ? 'destructive' : 'success'}
          hint={zustand?.letzterFehler ?? undefined}
        />
        <StatCard
          label="Externer Speicher"
          value={externEingerichtet ? (zustand?.extern ?? 'eingerichtet') : 'nicht eingerichtet'}
          tone={externEingerichtet ? 'default' : 'warning'}
          hint={
            externEingerichtet
              ? (zustand?.externLetzterErfolg ?? undefined)
              : 'lokale Sicherungen allein überleben keinen Serververlust'
          }
        />
      </div>

      {befund.beanstandet.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              {befund.beanstandet.length}{' '}
              {befund.beanstandet.length === 1 ? 'Sicherung ist' : 'Sicherungen sind'} beanstandet
            </CardTitle>
            <CardDescription>
              Diese Sicherungen haben eine Prüfung nicht bestanden. Sie werden nicht automatisch entfernt -
              eine beanstandete Sicherung ist immer noch mehr als keine, und was ihr fehlt, steht daneben.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {befund.beanstandet.map((sicherung) => (
              <div key={sicherung.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="font-mono text-xs">{sicherung.id}</div>
                {sicherung.integritaet.status === 'gescheitert' ? (
                  <div className="mt-1 text-destructive">Integrität: {sicherung.integritaet.meldung}</div>
                ) : null}
                {sicherung.restoreTest.status === 'gescheitert' ? (
                  <div className="mt-1 text-destructive">Restore-Test: {sicherung.restoreTest.meldung}</div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {befund.keinRestoreTest ? (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-warning">
              <CircleSlash className="size-4" aria-hidden="true" />
              Keine dieser Sicherungen wurde je zurückgelesen
            </CardTitle>
            <CardDescription>
              Richtige Prüfsummen sagen nichts darüber, ob PostgreSQL den Export annimmt. Bis ein Restore-Test
              gelaufen ist, ist die Wiederherstellbarkeit eine Annahme:{' '}
              <code className="font-mono text-xs">sudo systemctl start swisshub-restore-test.service</code>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Backup-Historie</CardTitle>
          <CardDescription>
            Drei getrennte Zustände: erstellt, Integrität geprüft, Restore getestet. Sie werden bewusst nicht
            zu einem Haken zusammengefasst.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sicherungen.length > 0 ? (
            <SicherungsTabelle sicherungen={sicherungen} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Der Backup-Dienst hat geschrieben, aber es liegt keine Sicherung vor. Der letzte Lauf ist
              vermutlich gescheitert - siehe Kachel «Letzter Fehler» und{' '}
              <code className="font-mono text-xs">journalctl -u swisshub-backup.service</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-primary" aria-hidden="true" />
            Sichern und wiederherstellen
          </CardTitle>
          <CardDescription>
            Auf dem Server, nicht von hier. Diese Seite ist Auskunft - der Grund dafür steht darunter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
            {[
              '# Jetzt sichern',
              'sudo systemctl start swisshub-backup.service',
              '',
              '# Was liegt da?',
              'sudo /opt/swisshub/deploy/backup/bin/swisshub-recovery liste',
              '',
              '# Was ein Restore tun würde, bevor man ihn tut',
              'sudo /opt/swisshub/deploy/backup/bin/swisshub-recovery plan',
              '',
              '# Probe in einer Wegwerf-Datenbank (berührt die Produktion nicht)',
              'sudo /opt/swisshub/deploy/backup/bin/swisshub-recovery test',
            ].join('\n')}
          </pre>
          <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-2 text-muted-foreground">
              <p>
                <strong className="text-foreground">Warum keine Schaltflächen:</strong> die WebApp läuft als
                unprivilegierter Benutzer in einem Container ohne Docker-Socket und ohne Zugang zum
                Backup-Verzeichnis. Ein Knopf, der trotzdem ein Systembackup auslöst, bräuchte einen Weg aus
                dem Container heraus. Diesen Weg dauerhaft offen zu halten, wäre teurer als der Komfort, den
                er bringt.
              </p>
              <p>
                <strong className="text-foreground">Was ein Restore nicht mitbringt:</strong> die Geheimnisse.{' '}
                <code className="font-mono text-xs">MASTER_ENCRYPTION_KEY</code>,{' '}
                <code className="font-mono text-xs">AUTH_SECRET</code> und die Discord-Tokens liegen
                absichtlich in keiner Sicherung - neben dem Datenbankexport wären sie der Schlüssel zum
                Schloss am selben Bund. Sie gehören in eine Offline-Kopie, und wie das geht, steht in{' '}
                <code className="font-mono text-xs">deploy/backup/README.md</code>.
              </p>
            </div>
          </div>
          {sicherungen[0]?.schluesselFingerabdruck ? (
            <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
              Fingerabdruck des Hauptschlüssels der letzten Sicherung:
              <Badge variant="outline" className="font-mono">
                {sicherungen[0].schluesselFingerabdruck}
              </Badge>
              <span>
                – stimmt er mit der Offline-Kopie überein, passt der Schlüssel. Der Wert selbst steht
                nirgends.
              </span>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
