import { registerPermissions, type PermissionDefinition } from '@swisshub/permissions';
import type { z } from 'zod';

/**
 * Module Registry.
 *
 * Ein Modul beschreibt sich vollstaendig selbst: Permissions, Navigation,
 * Einstellungen. Navigation, Dashboard und die Berechtigungsverwaltung werden
 * daraus generiert - ein neues Modul erfordert deshalb keine Aenderung an der
 * Kernanwendung (siehe docs/MODULES.md).
 */
export interface ModuleNavigationItem {
  href: string;
  label: string;
  /** Sichtbar, wenn der Benutzer diese Permission besitzt. */
  permission: string;
  /** Lucide Icon Name. */
  icon: string;
  order: number;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  /** Lucide Icon Name, z.B. `Lock`. */
  icon: string;
  /** Praefix saemtlicher Permissions dieses Moduls, z.B. `jail`. */
  permissionPrefix: string;
  permissions: PermissionDefinition[];
  navigation: ModuleNavigationItem[];
  /** Kernbereiche koennen nicht deaktiviert werden. */
  core?: boolean;
  defaultEnabled: boolean;
  /** Zod-Schema der Moduleinstellungen (optional). */
  settingsSchema?: z.ZodTypeAny;
  /** Kurzbeschreibung des Status fuer die Modulkarte. */
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

/** Navigationseintraege aller aktivierten Module, gefiltert nach Permissions. */
export function buildNavigation(
  permissionKeys: readonly string[],
  enabledModuleIds: ReadonlySet<string>,
): Array<ModuleNavigationItem & { moduleId: string }> {
  const owned = new Set(permissionKeys);
  return listModuleDefinitions()
    .filter((definition) => definition.core || enabledModuleIds.has(definition.id))
    .flatMap((definition) => definition.navigation.map((item) => ({ ...item, moduleId: definition.id })))
    .filter((item) => owned.has(item.permission))
    .sort((a, b) => a.order - b.order);
}
