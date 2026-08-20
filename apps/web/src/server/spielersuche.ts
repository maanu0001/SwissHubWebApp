import 'server-only';
import { can } from '@swisshub/auth';
import { spielersuche } from '@swisshub/modules';
import type { AuthContext } from '@swisshub/auth';
import type { SpielersucheSection } from '@/modules/spielersuche/components/section-nav';

/**
 * Unterseiten des Spielersuche-Moduls.
 *
 * Einmal zentral definiert, damit alle Seiten dieselbe Bereichsnavigation
 * zeigen und nichts auseinanderläuft.
 */
export function spielersucheSections(context: AuthContext): SpielersucheSection[] {
  const permissions = spielersuche.SPIELERSUCHE_PERMISSIONS;
  const sections: SpielersucheSection[] = [
    { href: '/spielersuche', label: 'Übersicht', icon: 'overview' },
    { href: '/spielersuche/aktiv', label: 'Aktive Suchen', icon: 'active' },
  ];

  if (can(context, permissions.create)) {
    sections.push({ href: '/spielersuche/neu', label: 'Neue Suche', icon: 'new' });
  }
  if (can(context, permissions.gamesView)) {
    sections.push({ href: '/spielersuche/spiele', label: 'Spiele', icon: 'games' });
  }
  sections.push({ href: '/spielersuche/verlauf', label: 'Verlauf', icon: 'history' });

  if (can(context, permissions.statsViewOwn) || can(context, permissions.statsViewAll)) {
    sections.push({ href: '/spielersuche/statistiken', label: 'Statistiken', icon: 'stats' });
  }
  if (can(context, permissions.onboardingManage)) {
    sections.push({ href: '/spielersuche/onboarding', label: 'Onboarding', icon: 'onboarding' });
  }
  if (can(context, permissions.import)) {
    sections.push({ href: '/spielersuche/import', label: 'Import', icon: 'import' });
  }
  if (can(context, permissions.settingsView)) {
    sections.push({
      href: `/modules/${spielersuche.SPIELERSUCHE_MODULE_ID}`,
      label: 'Einstellungen',
      icon: 'settings',
    });
  }

  return sections;
}
