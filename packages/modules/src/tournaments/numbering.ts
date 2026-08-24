import { prisma } from '@swisshub/database';
import type { Prisma } from '@swisshub/database';

type TransactionClient = Prisma.TransactionClient;

/**
 * Die naechste Matchnummer eines Turniers.
 *
 * Eine Zeile je Turnier, hochgezaehlt in derselben Anweisung, die den Wert
 * zurueckgibt. `MAX(matchNumber) + 1` verliert dieses Rennen: zwei
 * gleichzeitige Bracket-Erzeugungen laesen denselben Hoechstwert und
 * vergaeben dieselbe Nummer. Die Eindeutigkeit auf
 * `[tournamentId, matchNumber]` faenge das ab - aber erst, indem sie die
 * zweite Erzeugung abbricht.
 */
export async function nextMatchNumber(
  tournamentId: string,
  tx: TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const zeilen = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    INSERT INTO "TournamentMatchCounter" ("tournamentId", "lastNumber", "updatedAt")
    VALUES (${tournamentId}, 1, now())
    ON CONFLICT ("tournamentId") DO UPDATE
      SET "lastNumber" = "TournamentMatchCounter"."lastNumber" + 1, "updatedAt" = now()
    RETURNING "lastNumber"
  `;

  const nummer = zeilen[0]?.lastNumber;
  if (nummer === undefined) {
    throw new Error('Matchnummer konnte nicht vergeben werden.');
  }
  return nummer;
}

/**
 * Mehrere Nummern auf einmal.
 *
 * Ein Bracket entsteht in einem Zug; je Match einzeln zu zaehlen waere ein
 * Datenbankzugriff je Match.
 */
export async function reserveMatchNumbers(
  tournamentId: string,
  anzahl: number,
  tx: TransactionClient | typeof prisma = prisma,
): Promise<number[]> {
  if (anzahl <= 0) {
    return [];
  }
  const zeilen = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    INSERT INTO "TournamentMatchCounter" ("tournamentId", "lastNumber", "updatedAt")
    VALUES (${tournamentId}, ${anzahl}, now())
    ON CONFLICT ("tournamentId") DO UPDATE
      SET "lastNumber" = "TournamentMatchCounter"."lastNumber" + ${anzahl}, "updatedAt" = now()
    RETURNING "lastNumber"
  `;

  const letzte = zeilen[0]?.lastNumber;
  if (letzte === undefined) {
    throw new Error('Matchnummern konnten nicht vergeben werden.');
  }
  const erste = letzte - anzahl + 1;
  return Array.from({ length: anzahl }, (_, index) => erste + index);
}
