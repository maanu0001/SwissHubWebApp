import { prisma } from '@swisshub/database';
import type { TournamentBlockEntry } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';
import type { TournamentActor } from './events';

/**
 * Turniersperren.
 *
 * Eine eigene Sperrliste neben der des Ticketsystems, und das mit Absicht:
 * wer im Support ausfaellig wird, hat deswegen nicht bei einem Turnier
 * betrogen, und umgekehrt. Eine gemeinsame Liste waere bequemer und
 * ungerechter.
 *
 * Geprueft wird die Sperre in `checkEligibility` - also bei jeder Anmeldung,
 * ueber die WebApp wie ueber Discord.
 */

/** Alle Sperren dieses Servers, die laufende zuerst. */
export async function listBlocks(): Promise<
  Array<TournamentBlockEntry & { aktiv: boolean }>
> {
  const guildId = await resolveGuildId();
  const eintraege = await prisma.tournamentBlockEntry.findMany({
    where: { guildId },
    orderBy: [{ liftedAt: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });

  const jetzt = new Date();
  return eintraege.map((eintrag) => ({
    ...eintrag,
    aktiv: eintrag.liftedAt === null && (eintrag.expiresAt === null || eintrag.expiresAt > jetzt),
  }));
}

/**
 * Ein Mitglied von der Turnierteilnahme ausschliessen.
 *
 * Laufende Anmeldungen bleiben bestehen: eine Sperre verhindert neue
 * Anmeldungen, sie wirft niemanden mitten aus einem Turnier. Wer jemanden
 * auch aus einem laufenden Turnier nehmen will, disqualifiziert dort - das
 * ist eine andere Entscheidung und wird auch anders protokolliert.
 */
export async function blockMember(
  input: { discordId: string; username: string | null; reason: string; expiresAt: Date | null },
  actor: TournamentActor,
): Promise<TournamentBlockEntry> {
  const guildId = await resolveGuildId();

  const laufend = await prisma.tournamentBlockEntry.findFirst({
    where: {
      guildId,
      discordId: input.discordId,
      liftedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (laufend) {
    throw new AppError('CONFLICT', {
      userMessage: 'Dieses Mitglied ist bereits von Turnieren ausgeschlossen.',
    });
  }

  return prisma.tournamentBlockEntry.create({
    data: {
      guildId,
      discordId: input.discordId,
      username: input.username,
      reason: input.reason.trim().slice(0, 500),
      expiresAt: input.expiresAt,
      blockedByDiscordId: actor.discordId,
    },
  });
}

/** Eine Sperre aufheben. Der Eintrag bleibt - das Protokoll auch. */
export async function liftBlock(blockId: string): Promise<void> {
  await prisma.tournamentBlockEntry.update({
    where: { id: blockId },
    data: { liftedAt: new Date() },
  });
}
