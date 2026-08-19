import 'server-only';
import { getModuleDefinition, isModuleEnabled } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';

/**
 * Stellt sicher, dass ein Modul aktiviert ist, bevor seine Aktionen laufen.
 * Ein deaktiviertes Modul darf auch über direkte Requests nichts auslösen.
 */
export async function assertModuleEnabled(moduleId: string): Promise<void> {
  const definition = getModuleDefinition(moduleId);
  if (!definition) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Modul existiert nicht.' });
  }
  if (!(await isModuleEnabled(moduleId))) {
    throw new AppError('FORBIDDEN', {
      userMessage: `Das Modul "${definition.name}" ist derzeit deaktiviert.`,
    });
  }
}
