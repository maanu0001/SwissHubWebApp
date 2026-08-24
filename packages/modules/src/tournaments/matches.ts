import { prisma } from '@swisshub/database';
import type {
  Prisma,
  TournamentMatch,
  TournamentMatchStatus,
  TournamentResultReason,
} from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { tournamentEvent, type TournamentActor } from './events';

import type { Slot } from './bracket';

const logger = createLogger('tournaments:matches');

export type { Slot };

export interface GameResult {
  index: number;
  map?: string | null;
  scoreA: number;
  scoreB: number;
}

export interface ReportInput {
  matchId: string;
  /** Fuer welche Seite gemeldet wird - vom Server bestimmt, nie vom Browser. */
  slot: Slot;
  reportedByDiscordId: string;
  reportedByUsername: string;
  scoreA: number;
  scoreB: number;
  reason?: TournamentResultReason;
  games?: GameResult[];
  comment?: string | null;
  evidenceUrl?: string | null;
  evidenceFile?: string | null;
}

/**
 * Ein Resultat melden.
 *
 * Eine Meldung ist noch kein Resultat. Erst wenn die Gegenseite dasselbe sagt
 * - oder ausdruecklich bestaetigt - steht es fest. Der Grund ist einfach: wer
 * allein melden darf, kann sich durchs ganze Turnier schreiben.
 *
 * Meldet die Gegenseite etwas anderes, wird das Match strittig und die
 * Turnierleitung entscheidet. Es wird nichts stillschweigend ueberschrieben.
 */
