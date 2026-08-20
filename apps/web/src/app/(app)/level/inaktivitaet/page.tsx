import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { StatCard } from '@/components/shared/stat-card';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { LevelSettingsSection } from '@/modules/level/components/settings-section';
import { DecayRunner } from '@/modules/level/components/decay-runner';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Inaktivität' };
export const dynamic = 'force-dynamic';

/**
 * Inaktivitäts-Abzug: Einstellungen und eine Vorschau, wen der nächste
 * Durchgang trifft.
 */
export default async function LevelDecayPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.settingsView);
  const csrfToken = csrfTokenFor(context);
  const sections = <LevelSectionNav sections={levelSections(context)} />;

  if (!(await isModuleEnabled(level.LEVEL_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState title="Modul deaktiviert" description="Das Level-System ist derzeit deaktiviert." />
      </>
    );
  }

  const settings = await level.readLevelSettings();
  const decayRules = level.decayRulesFrom(settings);
  const preview = settings.decayEnabled
    ? await level.previewDecay({ decayRules, limit: 50, maxLevelTotalXp: settings.maxLevelTotalXp })
    : [];

  const pendingXp = preview.reduce((sum, entry) => sum + entry.pendingDecay, 0);
  const canRun = can(context, level.LEVEL_PERMISSIONS.decayManage);

  return (
    <>
      <PageHeader
        title="Inaktivität"
        description="Wer lange nichts schreibt und nicht im Voice ist, verliert täglich XP."
        actions={canRun && settings.decayEnabled ? <DecayRunner csrfToken={csrfToken} /> : undefined}
      />
      {sections}

      {!settings.decayEnabled ? (
        <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
          Der Inaktivitäts-Abzug ist abgeschaltet. Es wird niemandem XP abgezogen.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Betroffen"
            value={preview.length}
            hint={`Schonfrist ${settings.decayGraceDays} Tage`}
          />
          <StatCard
            label="Fällige XP"
            value={level.formatXp(pendingXp)}
            hint="Beim nächsten Durchgang"
            tone={pendingXp > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Abzug pro Tag"
            value={`${settings.decayDay1To4} / ${settings.decayDay5Plus}`}
            hint="Tag 1 bis 4 / ab Tag 5"
          />
        </div>
      )}

      {settings.decayEnabled ? (
        <DataTable
          caption="Vorschau des nächsten Abzugs"
          rows={preview}
          getRowKey={(row) => row.discordId}
          emptyTitle="Niemand im Abzug"
          emptyDescription="Alle sind innerhalb der Schonfrist aktiv gewesen."
          columns={[
            {
              key: 'member',
              header: 'Mitglied',
              render: (row) => (
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.displayName ?? row.username ?? row.discordId}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{row.discordId}</p>
                </div>
              ),
            },
            {
              key: 'inactive',
              header: 'Inaktiv seit',
              render: (row) => (
                <span className="tabular-nums text-sm">
                  {row.inactiveDays} {row.inactiveDays === 1 ? 'Tag' : 'Tagen'}
                </span>
              ),
            },
            {
              key: 'xp',
              header: 'XP',
              render: (row) => (
                <span className="tabular-nums">
                  {level.formatXp(row.xp)} → {level.formatXp(row.xp - row.pendingDecay)}
                </span>
              ),
            },
            {
              key: 'pending',
              header: 'Abzug',
              render: (row) => (
                <span className="tabular-nums text-destructive">−{level.formatXp(row.pendingDecay)}</span>
              ),
            },
            {
              key: 'level',
              header: 'Level',
              render: (row) =>
                row.levelAfter < row.level ? (
                  <Badge variant="secondary">
                    {row.level} → {row.levelAfter}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{row.level}</Badge>
                ),
            },
          ]}
        />
      ) : null}

      <LevelSettingsSection context={context} csrfToken={csrfToken} groups={['Inaktivität']} />
    </>
  );
}
