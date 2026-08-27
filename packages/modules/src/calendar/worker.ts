import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { calendarSettings } from './service';
import { refreshAnnouncement } from './discord';

const logger = createLogger('calendar:worker');

/**
 * Zeitsteuerung des Kalenders.
 *
 * Der Zustand steht ausschliesslich in der Datenbank; dieser Lauf holt nur
 * nach, was faellig geworden ist. Bewusst kein Zeitgeber im Arbeitsspeicher:
 * ein Neustart wuerde jede so gemerkte Frist verlieren, und nach einem
 * Ausfall ueber Nacht stuende ein Termin von gestern immer noch als «geplant»
 * da.
 *
 * Jeder Durchgang ist idempotent - zweimal ausgefuehrt aendert er nichts.
 * Historische Daten werden nicht angetastet: `startedAt` und `completedAt`
 * werden nur gesetzt, wenn sie noch leer sind.
 */

export interface CalendarTickResult {
  gestartet: string[];
  beendet: string[];
}

export async function runCalendarTick(now = new Date()): Promise<CalendarTickResult> {
  const settings = await calendarSettings();
  const gestartet: string[] = [];
  const beendet: string[] = [];

  // --- Geplant -> Laeuft -------------------------------------------------
  const beginnend = await prisma.calendarEvent.findMany({
    where: { status: 'SCHEDULED', startAt: { lte: now } },
    select: { id: true },
  });
  for (const event of beginnend) {
    await prisma.calendarEvent.updateMany({
      // `status` in der Bedingung: laeuft ein zweiter Durchgang gleichzeitig,
      // gewinnt genau einer, und der andere aendert nichts.
      where: { id: event.id, status: 'SCHEDULED' },
      data: { status: 'ONGOING', startedAt: now },
    });
    gestartet.push(event.id);
  }

  // --- Laeuft -> Beendet -------------------------------------------------
  //
  // Ohne Endzeit gilt die eingestellte Vorgabedauer. Das ist eine Annahme,
  // aber eine sichtbare: sie steht in den Moduleinstellungen, und die
  // Detailseite zeigt weiterhin «offenes Ende».
  const nachlaufMs = settings.autoCompleteGraceMinutes * 60_000;
  const vorgabeMs = settings.defaultDurationMinutes * 60_000;

  const laufend = await prisma.calendarEvent.findMany({
    where: { status: 'ONGOING' },
    select: { id: true, startAt: true, endAt: true },
  });
  for (const event of laufend) {
    const ende = event.endAt ?? new Date(event.startAt.getTime() + vorgabeMs);
    if (ende.getTime() + nachlaufMs > now.getTime()) {
      continue;
    }
    await prisma.calendarEvent.updateMany({
      where: { id: event.id, status: 'ONGOING' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    beendet.push(event.id);
  }

  // Die Ankuendigung nachziehen, damit im Kanal nicht «geplant» steht,
  // waehrend der Abend laeuft. Ein Discord-Ausfall darf den Lauf nicht
  // scheitern lassen - der Zustand in der Datenbank stimmt bereits.
  for (const id of [...gestartet, ...beendet]) {
    await refreshAnnouncement(id).catch((error: unknown) =>
      logger.warn('Ankündigung konnte nach Statuswechsel nicht aktualisiert werden', {
        eventId: id,
        error,
      }),
    );
  }

  if (gestartet.length > 0 || beendet.length > 0) {
    logger.info('Events fortgeschrieben', {
      gestartet: gestartet.length,
      beendet: beendet.length,
    });
  }
  return { gestartet, beendet };
}