export async function reportResult(
  input: ReportInput,
  actor: TournamentActor,
): Promise<{ match: TournamentMatch; bestaetigt: boolean; strittig: boolean }> {
  const match = await prisma.tournamentMatch.findUniqueOrThrow({
    where: { id: input.matchId },
    include: { tournament: { select: { status: true, defaultBestOf: true } } },
  });

  if (match.status === 'COMPLETED' || match.status === 'FORFEIT') {
    throw new AppError('CONFLICT', {
      userMessage: 'Für dieses Match steht das Resultat bereits fest.',
    });
  }
  if (match.status === 'CANCELLED') {
    throw new AppError('CONFLICT', { userMessage: 'Dieses Match wurde abgesagt.' });
  }
  if (!match.participantAId || !match.participantBId) {
    throw new AppError('CONFLICT', {
      userMessage: 'Für dieses Match stehen noch nicht beide Gegner fest.',
    });
  }
  if (match.tournament.status === 'PAUSED') {
    throw new AppError('CONFLICT', {
      userMessage: 'Das Turnier ist pausiert. Resultate werden gerade nicht angenommen.',
    });
  }

  pruefeErgebnis(input, match.bestOf);

  const gemeldet = await prisma.tournamentResultSubmission.create({
    data: {
      matchId: match.id,
      slot: input.slot,
      reportedByDiscordId: input.reportedByDiscordId,
      reportedByUsername: input.reportedByUsername.slice(0, 64),
      scoreA: input.scoreA,
      scoreB: input.scoreB,
      reason: input.reason ?? 'PLAYED',
      games: (input.games ?? []) as never,
      comment: input.comment?.slice(0, 1000) ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      evidenceFile: input.evidenceFile ?? null,
    },
  });

  // Gibt es eine offene Meldung der Gegenseite?
  const gegenseite = await prisma.tournamentResultSubmission.findFirst({
    where: {
      matchId: match.id,
      slot: input.slot === 'A' ? 'B' : 'A',
      rejectedAt: null,
      id: { not: gemeldet.id },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!gegenseite) {
    const aktualisiert = await prisma.tournamentMatch.update({
      where: { id: match.id },
      data: { status: 'AWAITING_RESULT' },
    });
    await tournamentEvent(match.tournamentId, 'MATCH_RESULT_REPORTED', actor, {
      match: match.matchNumber,
      scoreA: input.scoreA,
      scoreB: input.scoreB,
    });
    return { match: aktualisiert, bestaetigt: false, strittig: false };
  }

  // Beide Seiten sagen dasselbe: das Resultat steht.
  if (gegenseite.scoreA === input.scoreA && gegenseite.scoreB === input.scoreB) {
    await prisma.tournamentResultSubmission.updateMany({
      where: { matchId: match.id, confirmedAt: null, rejectedAt: null },
      data: { confirmedAt: new Date(), confirmedByDiscordId: input.reportedByDiscordId },
    });
    const fertig = await finalisiereResultat(
      match.id,
      { scoreA: input.scoreA, scoreB: input.scoreB, reason: input.reason ?? 'PLAYED', games: input.games },
      actor,
    );
    return { match: fertig, bestaetigt: true, strittig: false };
  }

  // Zwei verschiedene Angaben: das entscheidet die Leitung, nicht der Server.
  const strittig = await prisma.tournamentMatch.update({
    where: { id: match.id },
    data: { status: 'DISPUTED' },
  });
  await prisma.tournamentDispute.create({
    data: {
      tournamentId: match.tournamentId,
      matchId: match.id,
      openedByDiscordId: input.reportedByDiscordId,
      openedByUsername: input.reportedByUsername.slice(0, 64),
      reason: `Widersprüchliche Meldungen: ${gegenseite.scoreA}:${gegenseite.scoreB} gegen ${input.scoreA}:${input.scoreB}`,
    },
  });
  await tournamentEvent(match.tournamentId, 'DISPUTE_OPENED', actor, {
    match: match.matchNumber,
    gemeldet: `${input.scoreA}:${input.scoreB}`,
    gegenseite: `${gegenseite.scoreA}:${gegenseite.scoreB}`,
  });
  logger.info('Match strittig', { matchId: match.id });

  return { match: strittig, bestaetigt: false, strittig: true };
}

/**
 * Die Meldung der Gegenseite bestaetigen.
 *
 * Der kurze Weg: statt dasselbe nochmals einzutippen, bestaetigt der zweite
 * Captain, was der erste gemeldet hat.
 */
export async function confirmResult(
  matchId: string,
  slot: Slot,
  discordId: string,
  actor: TournamentActor,
): Promise<TournamentMatch> {
  const offen = await prisma.tournamentResultSubmission.findFirst({
    where: { matchId, slot: slot === 'A' ? 'B' : 'A', confirmedAt: null, rejectedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!offen) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Es gibt keine offene Meldung der Gegenseite zu bestätigen.',
    });
  }

  await prisma.tournamentResultSubmission.update({
    where: { id: offen.id },
    data: { confirmedAt: new Date(), confirmedByDiscordId: discordId },
  });

  const games = Array.isArray(offen.games) ? (offen.games as unknown as GameResult[]) : [];
  return finalisiereResultat(
    matchId,
    { scoreA: offen.scoreA, scoreB: offen.scoreB, reason: offen.reason, games },
    actor,
  );
}

/**
 * Der Meldung der Gegenseite widersprechen.
 *
 * Damit wird das Match strittig - ohne dass der Widersprechende selbst ein
 * Resultat behaupten muss.
 */
export async function rejectResult(
  matchId: string,
  slot: Slot,
  reason: string,
  discordId: string,
  username: string,
  actor: TournamentActor,
): Promise<TournamentMatch> {
  const offen = await prisma.tournamentResultSubmission.findFirst({
    where: { matchId, slot: slot === 'A' ? 'B' : 'A', confirmedAt: null, rejectedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!offen) {
    throw new AppError('NOT_FOUND', {
      userMessage: 'Es gibt keine offene Meldung der Gegenseite.',
    });
  }

  const match = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } });

  await prisma.$transaction([
    prisma.tournamentResultSubmission.update({
      where: { id: offen.id },
      data: { rejectedAt: new Date() },
    }),
    prisma.tournamentMatch.update({ where: { id: matchId }, data: { status: 'DISPUTED' } }),
    prisma.tournamentDispute.create({
      data: {
        tournamentId: match.tournamentId,
        matchId,
        openedByDiscordId: discordId,
        openedByUsername: username.slice(0, 64),
        reason: reason.slice(0, 2000),
      },
    }),
  ]);

  await tournamentEvent(match.tournamentId, 'DISPUTE_OPENED', actor, {
    match: match.matchNumber,
    grund: reason,
  });

  return prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } });
}

