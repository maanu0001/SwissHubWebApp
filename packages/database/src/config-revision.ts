import { prisma } from './client';

/**
 * Konfigurations-Revision.
 *
 * Jede Änderung an der Laufzeitkonfiguration (Guild, Rollen-Mappings,
 * Moduleinstellungen, Discord-Sync) erhöht einen Zähler. Bot und WebApp prüfen
 * diesen Zähler günstig (eine Zeile) und verwerfen ihre Caches, sobald er sich
 * geändert hat. Dadurch wirken Änderungen ohne Neustart und ohne zusätzliche
 * Infrastruktur wie Redis oder Pub/Sub.
 */
const SINGLETON = 'singleton';

/** Wie lange eine gelesene Revision wiederverwendet wird, bevor neu geprüft wird. */
const REVISION_POLL_INTERVAL_MS = 5_000;

let cachedRevision: { value: bigint; readAt: number } | null = null;

export async function readConfigRevision(options: { force?: boolean } = {}): Promise<bigint> {
  if (!options.force && cachedRevision && Date.now() - cachedRevision.readAt < REVISION_POLL_INTERVAL_MS) {
    return cachedRevision.value;
  }

  const row = await prisma.configRevision.findUnique({
    where: { id: SINGLETON },
    select: { revision: true },
  });
  const value = row?.revision ?? 0n;
  cachedRevision = { value, readAt: Date.now() };
  return value;
}

/**
 * Erhöht die Revision. Wird von jedem schreibenden Konfigurationszugriff
 * aufgerufen - niemals direkt aus dem Browser.
 */
export async function bumpConfigRevision(reason: string, updatedBy?: string | null): Promise<bigint> {
  const row = await prisma.configRevision.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, revision: 1n, reason, updatedBy: updatedBy ?? null },
    update: { revision: { increment: 1 }, reason, updatedBy: updatedBy ?? null },
    select: { revision: true },
  });
  cachedRevision = { value: row.revision, readAt: Date.now() };
  return row.revision;
}

/**
 * Cache, der sich automatisch verwirft, sobald sich die Konfiguration ändert.
 *
 *   const roles = await revisionCache('roles', () => loadRoles());
 *
 * Zusätzlich greift eine maximale Lebensdauer, damit ein Prozess auch dann
 * aufholt, wenn eine Revision einmal verpasst wurde.
 */
const caches = new Map<string, { revision: bigint; value: unknown; expiresAt: number }>();

export async function revisionCache<T>(
  key: string,
  loader: () => Promise<T>,
  options: { maxAgeMs?: number; force?: boolean } = {},
): Promise<T> {
  const revision = await readConfigRevision();
  const entry = caches.get(key);

  if (!options.force && entry && entry.revision === revision && entry.expiresAt > Date.now()) {
    return entry.value as T;
  }

  const value = await loader();
  caches.set(key, {
    revision,
    value,
    expiresAt: Date.now() + (options.maxAgeMs ?? 60_000),
  });
  return value;
}

/** Verwirft lokale Caches sofort (z.B. direkt nach einem Schreibvorgang). */
export function clearRevisionCaches(key?: string): void {
  if (key) {
    caches.delete(key);
    return;
  }
  caches.clear();
  cachedRevision = null;
}
