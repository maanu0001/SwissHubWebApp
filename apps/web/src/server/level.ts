import 'server-only';
import { can } from '@swisshub/auth';
import { level } from '@swisshub/modules';
import type { AuthContext } from '@swisshub/auth';
import type { LevelSection } from '@/modules/level/components/section-nav';

/**
 * Unterseiten des Level-Moduls.
 *
 * Einmal zentral definiert, damit alle Seiten dieselbe Bereichsnavigation
 * zeigen und nichts auseinanderläuft.
 */
export function levelSections(context: AuthContext): LevelSection[] {
  const permissions = level.LEVEL_PERMISSIONS;
  const sections: LevelSection[] = [{ href: '/level', label: 'Übersicht', icon: 'overview' }];

  if (can(context, permissions.membersView)) {
    sections.push({ href: '/level/mitglieder', label: 'Mitglieder', icon: 'members' });
  }
  if (can(context, permissions.leaderboardView)) {
    sections.push({ href: '/level/rangliste', label: 'Rangliste', icon: 'leaderboard' });
  }
  if (can(context, permissions.gamesView)) {
    sections.push({ href: '/level/spiele', label: 'XP-Spiele', icon: 'games' });
  }
  if (can(context, permissions.raffleView)) {
    sections.push({ href: '/level/gluecksrad', label: 'XP-Glücksrad', icon: 'raffle' });
  }
  if (can(context, permissions.rolesView)) {
    sections.push({ href: '/level/rollen', label: 'Level & Rollen', icon: 'roles' });
  }
  if (can(context, permissions.settingsView)) {
    sections.push(
      { href: '/level/regeln', label: 'XP-Regeln', icon: 'rules' },
      { href: '/level/voice', label: 'Voice XP', icon: 'voice' },
      { href: '/level/karte', label: 'Levelkarte', icon: 'card' },
    );
  }
  if (can(context, permissions.decayManage) || can(context, permissions.settingsView)) {
    sections.push({ href: '/level/inaktivitaet', label: 'Inaktivität', icon: 'decay' });
  }
  if (can(context, permissions.statsView)) {
    sections.push({ href: '/level/statistiken', label: 'Statistiken', icon: 'stats' });
  }
  if (can(context, permissions.import)) {
    sections.push({ href: '/level/import', label: 'Import', icon: 'import' });
  }
  if (can(context, permissions.settingsView)) {
    sections.push({
      href: `/modules/${level.LEVEL_MODULE_ID}`,
      label: 'Einstellungen',
      icon: 'settings',
    });
  }

  return sections;
}