/** Ergebnisangaben pruefen, bevor sie irgendwo landen. */
function pruefeErgebnis(input: ReportInput, bestOf: number): void {
  if (input.scoreA < 0 || input.scoreB < 0) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Negative Resultate gibt es nicht.' });
  }
  if (input.scoreA > 99 || input.scoreB > 99) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Das Resultat ist unplausibel hoch.' });
  }

  const noetig = Math.floor(bestOf / 2) + 1;

  if ((input.reason ?? 'PLAYED') === 'PLAYED') {
    if (input.scoreA === input.scoreB && bestOf > 1) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Bei Best of ${bestOf} gibt es kein Unentschieden.`,
      });
    }
    const hoechster = Math.max(input.scoreA, input.scoreB);
    if (bestOf > 1 && hoechster !== noetig) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Bei Best of ${bestOf} gewinnt, wer ${noetig} ${noetig === 1 ? 'Map' : 'Maps'} holt - gemeldet wurde ${input.scoreA}:${input.scoreB}.`,
      });
    }
    if (input.scoreA + input.scoreB > bestOf) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Bei Best of ${bestOf} sind höchstens ${bestOf} ${bestOf === 1 ? 'Map' : 'Maps'} möglich.`,
      });
    }
  }

  if (input.games && input.games.length > 0) {
    if (input.games.length > bestOf) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Es wurden mehr Maps gemeldet, als bei Best of ${bestOf} möglich sind.`,
      });
    }
    const indizes = new Set(input.games.map((game) => game.index));
    if (indizes.size !== input.games.length) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Eine Map ist doppelt gemeldet.' });
    }
  }
}

/**
 * Das Resultat festschreiben und den Sieger weiterschicken.
 *
 * Alles in einer Transaktion. Ohne sie kann ein Abbruch nach dem Speichern
 * des Resultats, aber vor dem Weiterschicken, ein Bracket hinterlassen, in
 * dem ein Match entschieden ist und die naechste Runde trotzdem leer bleibt -
 * und niemand sieht, woran es liegt.
 */
async function finalisiereResultat(
  matchId: string,
  ergebnis: {
    scoreA: number;
    scoreB: number;
    reason: TournamentResultReason;
    games?: GameResult[];
  },
  actor: TournamentActor,
): Promise<TournamentMatch> {
  const fertig = await prisma.$transaction(async (tx) => {
    // Das Match sperren: zwei gleichzeitige Bestaetigungen duerfen den
    // Sieger nicht zweimal weiterschicken.
    await tx.$queryRaw`SELECT id FROM "TournamentMatch" WHERE id = ${matchId} FOR UPDATE`;

    const match = await tx.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } });

    if (match.status === 'COMPLETED' || match.status === 'FORFEIT') {
      // Ein anderer Vorgang war schneller. Das ist kein Fehler - das
      // Resultat steht bereits, und zwar dasselbe.
      return match;
    }

    const winnerId =
      ergebnis.scoreA > ergebnis.scoreB
        ? match.participantAId
        : ergebnis.scoreB > ergebnis.scoreA
          ? match.participantBId
          : null;
    const loserId =
      winnerId === null
        ? null
        : winnerId === match.participantAId
          ? match.participantBId
          : match.participantAId;

    const status: TournamentMatchStatus =
      ergebnis.reason === 'FORFEIT' || ergebnis.reason === 'NO_SHOW' ? 'FORFEIT' : 'COMPLETED';

    const aktualisiert = await tx.tournamentMatch.update({
      where: { id: matchId },
      data: {
        scoreA: ergebnis.scoreA,
        scoreB: ergebnis.scoreB,
        winnerId,
        loserId,
        resultReason: ergebnis.reason,
        status,
        completedAt: new Date(),
        ...(match.startedAt === null ? { startedAt: new Date() } : {}),
      },
    });

    // Einzelne Maps ersetzen - eine Korrektur soll die alten nicht stehen
    // lassen.
    await tx.tournamentMatchGame.deleteMany({ where: { matchId } });
    if (ergebnis.games && ergebnis.games.length > 0) {
      await tx.tournamentMatchGame.createMany({
        data: ergebnis.games.map((game) => ({
          matchId,
          index: game.index,
          map: game.map ?? null,
          scoreA: game.scoreA,
          scoreB: game.scoreB,
          winnerSlot: game.scoreA > game.scoreB ? 'A' : game.scoreB > game.scoreA ? 'B' : null,
        })),
      });
    }

    await schiebeWeiter(tx, aktualisiert, winnerId, loserId);
    return aktualisiert;
  });

  await tournamentEvent(fertig.tournamentId, 'MATCH_RESULT_CONFIRMED', actor, {
    match: fertig.matchNumber,
    resultat: `${fertig.scoreA}:${fertig.scoreB}`,
    grund: fertig.resultReason,
  });

  await pruefeRundenende(fertig.tournamentId, fertig.stageId, actor);

  return fertig;
}

