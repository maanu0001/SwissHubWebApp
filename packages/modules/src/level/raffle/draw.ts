import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import type { XpRaffle, XpRaffleDraw } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict, notFound } from '@swisshub/shared';
import { LEVEL_MODULE_ID } from '../config';
import { applyXpWithin, type XpEngineOptions } from '../service';
import { refundEntry } from './entries';
import { drawWeighted, secureRandom, type RandomSource, type WeightedTicket } from './random';
import { canTransition, raffleStatusLabel, refreshCounters, requireRaffle } from './service';
import type { RaffleActor } from './schemas';

const logger = createLogger('level.raffle.draw');

/**
 * Die Ziehung.
 *
 * Der Gewinner entsteht ausschliesslich hier. Die Verwaltung löst die Ziehung
 * aus, wählt aber niemanden aus - es gibt keinen Weg, einen bestimmten
 * Gewinner zu bestimmen. Das Rad im Browser dreht sich zu einem Ergebnis, das
 * zu diesem Zeitpunkt schon in der Datenbank steht.
 */

export interface DrawOptions extends XpEngineOptions {
  /** Nur für Tests: eine nachrechenbare Zufallsquelle. Im Betrieb sicher. */
  random?: RandomSource;
  now?: Date;
}

/** Eine Zeile im unveränderlichen Auszug der Teilnehmenden. */
export interface SnapshotTicket extends WeightedTicket {
  displayName: string | null;
  username: string | null;
  entryXp: number;
}

export const snapshotTickets = (draw: XpRaffleDraw): SnapshotTicket[] =>
  draw.snapshot as unknown as SnapshotTicket[];

/**
 * Startet eine Ziehung.
 *
 * Zuerst wechselt die Verlosung nach `DRAWING` - ab da nimmt niemand mehr
 * teil. Erst danach entsteht der Auszug, damit er sich nicht noch unter der
 * laufenden Ziehung verändern kann.
 */
