import 'server-only';
import { can } from '@swisshub/auth';
import { communication, getModuleHealth, type ModuleHealthCheck } from '@swisshub/modules';
import { discord } from '@swisshub/discord';
import type { AuthContext } from '@swisshub/auth';
import type { CommunicationSection } from '@/modules/communication/components/section-nav';

/**
 * Unterseiten des Kommunikationsmoduls.
 *
 * Einmal zentral definiert, damit alle Seiten dieselbe Bereichsnavigation
 * zeigen und nichts auseinanderläuft.
 */
export function communicationSections(context: AuthContext): CommunicationSection[] {
  const sections: CommunicationSection[] = [{ href: '/communication', label: 'Erstellen', icon: 'compose' }];

  if (can(context, communication.COMMUNICATION_PERMISSIONS.history)) {
    sections.push({
      href: '/communication/history',
      label: 'Gesendete Nachrichten',
      icon: 'history',
    });
  }
  if (
    can(context, communication.COMMUNICATION_PERMISSIONS.settingsManage) ||
    can(context, communication.COMMUNICATION_PERMISSIONS.manage)
  ) {
    sections.push({
      href: `/modules/${communication.COMMUNICATION_MODULE_ID}`,
      label: 'Einstellungen',
      icon: 'settings',
    });
  }

  return sections;
}

/**
 * Zustand des Kommunikationsmoduls für die Anzeige auf der Seite.
 *
 * Bewusst fehlertolerant: Ist Discord nicht erreichbar, wird das gemeldet -
 * die Seite öffnet sich trotzdem. Ein Modul, das sich wegen einer fehlenden
 * Einstellung nicht mehr aufrufen lässt, hilft niemandem.
 */
export async function communicationHealth(): Promise<{
  checks: ModuleHealthCheck[];
  discordReachable: boolean;
}> {
  const [reports, reachable] = await Promise.all([
    getModuleHealth().catch(() => []),
    discord.guild
      .get()
      .then(() => true)
      .catch(() => false),
  ]);

  const report = reports.find((entry) => entry.moduleId === communication.COMMUNICATION_MODULE_ID);
  return { checks: report?.checks ?? [], discordReachable: reachable };
}
