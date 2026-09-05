import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, CircleDot, MinusCircle, XCircle } from 'lucide-react';
import { jail } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/states';
import { ImportConfirmStep, ImportUploadStep } from '@/modules/jail/components/import-wizard';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import type { JailImportRow, JailImportRowAction } from '@swisshub/database';
import { ModerationSectionNav } from '@/modules/moderation/components/section-nav';
import { moderationSections } from '@/server/moderation';

export const metadata: Metadata = { title: 'Jail-Import' };
export const dynamic = 'force-dynamic';

/** Beschriftung und Erklärung je Entscheidung des Assistenten. */
const ACTION_LABEL: Record<JailImportRowAction, { label: string; tone: string; hint: string }> = {
  IMPORT: { label: 'Wird übernommen', tone: 'text-success', hint: 'Wird als aktiver Jail angelegt.' },
  SKIP_DUPLICATE: {
    label: 'Bereits vorhanden',
    tone: 'text-muted-foreground',
    hint: 'Wurde in einem früheren Durchgang schon übernommen.',
  },
  SKIP_RELEASED: {
    label: 'Schon beendet',
    tone: 'text-muted-foreground',
    hint: 'Die Strafe war in der alten Datenbank bereits abgeschlossen.',
  },
  SKIP_INVALID: {
    label: 'Unlesbar',
    tone: 'text-destructive',
    hint: 'Pflichtangaben fehlen oder sind beschädigt.',
  },
  CONFLICT: {
    label: 'Konflikt',
    tone: 'text-warning',
    hint: 'Für dieses Mitglied läuft hier bereits ein Jail.',
  },
};

/**
 * Assistent für die Übernahme der alten Jail-Datenbank.
 *
 * Der Ablauf ist bewusst zweistufig und jederzeit abbrechbar:
 * Hochladen → Analysieren → Vorschau prüfen → bestätigen → übernehmen →
 * abgleichen. Bis zur Bestätigung wird nichts angelegt.
 */
