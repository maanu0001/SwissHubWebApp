import 'server-only';
import { can } from '@swisshub/auth';
import { communication } from '@swisshub/modules';
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
  if (can(context, communication.COMMUNICATION_PERMISSIONS.manage)) {
    sections.push({
      href: `/modules/${communication.COMMUNICATION_MODULE_ID}`,
      label: 'Einstellungen',
      icon: 'settings',
    });
  }

  return sections;
}
