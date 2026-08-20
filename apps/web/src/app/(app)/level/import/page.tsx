import type { Metadata } from 'next';
import { level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import {
  LevelEnvImport,
  LevelImportConfirm,
  LevelImportUpload,
  type ImportSummary,
} from '@/modules/level/components/import-wizard';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Import' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  ANALYSED: 'Analysiert',
  CONFIRMED: 'Bestätigt',
  IMPORTED: 'Übernommen',
  FAILED: 'Fehlgeschlagen',
};

/** Übernahme der Altdaten aus `levels.db` und optional aus der alten `.env`. */
export default async function LevelImportPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.import);
  const csrfToken = csrfTokenFor(context);
  const params = await searchParams;

  const pending = params.id ? await level.getLevelImport(params.id) : null;
  const history = await level.listLevelImports(10);

  let summary: ImportSummary | null = null;
  if (pending && pending.status === 'ANALYSED') {
    summary = {
      importId: pending.id,
      fileName: pending.fileName,
      counts: {
        total: pending.totalRows,
        importable: pending.importableRows,
        duplicate: pending.duplicateRows,
        invalid: pending.conflictRows,
        empty: pending.invalidRows,
      },
      totalXp: pending.items
        .filter((item) => item.action === 'IMPORT' && item.kind === 'PROFILE')
        .reduce((sum, item) => sum + Number((item.payload as { xp?: number }).xp ?? 0), 0),
      highestLevel: pending.items
        .filter((item) => item.kind === 'PROFILE')
        .reduce(
          (best, item) =>
            Math.max(best, level.levelFromXp(Number((item.payload as { xp?: number }).xp ?? 0))),
          1,
        ),
      rows: pending.items.map((item) => ({
        legacyKey: item.legacyKey,
        label: item.label,
        action: item.action,
        note: item.note,
        kind: item.kind,
      })),
    };
  }

  return (
    <>
      <PageHeader
        title="Altdaten übernehmen"
        description="XP-Stände aus der alten levels.db übernehmen - exakt so, wie sie dort stehen."
      />
      <LevelSectionNav sections={levelSections(context)} />

      {summary ? (
        <LevelImportConfirm csrfToken={csrfToken} summary={summary} />
      ) : (
        <LevelImportUpload csrfToken={csrfToken} maxBytes={level.MAX_LEGACY_DB_BYTES} />
      )}

      <LevelEnvImport csrfToken={csrfToken} />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Bisherige Übernahmen</h3>
        <DataTable
          caption="Verlauf der Übernahmen"
          rows={history}
          getRowKey={(row) => row.id}
          emptyTitle="Noch keine Übernahme"
          emptyDescription="Es wurde bisher keine levels.db eingelesen."
          columns={[
            {
              key: 'file',
              header: 'Datei',
              render: (row) => (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.fileName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.fileSha256.slice(0, 16)}…
                  </p>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Stand',
              render: (row) => <Badge variant="secondary">{STATUS_LABELS[row.status] ?? row.status}</Badge>,
            },
            {
              key: 'rows',
              header: 'Einträge',
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {row.importedRows} übernommen · {row.duplicateRows} Duplikate · {row.failedRows} Fehler
                </span>
              ),
            },
            {
              key: 'created',
              header: 'Zeitpunkt',
              render: (row) => (
                <span className="text-xs text-muted-foreground">
                  {(row.finishedAt ?? row.createdAt).toLocaleString('de-CH')}
                </span>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}
