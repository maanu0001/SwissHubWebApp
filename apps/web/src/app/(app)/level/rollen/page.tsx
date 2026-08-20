import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { isModuleEnabled, level } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { LevelSectionNav } from '@/modules/level/components/section-nav';
import { MilestoneEditor, type MilestoneView } from '@/modules/level/components/milestone-editor';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { levelSections } from '@/server/level';

export const metadata: Metadata = { title: 'Level – Rollen' };
export const dynamic = 'force-dynamic';

/** Zuordnung von Leveln zu Discord-Rollen. */
export default async function LevelRolesPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(level.LEVEL_PERMISSIONS.rolesView);
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

  const [milestones, options] = await Promise.all([level.listMilestones(), loadDiscordOptions()]);
  const byId = new Map(options.roles.map((role) => [role.id, role]));

  const views: MilestoneView[] = milestones.map((entry) => {
    const role = byId.get(entry.roleId);
    return {
      level: entry.level,
      roleId: entry.roleId,
      enabled: entry.enabled,
      roleName: role ? role.name : null,
      manageable: role?.manageable ?? false,
    };
  });

  return (
    <>
      <PageHeader
        title="Level & Rollen"
        description="Wer ein Level erreicht, bekommt die zugehörige Rolle - wer darunter fällt, verliert sie wieder."
      />
      {sections}

      <MilestoneEditor
        csrfToken={csrfToken}
        milestones={views}
        roles={options.roles}
        canManage={can(context, level.LEVEL_PERMISSIONS.rolesManage)}
      />

      <p className="text-xs text-muted-foreground">
        Der Bot zieht Rollen bei jeder XP-Änderung nach. Wer seither keine XP mehr gesammelt hat,
        bekommt eine neu eingerichtete Rolle erst über &quot;Alle abgleichen&quot;.
      </p>
    </>
  );
}