/**
 * Sieger und Verlierer an ihren naechsten Platz setzen.
 *
 * Die Verweise stehen am Match selbst - dadurch muss diese Stelle die Form
 * des Brackets nicht kennen. Zwei Stellen, die dieselbe Form ausrechnen, sind
 * irgendwann uneinig.
 */
async function schiebeWeiter(
  tx: Prisma.TransactionClient,
  match: TournamentMatch,
  winnerId: string | null,
  loserId: string | null,
): Promise<void> {
  const setze = async (
    zielMatchId: string | null,
    slot: string | null,
    participantId: string | null,
  ): Promise<void> => {
    if (!zielMatchId || !slot || !participantId) {
      return;
    }
    const feld = slot === 'A' ? 'participantAId' : 'participantBId';
    await tx.tournamentMatch.update({
      where: { id: zielMatchId },
      data: { [feld]: participantId },
    });

    // Sind beide Seiten da, kann gespielt werden.
    const ziel = await tx.tournamentMatch.findUniqueOrThrow({ where: { id: zielMatchId } });
    if (ziel.participantAId && ziel.participantBId && ziel.status === 'PENDING') {
      await tx.tournamentMatch.update({ where: { id: zielMatchId }, data: { status: 'READY' } });
    }
  };

  await setze(match.winnerToMatchId, match.winnerToSlot, winnerId);
  await setze(match.loserToMatchId, match.loserToSlot, loserId);

  // Wer nirgends mehr hingeht, ist ausgeschieden.
  if (loserId && !match.loserToMatchId) {
    await tx.tournamentParticipant.update({
      where: { id: loserId },
      data: { eliminatedAt: new Date() },
    });
  }
}

/**
 * Ist eine Runde fertig?
 *
 * Dann bekommt sie einen Eintrag im Verlauf. Das ist der Punkt, an dem die
 * Leitung die naechste ansetzen kann - und bei Gruppen oder Schweizer System
 * der Punkt, an dem es ueberhaupt weitergeht.
 */
async function pruefeRundenende(
  tournamentId: string,
  stageId: string,
  actor: TournamentActor,
): Promise<void> {
  const offen = await prisma.tournamentMatch.groupBy({
    by: ['round'],
    where: { stageId, status: { notIn: ['COMPLETED', 'FORFEIT', 'CANCELLED'] } },
    _count: { _all: true },
  });
  const offeneRunden = new Set(offen.map((eintrag) => eintrag.round));

  const runden = await prisma.tournamentMatch.groupBy({
    by: ['round'],
    where: { stageId },
    _count: { _all: true },
  });

  for (const runde of runden) {
    if (offeneRunden.has(runde.round)) {
      continue;
    }
    const schonGemeldet = await prisma.tournamentEvent.findFirst({
      where: {
        tournamentId,
        kind: 'ROUND_COMPLETED',
        detail: { path: ['stageId'], equals: stageId },
      },
      orderBy: { createdAt: 'desc' },
    });
    const bereitsFuerDieseRunde =
      schonGemeldet &&
      typeof schonGemeldet.detail === 'object' &&
      schonGemeldet.detail !== null &&
      (schonGemeldet.detail as Record<string, unknown>).runde === runde.round;

    if (bereitsFuerDieseRunde) {
      continue;
    }

    await tournamentEvent(tournamentId, 'ROUND_COMPLETED', actor, {
      stageId,
      runde: runde.round,
      matches: runde._count._all,
    });
  }
}

