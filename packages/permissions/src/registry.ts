/**
 * Permission Registry.
 *
 * Berechtigungen werden als `<prefix>.<aktion>` Strings gefuehrt. Module bringen
 * ihre eigenen Permissions mit und registrieren sie beim Laden - die Kernlogik
 * muss dafuer nicht angefasst werden.
 */
export interface PermissionDefinition {
  /** z.B. `jail.create` */
  key: string;
  /** Anzeigename in den Einstellungen. */
  label: string;
  description: string;
  /** Modul-ID oder `core`. */
  module: string;
  /** Kennzeichnet besonders kritische Berechtigungen (Warnhinweis im UI). */
  critical?: boolean;
}

/** Sonderberechtigung: schliesst saemtliche anderen Berechtigungen ein. */
export const ADMIN_FULL = 'admin.full';

export const CORE_PERMISSIONS: PermissionDefinition[] = [
  {
    key: 'dashboard.view',
    label: 'Dashboard ansehen',
    description: 'Zugriff auf das Dashboard und die Statuskacheln.',
    module: 'core',
  },
  {
    key: 'members.view',
    label: 'Mitglieder ansehen',
    description: 'Mitgliedersuche und Mitgliederprofile einsehen.',
    module: 'core',
  },
  {
    key: 'moderation.view',
    label: 'Moderation ansehen',
    description: 'Moderationshistorie und laufende Massnahmen einsehen.',
    module: 'core',
  },
  {
    key: 'moderation.execute',
    label: 'Moderation ausfuehren',
    description: 'Moderationsaktionen gegen Mitglieder ausfuehren.',
    module: 'core',
    critical: true,
  },
  {
    key: 'audit.view',
    label: 'Audit Log ansehen',
    description: 'Das zentrale Audit Log einsehen und filtern.',
    module: 'core',
  },
  {
    key: 'settings.view',
    label: 'Einstellungen ansehen',
    description: 'Konfiguration der WebApp einsehen.',
    module: 'core',
  },
  {
    key: 'settings.edit',
    label: 'Einstellungen bearbeiten',
    description: 'Discord-, Rollen- und Systemeinstellungen aendern.',
    module: 'core',
    critical: true,
  },
  {
    key: 'permissions.manage',
    label: 'Berechtigungen verwalten',
    description: 'Discord-Rollen Berechtigungen zuweisen oder entziehen.',
    module: 'core',
    critical: true,
  },
  {
    key: 'modules.manage',
    label: 'Module verwalten',
    description: 'Module aktivieren, deaktivieren und konfigurieren.',
    module: 'core',
    critical: true,
  },
  {
    key: 'system.manage',
    label: 'System verwalten',
    description: 'Systemweite Funktionen wie Reconciliation und Wartung.',
    module: 'core',
    critical: true,
  },
  {
    key: ADMIN_FULL,
    label: 'Vollzugriff',
    description: 'Schliesst saemtliche Berechtigungen ein. Nur fuer Administratoren.',
    module: 'core',
    critical: true,
  },
];

const registry = new Map<string, PermissionDefinition>(
  CORE_PERMISSIONS.map((definition) => [definition.key, definition]),
);

/** Registriert Permissions eines Moduls (idempotent). */
export function registerPermissions(definitions: PermissionDefinition[]): void {
  for (const definition of definitions) {
    registry.set(definition.key, definition);
  }
}

export function listPermissions(): PermissionDefinition[] {
  return [...registry.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getPermission(key: string): PermissionDefinition | undefined {
  return registry.get(key);
}

export function isKnownPermission(key: string): boolean {
  return registry.has(key);
}

/** Gruppiert die bekannten Permissions nach Modul (fuer die Einstellungen). */
export function listPermissionsByModule(): Map<string, PermissionDefinition[]> {
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const definition of listPermissions()) {
    const entries = grouped.get(definition.module) ?? [];
    entries.push(definition);
    grouped.set(definition.module, entries);
  }
  return grouped;
}
