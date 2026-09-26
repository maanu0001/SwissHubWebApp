import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@swisshub/shared';
import type { BackupManifest, Pruefstatus } from '@swisshub/modules/backup/manifest';

/**
 * Die Backup-Historie.
 *
 * Eine Zeile je Sicherung, und drei Spalten, die nicht zusammengefasst werden
 * duerfen: erstellt, Integritaet geprueft, Restore getestet. Ein einziges
 * gruenes Haekchen fuer alle drei waere die bequemere Darstellung und die
 * falsche - eine Sicherung mit richtiger Pruefsumme, die PostgreSQL nicht
 * annimmt, saehe darin aus wie eine, die schon einmal zurueckgelesen wurde.
 *
 * Kein Herunterladen, kein Wiederherstellen, keine Schaltflaeche. Die WebApp
 * sieht die Dateien nicht - sie liest ausschliesslich die Manifeste. Was zu tun
 * ist, steht darunter als Befehl fuer die CLI.
 */

/** Byte in etwas Lesbares. */
function groesse(bytes: number): string {
  if (bytes <= 0) {
    return '0 B';
  }
  const einheiten = ['B', 'KB', 'MB', 'GB', 'TB'];
  const stufe = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), einheiten.length - 1);
  const wert = bytes / 1024 ** stufe;
  return `${wert.toFixed(stufe === 0 ? 0 : 1)} ${einheiten[stufe]}`;
}

const STATUS_TEXT: Record<Pruefstatus, string> = {
  ungeprueft: 'ungeprüft',
  bestanden: 'bestanden',
  gescheitert: 'gescheitert',
};

function PruefBadge({ status, titel }: { status: Pruefstatus; titel?: string }): React.JSX.Element {
  const variante = status === 'bestanden' ? 'success' : status === 'gescheitert' ? 'destructive' : 'outline';
  return (
    <Badge variant={variante} title={titel ?? undefined}>
      {STATUS_TEXT[status]}
    </Badge>
  );
}

export function SicherungsTabelle({ sicherungen }: { sicherungen: BackupManifest[] }): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Erstellt</TableHead>
          <TableHead>Komponenten</TableHead>
          <TableHead className="text-right">Grösse</TableHead>
          <TableHead>Integrität</TableHead>
          <TableHead>Restore-Test</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sicherungen.map((sicherung) => (
          <TableRow key={sicherung.id}>
            <TableCell className="whitespace-nowrap">
              <div className="font-medium">{formatDateTime(new Date(sicherung.erstelltAm))}</div>
              <div className="font-mono text-xs text-muted-foreground">{sicherung.id}</div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {sicherung.komponenten.map((teil) => (
                  <Badge key={teil} variant="outline" className="font-normal">
                    {teil}
                  </Badge>
                ))}
              </div>
              {sicherung.postgresVersion ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  PostgreSQL {sicherung.postgresVersion}
                </div>
              ) : null}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">
              {groesse(sicherung.bytesGesamt)}
            </TableCell>
            <TableCell>
              <PruefBadge
                status={sicherung.integritaet.status}
                titel={sicherung.integritaet.meldung ?? undefined}
              />
              {sicherung.integritaet.am ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(new Date(sicherung.integritaet.am))}
                </div>
              ) : null}
            </TableCell>
            <TableCell>
              <PruefBadge
                status={sicherung.restoreTest.status}
                titel={sicherung.restoreTest.meldung ?? undefined}
              />
              {sicherung.restoreTest.meldung && sicherung.restoreTest.status === 'bestanden' ? (
                <div className="mt-1 text-xs text-muted-foreground">{sicherung.restoreTest.meldung}</div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export { groesse };