/**
 * Ein Resultat von der Turnierleitung korrigieren.
 *
 * Braucht immer einen Grund. Eine Korrektur ohne Begruendung ist von aussen
 * nicht von Willkuer zu unterscheiden - und genau darum geht es bei einem
 * Einspruch.
 *
 * Das Weiterschicken wird zurueckgenommen und neu gesetzt: sonst stuende der
 * bisherige Sieger weiterhin in der naechsten Runde.
 */
export async function overrideResult(
  matchId: string,
  ergebnis: {
    scoreA: number;
    scoreB: number;
    reason?: TournamentResultReason;
    games?: GameResult[];
  },
  grund: string,
  actor: TournamentActor,
): Promise<TournamentMatch> {
  if (grund.trim().length < 5) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Für eine Korrektur braucht es eine Begründung.',
    });
  }

  const fertig = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TournamentMatch" WHERE id = ${matchId} FOR UPDATE`;
    const match = await tx.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } });

    // Den bisherigen Sieger und Verlierer aus ihren Folgematches nehmen.
    await macheWeiterschiebenRueckgaengig(tx, match);

    const winnerId =
      ergebnis.scoreA > ergebnis.scoreB
        ? match.participantAId
        : ergebnis.scoreB > ergebnis.scoreA
          ? match.participantBId
          : null;
    const loserId =
      winnerId === null
        ? null
        : winnerId === match.participantAId
          ? match.participantBId
          : match.participantAId;

    const reason = ergebnis.reason ?? 'ADMIN_DECISION';
    const status: TournamentMatchStatus =
      reason === 'FORFEIT' || reason === 'NO_SHOW' ? 'FORFEIT' : 'COMPLETED';

    const aktualisiert = await tx.tournamentMatch.update({
      where: { id: matchId },
      data: {
        scoreA: ergebnis.scoreA,
        scoreB: ergebnis.scoreB,
        winnerId,
        loserId,
        resultReason: reason,
        status,
        completedAt: new Date(),
      },
    });

    await tx.tournamentMatchGame.deleteMany({ where: { matchId } });
    if (ergebnis.games && ergebnis.games.length > 0) {
      await tx.tournamentMatchGame.createMany({
        data: ergebnis.games.map((game) => ({
          matchId,
          index: game.index,
          map: game.map ?? null,
          scoreA: game.scoreA,
          scoreB: game.scoreB,
          winnerSlot: game.scoreA > game.scoreB ? 'A' : game.scoreB > game.scoreA ? 'B' : null,
        })),
      });
    }

    await schiebeWeiter(tx, aktualisiert, winnerId, loserId);
    return aktualisiert;
  });

  await tournamentEvent(fertig.tournamentId, 'MATCH_RESULT_OVERRIDDEN', actor, {
    match: fertig.matchNumber,
    resultat: `${fertig.scoreA}:${fertig.scoreB}`,
    grund,
  });
  logger.info('Resultat korrigiert', { matchId, grund });

  return fertig;
}

/**
 * Das Weiterschicken zuruecknehmen.
 *
 * Nur, solange das Folgematch noch nicht gespielt ist. Sonst haenge an der
 * Korrektur eine Kette weiterer Korrekturen, die niemand ueberblickt - dann
 * ist es ehrlicher, sie abzulehnen und die Leitung entscheiden zu lassen.
 */
