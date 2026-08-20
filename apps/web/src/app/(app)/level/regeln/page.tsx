import type { Metadata } from 'next';
import { level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { LevelSettingsSection } from '@/modules/level/components/settings-section';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – XP-Regeln' };
export const dynamic = 'force-dynamic';

/** XP für Nachrichten, Cooldowns, Boost und Channels ohne XP. */
export default async function LevelRulesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.settingsView);
  const csrfToken = csrfTokenFor(context);

  return (
    <>
      <PageHeader
        title="XP-Regeln"
        description="Wie viel XP eine Nachricht bringt, wie lange die Sperrfrist läuft und wo es gar keine XP gibt."
      />
      <LevelSectionNav sections={levelSections(context)} />
      <LevelSettingsSection
        context={context}
        csrfToken={csrfToken}
        groups={['XP für Nachrichten', 'Rollen', 'Level-Ups']}
      />
    </>
  );
}
