import { prisma } from '@swisshub/database';
import type { TournamentPrize, TournamentStreamStatus } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { tournamentEvent, type TournamentActor } from './events';
import { announce } from './discord';

const logger = createLogger('tournaments:stream');

/**
 * Livestream, Caster und Preise.
 *
 * Drei kleine Bereiche mit demselben Muster: lesen, schreiben, ein Ereignis
 * vermerken. Drei Dateien mit je dreissig Zeilen machten die Ablage
 * uebersichtlicher und den Ueberblick schlechter.
 */

// --- Livestream ------------------------------------------------------------

export interface StreamInput {
  status: TournamentStreamStatus;
  streamUrl?: string | null;
  vodUrl?: string | null;
  highlightUrl?: string | null;
}

/**
 * Den Stream-Stand eines Matches setzen.
 *
 * Geht der Stream live, meldet der Bot es einmal - nicht bei jeder Aenderung.
 * Ein Kanal, der bei jeder Statusaenderung pingt, wird stummgeschaltet.
 */
export async function setMatchStream(
  matchId: string,
  input: StreamInput,
  actor: TournamentActor,
): Promise<void> {
  for (const [name, wert] of [
    ['Stream-Adresse', input.streamUrl],
    ['VOD-Adresse', input.vodUrl],
    ['Highlight-Adresse', input.highlightUrl],
  ] as const) {
    if (wert && !/^https:\/\/\S+$/u.test(wert)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die ${name} braucht eine vollständige https-Adresse.`,
      });
    }
  }

  const vorher = await prisma.tournamentMatch.findUniqueOrThrow({
    where: { id: matchId },
    select: { streamStatus: true, tournamentId: true, matchNumber: true },
  });

  const match = await prisma.tournamentMatch.update({
    where: { id: matchId },
    data: {
      streamStatus: input.status,
      ...(input.streamUrl !== undefined ? { streamUrl: input.streamUrl } : {}),
      ...(input.vodUrl !== undefined ? { vodUrl: input.vodUrl } : {}),
      ...(input.highlightUrl !== undefined ? { highlightUrl: input.highlightUrl } : {}),
    },
  });

  if (input.status === 'LIVE' && vorher.streamStatus !== 'LIVE') {
    await announce(match.tournamentId, 'STREAM_LIVE', { actorDiscordId: actor.discordId });
    logger.info('Stream live gemeldet', { matchId, match: match.matchNumber });
  }
}

/**
 * Wer ein Match kommentiert oder beobachtet.
 *
 * Ein Caster ist kein Teilnehmer: er bekommt keinen Zugriff auf den
 * Match-Kanal, sondern steht nur im Zeitplan. Wer mitlesen soll, wird
 * ausdruecklich als Beobachter zur Turnierleitung hinzugefuegt.
 */
export async function setMatchCasters(
  matchId: string,
  caster: Array<{ discordId: string; username: string; role?: string }>,
  actor: TournamentActor,
): Promise<void> {
  const match = await prisma.tournamentMatch.findUniqueOrThrow({
    where: { id: matchId },
    select: { tournamentId: true, matchNumber: true },
  });

  const erlaubteRollen = new Set(['CASTER', 'OBSERVER', 'HOST']);

  await prisma.$transaction(async (tx) => {
    await tx.tournamentMatchCaster.deleteMany({ where: { matchId } });
    if (caster.length === 0) {
      return;
    }
    await tx.tournamentMatchCaster.createMany({
      data: caster.slice(0, 10).map((eintrag) => ({
        matchId,
        discordId: eintrag.discordId,
        username: eintrag.username.slice(0, 64),
        role: erlaubteRollen.has(eintrag.role ?? '') ? eintrag.role! : 'CASTER',
      })),
      skipDuplicates: true,
    });
  });

  await tournamentEvent(match.tournamentId, 'STAFF_CHANGED', actor, {
    match: match.matchNumber,
    caster: caster.map((eintrag) => eintrag.username),
  });
}

/**
 * Der Stream-Zeitplan eines Turniers.
 *
 * Nur Matches, die tatsaechlich gestreamt werden - eine Liste aller Matches
 * waere kein Zeitplan, sondern das Bracket in anderer Form.
 */
export async function getStreamPlan(tournamentId: string) {
  return prisma.tournamentMatch.findMany({
    where: {
      tournamentId,
      streamStatus: { in: ['PLANNED', 'LIVE', 'FINISHED'] },
    },
    orderBy: [{ scheduledAt: 'asc' }, { matchNumber: 'asc' }],
    include: {
      stage: { select: { name: true } },
      casters: true,
      participantA: {
        select: { id: true, username: true, team: { select: { name: true, tag: true, logoUrl: true } } },
      },
      participantB: {
        select: { id: true, username: true, team: { select: { name: true, tag: true, logoUrl: true } } },
      },
    },
  });
}

// --- Preise ----------------------------------------------------------------

export interface PrizeInput {
  placement: number;
  title: string;
  description?: string | null;
  value?: string | null;
  sponsorName?: string | null;
  sponsorUrl?: string | null;
  sponsorLogoUrl?: string | null;
}

export async function upsertPrize(
  tournamentId: string,
  input: PrizeInput,
  actor: TournamentActor,
): Promise<TournamentPrize> {
  if (input.placement < 1 || input.placement > 64) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Platzierung muss zwischen 1 und 64 liegen.',
    });
  }

  for (const [name, wert] of [
    ['Sponsor-Adresse', input.sponsorUrl],
    ['Sponsor-Logo', input.sponsorLogoUrl],
  ] as const) {
    if (wert && !/^https:\/\/\S+$/u.test(wert)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die ${name} braucht eine vollständige https-Adresse.`,
      });
    }
  }

  const daten = {
    title: input.title.trim().slice(0, 120),
    description: input.description?.slice(0, 500) ?? null,
    value: input.value?.slice(0, 120) ?? null,
    sponsorName: input.sponsorName?.slice(0, 120) ?? null,
    sponsorUrl: input.sponsorUrl ?? null,
    sponsorLogoUrl: input.sponsorLogoUrl ?? null,
  };

  const preis = await prisma.tournamentPrize.upsert({
    where: { tournamentId_placement: { tournamentId, placement: input.placement } },
    create: { tournamentId, placement: input.placement, ...daten },
    update: daten,
  });

  await tournamentEvent(tournamentId, 'PRIZE_UPDATED', actor, {
    platz: input.placement,
    titel: preis.title,
  });
  return preis;
}