async function macheWeiterschiebenRueckgaengig(
  tx: Prisma.TransactionClient,
  match: TournamentMatch,
): Promise<void> {
  for (const [zielId, slot, participantId] of [
    [match.winnerToMatchId, match.winnerToSlot, match.winnerId],
    [match.loserToMatchId, match.loserToSlot, match.loserId],
  ] as const) {
    if (!zielId || !slot || !participantId) {
      continue;
    }
    const ziel = await tx.tournamentMatch.findUnique({ where: { id: zielId } });
    if (!ziel) {
      continue;
    }
    if (ziel.status === 'COMPLETED' || ziel.status === 'FORFEIT') {
      throw new AppError('CONFLICT', {
        userMessage: `Match #${ziel.matchNumber} ist bereits gespielt. Korrigiere zuerst dieses.`,
      });
    }

    const feld = slot === 'A' ? 'participantAId' : 'participantBId';
    if (ziel[feld] === participantId) {
      await tx.tournamentMatch.update({
        where: { id: zielId },
        data: { [feld]: null, status: 'PENDING' },
      });
    }
  }

  // Ein zuvor Ausgeschiedener ist es womoeglich nicht mehr.
  if (match.loserId && !match.loserToMatchId) {
    await tx.tournamentParticipant.update({
      where: { id: match.loserId },
      data: { eliminatedAt: null },
    });
  }
}

/**
 * Ein Match als Forfait oder Nichtantritt werten.
 *
 * Der Unterschied zum gewoehnlichen Resultat steht im Grund: bei einem
 * Einspruch macht es etwas aus, ob 2:0 gespielt oder gegeben wurde.
 */
export async function forfeitMatch(
  matchId: string,
  gewinnerSlot: Slot,
  reason: 'FORFEIT' | 'NO_SHOW',
  grund: string,
  actor: TournamentActor,
): Promise<TournamentMatch> {
  const match = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } });
  const noetig = Math.floor(match.bestOf / 2) + 1;

  return overrideResult(
    matchId,
    {
      scoreA: gewinnerSlot === 'A' ? noetig : 0,
      scoreB: gewinnerSlot === 'B' ? noetig : 0,
      reason,
    },
    grund,
    actor,
  );
}

// --- Planung und Ablauf ----------------------------------------------------

export async function scheduleMatch(
  matchId: string,
  scheduledAt: Date | null,
  actor: TournamentActor,
): Promise<TournamentMatch> {
  const match = await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: {
      scheduledAt,
      ...(scheduledAt && ['PENDING', 'READY'].includes(
        (await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } })).status,
      )
        ? { status: 'SCHEDULED' as const }
        : {}),
    },
  });
  await tournamentEvent(match.tournamentId, 'MATCH_SCHEDULED', actor, {
    match: match.matchNumber,
    zeit: scheduledAt?.toISOString() ?? null,
  });
  return match;
}

/** Alle Matches einer Runde auf denselben Zeitpunkt setzen. */
export async function scheduleRound(
  stageId: string,
  round: number,
  scheduledAt: Date,
  actor: TournamentActor,
): Promise<number> {
  const { count } = await prisma.tournamentMatch.updateMany({
    where: { stageId, round, status: { in: ['PENDING', 'READY', 'SCHEDULED'] } },
    data: { scheduledAt, status: 'SCHEDULED' },
  });

  const stage = await prisma.tournamentStage.findUniqueOrThrow({ where: { id: stageId } });
  await tournamentEvent(stage.tournamentId, 'MATCH_SCHEDULED', actor, {
    runde: round,
    matches: count,
    zeit: scheduledAt.toISOString(),
  });
  return count;
}

/**
 * Bereitmeldung eines Teams.
 *
 * Sagen beide Bescheid, geht das Match live. Der Nutzen ist nicht die
 * Foermlichkeit, sondern die Auskunft fuer die Leitung: wenn eine Seite nach
 * zehn Minuten nicht bereit ist, weiss man, wo man nachfragen muss.
 */
export async function setReady(
  matchId: string,
  slot: Slot,
  bereit: boolean,
): Promise<TournamentMatch> {
  const match = await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: slot === 'A' ? { readyA: bereit } : { readyB: bereit },
  });

  if (match.readyA && match.readyB && ['READY', 'SCHEDULED'].includes(match.status)) {
    return prisma.tournamentMatch.update({
      where: { id: matchId },
      data: { status: 'LIVE', startedAt: new Date() },
    });
  }
  return match;
}

export async function startMatch(matchId: string, actor: TournamentActor): Promise<TournamentMatch> {
  const match = await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: { status: 'LIVE', startedAt: new Date() },
  });
  await tournamentEvent(match.tournamentId, 'MATCH_SCHEDULED', actor, {
    match: match.matchNumber,
    gestartet: true,
  });
  return match;
}

