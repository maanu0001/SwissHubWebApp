import { z } from 'zod';
import { CORE_PERMISSIONS, MEMBER_CENTER_PERMISSIONS } from '@swisshub/permissions';
import { MODERATION_CENTER_PERMISSIONS } from './moderation/permissions';
import { STANDARD_REASON_TEMPLATES } from './moderation/reasons';
import type { SettingsField } from './settings/fields';
import { registerModule } from './registry';

/**
 * Einstellungen der Moderation.
 *
 * Bisher hatte das Modul keine - der Reiter «Einstellungen» führte auf eine
 * leere Seite. Was hier steht, sind die Gründe: die Vorgaben lassen sich
 * ergänzen und einzelne ausblenden, und beides an genau einer Stelle für alle
 * Massnahmen. Das Jail-Modul führte dafür einmal eine eigene Liste; sie ist
 * hier aufgegangen, weil Jail inzwischen eine Massnahme der Moderation ist.
 */
const moderationSettingsSchema = z.object({
  /** Eigene Gründe, eine Zeile je Grund. Leer heisst: nur die Vorgaben. */
  reasonTemplates: z.string().max(2000).default(''),
  /**
   * Vorgaben, die dieser Server nicht anbietet - je Kennung eine Zeile.
   *
   * Ausblenden statt loeschen: die Vorgaben stehen im Code, und ein Server,
   * der «Voice-Verhalten» nicht braucht, soll deswegen nicht die ganze Liste
   * abschreiben muessen.
   */
  disabledReasonTemplates: z.string().max(1000).default(''),
});

const moderationSettingsFields: SettingsField[] = [
  {
    key: 'reasonTemplates',
    label: 'Eigene Gründe',
    description:
      'Eine Zeile je Grund. Sie erscheinen zusätzlich zu den Vorgaben als Schnellauswahl bei jeder Massnahme. Der Text lässt sich danach im Formular weiter anpassen.',
    type: 'textarea',
    group: 'Gründe',
  },
  {
    key: 'disabledReasonTemplates',
    label: 'Vorgaben ausblenden',
    description: `Je Zeile eine Kennung. Verfügbar: ${STANDARD_REASON_TEMPLATES.map(
      (vorlage) => vorlage.id,
    ).join(', ')}.`,
    type: 'textarea',
    group: 'Gründe',
  },
];

/**
 * Kernbereiche der Anwendung.
 *
 * Sie werden über dieselbe Registry geführt wie Feature-Module, damit
 * Navigation und Berechtigungen einheitlich generiert werden. Kernbereiche
 * lassen sich nicht deaktivieren.
 */
const corePermission = (key: string) => CORE_PERMISSIONS.filter((entry) => entry.key === key);

registerModule({
  id: 'dashboard',
  name: 'Dashboard',
  description: 'Überblick über Bot-Status, Kennzahlen und die letzten Aktionen.',
  icon: 'LayoutDashboard',
  permissionPrefix: 'dashboard',
  core: true,
  defaultEnabled: true,
  permissions: corePermission('dashboard.view'),
  navigation: [
    {
      href: '/dashboard',
      label: 'Dashboard',
      description: 'Übersicht über deinen Server und Bot-Aktivitäten',
      permission: 'dashboard.view',
      icon: 'House',
      group: 'overview',
      order: 10,
    },
  ],
});

registerModule({
  id: 'members',
  name: 'Mitglieder',
  description: 'Mitglieder suchen, Rollen und Moderationsstatus einsehen.',
  icon: 'Users',
  permissionPrefix: 'members',
  core: true,
  defaultEnabled: true,
  // `members.view` oeffnet den Bereich und die Suche - unveraendert. Die
  // granularen Berechtigungen daneben entscheiden, welche Abschnitte eines
  // Profils jemand tatsaechlich zu sehen bekommt.
  permissions: [...corePermission('members.view'), ...MEMBER_CENTER_PERMISSIONS],
  navigation: [
    {
      href: '/members',
      label: 'Mitglieder',
      description: 'Mitglieder des SwissHub Discord-Servers suchen und einsehen',
      permission: 'members.view',
      icon: 'Users',
      group: 'moderation',
      order: 20,
    },
    {
      href: '/profile',
      label: 'Mein Profil',
      description: 'Die eigenen Daten im SwissHub System',
      // Wer nur sich selbst sehen darf, braucht die Mitgliedersuche nicht -
      // und ohne diesen Eintrag fuehrte kein Weg zum eigenen Profil.
      permission: 'members.view.basic.own',
      icon: 'UserRound',
      group: 'overview',
      order: 20,
    },
  ],
});

