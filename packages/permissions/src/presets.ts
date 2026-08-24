import { ADMIN_FULL, listPermissions, type PermissionDefinition } from './registry';

/**
 * Berechtigungs-Vorlagen.
 *
 * Vorlagen ersetzen das manuelle Zusammenklicken einzelner Berechtigungen für
 * die häufigen Fälle. Sie werden beim Anwenden zu konkreten Permissions
 * aufgelöst - gespeichert wird also immer die explizite Liste, nie die Vorlage.
 * Dadurch bleibt nachvollziehbar, was eine Rolle tatsächlich darf.
 */
export interface PermissionPreset {
  id: string;
  label: string;
  description: string;
  /** Konkrete Permissions; `*` steht für "alle bekannten Berechtigungen". */
  permissions: string[];
  /** Vorschlag für die Moderationsstufe (Rollenhierarchie der Anwendung). */
  moderationLevel: number;
  critical?: boolean;
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'viewer',
    label: 'Nur Lesen',
    description: 'Dashboard, Mitglieder und Moderationshistorie ansehen - keine Aktionen.',
    permissions: ['dashboard.view', 'members.view', 'moderation.view', 'jail.view'],
    moderationLevel: 10,
  },
  {
    id: 'moderator',
    label: 'Moderator',
    description: 'Darf Mitglieder jailen und wieder freigeben, aber nichts konfigurieren.',
    permissions: [
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.execute',
      'jail.view',
      'jail.create',
      'jail.release',
    ],
    moderationLevel: 50,
  },
  {
    id: 'senior-moderator',
    label: 'Senior Moderator',
    description: 'Moderation inklusive Audit Log und Verlängerung laufender Massnahmen.',
    permissions: [
      'dashboard.view',
      'members.view',
      'moderation.view',
      'moderation.execute',
      'audit.view',
      'settings.view',
      'jail.view',
      'jail.create',
      'jail.release',
      'jail.extend',
    ],
    moderationLevel: 70,
  },
  {
    id: 'level-team',
    label: 'Level-Team',
    description:
      'XP vergeben und entziehen, Level-Rollen und XP-Regeln pflegen. Ersetzt die frühere Level-Manager-Rolle.',
    permissions: [
      'dashboard.view',
      'members.view',
      'level.view',
      'level.members.view',
      'level.members.manage',
      'level.leaderboard.view',
      'level.games.view',
      'level.games.play.basic',
      'level.games.play.advanced',
      'level.games.manage',
      'level.roles.view',
      'level.roles.manage',
      'level.rules.manage',
      'level.decay.manage',
      'level.stats.view',
      'level.settings.view',
      'level.settings.manage',
    ],
    moderationLevel: 50,
  },
  {
    id: 'support-team',
    label: 'Support-Team',
    description:
      'Tickets bearbeiten: antworten, übernehmen, Status setzen, schliessen. Interne Notizen inbegriffen - Kategorien, Panels und Einstellungen nicht.',
    permissions: [
      'dashboard.view',
      'members.view',
      'tickets.view',
      'tickets.viewOwn',
      'tickets.create',
      'tickets.support.view',
      'tickets.support.reply',
      'tickets.support.claim',
      'tickets.support.assign',
      'tickets.support.changeStatus',
      'tickets.support.changePriority',
      'tickets.support.manageTags',
      'tickets.support.addUser',
      'tickets.support.removeUser',
      'tickets.support.close',
      'tickets.support.reopen',
      'tickets.notes.view',
      'tickets.notes.create',
      'tickets.archive.view',
      'tickets.transcript.view',
      'tickets.stats.view',
    ],
    moderationLevel: 40,
  },
  {
    id: 'administrator',
    label: 'Administrator',
    description: 'Vollzugriff inklusive Berechtigungen, Module und Systemfunktionen.',
    permissions: [ADMIN_FULL],
    moderationLevel: 100,
    critical: true,
  },
];

export function getPermissionPreset(id: string): PermissionPreset | undefined {
  return PERMISSION_PRESETS.find((preset) => preset.id === id);
}

/**
 * Löst eine Vorlage gegen die tatsächlich registrierten Permissions auf.
 * Unbekannte Einträge (z.B. aus einem deaktivierten Modul) fallen weg.
 */
export function resolvePreset(preset: PermissionPreset): string[] {
  const known = new Set(listPermissions().map((definition) => definition.key));
  if (preset.permissions.includes('*')) {
    return [...known];
  }
  return preset.permissions.filter((permission) => known.has(permission));
}

/** Vorlage, die exakt zur aktuellen Auswahl passt (für die Anzeige). */
export function matchPreset(permissions: readonly string[]): PermissionPreset | undefined {
  const selected = [...permissions].sort().join(',');
  return PERMISSION_PRESETS.find((preset) => resolvePreset(preset).sort().join(',') === selected);
}

/** Permissions für die Matrix-Darstellung, nach Modul gruppiert und sortiert. */
export function permissionMatrixColumns(): PermissionDefinition[] {
  return listPermissions().filter((definition) => definition.key !== ADMIN_FULL);
}
