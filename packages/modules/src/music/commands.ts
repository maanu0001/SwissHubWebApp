import { prisma } from '@swisshub/database';
import type { MusicCommandStatus } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';

const logger = createLogger('music:commands');

/**
 * Wie lange auf die Bestaetigung eines Befehls gewartet wird.
 *
 * Der Legacy-Bot rief die Wiedergabe direkt im Befehlsrumpf auf - es gab
 * nichts zu bestaetigen, weil alles derselbe Prozess war. Hier liegen
 * WebApp und Laufzeit auseinander, und ohne Rueckmeldung waere jede Anzeige
 * eine Behauptung: "Pausiert", obwohl der Bot vielleicht gar nicht mehr
 * laeuft.
 */
export const COMMAND_TIMEOUT_MS = 8_000;

export interface CommandResult {
  status: MusicCommandStatus;
  error: string | null;
}

/**
 * Auf die Bestaetigung eines Befehls warten.
 *
 * Bewusst kurzes Nachfragen statt einer offenen Verbindung: die Laufzeit ist
 * ein eigener Container, und eine Warteschlange in der Datenbank ist der Weg,
 * den beide Seiten ohnehin teilen. Nach Ablauf der Frist wird der Befehl als
 * `TIMEOUT` markiert - er bleibt sichtbar, statt stillschweigend zu
 * verschwinden.
 */
export async function waitForCommand(
  commandId: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  const frist = Date.now() + timeoutMs;

  while (Date.now() < frist) {
    const befehl = await prisma.musicCommand.findUnique({
      where: { id: commandId },
      select: { status: true, error: true },
    });

    if (!befehl) {
      return { status: 'FAILED', error: 'Der Befehl wurde nicht gefunden.' };
    }
    if (befehl.status === 'DONE' || befehl.status === 'FAILED') {
      return { status: befehl.status, error: befehl.error };
    }

    await new Promise((fertig) => setTimeout(fertig, 250));
  }

  // Nur markieren, wenn er noch offen ist: die Laufzeit koennte im selben
  // Moment geantwortet haben.
  const { count } = await prisma.musicCommand.updateMany({
    where: { id: commandId, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'TIMEOUT', finishedAt: new Date() },
  });
  if (count > 0) {
    logger.warn('Musik-Befehl ohne Antwort', { commandId });
  }

  const endgueltig = await prisma.musicCommand.findUnique({
    where: { id: commandId },
    select: { status: true, error: true },
  });
  return {
    status: endgueltig?.status ?? 'TIMEOUT',
    error: endgueltig?.error ?? null,
  };
}

/** Verstaendliche Meldung statt eines technischen Zustands. */
export function commandMeldung(ergebnis: CommandResult): string | null {
  if (ergebnis.status === 'DONE') {
    return null;
  }
  if (ergebnis.status === 'TIMEOUT') {
    return 'Der Musik-Bot antwortet derzeit nicht.';
  }
  return ergebnis.error ?? 'Die Aktion ist fehlgeschlagen.';
}

/**
 * Liegengebliebene Befehle aufraeumen.
 *
 * Faellt eine Laufzeit aus, bleiben ihre Befehle auf `PENDING` stehen. Ohne
 * dieses Aufraeumen sammelten sie sich an und wuerden nach einem Neustart
 * verspaetet ausgefuehrt - jemand druecket "Skip", nichts passiert, und
 * zwanzig Minuten spaeter springt die Wiedergabe.
 */
export async function expireStaleCommands(aelterAlsMs = 60_000): Promise<number> {
  const { count } = await prisma.musicCommand.updateMany({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      createdAt: { lt: new Date(Date.now() - aelterAlsMs) },
    },
    data: { status: 'TIMEOUT', finishedAt: new Date() },
  });
  if (count > 0) {
    logger.info('Liegengebliebene Musik-Befehle verworfen', { anzahl: count });
  }
  return count;
}
