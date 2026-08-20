import { prisma } from '@swisshub/database';
import type { JailImport, JailImportRow, JailImportRowAction } from '@swisshub/database';

/** Lesezugriffe des Import-Assistenten. */

export interface ImportWithRows extends JailImport {
  rows: JailImportRow[];
}

/**
 * Ein Import mit einer begrenzten Zahl Beispielzeilen.
 *
 * Die Vorschau zeigt bewusst nicht alle Zeilen - bei mehreren hundert
 * Einträgen wäre die Seite unbrauchbar. Die Zahlen darüber bleiben vollständig.
 */
export async function getImport(
  id: string,
  options: { action?: JailImportRowAction; limit?: number } = {},
): Promise<ImportWithRows | null> {
  return prisma.jailImport.findUnique({
    where: { id },
    include: {
      rows: {
        where: options.action ? { action: options.action } : undefined,
        orderBy: [{ action: 'asc' }, { startedAt: 'asc' }],
        take: options.limit ?? 100,
      },
    },
  });
}

/** Der zuletzt begonnene, noch nicht abgeschlossene Import. */
export async function getPendingImport(): Promise<JailImport | null> {
  return prisma.jailImport.findFirst({
    where: { status: { in: ['ANALYSED', 'CONFIRMED', 'IMPORTING'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listImports(limit = 20): Promise<JailImport[]> {
  return prisma.jailImport.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}

/** True, sobald mindestens ein Import erfolgreich abgeschlossen wurde. */
export async function hasCompletedImport(): Promise<boolean> {
  const count = await prisma.jailImport.count({ where: { status: 'COMPLETED' } });
  return count > 0;
}