export async function deletePrize(prizeId: string, actor: TournamentActor): Promise<void> {
  const preis = await prisma.tournamentPrize.delete({ where: { id: prizeId } });
  await tournamentEvent(preis.tournamentId, 'PRIZE_UPDATED', actor, {
    platz: preis.placement,
    entfernt: true,
  });
}

/**
 * Preise den Platzierungen zuordnen.
 *
 * Erst nach dem Turnier. Wer welchen Platz belegt hat, steht am Teilnehmer -
 * hier wird nur verknuepft, nicht entschieden.
 */
export async function awardPrizes(tournamentId: string, actor: TournamentActor): Promise<number> {
  const preise = await prisma.tournamentPrize.findMany({
    where: { tournamentId, awardedParticipantId: null },
    orderBy: { placement: 'asc' },
  });

  let zugeteilt = 0;
  for (const preis of preise) {
    const teilnehmer = await prisma.tournamentParticipant.findFirst({
      where: { tournamentId, placement: preis.placement },
      select: { id: true },
    });
    if (!teilnehmer) {
      continue;
    }
    await prisma.tournamentPrize.update({
      where: { id: preis.id },
      data: {
        awardedParticipantId: teilnehmer.id,
        awardedAt: new Date(),
        status: 'AWARDED',
      },
    });
    zugeteilt += 1;
  }

  if (zugeteilt > 0) {
    await tournamentEvent(tournamentId, 'PRIZE_UPDATED', actor, { zugeteilt });
  }
  return zugeteilt;
}

/** Einen Preis als übergeben markieren. */
export async function markPrizeDelivered(prizeId: string, actor: TournamentActor): Promise<void> {
  const preis = await prisma.tournamentPrize.update({
    where: { id: prizeId },
    data: { status: 'DELIVERED', deliveredAt: new Date() },
  });
  await tournamentEvent(preis.tournamentId, 'PRIZE_UPDATED', actor, {
    platz: preis.placement,
    uebergeben: true,
  });
}

export async function listPrizes(tournamentId: string) {
  const preise = await prisma.tournamentPrize.findMany({
    where: { tournamentId },
    orderBy: { placement: 'asc' },
  });

  const zugeteilt = preise
    .map((preis) => preis.awardedParticipantId)
    .filter((id): id is string => id !== null);

  const teilnehmer =
    zugeteilt.length > 0
      ? await prisma.tournamentParticipant.findMany({
          where: { id: { in: zugeteilt } },
          select: { id: true, username: true, team: { select: { name: true, tag: true, logoUrl: true } } },
        })
      : [];

  const nachId = new Map(teilnehmer.map((eintrag) => [eintrag.id, eintrag]));

  return preise.map((preis) => ({
    ...preis,
    gewinner: preis.awardedParticipantId ? (nachId.get(preis.awardedParticipantId) ?? null) : null,
  }));
}

// --- Turnierleitung --------------------------------------------------------

export async function setStaff(
  tournamentId: string,
  eintraege: Array<{
    discordId: string;
    username: string;
    role: 'OWNER' | 'ADMIN' | 'REFEREE' | 'CASTER' | 'OBSERVER';
  }>,
  actor: TournamentActor,
): Promise<void> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  // Ohne mindestens eine Person mit Vollzugriff liesse sich das Turnier von
  // niemandem mehr verwalten - ausser von jemandem mit `tournaments.admin`.
  const mitVollzugriff = eintraege.filter((eintrag) => eintrag.role === 'OWNER');
  if (mitVollzugriff.length === 0) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Mindestens eine Person muss die Turnierleitung übernehmen.',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentStaff.deleteMany({ where: { tournamentId } });
    await tx.tournamentStaff.createMany({
      data: eintraege.slice(0, 50).map((eintrag) => ({
        tournamentId,
        discordId: eintrag.discordId,
        username: eintrag.username.slice(0, 64),
        role: eintrag.role,
        addedByDiscordId: actor.discordId,
      })),
      skipDuplicates: true,
    });
  });

  await tournamentEvent(tournamentId, 'STAFF_CHANGED', actor, {
    anzahl: eintraege.length,
    turnier: tournament.name,
  });
}

export async function listStaff(tournamentId: string) {
  return prisma.tournamentStaff.findMany({
    where: { tournamentId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
}
