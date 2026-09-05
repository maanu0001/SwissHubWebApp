import { randomUUID } from 'node:crypto';
import { prisma } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { LIMITS, getEventDefinition, type EventEnvelope, type PublishInput } from './contract';

const logger = createLogger('automation:bus');

/**
 * Der Ereignisbus.
 *
 * Eine Tabelle, kein Bus im Arbeitsspeicher. Drei Gründe, und jeder allein
 * genügte:
 *
 * 1. **Zwei Prozesse.** Die WebApp erzeugt Ereignisse (jemand schaltet ein
 *    Mitglied frei), verarbeitet werden sie im Bot (er hat die
 *    Discord-Verbindung). Ein Bus im Speicher erreichte den anderen Prozess
 *    nie.
 * 2. **Neustart.** Was zwischen Veröffentlichung und Verarbeitung liegt,
 *    überlebt einen Neustart nur, wenn es geschrieben wurde.
 * 3. **Genau einmal.** Erst durch die Zeile in der Datenbank lässt sich
 *    festhalten, dass dieses Ereignis bereits verteilt wurde.
 *
 * Dasselbe Muster wie überall sonst im Projekt: die Datenbank ist die
 * Wahrheit, ein Lauf im Hintergrund holt sie ab.
 */

export interface PublishErgebnis {
  eventId: string;
  /** `false`, wenn die Nutzdaten nicht zum Schema passten. */
  angenommen: boolean;
  grund?: string;
}

/**
 * Ein Ereignis veröffentlichen.
 *
 * **Wirft nie.** Ein Modul, das ein Ereignis meldet, hat seine eigentliche
 * Arbeit bereits getan - eine Freischaltung soll nicht rückgängig gemacht
 * werden, weil die Automation Engine gerade nicht erreichbar ist. Was hier
 * schiefgeht, landet im Protokoll und sonst nirgends.
 */
export async function publish<TPayload>(eingabe: PublishInput<TPayload>): Promise<PublishErgebnis> {
  const eventId = randomUUID();

  try {
    const definition = getEventDefinition(eingabe.type);
    if (!definition) {
      // Ein Ereignis ohne Anmeldung wäre eines, auf das keine Automation
      // zeigen kann - und dessen Nutzdaten niemand geprüft hat.
      logger.warn('Unbekanntes Ereignis nicht veröffentlicht', { type: eingabe.type });
      return { eventId, angenommen: false, grund: 'Ereignis ist nicht registriert.' };
    }

    const geprueft = definition.payloadSchema.safeParse(eingabe.payload);
    if (!geprueft.success) {
      logger.warn('Nutzdaten passen nicht zum Schema', {
        type: eingabe.type,
        problem: geprueft.error.issues[0]?.message,
      });
      return { eventId, angenommen: false, grund: 'Die Nutzdaten passen nicht zum Schema.' };
    }

    const payload = geprueft.data as Record<string, unknown>;
    const alsText = JSON.stringify(payload);
    if (alsText.length > LIMITS.maxPayloadChars) {
      // Grosse Nutzdaten sind fast immer ein Versehen - eine ganze
      // Nachrichtenliste statt einer Kennung. Sie zu speichern hiesse, die
      // Tabelle unbegrenzt wachsen zu lassen (§34).
      logger.warn('Nutzdaten zu gross - Ereignis verworfen', {
        type: eingabe.type,
        zeichen: alsText.length,
      });
      return { eventId, angenommen: false, grund: 'Die Nutzdaten sind zu gross.' };
    }

    const tiefe = eingabe.causation ? eingabe.causation.depth + 1 : 0;
    if (tiefe > LIMITS.maxDepth) {
      // Die Kette ist zu lang geworden. Das Ereignis wird nicht
      // veröffentlicht - sonst liefe die Schleife weiter (§17).
      logger.error('Ereigniskette zu tief - abgebrochen', {
        type: eingabe.type,
        tiefe,
        correlationId: eingabe.causation?.correlationId,
      });
      return { eventId, angenommen: false, grund: 'Die Ereigniskette ist zu tief.' };
    }

    await prisma.automationEvent.create({
      data: {
        id: eventId,
        type: eingabe.type,
        schemaVersion: definition.schemaVersion ?? 1,
        guildId: eingabe.guildId,
        sourceModule: definition.module,
        actorId: eingabe.actorId ?? null,
        subjectId: eingabe.subjectId ?? null,
        entityId: eingabe.entityId ?? null,
        correlationId: eingabe.causation?.correlationId ?? eventId,
        causationId: eingabe.causation?.causationId ?? null,
        depth: tiefe,
        payload: payload as Prisma.InputJsonValue,
        occurredAt: eingabe.occurredAt ?? new Date(),
      },
    });

    return { eventId, angenommen: true };
  } catch (error) {
    logger.error('Ereignis konnte nicht veröffentlicht werden', { type: eingabe.type, error });
    return { eventId, angenommen: false, grund: 'Das Ereignis konnte nicht gespeichert werden.' };
  }
}

/**
 * Unverarbeitete Ereignisse holen.
 *
 * Älteste zuerst: die Reihenfolge, in der etwas geschehen ist, soll die
 * Reihenfolge sein, in der darauf reagiert wird.
 */
export async function holeUnverarbeitete(limit = 50): Promise<EventEnvelope[]> {
  const zeilen = await prisma.automationEvent.findMany({
    where: { processedAt: null },
    orderBy: { occurredAt: 'asc' },
    take: limit,
  });

  return zeilen.map((zeile) => ({
    eventId: zeile.id,
    type: zeile.type,
    schemaVersion: zeile.schemaVersion,
    guildId: zeile.guildId,
    sourceModule: zeile.sourceModule,
    actorId: zeile.actorId,
    subjectId: zeile.subjectId,
    entityId: zeile.entityId,
    correlationId: zeile.correlationId,
    causationId: zeile.causationId,
    depth: zeile.depth,
    payload: (zeile.payload ?? {}) as Record<string, unknown>,
    occurredAt: zeile.occurredAt,
  }));
}

/**
 * Ein Ereignis als verteilt kennzeichnen - unter Bedingung.
 *
 * `processedAt: null` in der Bedingung ist der ganze Punkt: laufen zwei
 * Instanzen, kommt genau eine durch. Wer null Zeilen ändert, war zu spät und
 * lässt die Finger davon. Dasselbe Verfahren wie bei den Erinnerungen des
 * Kalenders - ein zweites hätte niemand geprüft.
 */
export async function beanspruche(eventId: string, jetzt = new Date()): Promise<boolean> {
  const ergebnis = await prisma.automationEvent.updateMany({
    where: { id: eventId, processedAt: null },
    data: { processedAt: jetzt },
  });
  return ergebnis.count > 0;
}

/**
 * Alte Ereignisse entfernen (§34).
 *
 * Nur verarbeitete: was noch offen ist, bleibt liegen, auch wenn es alt ist -
 * sonst verschwände genau das, was nach einer längeren Störung noch
 * abzuarbeiten wäre.
 */
export async function raeumeEreignisse(tage: number, jetzt = new Date()): Promise<number> {
  const grenze = new Date(jetzt.getTime() - tage * 24 * 3600_000);
  const ergebnis = await prisma.automationEvent.deleteMany({
    where: { processedAt: { not: null, lt: grenze } },
  });
  return ergebnis.count;
}