export async function startDraw(
  actor: RaffleActor,
  raffleId: string,
  options: DrawOptions = {},
): Promise<{ raffle: XpRaffle; draw: XpRaffleDraw }> {
  const random = options.random ?? secureRandom;
  const now = options.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const raffle = await tx.xpRaffle.findUnique({ where: { id: raffleId } });
    if (!raffle) {
      throw notFound(`Verlosung ${raffleId} nicht gefunden`, 'Diese Verlosung gibt es nicht.');
    }
    if (raffle.status === 'DRAWING') {
      throw conflict('Die Ziehung läuft bereits.');
    }
    if (!canTransition(raffle.status, 'DRAWING')) {
      throw conflict(
        `Aus "${raffleStatusLabel(raffle.status)}" lässt sich keine Ziehung starten. Bitte zuerst die Teilnahme schliessen.`,
      );
    }

    const entries = await tx.xpRaffleEntry.findMany({
      where: { raffleId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    if (entries.length === 0) {
      throw conflict('Es hat niemand teilgenommen - es lässt sich nichts ziehen.');
    }
    if (entries.length < raffle.minimumParticipants) {
      throw conflict(
        `Es fehlen Teilnehmende: ${entries.length} von mindestens ${raffle.minimumParticipants}. Verlängere die Teilnahme oder brich die Verlosung ab.`,
      );
    }

    const tickets: SnapshotTicket[] = entries.map((entry) => ({
      entryId: entry.id,
      discordId: entry.discordId,
      weight: entry.weight,
      displayName: entry.displayName,
      username: entry.username,
      entryXp: entry.entryXp,
    }));

    const selection = drawWeighted(tickets, random);
    if (!selection) {
      throw conflict('Keine gültige Teilnahme für die Ziehung gefunden.');
    }

    const version = await nextVersion(tx, raffleId);
    const draw = await tx.xpRaffleDraw.create({
      data: {
        raffleId,
        version,
        snapshot: tickets as unknown as object,
        participantCount: tickets.length,
        totalWeight: selection.totalWeight,
        winnerEntryId: selection.winner.entryId,
        winnerDiscordId: selection.winner.discordId,
        drawnTicket: selection.ticket,
        entropy: random.hex(16),
        animationSeed: random.hex(8),
        excludedEntryIds: [],
        startedByDiscordId: actor.discordId,
      },
    });

    const updated = await tx.xpRaffle.update({
      where: { id: raffleId },
      data: { status: 'WINNER_PENDING', drawStartedAt: now },
    });

    return { raffle: updated, draw };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_DRAW_STARTED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: result.raffle.title,
    success: true,
    metadata: {
      raffleId,
      drawId: result.draw.id,
      version: result.draw.version,
      participantCount: result.draw.participantCount,
      totalWeight: result.draw.totalWeight,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_WINNER_DRAWN,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: result.draw.winnerDiscordId,
    targetLabel: result.raffle.title,
    success: true,
    metadata: {
      raffleId,
      drawId: result.draw.id,
      version: result.draw.version,
      drawnTicket: result.draw.drawnTicket,
      totalWeight: result.draw.totalWeight,
    },
  });

  logger.info('Gewinner gezogen', {
    raffleId,
    drawId: result.draw.id,
    version: result.draw.version,
    participantCount: result.draw.participantCount,
  });

  return result;
}

/**
 * Zieht erneut.
 *
 * Nur mit Pflichtgrund und mit einer eigenen Berechtigung. Die frühere
 * Ziehung bleibt bestehen - sie wird nicht überschrieben, sondern durch eine
 * neue Fassung ergänzt. Wer später nachschaut, sieht beide.
 */
export async function redraw(
  actor: RaffleActor,
  raffleId: string,
  input: { reason: string; excludePreviousWinner: boolean },
  options: DrawOptions = {},
): Promise<{ raffle: XpRaffle; draw: XpRaffleDraw; previousWinnerDiscordId: string }> {
  const random = options.random ?? secureRandom;
  const now = options.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const raffle = await tx.xpRaffle.findUnique({ where: { id: raffleId } });
    if (!raffle) {
      throw notFound(`Verlosung ${raffleId} nicht gefunden`, 'Diese Verlosung gibt es nicht.');
    }
    if (raffle.status !== 'WINNER_PENDING') {
      throw conflict('Neu ziehen geht nur, solange der Gewinner noch nicht bestätigt ist.');
    }

    const previous = await tx.xpRaffleDraw.findFirst({
      where: { raffleId },
      orderBy: { version: 'desc' },
    });
    if (!previous) {
      throw conflict('Zu dieser Verlosung gibt es noch keine Ziehung.');
    }

    // Derselbe Auszug wie beim ersten Mal: wer damals dabei war, bleibt
    // dabei. Nur wer ausgeschlossen wurde, fällt heraus.
    const excluded = new Set(previous.excludedEntryIds);
    if (input.excludePreviousWinner) {
      excluded.add(previous.winnerEntryId);
    }

    const tickets = snapshotTickets(previous).filter((ticket) => !excluded.has(ticket.entryId));
    if (tickets.length === 0) {
      throw conflict('Nach dem Ausschluss bleibt niemand mehr übrig, der gezogen werden könnte.');
    }

    const selection = drawWeighted(tickets, random);
    if (!selection) {
      throw conflict('Keine gültige Teilnahme für die Ziehung gefunden.');
    }

    if (input.excludePreviousWinner) {
      await tx.xpRaffleEntry.update({
        where: { id: previous.winnerEntryId },
        data: { status: 'DISQUALIFIED', removalReason: input.reason },
      });
    }

    const draw = await tx.xpRaffleDraw.create({
      data: {
        raffleId,
        version: previous.version + 1,
        snapshot: tickets as unknown as object,
        participantCount: tickets.length,
        totalWeight: selection.totalWeight,
        winnerEntryId: selection.winner.entryId,
        winnerDiscordId: selection.winner.discordId,
        drawnTicket: selection.ticket,
        entropy: random.hex(16),
        animationSeed: random.hex(8),
        redrawReason: input.reason,
        excludedEntryIds: [...excluded],
        startedByDiscordId: actor.discordId,
      },
    });

    const updated = await tx.xpRaffle.update({
      where: { id: raffleId },
      data: { status: 'WINNER_PENDING', drawStartedAt: now },
    });

    return { raffle: updated, draw, previousWinnerDiscordId: previous.winnerDiscordId };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_REDRAW,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: result.draw.winnerDiscordId,
    targetLabel: result.raffle.title,
    success: true,
    metadata: {
      raffleId,
      drawId: result.draw.id,
      version: result.draw.version,
      reason: input.reason,
      previousWinnerDiscordId: result.previousWinnerDiscordId,
      excludedPreviousWinner: input.excludePreviousWinner,
      participantCount: result.draw.participantCount,
    },
  });

  return result;
}

/**
 * Bestätigt den gezogenen Gewinner.
 *
 * Erst hier wird die Verlosung abgeschlossen und ein etwaiger XP-Gewinn
 * gutgeschrieben - vorher lässt sich noch neu ziehen.
 */