// --- Einsprueche -----------------------------------------------------------

export async function openDispute(
  matchId: string,
  reason: string,
  discordId: string,
  username: string,
  actor: TournamentActor,
): Promise<void> {
  const match = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } });

  const offen = await prisma.tournamentDispute.findFirst({
    where: { matchId, status: { in: ['OPEN', 'IN_REVIEW'] } },
  });
  if (offen) {
    throw new AppError('CONFLICT', {
      userMessage: 'Zu diesem Match läuft bereits ein Einspruch.',
    });
  }

  await prisma.$transaction([
    prisma.tournamentDispute.create({
      data: {
        tournamentId: match.tournamentId,
        matchId,
        openedByDiscordId: discordId,
        openedByUsername: username.slice(0, 64),
        reason: reason.slice(0, 2000),
      },
    }),
    ...(match.status === 'COMPLETED' || match.status === 'FORFEIT'
      ? []
      : [prisma.tournamentMatch.update({ where: { id: matchId }, data: { status: 'DISPUTED' } })]),
  ]);

  await tournamentEvent(match.tournamentId, 'DISPUTE_OPENED', actor, {
    match: match.matchNumber,
    grund: reason,
  });
}

export async function resolveDispute(
  disputeId: string,
  entscheidung: string,
  actor: TournamentActor,
  options: { ablehnen?: boolean; staffNote?: string } = {},
): Promise<void> {
  const einspruch = await prisma.tournamentDispute.update({
    where: { id: disputeId },
    data: {
      status: options.ablehnen ? 'REJECTED' : 'RESOLVED',
      resolution: entscheidung.slice(0, 2000),
      ...(options.staffNote !== undefined ? { staffNote: options.staffNote.slice(0, 2000) } : {}),
      resolvedByDiscordId: actor.discordId,
      resolvedAt: new Date(),
    },
  });

  // Bleibt kein Einspruch offen und ist das Match noch strittig, geht es
  // zurueck in die Warteschlange - sonst haenge es fuer immer.
  const weitereOffen = await prisma.tournamentDispute.count({
    where: { matchId: einspruch.matchId, status: { in: ['OPEN', 'IN_REVIEW'] } },
  });
  if (weitereOffen === 0) {
    const match = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: einspruch.matchId },
    });
    if (match.status === 'DISPUTED') {
      await prisma.tournamentMatch.update({
        where: { id: match.id },
        data: {
          status: match.participantAId && match.participantBId ? 'AWAITING_RESULT' : 'PENDING',
        },
      });
    }
  }

  await tournamentEvent(einspruch.tournamentId, 'DISPUTE_RESOLVED', actor, {
    entscheidung,
    abgelehnt: options.ablehnen ?? false,
  });
}

// --- Abfragen --------------------------------------------------------------

/** Ein Match mit allem, was die Detailseite braucht. */
export async function getMatch(matchId: string) {
  return prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      tournament: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          mode: true,
          mapPool: true,
          twitchUrl: true,
          youtubeUrl: true,
          streamUrl: true,
        },
      },
      stage: { select: { id: true, name: true, kind: true, roundCount: true } },
      group: { select: { id: true, name: true } },
      participantA: {
        select: {
          id: true,
          username: true,
          discordId: true,
          seed: true,
          team: { select: { id: true, name: true, tag: true, logoUrl: true, captainDiscordId: true } },
        },
      },
      participantB: {
        select: {
          id: true,
          username: true,
          discordId: true,
          seed: true,
          team: { select: { id: true, name: true, tag: true, logoUrl: true, captainDiscordId: true } },
        },
      },
      games: { orderBy: { index: 'asc' } },
      submissions: { orderBy: { createdAt: 'desc' } },
      disputes: { orderBy: { createdAt: 'desc' } },
      casters: true,
    },
  });
}

