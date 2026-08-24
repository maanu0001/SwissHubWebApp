import { prisma } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';

/**
 * Die naechste Ticketnummer.
 *
 * Bewusst ein eigener Zaehler statt `MAX(ticketNumber) + 1`. Die Rechnung
 * ueber alle Tickets liefert zwei gleichzeitigen Erstellungen dieselbe Zahl -
 * beide lesen dasselbe Maximum, bevor eine schreibt. Das faellt erst unter
 * Last auf, und dann als verlorener Datensatz.
 *
 * `UPDATE ... RETURNING` auf einer einzelnen Zeile hat dieses Problem nicht:
 * Postgres serialisiert die Schreibzugriffe auf dieselbe Zeile, und jeder
 * Aufrufer bekommt genau seine eigene Zahl.
 *
 * Der Aufruf gehoert in dieselbe Transaktion wie das Anlegen des Tickets -
 * sonst entstuende bei einem Abbruch eine Luecke in der Nummerierung.
 */
export async function nextTicketNumber(
  guildId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const zeilen = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    INSERT INTO "TicketCounter" ("guildId", "lastNumber", "updatedAt")
    VALUES (${guildId}, 1, now())
    ON CONFLICT ("guildId") DO UPDATE
      SET "lastNumber" = "TicketCounter"."lastNumber" + 1,
          "updatedAt" = now()
    RETURNING "lastNumber"
  `;
  const nummer = zeilen[0]?.lastNumber;
  if (typeof nummer !== 'number') {
    throw new Error('Die Ticketnummer konnte nicht vergeben werden.');
  }
  return nummer;
}

/** Anzeigeform: #000123. */
export function formatTicketNumber(nummer: number, prefix = '#'): string {
  return `${prefix}${String(nummer).padStart(6, '0')}`;
}
