import { CORE_PERMISSIONS } from '@swisshub/permissions';
import { registerModule } from './registry';

/**
 * Kernbereiche der Anwendung.
 *
 * Sie werden ueber dieselbe Registry gefuehrt wie Feature-Module, damit
 * Navigation und Berechtigungen einheitlich generiert werden. Kernbereiche
 * lassen sich nicht deaktivieren.
 */
const corePermission = (key: string) => CORE_PERMISSIONS.filter((entry) => entry.key === key);

registerModule({
  id: 'dashboard',
  name: 'Dashboard',
  description: 'Ueberblick ueber Bot-Status, Kennzahlen und die letzten Aktionen.',
  icon: 'LayoutDashboard',
  permissionPrefix: 'dashboard',
  core: true,
  defaultEnabled: true,
  permissions: corePermission('dashboard.view'),
  navigation: [
    {
      href: '/dashboard',
      label: 'Dashboard',
      permission: 'dashboard.view',
      icon: 'LayoutDashboard',
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
    { href: '/members', label: 'Mitglieder', permission: 'members.view', icon: 'Users', order: 20 },
  ],
});

registerModule({
  id: 'moderation',
  name: 'Moderation',
  description: 'Modulunabhaengige Moderationshistorie des Servers.',
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
      permission: 'moderation.view',
      icon: 'ShieldAlert',
      order: 40,
    },
  ],
});

registerModule({
  id: 'audit',
  name: 'Audit Log',
  description: 'Manipulationsgeschuetztes Protokoll saemtlicher sicherheitsrelevanter Aktionen.',
  icon: 'ScrollText',
  permissionPrefix: 'audit',
  core: true,
  defaultEnabled: true,
  permissions: corePermission('audit.view'),
  navigation: [
    { href: '/audit', label: 'Audit Log', permission: 'audit.view', icon: 'ScrollText', order: 50 },
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
    { href: '/modules', label: 'Module', permission: 'modules.manage', icon: 'Blocks', order: 60 },
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
      entry.key === 'admin.full',
  ),
  navigation: [
    { href: '/settings', label: 'Einstellungen', permission: 'settings.view', icon: 'Settings', order: 70 },
  ],
});