registerModule({
  id: 'moderation',
  name: 'Moderation',
  description: 'Modulunabhängige Moderationshistorie des Servers.',
  icon: 'ShieldAlert',
  permissionPrefix: 'moderation',
  core: true,
  defaultEnabled: true,
  // Die beiden bestehenden Kernrechte plus die Massnahmen des Moderation
  // Center. Jail bringt seine eigenen mit - hier steht kein zweiter Schluessel
  // fuer dieselbe Handlung.
  permissions: [
    ...CORE_PERMISSIONS.filter((entry) => entry.module === 'core' && entry.key.startsWith('moderation.')),
    ...MODERATION_CENTER_PERMISSIONS,
  ],
  settingsSchema: moderationSettingsSchema,
  settingsFields: moderationSettingsFields,
  navigation: [
    {
      href: '/moderation',
      label: 'Moderation',
      description: 'Massnahmen des Servers: Jail, Bann, Kick und Timeout',
      permission: 'moderation.view',
      // Wer nur bannen darf, braucht ebenfalls einen Weg dorthin - die Seite
      // leitet ihn dann in die Bannliste.
      altPermissions: ['moderation.ban', 'moderation.unban'],
      icon: 'ShieldAlert',
      group: 'moderation',
      order: 40,
    },
  ],
});

registerModule({
  id: 'server',
  name: 'Server',
  description: 'Verbundener Discord-Server: Übersicht, Rollen, Channels und Berechtigungen.',
  icon: 'Server',
  permissionPrefix: 'settings',
  core: true,
  defaultEnabled: true,
  permissions: [],
  navigation: [
    {
      href: '/server',
      label: 'Übersicht',
      description: 'Der verbundene Discord-Server auf einen Blick',
      permission: 'settings.view',
      icon: 'Server',
      group: 'server',
      order: 11,
    },
    {
      href: '/server/roles',
      label: 'Rollen',
      description: 'Rollenhierarchie des Servers und was der Bot verwalten kann',
      permission: 'settings.view',
      icon: 'Shield',
      group: 'server',
      order: 12,
    },
    {
      href: '/server/channels',
      label: 'Channels',
      description: 'Channels des Servers, wie sie in den Einstellungen zur Auswahl stehen',
      permission: 'settings.view',
      icon: 'Hash',
      group: 'server',
      order: 13,
    },
    {
      href: '/server/permissions',
      label: 'Berechtigungen',
      description: 'Welche Discord-Rolle im Dashboard was darf',
      permission: 'permissions.manage',
      icon: 'KeyRound',
      group: 'server',
      order: 14,
    },
  ],
});

registerModule({
  id: 'audit',
  name: 'Audit Log',
  description: 'Manipulationsgeschütztes Protokoll sämtlicher sicherheitsrelevanter Aktionen.',
  icon: 'ScrollText',
  permissionPrefix: 'audit',
  core: true,
  defaultEnabled: true,
  permissions: corePermission('audit.view'),
  navigation: [
    {
      href: '/audit',
      label: 'Audit Log',
      description: 'Protokoll aller sicherheitsrelevanten Aktionen',
      permission: 'audit.view',
      icon: 'ScrollText',
      group: 'system',
      order: 80,
    },
  ],
});

registerModule({
  id: 'modules',
  name: 'Module',
  description: 'Module aktivieren, deaktivieren und konfigurieren.',
  icon: 'Blocks',
  permissionPrefix: 'modules',
  core: true,
  defaultEnabled: true,
  permissions: corePermission('modules.manage'),
  navigation: [
    {
      href: '/modules',
      label: 'Module',
      description: 'SwissHub-Module aktivieren, deaktivieren und einsehen',
      permission: 'modules.manage',
      icon: 'Blocks',
      group: 'system',
      order: 81,
    },
  ],
});

registerModule({
  id: 'settings',
  name: 'Einstellungen',
  description: 'Discord-, Rollen- und Systemeinstellungen der WebApp.',
  icon: 'Settings',
  permissionPrefix: 'settings',
  core: true,
  defaultEnabled: true,
  permissions: CORE_PERMISSIONS.filter(
    (entry) =>
      entry.key.startsWith('settings.') ||
      entry.key.startsWith('integrations.') ||
      entry.key === 'permissions.manage' ||
      entry.key === 'system.manage' ||
      entry.key === 'branding.manage' ||
      entry.key === 'admin.full',
  ),
  navigation: [
    {
      href: '/system/bot',
      label: 'Bot',
      description: 'Status des Bots und seine Discord-Berechtigungen',
      permission: 'settings.view',
      icon: 'Bot',
      group: 'system',
      order: 78,
    },
    {
      href: '/system/discord',
      label: 'Discord-Sync',
      description: 'Abgleich von Rollen und Channels mit Discord',
      permission: 'settings.view',
      icon: 'RefreshCw',
      group: 'system',
      order: 79,
    },
    {
      href: '/system/integrationen',
      label: 'Integrationen',
      description: 'Zugangsdaten für Discord, AI und weitere Anbieter',
      permission: 'integrations.view',
      icon: 'Plug',
      group: 'system',
      order: 80,
    },
    {
      href: '/settings/branding',
      label: 'Branding',
      description: 'Logo und Erscheinungsbild der WebApp',
      permission: 'branding.manage',
      icon: 'Palette',
      group: 'system',
      order: 83,
    },
    {
      href: '/settings',
      label: 'Einstellungen',
      description: 'Discord-Anbindung, Rollen, Berechtigungen und Systemverhalten',
      permission: 'settings.view',
      icon: 'Settings',
      group: 'system',
      order: 82,
    },
  ],
});
