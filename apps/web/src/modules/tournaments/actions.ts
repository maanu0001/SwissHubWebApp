'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AppError } from '@swisshub/shared';
import { tournaments } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { ladeMatchMitZugriff, tournamentActor } from '@/server/tournaments';

/**
 * Aktionen der Teilnehmer.
 *
 * Anmelden, Team gruenden, einchecken, Resultate melden. Alle sind
 * Selbstbedienung: sie wirken auf die eigene Anmeldung, das eigene Team, das
 * eigene Match - und wer das ist, entscheidet der Server, nie eine Kennung
 * aus dem Browser.
 *
 * Die Verwaltung liegt in `admin-actions.ts`.
 */

const teamSchema = z.object({ teamId: z.string().cuid() });

/** Prueft, dass der Aufrufer Captain dieses Teams ist. */
async function assertCaptain(
  teamId: string,
  discordId: string,
): Promise<{ tournamentId: string }> {
  const team = await tournaments.getTeam(teamId);
  if (!team) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Team existiert nicht.' });
  }
  if (team.captainDiscordId !== discordId) {
    // Dieselbe Meldung wie bei einem nicht vorhandenen Team: sonst liesse
    // sich an der Antwort ablesen, welche Teams es gibt.
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Team existiert nicht.' });
  }
  return { tournamentId: team.tournamentId };
}

// --- Anmeldung -------------------------------------------------------------

