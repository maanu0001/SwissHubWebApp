import { prisma } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';

/**
 * Die nächste Fallnummer (§52).
 *
 * Dasselbe Verfahren wie bei den Tickets, und aus demselben Grund: `MAX(n) + 1`
 * gibt zwei gleichzeitigen Einreichungen dieselbe Zahl, weil beide dasselbe
 * Maximum lesen, ehe eine schreibt. `UPDATE ... RETURNING` auf einer einzelnen
 * Zeile hat das Problem nicht - Postgres reiht die Schreibzugriffe auf
 * dieselbe Zeile auf, und jeder Aufrufer bekommt genau seine eigene Zahl.
 *
 * Je Jahr ein eigener Zähler: die Fallnummer soll `A-2026-0042` lauten und
 * nicht `A-2026-0000842`. Ein Jahreswechsel beginnt bei 1.
 *
 * Der Aufruf gehört in dieselbe Transaktion wie das Einreichen - sonst
 * entstünde bei einem Abbruch eine Lücke.
 */
export async function naechsteFallnummer(
  guildId: string,
  jahr: number,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const zeilen = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    INSERT INTO "AppealCounter" ("guildId", "year", "lastNumber", "updatedAt")
    VALUES (${guildId}, ${jahr}, 1, now())
    ON CONFLICT ("guildId", "year") DO UPDATE
      SET "lastNumber" = "AppealCounter"."lastNumber" + 1,
          "updatedAt" = now()
    RETURNING "lastNumber"
  `;
  const nummer = zeilen[0]?.lastNumber;
  if (typeof nummer !== 'number') {
    throw new Error('Die Fallnummer konnte nicht vergeben werden.');
  }
  return nummer;
}

/** Anzeigeform: `A-2026-0042`. */
export function formatFallnummer(jahr: number, nummer: number): string {
  return `A-${jahr}-${String(nummer).padStart(4, '0')}`;
}
