import type { Metadata } from 'next';
import { level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { LevelSettingsSection } from '@/modules/level/components/settings-section';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Voice XP' };
export const dynamic = 'force-dynamic';

/** XP für Zeit im Sprachkanal, Multiplikatoren und Stummschaltung. */
export default async function LevelVoicePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.settingsView);
  const csrfToken = csrfTokenFor(context);

  return (
    <>
      <PageHeader
        title="Voice XP"
        description="XP für Zeit im Sprachkanal - inklusive der Regeln für Stummschaltung und Alleinsein."
      />
      <LevelSectionNav sections={levelSections(context)} />
      <LevelSettingsSection context={context} csrfToken={csrfToken} groups={['XP für Voice']} />
    </>
  );
}
