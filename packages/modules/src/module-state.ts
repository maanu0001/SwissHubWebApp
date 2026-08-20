import { bumpConfigRevision, prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { getModuleDefinition, listModuleDefinitions, type ModuleDefinition } from './registry';

const log = createLogger('modules');

/**
 * Aktivierungszustand und Einstellungen der Module (Datenbank als Source of Truth).
 */
export interface ModuleStatusEntry {
  definition: ModuleDefinition;
  enabled: boolean;
  updatedAt: Date | null;
}

export async function listModuleStatus(): Promise<ModuleStatusEntry[]> {
  const rows = await prisma.moduleState.findMany();
  const byId = new Map(rows.map((row) => [row.moduleId, row]));

  return listModuleDefinitions().map((definition) => {
    const row = byId.get(definition.id);
    return {
      definition,
      enabled: definition.core ? true : (row?.enabled ?? definition.defaultEnabled),
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export async function enabledModuleIds(): Promise<Set<string>> {
  const status = await listModuleStatus();
  return new Set(status.filter((entry) => entry.enabled).map((entry) => entry.definition.id));
}

export async function isModuleEnabled(moduleId: string): Promise<boolean> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    return false;
  }
  if (definition.core) {
    return true;
  }
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  return row?.enabled ?? definition.defaultEnabled;
}

export async function setModuleEnabled(moduleId: string, enabled: boolean, updatedBy: string): Promise<void> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    throw new Error(`Unbekanntes Modul: ${moduleId}`);
  }
  if (definition.core) {
    throw new Error('Kernbereiche können nicht deaktiviert werden.');
  }
  await prisma.moduleState.upsert({
    where: { moduleId },
    create: { moduleId, enabled, updatedBy },
    update: { enabled, updatedBy },
  });

  // Der Zähler verwirft die Caches von Bot und WebApp. Ohne ihn würde ein
  // abgeschaltetes Modul weiterlaufen, bis der jeweilige Cache von selbst
  // abläuft - beim Level-System hiesse das: weiter XP vergeben.
  await bumpConfigRevision(`module.${moduleId}.enabled`, updatedBy);

  log.info('Modulzustand geändert', { moduleId, enabled, updatedBy });
}

/**
 * Liest die Einstellungen eines Moduls und validiert sie gegen das Schema.
 * Ungültige oder fehlende Werte fallen auf die Defaults zurück (Fail Safe).
 */
export async function getModuleSettings<T>(moduleId: string): Promise<T> {
  const definition = getModuleDefinition(moduleId);
  if (!definition?.settingsSchema) {
    return {} as T;
  }
  const row = await prisma.moduleState.findUnique({ where: { moduleId } });
  const parsed = definition.settingsSchema.safeParse(row?.settings ?? {});
  if (!parsed.success) {
    log.warn('Ungültige Moduleinstellungen - Defaults werden verwendet', {
      moduleId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return definition.settingsSchema.parse({}) as T;
  }
  return parsed.data as T;
}

export async function setModuleSettings<T>(
  moduleId: string,
  settings: unknown,
  updatedBy: string,
): Promise<T> {
  const definition = getModuleDefinition(moduleId);
  if (!definition?.settingsSchema) {
    throw new Error(`Modul ${moduleId} besitzt keine Einstellungen.`);
  }
  const parsed = definition.settingsSchema.parse(settings);
  await prisma.moduleState.upsert({
    where: { moduleId },
    create: { moduleId, enabled: definition.defaultEnabled, settings: parsed, updatedBy },
    update: { settings: parsed, updatedBy },
  });
  return parsed as T;
}