export const registerAction = defineAction(
  {
    name: 'tournaments.register',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.participate,
    schema: z.object({
      tournamentId: z.string().cuid(),
      teamId: z.string().cuid().optional(),
      rulesVersion: z.number().int().min(1),
      rulesAccepted: z.literal(true, {
        errorMap: () => ({ message: 'Bitte das Regelwerk bestätigen.' }),
      }),
      answers: z.record(z.string().max(4000)).default({}),
    }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const registration = await tournaments.register(
      {
        tournamentId: input.tournamentId,
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        teamId: input.teamId ?? null,
        rulesVersion: input.rulesVersion,
        answers: input.answers,
      },
      tournamentActor(ctx),
    );

    revalidatePath('/turniere');
    return { status: registration.status, waitlistPosition: registration.waitlistPosition };
  },
);

export const withdrawAction = defineAction(
  {
    name: 'tournaments.withdraw',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ registrationId: z.string().cuid() }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const eintrag = await prisma.tournamentRegistration.findUnique({
      where: { id: input.registrationId },
      select: { discordId: true, teamId: true, tournamentId: true },
    });
    if (!eintrag) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Anmeldung existiert nicht.' });
    }

    // Zurueckziehen darf, wer angemeldet hat - bei Teams also der Captain.
    if (eintrag.discordId !== ctx.user.discordId) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Anmeldung existiert nicht.' });
    }

    await tournaments.withdrawRegistration(input.registrationId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

// --- Teams -----------------------------------------------------------------

export const createTeamAction = defineAction(
  {
    name: 'tournaments.teams.create',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.participate,
    schema: z.object({
      tournamentId: z.string().cuid(),
      name: z.string().min(2).max(60),
      tag: z.string().max(8).optional(),
      logoUrl: z.string().url().max(500).optional(),
    }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const team = await tournaments.createTeam(
      {
        tournamentId: input.tournamentId,
        name: input.name,
        tag: input.tag ?? null,
        logoUrl: input.logoUrl ?? null,
        captainDiscordId: ctx.user.discordId,
        captainUsername: ctx.user.username,
      },
      tournamentActor(ctx),
    );

    revalidatePath('/turniere');
    return { teamId: team.id };
  },
);

export const updateTeamAction = defineAction(
  {
    name: 'tournaments.teams.update',
    module: 'tournaments',
    selfService: true,
    schema: teamSchema.extend({
      name: z.string().min(2).max(60).optional(),
      tag: z.string().max(8).nullable().optional(),
      logoUrl: z.string().url().max(500).nullable().optional(),
    }),
    rateLimit: 'tournamentParticipate',
  },
  async ({ ctx, input }) => {
    await assertCaptain(input.teamId, ctx.user.discordId);
    const { teamId, ...rest } = input;
    await tournaments.updateTeam(teamId, rest, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const inviteToTeamAction = defineAction(
  {
    name: 'tournaments.teams.invite',
    module: 'tournaments',
    selfService: true,
    schema: teamSchema.extend({
      discordId: z.string().regex(/^\d{17,20}$/u),
      username: z.string().min(1).max(64),
      role: z.enum(['PLAYER', 'SUBSTITUTE', 'COACH']).default('PLAYER'),
    }),
    rateLimit: 'tournamentInvite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertCaptain(input.teamId, ctx.user.discordId);
    await tournaments.inviteToTeam(
      {
        teamId: input.teamId,
        discordId: input.discordId,
        username: input.username,
        role: input.role,
      },
      tournamentActor(ctx),
    );
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const revokeInviteAction = defineAction(
  {
    name: 'tournaments.teams.revokeInvite',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ inviteId: z.string().cuid() }),
    rateLimit: 'tournamentInvite',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const einladung = await prisma.tournamentTeamInvite.findUnique({
      where: { id: input.inviteId },
      select: { teamId: true },
    });
    if (!einladung) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Einladung existiert nicht.' });
    }
    await assertCaptain(einladung.teamId, ctx.user.discordId);

    await tournaments.revokeInvite(input.inviteId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const respondInviteAction = defineAction(
  {
    name: 'tournaments.teams.respondInvite',
    module: 'tournaments',
    // Selbstbedienung: die eigene Einladung. Wer sie bekommen hat,
    // entscheidet der Dienst anhand der Kennung - nicht eine Berechtigung.
    selfService: true,
    schema: z.object({ inviteId: z.string().cuid(), annehmen: z.boolean() }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    if (input.annehmen) {
      await tournaments.acceptInvite(input.inviteId, ctx.user.discordId, tournamentActor(ctx));
    } else {
      await tournaments.declineInvite(input.inviteId, ctx.user.discordId);
    }
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const removeMemberAction = defineAction(
  {
    name: 'tournaments.teams.removeMember',
    module: 'tournaments',
    selfService: true,
    schema: teamSchema.extend({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertCaptain(input.teamId, ctx.user.discordId);
    await tournaments.removeMember(input.teamId, input.discordId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const setMemberRoleAction = defineAction(
  {
    name: 'tournaments.teams.setMemberRole',
    module: 'tournaments',
    selfService: true,
    schema: teamSchema.extend({
      discordId: z.string().regex(/^\d{17,20}$/u),
      role: z.enum(['PLAYER', 'SUBSTITUTE', 'COACH']),
    }),
    rateLimit: 'tournamentParticipate',
  },
  async ({ ctx, input }) => {
    await assertCaptain(input.teamId, ctx.user.discordId);
    await tournaments.setMemberRole(
      input.teamId,
      input.discordId,
      input.role,
      tournamentActor(ctx),
    );
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const transferCaptaincyAction = defineAction(
  {
    name: 'tournaments.teams.transferCaptaincy',
    module: 'tournaments',
    selfService: true,
    schema: teamSchema.extend({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertCaptain(input.teamId, ctx.user.discordId);
    await tournaments.transferCaptaincy(input.teamId, input.discordId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

// --- Check-in --------------------------------------------------------------

export const checkinAction = defineAction(
  {
    name: 'tournaments.checkin',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.participate,
    schema: z.object({ tournamentId: z.string().cuid() }),
    rateLimit: 'tournamentParticipate',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await tournaments.checkIn(
      input.tournamentId,
      ctx.user.discordId,
      tournamentActor(ctx),
    );
    revalidatePath('/turniere');
    return ergebnis;
  },
);

export const undoCheckinAction = defineAction(
  {
    name: 'tournaments.checkin.undo',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ tournamentId: z.string().cuid() }),
    rateLimit: 'tournamentParticipate',
  },
  async ({ ctx, input }) => {
    const ergebnis = await tournaments.undoCheckIn(input.tournamentId, ctx.user.discordId);
    revalidatePath('/turniere');
    return ergebnis;
  },
);

// --- Resultate -------------------------------------------------------------

const spielSchema = z.object({
  index: z.number().int().min(1).max(9),
  map: z.string().max(60).nullable().optional(),
  scoreA: z.number().int().min(0).max(99),
  scoreB: z.number().int().min(0).max(99),
});

export const reportResultAction = defineAction(
  {
    name: 'tournaments.matches.report',
    module: 'tournaments',
    // Selbstbedienung: das eigene Match. Fuer welche Seite jemand sprechen
    // darf, entscheidet der Server aus der Teamzugehoerigkeit - nie der
    // Browser.
    selfService: true,
    schema: z.object({
      matchId: z.string().cuid(),
      scoreA: z.number().int().min(0).max(99),
      scoreB: z.number().int().min(0).max(99),
      games: z.array(spielSchema).max(9).default([]),
      comment: z.string().max(1000).optional(),
      evidenceUrl: z.string().url().max(500).optional(),
    }),
    rateLimit: 'tournamentResult',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { match, slot, zugriff } = await ladeMatchMitZugriff(ctx, input.matchId);

    if (!slot && !zugriff.resultsOverride) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Nur die Captains der beiden Teams können ein Resultat melden.',
      });
    }
    if (!slot) {
      throw new AppError('FORBIDDEN', {
        userMessage:
          'Als Turnierleitung wird ein Resultat über die Korrektur gesetzt, nicht über die Meldung.',
      });
    }

    const ergebnis = await tournaments.reportResult(
      {
        matchId: match.id,
        slot,
        reportedByDiscordId: ctx.user.discordId,
        reportedByUsername: ctx.user.username,
        scoreA: input.scoreA,
        scoreB: input.scoreB,
        games: input.games,
        comment: input.comment ?? null,
        evidenceUrl: input.evidenceUrl ?? null,
      },
      tournamentActor(ctx),
    );

    revalidatePath(`/turniere/matches/${match.id}`);
    return { bestaetigt: ergebnis.bestaetigt, strittig: ergebnis.strittig };
  },
);

export const confirmResultAction = defineAction(
  {
    name: 'tournaments.matches.confirm',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ matchId: z.string().cuid() }),
    rateLimit: 'tournamentResult',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { match, slot } = await ladeMatchMitZugriff(ctx, input.matchId);
    if (!slot) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Nur die Captains der beiden Teams können ein Resultat bestätigen.',
      });
    }

    await tournaments.confirmResult(match.id, slot, ctx.user.discordId, tournamentActor(ctx));
    revalidatePath(`/turniere/matches/${match.id}`);
    return { ok: true };
  },
);

export const rejectResultAction = defineAction(
  {
    name: 'tournaments.matches.reject',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ matchId: z.string().cuid(), reason: z.string().min(5).max(2000) }),
    rateLimit: 'tournamentResult',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { match, slot } = await ladeMatchMitZugriff(ctx, input.matchId);
    if (!slot) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Nur die Captains der beiden Teams können widersprechen.',
      });
    }

    await tournaments.rejectResult(
      match.id,
      slot,
      input.reason,
      ctx.user.discordId,
      ctx.user.username,
      tournamentActor(ctx),
    );
    revalidatePath(`/turniere/matches/${match.id}`);
    return { ok: true };
  },
);

export const setReadyAction = defineAction(
  {
    name: 'tournaments.matches.ready',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ matchId: z.string().cuid(), bereit: z.boolean() }),
    rateLimit: 'tournamentResult',
  },
  async ({ ctx, input }) => {
    const { match, slot } = await ladeMatchMitZugriff(ctx, input.matchId);
    if (!slot) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Nur die Captains der beiden Teams können sich bereit melden.',
      });
    }

    const aktualisiert = await tournaments.setReady(match.id, slot, input.bereit);
    revalidatePath(`/turniere/matches/${match.id}`);
    return { readyA: aktualisiert.readyA, readyB: aktualisiert.readyB };
  },
);

export const openDisputeAction = defineAction(
  {
    name: 'tournaments.matches.dispute',
    module: 'tournaments',
    selfService: true,
    schema: z.object({ matchId: z.string().cuid(), reason: z.string().min(5).max(2000) }),
    rateLimit: 'tournamentResult',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { match, slot } = await ladeMatchMitZugriff(ctx, input.matchId);
    if (!slot) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Nur die Beteiligten können einen Einspruch erheben.',
      });
    }

    await tournaments.openDispute(
      match.id,
      input.reason,
      ctx.user.discordId,
      ctx.user.username,
      tournamentActor(ctx),
    );
    revalidatePath(`/turniere/matches/${match.id}`);
    return { ok: true };
  },
);
