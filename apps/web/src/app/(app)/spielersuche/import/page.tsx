import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, CircleDot, MinusCircle, ServerOff, XCircle } from 'lucide-react';
import { spielersuche } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/states';
import { ImportConfirmStep, ImportUploadStep } from '@/modules/spielersuche/components/import-wizard';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { spielersucheSections } from '@/server/spielersuche';
import type { SpielersucheImportItem } from '@swisshub/database';

export const metadata: Metadata = { title: 'Spielersuche-Import' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  SETTINGS: 'Konfiguration',
  GAME: 'Spiel',
  MATCH: 'Suche',
  PARTICIPANT: 'Teilnahme',
  USAGE: 'Nutzung',
  VOICE_SESSION: 'Voice-Zeit',
  ROLE_PING: 'Rollen-Ping',
};

const ACTION_LABEL: Record<string, { label: string; tone: string }> = {
  IMPORT: { label: 'Wird übernommen', tone: 'text-success' },
  SKIP_DUPLICATE: { label: 'Bereits vorhanden', tone: 'text-muted-foreground' },
  SKIP_INVALID: { label: 'Unlesbar', tone: 'text-destructive' },
  SKIP_OTHER_GUILD: { label: 'Anderer Server', tone: 'text-muted-foreground' },
  CONFLICT: { label: 'Konflikt', tone: 'text-warning' },
};

/**
 * Assistent für die Übernahme der alten Spielersuche-Datenbank.
 *
 * Hochladen → analysieren → Vorschau prüfen → bestätigen → übernehmen.
 * Bis zur Bestätigung entsteht kein einziger Datensatz im Modul.
 */
export default async function SpielersucheImportPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.import);
  const csrfToken = csrfTokenFor(context);
  const params = await searchParams;

  const current = params.id
    ? await spielersuche.getImport(params.id, { limit: 300 })
    : await (async () => {
        const pending = await spielersuche.getPendingImport();
        return pending ? spielersuche.getImport(pending.id, { limit: 300 }) : null;
      })();

  const [breakdown, history] = await Promise.all([
    current ? spielersuche.getImportBreakdown(current.id) : Promise.resolve([]),
    spielersuche.listImports(10),
  ]);

  const sections = <SpielersucheSectionNav sections={spielersucheSections(context)} />;

  return (
    <>
      <PageHeader
        title="Alte Spielersuche übernehmen"
        description="Einmalige Übernahme der Daten des früheren Spielersuche-Bots. Die Datei wird nur gelesen; bestehende Daten werden nie überschrieben."
      />
      {sections}

      {current === null || current.status === 'CANCELLED' ? (
        <ImportUploadStep csrfToken={csrfToken} maxBytes={spielersuche.MAX_LEGACY_DB_BYTES} />
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
            <CardContent className="space-y-6">
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
                  label="Anderer Server"
                  value={current.otherGuildRows}
                  icon={<ServerOff />}
                  tone="text-muted-foreground"
                />
                <Figure
                  label="Unlesbar / Konflikt"
                  value={current.invalidRows + current.conflictRows}
                  icon={<XCircle />}
                  tone={
                    current.invalidRows + current.conflictRows > 0 ? 'text-warning' : 'text-muted-foreground'
                  }
                />
              </dl>

              <GuildSummary schemaInfo={current.schemaInfo} selected={current.sourceGuildId} />

              {breakdown.length > 0 ? (
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-xs">
                  <p className="mb-2 font-medium">Nach Datenart</p>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {Object.entries(
                      breakdown.reduce<Record<string, Record<string, number>>>((groups, row) => {
                        groups[row.kind] = groups[row.kind] ?? {};
                        groups[row.kind]![row.action] = row.count;
                        return groups;
                      }, {}),
                    ).map(([kind, actions]) => (
                      <li key={kind} className="text-muted-foreground">
                        <span className="font-medium text-foreground">{KIND_LABEL[kind] ?? kind}</span>
                        {': '}
                        {Object.entries(actions)
                          .map(([action, count]) => `${count}× ${ACTION_LABEL[action]?.label ?? action}`)
                          .join(' · ')}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
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
                  {current.importedRows} Zeilen übernommen. Die Spiele stehen jetzt in{' '}
                  <Link href="/spielersuche/spiele" className="underline">
                    Spiele
                  </Link>{' '}
                  und der Verlauf unter{' '}
                  <Link href="/spielersuche/verlauf" className="underline">
                    Verlauf
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
                Jede gelesene Zeile mit der Entscheidung des Assistenten - maximal 300 Zeilen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {current.items.length === 0 ? (
                <EmptyState title="Keine Zeilen" description="Die Datei enthält keine Daten." />
              ) : (
                <DataTable
                  rows={current.items}
                  getRowKey={(item: SpielersucheImportItem) => item.id}
                  columns={[
                    {
                      key: 'kind',
                      header: 'Art',
                      render: (item: SpielersucheImportItem) => (
                        <span className="text-xs text-muted-foreground">
                          {KIND_LABEL[item.kind] ?? item.kind}
                        </span>
                      ),
                    },
                    {
                      key: 'label',
                      header: 'Eintrag',
                      render: (item: SpielersucheImportItem) => <span className="text-sm">{item.label}</span>,
                    },
                    {
                      key: 'action',
                      header: 'Entscheidung',
                      render: (item: SpielersucheImportItem) => (
                        <span className="flex flex-col leading-tight">
                          <span className={`text-xs font-medium ${ACTION_LABEL[item.action]?.tone ?? ''}`}>
                            {ACTION_LABEL[item.action]?.label ?? item.action}
                          </span>
                          {item.note ? (
                            <span className="text-xs text-muted-foreground">{item.note}</span>
                          ) : null}
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
                  <Link href={`/spielersuche/import?id=${entry.id}`} className="hover:underline">
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

/**
 * Zeigt die Server, die in der Datei vorkommen.
 *
 * Die Altdatenbank kann Test- und Produktivserver enthalten; übernommen wird
 * genau einer.
 */
function GuildSummary({
  schemaInfo,
  selected,
}: {
  schemaInfo: unknown;
  selected: string | null;
}): React.JSX.Element | null {
  const info = schemaInfo as {
    guilds?: Array<{ guildId: string; games: number; matches: number; usages: number }>;
    tables?: Array<{ table: string; rows: number }>;
  } | null;

  if (!info?.guilds?.length) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3 text-xs">
      <p className="font-medium">Server in der Datei</p>
      <ul className="space-y-1 text-muted-foreground">
        {info.guilds.map((guild) => (
          <li key={guild.guildId}>
            <span className="font-mono">{guild.guildId}</span> · {guild.games} Spiele · {guild.matches} Suchen
            · {guild.usages} Nutzungen
            {guild.guildId === selected ? (
              <span className="ml-2 font-medium text-success">wird übernommen</span>
            ) : (
              <span className="ml-2">wird übersprungen</span>
            )}
          </li>
        ))}
      </ul>
      {info.tables?.length ? (
        <p className="text-muted-foreground">
          Tabellen: {info.tables.map((table) => `${table.table} (${table.rows})`).join(', ')}
        </p>
      ) : null}
    </div>
  );
}
