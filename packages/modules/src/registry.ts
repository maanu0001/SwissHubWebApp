import { registerPermissions, type PermissionDefinition } from '@swisshub/permissions';
import type { DiscordPermissionName } from '@swisshub/discord';
import type { z } from 'zod';
import type { SettingsField } from './settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from './health/types';

/**
 * Module Registry.
 *
 * Ein Modul beschreibt sich vollständig selbst: Permissions, Navigation,
 * Einstellungen. Navigation, Dashboard und die Berechtigungsverwaltung werden
 * daraus generiert - ein neues Modul erfordert deshalb keine Änderung an der
 * Kernanwendung (siehe docs/MODULES.md).
 */

/** Abschnitte der Seitenleiste (Reihenfolge = Anzeigereihenfolge). */
export const NAVIGATION_GROUPS = [
  { id: 'overview', label: null },
  { id: 'server', label: 'Server' },
  { id: 'modules', label: 'Module' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'system', label: 'System' },
] as const;

export type NavigationGroupId = (typeof NAVIGATION_GROUPS)[number]['id'];

export interface ModuleNavigationItem {
  href: string;
  label: string;
  /** Kurztext unter dem Seitentitel. */
  description?: string;
  /** Sichtbar, wenn der Benutzer diese Permission besitzt. */
  permission: string;
  /** Lucide Icon Name (siehe `nav-icon.tsx`). */
  icon: string;
  /** Abschnitt in der Seitenleiste. */
  group: NavigationGroupId;
  order: number;
  /** Statisches Label rechts im Navigationseintrag, z.B. `NEU`. */
  badge?: string;
  /**
   * Dynamischer Zähler, den die Seitenleiste anzeigt.
   * `activeJails` wird serverseitig befüllt.
   */
  counter?: 'activeJails';
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  /** Lucide Icon Name, z.B. `Lock`. */
  icon: string;
  /** Präfix sämtlicher Permissions dieses Moduls, z.B. `jail`. */
  permissionPrefix: string;
  permissions: PermissionDefinition[];
  navigation: ModuleNavigationItem[];
  /** Kernbereiche können nicht deaktiviert werden. */
  core?: boolean;
  defaultEnabled: boolean;
  /** Zod-Schema der Moduleinstellungen (optional). */
  settingsSchema?: z.ZodTypeAny;
  /**
   * Beschreibung der Einstellungen für die generische Oberfläche.
   * Daraus entsteht die Settings-Seite - inklusive Rollen- und Channel-Auswahl.
   */
  settingsFields?: SettingsField[];
  /** Schema-Version der Einstellungen (für spätere Migrationen). */
  configVersion?: number;
  /** Discord-Berechtigungen, die der Bot für dieses Modul benötigt. */
  requiredDiscordPermissions?: DiscordPermissionName[];
  /** Zusätzliche Prüfungen für die Modul-Gesundheit (siehe `health.ts`). */
  healthChecks?: (context: ModuleHealthContext) => Promise<ModuleHealthCheck[]>;
  /** Sehr kurzer Text für Modulkacheln (Dashboard). */
  tagline?: string;
  /** Kurzbeschreibung des Status für die Modulkarte. */
  badge?: string;
}

const modules = new Map<string, ModuleDefinition>();

export function registerModule(definition: ModuleDefinition): ModuleDefinition {
  modules.set(definition.id, definition);
  registerPermissions(definition.permissions);
  return definition;
}

export function listModuleDefinitions(): ModuleDefinition[] {
  return [...modules.values()];
}

export function getModuleDefinition(id: string): ModuleDefinition | undefined {
  return modules.get(id);
}

export interface NavigationEntry extends ModuleNavigationItem {
  moduleId: string;
}

/**
 * Navigationseinträge aller aktivierten Module, gefiltert nach Permissions.
 *
 * Es erscheint nur, was auch funktioniert: ein Eintrag entsteht ausschliesslich
 * für ein eingeschaltetes Modul mit vorhandener Seite. Platzhalter, die zu
 * einer leeren Seite führen, gibt es bewusst nicht.
 */
export function buildNavigation(
  permissionKeys: readonly string[],
  enabledModuleIds: ReadonlySet<string>,
): NavigationEntry[] {
  const owned = new Set(permissionKeys);
  return listModuleDefinitions()
    .filter((definition) => definition.core || enabledModuleIds.has(definition.id))
    .flatMap((definition) =>
      definition.navigation.map((item) => ({ ...item, moduleId: definition.id })),
    )
    .filter((item) => owned.has(item.permission))
    .sort((a, b) => a.order - b.order);
}

/** Gruppiert Navigationseinträge für die Seitenleiste. */
export function groupNavigation(
  entries: NavigationEntry[],
): Array<{ id: NavigationGroupId; label: string | null; items: NavigationEntry[] }> {
  return NAVIGATION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: entries.filter((entry) => entry.group === group.id),
  })).filter((group) => group.items.length > 0);
}
