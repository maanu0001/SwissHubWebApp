import { prisma } from '@swisshub/database';
import type { SpielersucheImport, SpielersucheImportItem, SpielersucheImportKind } from '@swisshub/database';

/** Lesezugriffe des Import-Assistenten. */

export interface ImportWithItems extends SpielersucheImport {
  items: SpielersucheImportItem[];
}

/**
 * Ein Import mit begrenzter Zahl Vorschauzeilen.
 *
 * Die Zahlen darüber bleiben vollständig; die Liste ist bewusst gedeckelt,
 * damit die Seite auch bei mehreren hundert Zeilen nutzbar bleibt.
 */
export async function getImport(
  id: string,
  options: { kind?: SpielersucheImportKind; limit?: number } = {},
): Promise<ImportWithItems | null> {
  return prisma.spielersucheImport.findUnique({
    where: { id },
    include: {
      items: {
        where: options.kind ? { kind: options.kind } : undefined,
        orderBy: [{ kind: 'asc' }, { action: 'asc' }, { legacyKey: 'asc' }],
        take: options.limit ?? 300,
      },
    },
  });
}

/** Zählt die Zeilen je Datenart und Entscheidung - Grundlage der Vorschau. */
export async function getImportBreakdown(
  importId: string,
): Promise<Array<{ kind: SpielersucheImportKind; action: string; count: number }>> {
  const rows = await prisma.spielersucheImportItem.groupBy({
    by: ['kind', 'action'],
    where: { importId },
    _count: { _all: true },
  });
  return rows.map((row) => ({ kind: row.kind, action: row.action, count: row._count._all }));
}

export async function getPendingImport(): Promise<SpielersucheImport | null> {
  return prisma.spielersucheImport.findFirst({
    where: { status: { in: ['ANALYSED', 'CONFIRMED', 'IMPORTING'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listImports(limit = 10): Promise<SpielersucheImport[]> {
  return prisma.spielersucheImport.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}