export interface MatchFilter {
  tournamentId?: string;
  /**
   * Mehrere Turniere - fuer die Gesamtuebersicht.
   *
   * Sie bekommt die Liste aus der Sichtbarkeitspruefung. Eine Uebersicht, die
   * alle Matches laedt und danach aussortiert, waere keine.
   */
  tournamentIds?: string[];
  status?: TournamentMatchStatus[];
  stageId?: string;
  round?: number;
  /** Nur Matches, an denen dieser Teilnehmer beteiligt ist. */
  participantId?: string;
  /** Nur Matches, deren Resultat ueberfaellig ist. */
  ueberfaelligSeitMinuten?: number;
  limit?: number;
}

export async function listMatches(filter: MatchFilter) {
  const where: Prisma.TournamentMatchWhereInput = {
    ...(filter.tournamentId ? { tournamentId: filter.tournamentId } : {}),
    ...(filter.tournamentIds ? { tournamentId: { in: filter.tournamentIds } } : {}),
    ...(filter.status ? { status: { in: filter.status } } : {}),
    ...(filter.stageId ? { stageId: filter.stageId } : {}),
    ...(filter.round !== undefined ? { round: filter.round } : {}),
    ...(filter.participantId
      ? {
          OR: [{ participantAId: filter.participantId }, { participantBId: filter.participantId }],
        }
      : {}),
    ...(filter.ueberfaelligSeitMinuten
      ? {
          status: { in: ['LIVE', 'AWAITING_RESULT'] },
          startedAt: {
            not: null,
            lt: new Date(Date.now() - filter.ueberfaelligSeitMinuten * 60_000),
          },
        }
      : {}),
  };

  return prisma.tournamentMatch.findMany({
    where,
    orderBy: [{ scheduledAt: 'asc' }, { matchNumber: 'asc' }],
    take: filter.limit ?? 200,
    include: {
      tournament: { select: { id: true, slug: true, name: true } },
      stage: { select: { name: true, kind: true } },
      group: { select: { name: true } },
      participantA: {
        select: { id: true, username: true, seed: true, team: { select: { name: true, tag: true } } },
      },
      participantB: {
        select: { id: true, username: true, seed: true, team: { select: { name: true, tag: true } } },
      },
    },
  });
}

/**
 * Das Turnier abschliessen.
 *
 * Setzt die Platzierungen aus dem Bracket: der Sieger des letzten Matches ist
 * Erster, sein Gegner Zweiter, und danach entscheidet, wie weit jemand
 * gekommen ist. Das ist eine Naeherung fuer die Plaetze ab drei - deshalb
 * kann die Leitung sie ueberschreiben.
 */
export async function berechnePlatzierungen(tournamentId: string): Promise<number> {
  const matches = await prisma.tournamentMatch.findMany({
    where: { tournamentId, status: { in: ['COMPLETED', 'FORFEIT'] } },
    orderBy: [{ round: 'desc' }],
    include: { stage: { select: { kind: true } } },
  });

  if (matches.length === 0) {
    return 0;
  }

  // Das letzte Match ist das mit der hoechsten Runde im letzten Abschnitt.
  const finale =
    matches.find((match) => match.stage.kind === 'GRAND_FINAL') ??
    matches.find((match) => match.stage.kind === 'WINNERS') ??
    matches[0]!;

  const platzierung = new Map<string, number>();
  if (finale.winnerId) {
    platzierung.set(finale.winnerId, 1);
  }
  if (finale.loserId) {
    platzierung.set(finale.loserId, 2);
  }

  // Danach: wer spaeter ausgeschieden ist, steht weiter vorne.
  const ausgeschieden = await prisma.tournamentParticipant.findMany({
    where: { tournamentId, eliminatedAt: { not: null } },
    orderBy: { eliminatedAt: 'desc' },
    select: { id: true },
  });

  let naechsterPlatz = 3;
  for (const teilnehmer of ausgeschieden) {
    if (platzierung.has(teilnehmer.id)) {
      continue;
    }
    platzierung.set(teilnehmer.id, naechsterPlatz);
    naechsterPlatz += 1;
  }

  await prisma.$transaction(
    [...platzierung].map(([participantId, platz]) =>
      prisma.tournamentParticipant.update({
        where: { id: participantId },
        data: { placement: platz },
      }),
    ),
  );

  return platzierung.size;
}
