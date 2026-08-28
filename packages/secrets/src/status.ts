import { prisma } from '@swisshub/database';
import type { IntegrationHealth } from '@swisshub/database';

/**
 * Der Zustand einer Integration.
 *
 * Vier Werte für alle Anbieter - Discord, AI, Musik, jeder Bot. Eine
 * gemeinsame Skala ist der Grund, weshalb die Übersicht ohne Sonderfälle
 * auskommt:
 *
 * - `CONNECTED`      alles hinterlegt, letzter Test erfolgreich
 * - `DEGRADED`       nutzbar, aber unvollständig oder länger ungeprüft
 * - `NOT_CONFIGURED` nichts hinterlegt - kein Fehler, nur nicht eingerichtet
 * - `ERROR`          hinterlegt, aber der letzte Test ist gescheitert
 *
 * Der Unterschied zwischen `NOT_CONFIGURED` und `ERROR` ist der wichtigste:
 * eine nicht eingerichtete AI ist ein bewusster Zustand und darf nichts rot
 * färben; ein abgelehnter Schlüssel dagegen ist ein Fehler, den jemand sehen
 * muss.
 */

export type { IntegrationHealth };

export interface StatusEintrag {
  provider: string;
  status: IntegrationHealth;
  detail: string | null;
  lastCheckedAt: Date | null;
  lastOkAt: Date | null;
}

export async function readStatus(provider: string): Promise<StatusEintrag | null> {
  const zeile = await prisma.integrationStatus.findUnique({ where: { provider } });
  return zeile
    ? {
        provider: zeile.provider,
        status: zeile.status,
        detail: zeile.detail,
        lastCheckedAt: zeile.lastCheckedAt,
        lastOkAt: zeile.lastOkAt,
      }
    : null;
}

export async function readAllStatus(): Promise<StatusEintrag[]> {
  const zeilen = await prisma.integrationStatus.findMany();
  return zeilen.map((zeile) => ({
    provider: zeile.provider,
    status: zeile.status,
    detail: zeile.detail,
    lastCheckedAt: zeile.lastCheckedAt,
    lastOkAt: zeile.lastOkAt,
  }));
}

/**
 * Zustand festhalten.
 *
 * `detail` ist immer schon bereinigt, wenn es hier ankommt - diese Funktion
 * kürzt nur noch. Eine Anbieter-Rohantwort darf gar nicht erst bis hierher
 * gelangen, denn von hier geht sie direkt in die Oberfläche.
 */
export async function writeStatus(
  provider: string,
  status: IntegrationHealth,
  detail?: string | null,
): Promise<void> {
  const jetzt = new Date();
  const gekuerzt = detail ? detail.slice(0, 300) : null;
  await prisma.integrationStatus.upsert({
    where: { provider },
    create: {
      provider,
      status,
      detail: gekuerzt,
      lastCheckedAt: jetzt,
      ...(status === 'CONNECTED' ? { lastOkAt: jetzt } : {}),
    },
    update: {
      status,
      detail: gekuerzt,
      lastCheckedAt: jetzt,
      ...(status === 'CONNECTED' ? { lastOkAt: jetzt } : {}),
    },
  });
}
