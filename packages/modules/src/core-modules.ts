import { CORE_PERMISSIONS } from '@swisshub/permissions';
import { registerModule, type ModuleDefinition } from './registry';

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
  permissions: corePermission('members.view'),
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
  permissions: CORE_PERMISSIONS.filter(
    (entry) => entry.module === 'core' && entry.key.startsWith('moderation.'),
  ),
  navigation: [
    {
      href: '/moderation',
      label: 'Moderation',
      description: 'Alle Moderationsaktionen des Servers',
      permission: 'moderation.view',
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

/**
 * Geplante Module.
 *
 * Sie erscheinen in der Navigation als Ausblick (markiert mit "Bald"), sind
 * aber bewusst nicht verlinkt und besitzen noch keine Berechtigungen - es gibt
 * also keine Schaltfläche ohne Funktion. Sobald ein Modul implementiert wird,
 * genügt es, hier `status` zu entfernen und die echte Definition zu ergänzen
 * (siehe docs/MODULES.md).
 */
const plannedModules: Array<{
  id: string;
  name: string;
  description: string;
  icon: string;
  href: string;
  group: 'moderation' | 'modules';
  order: number;
  permission: string;
  tagline: string;
  badge?: string;
}> = [
  {
    id: 'warnings',
    name: 'Warnungen',
    description: 'Verwarnungen aussprechen, einsehen und zurücknehmen.',
    icon: 'Bell',
    href: '/warnings',
    group: 'moderation',
    order: 41,
    permission: 'moderation.view',
    tagline: 'Verwarnungen verwalten',
  },
  {
    id: 'reports',
    name: 'Reports',
    description: 'Meldungen aus der Community bearbeiten.',
    icon: 'MessageSquare',
    href: '/reports',
    group: 'moderation',
    order: 42,
    permission: 'moderation.view',
    tagline: 'Meldungen bearbeiten',
  },
  {
    id: 'voice-manager',
    name: 'Voice Manager',
    description: 'Temporäre Voice Channels verwalten.',
    icon: 'Volume2',
    href: '/voice-manager',
    group: 'modules',
    order: 52,
    permission: 'dashboard.view',
    tagline: 'Temporäre Voice Channels',
  },
  {
    id: 'giveaways',
    name: 'Giveaways',
    description: 'Giveaways erstellen und Gewinner ziehen.',
    icon: 'Gift',
    href: '/giveaways',
    group: 'modules',
    order: 53,
    permission: 'dashboard.view',
    tagline: 'Giveaways verwalten',
  },
  {
    id: 'tickets',
    name: 'Tickets',
    description: 'Support-Ticketsystem für die Community.',
    icon: 'Ticket',
    href: '/tickets',
    group: 'modules',
    order: 54,
    permission: 'dashboard.view',
    tagline: 'Support-Ticketsystem',
  },
];

for (const planned of plannedModules) {
  const definition: ModuleDefinition = {
    id: planned.id,
    name: planned.name,
    description: planned.description,
    tagline: planned.tagline,
    icon: planned.icon,
    permissionPrefix: planned.id,
    defaultEnabled: false,
    status: 'planned',
    permissions: [],
    navigation: [
      {
        href: planned.href,
        label: planned.name,
        description: planned.description,
        permission: planned.permission,
        icon: planned.icon,
        group: planned.group,
        order: planned.order,
        badge: planned.badge ?? 'Bald',
      },
    ],
  };
  registerModule(definition);
}