export async function confirmWinner(
  actor: RaffleActor,
  raffleId: string,
  options: XpEngineOptions & { now?: Date } = {},
): Promise<{ raffle: XpRaffle; draw: XpRaffleDraw; prizeXpAwarded: number }> {
  const now = options.now ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const raffle = await tx.xpRaffle.findUnique({ where: { id: raffleId } });
    if (!raffle) {
      throw notFound(`Verlosung ${raffleId} nicht gefunden`, 'Diese Verlosung gibt es nicht.');
    }
    if (raffle.status === 'COMPLETED') {
      throw conflict('Diese Verlosung ist bereits abgeschlossen.');
    }
    if (raffle.status !== 'WINNER_PENDING') {
      throw conflict('Es liegt kein gezogener Gewinner vor, der bestätigt werden könnte.');
    }

    const draw = await tx.xpRaffleDraw.findFirst({
      where: { raffleId },
      orderBy: { version: 'desc' },
    });
    if (!draw) {
      throw conflict('Zu dieser Verlosung gibt es keine Ziehung.');
    }

    await tx.xpRaffleEntry.update({
      where: { id: draw.winnerEntryId },
      data: { status: 'WINNER' },
    });

    // Ein XP-Gewinn läuft über dieselbe Engine wie alles andere.
    let prizeXpAwarded = 0;
    if (raffle.prizeKind === 'XP_PRIZE' && raffle.prizeXp && raffle.prizeXp > 0) {
      const booking = await applyXpWithin(
        tx,
        {
          discordId: draw.winnerDiscordId,
          delta: raffle.prizeXp,
          source: 'RAFFLE_PRIZE',
          reason: `XP-Glücksrad gewonnen: ${raffle.title}`,
          actorDiscordId: actor.discordId,
          idempotencyKey: `raffle-prize:${draw.id}`,
        },
        options,
      );
      prizeXpAwarded = booking.delta;
    }

    await tx.xpRaffleDraw.update({
      where: { id: draw.id },
      data: { confirmedByDiscordId: actor.discordId, confirmedAt: now },
    });

    const updated = await tx.xpRaffle.update({
      where: { id: raffleId },
      data: { status: 'COMPLETED', completedAt: now, confirmedDrawId: draw.id },
    });

    return { raffle: updated, draw, prizeXpAwarded };
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_WINNER_CONFIRMED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: result.draw.winnerDiscordId,
    targetLabel: result.raffle.title,
    success: true,
    metadata: {
      raffleId,
      drawId: result.draw.id,
      version: result.draw.version,
      prizeKind: result.raffle.prizeKind,
      prizeXpAwarded: result.prizeXpAwarded,
    },
  });

  return result;
}

/**
 * Bricht eine Verlosung ab und zahlt jeden Einsatz zurück.
 *
 * Die Rückzahlungen laufen in Stapeln durch eigene Transaktionen. Jede
 * Rückzahlung hängt an einem eindeutigen Schlüssel - ein zweiter Anlauf nach
 * einem Abbruch mitten im Vorgang zahlt deshalb nicht doppelt, sondern nur
 * das, was noch offen ist.
 */
export async function cancelRaffle(
  actor: RaffleActor,
  raffleId: string,
  reason: string,
  options: XpEngineOptions & { now?: Date } = {},
): Promise<{ raffle: XpRaffle; refundedEntries: number; refundedXp: number }> {
  const now = options.now ?? new Date();
  const raffle = await requireRaffle(raffleId);
  if (raffle.status === 'CANCELLED') {
    throw conflict('Diese Verlosung ist bereits abgebrochen.');
  }
  if (raffle.status === 'COMPLETED') {
    throw conflict('Eine abgeschlossene Verlosung lässt sich nicht mehr abbrechen.');
  }

  const open = await prisma.xpRaffleEntry.findMany({
    where: { raffleId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  });

  let refundedEntries = 0;
  let refundedXp = 0;
  const CHUNK = 50;

  for (let offset = 0; offset < open.length; offset += CHUNK) {
    const chunk = open.slice(offset, offset + CHUNK);
    await prisma.$transaction(
      async (tx) => {
        for (const entry of chunk) {
          const refund = await refundEntry(
            tx,
            entry,
            {
              reason: 'RAFFLE_CANCELLED',
              note: reason,
              actorDiscordId: actor.discordId,
              raffleTitle: raffle.title,
              status: 'REFUNDED',
            },
            options,
          );
          if (!refund.alreadyRefunded) {
            refundedEntries += 1;
            refundedXp += refund.refunded;
          }
        }
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await refreshCounters(tx, raffleId);
    return tx.xpRaffle.update({
      where: { id: raffleId },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason, refundedAt: now },
    });
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_CANCELLED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: raffle.title,
    success: true,
    metadata: { raffleId, reason, refundedEntries, refundedXp },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.XP_RAFFLE_REFUND,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetLabel: raffle.title,
    success: true,
    metadata: { raffleId, refundedEntries, refundedXp, reason: 'RAFFLE_CANCELLED' },
  });

  logger.info('Verlosung abgebrochen', { raffleId, refundedEntries, refundedXp });

  return { raffle: updated, refundedEntries, refundedXp };
}

/** Die zuletzt erzeugte Ziehung einer Verlosung. */
export async function latestDraw(raffleId: string): Promise<XpRaffleDraw | null> {
  return prisma.xpRaffleDraw.findFirst({ where: { raffleId }, orderBy: { version: 'desc' } });
}

export async function allDraws(raffleId: string): Promise<XpRaffleDraw[]> {
  return prisma.xpRaffleDraw.findMany({ where: { raffleId }, orderBy: { version: 'asc' } });
}

async function nextVersion(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  raffleId: string,
): Promise<number> {
  const last = await tx.xpRaffleDraw.findFirst({
    where: { raffleId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}