export default async function JailImportPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(jail.JAIL_PERMISSIONS.import);
  const csrfToken = csrfTokenFor(context);
  const params = await searchParams;

  const current = params.id
    ? await jail.getImport(params.id, { limit: 200 })
    : await (async () => {
        const pending = await jail.getPendingImport();
        return pending ? jail.getImport(pending.id, { limit: 200 }) : null;
      })();

  const history = await jail.listImports(10);

  return (
    <>
      <ModerationSectionNav sections={moderationSections(context)} />
      {current === null || current.status === 'CANCELLED' ? (
        <ImportUploadStep csrfToken={csrfToken} maxBytes={jail.MAX_LEGACY_DB_BYTES} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Analyse</CardTitle>
              <CardDescription>
                {current.fileName} · {(current.fileBytes / 1024).toFixed(0)} KB · gelesen am{' '}
                {formatDateTime(current.createdAt)} von {current.uploadedByUsername}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Figure label="Zeilen gesamt" value={current.totalRows} icon={<CircleDot />} />
                <Figure
                  label="Werden übernommen"
                  value={current.importableRows}
                  icon={<CheckCircle2 />}
                  tone="text-success"
                />
                <Figure
                  label="Bereits vorhanden"
                  value={current.duplicateRows}
                  icon={<MinusCircle />}
                  tone="text-muted-foreground"
                />
                <Figure
                  label="Konflikte"
                  value={current.conflictRows}
                  icon={<XCircle />}
                  tone={current.conflictRows > 0 ? 'text-warning' : 'text-muted-foreground'}
                />
                <Figure
                  label="Unlesbar"
                  value={current.invalidRows}
                  icon={<XCircle />}
                  tone={current.invalidRows > 0 ? 'text-destructive' : 'text-muted-foreground'}
                />
              </dl>

              <SchemaSummary schemaInfo={current.schemaInfo} />
            </CardContent>
          </Card>

          {current.status === 'COMPLETED' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  Übernahme abgeschlossen
                </CardTitle>
                <CardDescription>
                  {current.importedRows} Einträge übernommen
                  {current.reconciledAt ? ' und mit Discord abgeglichen' : ''}. Die Jails erscheinen jetzt in
                  der{' '}
                  <Link href="/moderation/jail" className="underline">
                    Jail-Übersicht
                  </Link>
                  .
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ImportConfirmStep
              csrfToken={csrfToken}
              importId={current.id}
              importableRows={current.importableRows}
              conflictRows={current.conflictRows}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Vorschau</CardTitle>
              <CardDescription>
                Jede Zeile der alten Datenbank mit der Entscheidung des Assistenten. Es werden maximal 200
                Zeilen angezeigt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {current.rows.length === 0 ? (
                <EmptyState title="Keine Zeilen" description="Die Datei enthält keine Jail-Einträge." />
              ) : (
                <DataTable
                  rows={current.rows}
                  getRowKey={(row: JailImportRow) => row.id}
                  columns={[
                    {
                      key: 'member',
                      header: 'Mitglied',
                      render: (row: JailImportRow) => (
                        <Link href={`/members/${row.targetDiscordId}`} className="hover:underline">
                          <span className="font-mono text-xs">{row.targetDiscordId}</span>
                        </Link>
                      ),
                    },
                    {
                      key: 'duration',
                      header: 'Dauer',
                      render: (row: JailImportRow) =>
                        row.permanent ? (
                          <Badge variant="outline">Permanent</Badge>
                        ) : (
                          <span className="text-xs">
                            {row.endsAt ? formatDateTime(row.endsAt) : 'unbekannt'}
                          </span>
                        ),
                    },
                    {
                      key: 'started',
                      header: 'Seit',
                      render: (row: JailImportRow) => (
                        <span className="text-xs text-muted-foreground">
                          {row.startedAt ? formatDateTime(row.startedAt) : 'unbekannt'}
                        </span>
                      ),
                    },
                    {
                      key: 'roles',
                      header: 'Rollen',
                      render: (row: JailImportRow) => (
                        <span className="text-xs text-muted-foreground">{row.roleIds.length}</span>
                      ),
                    },
                    {
                      key: 'reason',
                      header: 'Grund',
                      render: (row: JailImportRow) => (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {row.reason ?? '—'}
                        </span>
                      ),
                    },
                    {
                      key: 'action',
                      header: 'Entscheidung',
                      render: (row: JailImportRow) => (
                        <span className="flex flex-col leading-tight">
                          <span className={`text-xs font-medium ${ACTION_LABEL[row.action].tone}`}>
                            {ACTION_LABEL[row.action].label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.note ?? ACTION_LABEL[row.action].hint}
                          </span>
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Frühere Durchgänge</CardTitle>
            <CardDescription>
              Ein wiederholter Import legt nichts doppelt an - bereits übernommene Zeilen werden erkannt.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/moderation/jail/import?id=${entry.id}`} className="hover:underline">
                    {formatDateTime(entry.createdAt)} · {entry.fileName}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {entry.status === 'COMPLETED'
                      ? `${entry.importedRows} übernommen`
                      : entry.status === 'CANCELLED'
                        ? 'verworfen'
                        : entry.status === 'FAILED'
                          ? 'fehlgeschlagen'
                          : 'analysiert'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function Figure({
  label,
  value,
  icon,
  tone = 'text-foreground',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-4 py-3">
      <dt className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span className={`[&_svg]:size-3.5 ${tone}`}>{icon}</span>
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}

/** Zeigt, welche Tabellen und Spalten in der Datei gefunden wurden. */
function SchemaSummary({ schemaInfo }: { schemaInfo: unknown }): React.JSX.Element | null {
  const info = schemaInfo as {
    tables?: Array<{ table: string; columns: string[]; rows: number }>;
    activeVotes?: number;
    cooldowns?: Array<unknown>;
  } | null;

  if (!info?.tables?.length) {
    return null;
  }

  return (
    <div className="mt-6 space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
      <p className="font-medium">Gefundene Tabellen</p>
      <ul className="space-y-1 text-muted-foreground">
        {info.tables.map((table) => (
          <li key={table.table}>
            <span className="font-mono">{table.table}</span> · {table.rows} Zeilen ·{' '}
            {table.columns.join(', ')}
          </li>
        ))}
      </ul>
      {info.activeVotes && info.activeVotes > 0 ? (
        <p className="text-muted-foreground">
          {info.activeVotes} laufende Abstimmung(en) werden nicht übernommen - die zugehörigen
          Discord-Nachrichten gehören dem alten Bot und wären nach dessen Stopp wirkungslos.
        </p>
      ) : null}
      {Array.isArray(info.cooldowns) && info.cooldowns.length > 0 ? (
        <p className="text-muted-foreground">
          {info.cooldowns.length} laufende Vote-Sperrfrist(en) werden übernommen.
        </p>
      ) : null}
    </div>
  );
}
