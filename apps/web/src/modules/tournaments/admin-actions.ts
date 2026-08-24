'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { tournaments } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { ladeTurnierMitZugriff, tournamentActor } from '@/server/tournaments';

/**
 * Verwaltung des Turniermoduls.
 *
 * Jede Aktion laedt das Turnier ueber `ladeTurnierMitZugriff` - dieselbe
 * Pruefung wie die Seiten - und verlangt danach ausdruecklich das Recht, das
 * sie braucht. Die zentrale Berechtigung allein genuegt nicht: sie sagt, dass
 * jemand Turniere leiten darf, nicht welche.
 */

const turnierSchema = z.object({ tournamentId: z.string().cuid() });

/** Wirft, wenn das benoetigte Recht an diesem Turnier fehlt. */
function assertRecht(
  zugriff: tournaments.TournamentAccess,
  recht: keyof tournaments.TournamentAccess,
  meldung: string,
): void {
  if (!zugriff[recht]) {
    throw new AppError('FORBIDDEN', { userMessage: meldung });
  }
}

/**
 * Zeitpunkte aus dem Browser.
 *
 * Bewusst als benannte Bausteine und nicht jedes Mal neu inmitten der
 * Aktionsbeschreibung: in einer `'use server'`-Datei darf im Modulrumpf keine
 * gewoehnliche Funktion stehen, und eine Pfeilfunktion in einer
 * Schema-Eigenschaft ist genau das. Der Uebersetzer lehnt sie ab - hier steht
 * sie einmal und wird wiederverwendet.
 */
const zeitpunktRoh = z.string().datetime();
const zeitpunktPflicht = zeitpunktRoh.pipe(z.coerce.date());
const zeitpunktNullbar = zeitpunktPflicht.nullable();
const zeitpunkt = zeitpunktNullbar.optional();

const turnierFelder = {
  name: z.string().min(3).max(120),
  slug: z.string().max(60).optional(),
  gameName: z.string().min(1).max(60),
  gameId: z.string().cuid().nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  rules: z.string().max(40_000).nullable().optional(),
  mode: z.enum(['SOLO', 'TEAM']),
  access: z.enum(['OPEN', 'APPROVAL', 'INVITE_ONLY']),
  format: z.enum([
    'SINGLE_ELIMINATION',
    'DOUBLE_ELIMINATION',
    'ROUND_ROBIN',
    'SWISS',
    'GROUPS_THEN_ELIMINATION',
  ]),
  seeding: z.enum(['RANDOM', 'MANUAL', 'REGISTRATION_ORDER', 'RATING']),
  minTeamSize: z.number().int().min(1).max(20).optional(),
  maxTeamSize: z.number().int().min(1).max(20).optional(),
  maxSubstitutes: z.number().int().min(0).max(10).optional(),
  maxParticipants: z.number().int().min(0).max(1024).optional(),
  minParticipants: z.number().int().min(2).max(1024).optional(),
  registrationOpensAt: zeitpunkt,
  registrationClosesAt: zeitpunkt,
  checkinOpensAt: zeitpunkt,
  checkinClosesAt: zeitpunkt,
  rosterLockAt: zeitpunkt,
  startsAt: zeitpunkt,
  estimatedEndAt: zeitpunkt,
  checkinRequired: z.boolean().optional(),
  autoRemoveMissedCheckin: z.boolean().optional(),
  groupCount: z.number().int().min(0).max(32).optional(),
  advancePerGroup: z.number().int().min(1).max(16).optional(),
  swissRounds: z.number().int().min(0).max(20).optional(),
  pointsPerWin: z.number().int().min(0).max(10).optional(),
  pointsPerDraw: z.number().int().min(0).max(10).optional(),
  pointsPerLoss: z.number().int().min(0).max(10).optional(),
  tiebreakers: z
    .array(z.enum(['HEAD_TO_HEAD', 'SCORE_DIFFERENCE', 'SCORE_FOR', 'WINS', 'BUCHHOLZ']))
    .max(5)
    .optional(),
  defaultBestOf: z.number().int().min(1).max(9).optional(),
  mapPool: z.array(z.string().max(60)).max(20).optional(),
  serverRegion: z.string().max(40).nullable().optional(),
  bannerUrl: z.string().url().max(500).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  accentColor: z.number().int().min(0).max(0xffffff).nullable().optional(),
  announcementChannelId: z.string().nullable().optional(),
  matchCategoryId: z.string().nullable().optional(),
  staffCategoryId: z.string().nullable().optional(),
  streamChannelId: z.string().nullable().optional(),
  pingRoleIds: z.array(z.string()).max(10).optional(),
  matchChannelRetentionHours: z.number().int().min(0).max(720).optional(),
  createMatchChannels: z.boolean().optional(),
  twitchUrl: z.string().url().max(500).nullable().optional(),
  youtubeUrl: z.string().url().max(500).nullable().optional(),
  streamUrl: z.string().url().max(500).nullable().optional(),
  requiredRoleId: z.string().nullable().optional(),
  minLevel: z.number().int().min(0).max(999).optional(),
  requiresPremium: z.boolean().optional(),
};

// --- Turnier ---------------------------------------------------------------

export const createTournamentAction = defineAction(
  {
    name: 'tournaments.create',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.create,
    schema: z.object(turnierFelder),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const tournament = await tournaments.createTournament(input, tournamentActor(ctx));

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_CREATED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: tournament.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/turniere');
    return { tournamentId: tournament.id, slug: tournament.slug };
  },
);

export const updateTournamentAction = defineAction(
  {
    name: 'tournaments.update',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.manage,
    schema: turnierSchema
      .extend(turnierFelder)
      .partial({ name: true, gameName: true, mode: true, access: true, format: true, seeding: true })
      .extend({ tournamentId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'manage', 'Du kannst dieses Turnier nicht bearbeiten.');

    const { tournamentId, ...rest } = input;
    const tournament = await tournaments.updateTournament(tournamentId, rest, tournamentActor(ctx));

    revalidatePath('/turniere');
    revalidatePath(`/turniere/${tournament.slug}`);
    return { slug: tournament.slug };
  },
);

export const publishTournamentAction = defineAction(
  {
    name: 'tournaments.publish',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.publish,
    schema: turnierSchema,
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { zugriff, tournament } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'publish', 'Du kannst dieses Turnier nicht veröffentlichen.');

    await tournaments.publishTournament(input.tournamentId, tournamentActor(ctx));
    await tournaments.announce(input.tournamentId, 'REGISTRATION_OPEN', {
      actorDiscordId: ctx.user.discordId,
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_PUBLISHED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: tournament.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const setStatusAction = defineAction(
  {
    name: 'tournaments.status',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.publish,
    schema: turnierSchema.extend({
      status: z.enum([
        'REGISTRATION_OPEN',
        'REGISTRATION_CLOSED',
        'CHECKIN_OPEN',
        'CHECKIN_CLOSED',
        'READY',
        'RUNNING',
        'PAUSED',
        'COMPLETED',
        'ARCHIVED',
      ]),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { zugriff, tournament } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'publish', 'Du kannst den Zustand dieses Turniers nicht ändern.');

    // Der Start braucht den Startcheck: ein Turnier ohne Bracket zu starten
    // heisst, dass alle warten, bis jemand merkt, was fehlt.
    if (input.status === 'RUNNING' && tournament.status !== 'PAUSED') {
      const bericht = await tournaments.preflight(input.tournamentId, 'START');
      const blocker = bericht.filter((eintrag) => eintrag.status === 'error');
      if (blocker.length > 0) {
        throw new AppError('CONFLICT', {
          userMessage: `Das Turnier ist noch nicht startbereit: ${blocker[0]!.detail}`,
        });
      }
    }

    await tournaments.setTournamentStatus(input.tournamentId, input.status, tournamentActor(ctx));

    // Ankuendigungen an den Phasen, an denen sie hingehoeren.
    if (input.status === 'CHECKIN_OPEN') {
      await tournaments.sendeCheckinAufruf(input.tournamentId);
    }
    if (input.status === 'RUNNING') {
      await tournaments.announce(input.tournamentId, 'TOURNAMENT_START', {
        actorDiscordId: ctx.user.discordId,
      });
    }
    if (input.status === 'COMPLETED') {
      await tournaments.berechnePlatzierungen(input.tournamentId);
      await tournaments.awardPrizes(input.tournamentId, tournamentActor(ctx));
      await tournaments.announce(input.tournamentId, 'TOURNAMENT_COMPLETED', {
        actorDiscordId: ctx.user.discordId,
      });
    }

    const AUDIT: Partial<Record<typeof input.status, string>> = {
      RUNNING: AUDIT_ACTIONS.TOURNAMENT_STARTED,
      PAUSED: AUDIT_ACTIONS.TOURNAMENT_PAUSED,
      COMPLETED: AUDIT_ACTIONS.TOURNAMENT_COMPLETED,
      ARCHIVED: AUDIT_ACTIONS.TOURNAMENT_ARCHIVED,
    };
    const audit = AUDIT[input.status];
    if (audit) {
      await safeRecordAudit({
        action: audit,
        module: 'tournaments',
        actorDiscordId: ctx.user.discordId,
        actorUsername: ctx.user.username,
        targetLabel: tournament.name,
        success: true,
        ipHash: metadata.ipHash,
        userAgent: metadata.userAgent,
      });
    }

    revalidatePath('/turniere');
    revalidatePath(`/turniere/${tournament.slug}`);
    return { ok: true };
  },
);

export const cancelTournamentAction = defineAction(
  {
    name: 'tournaments.cancel',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.publish,
    schema: turnierSchema.extend({ reason: z.string().min(5).max(500) }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { zugriff, tournament } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'publish', 'Du kannst dieses Turnier nicht absagen.');

    await tournaments.cancelTournament(input.tournamentId, input.reason, tournamentActor(ctx));
    // Wer angemeldet ist, soll es erfahren - eine Absage, die nur im
    // Dashboard steht, erreicht niemanden.
    await tournaments.announce(input.tournamentId, 'TOURNAMENT_CANCELLED', {
      actorDiscordId: ctx.user.discordId,
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_CANCELLED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: tournament.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { grund: input.reason },
    });

    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const duplicateTournamentAction = defineAction(
  {
    name: 'tournaments.duplicate',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.create,
    schema: turnierSchema.extend({ name: z.string().min(3).max(120) }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'manage', 'Du kannst dieses Turnier nicht als Vorlage verwenden.');

    const neu = await tournaments.duplicateTournament(input.tournamentId, input.name, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { tournamentId: neu.id, slug: neu.slug };
  },
);

// --- Anmeldungen -----------------------------------------------------------

export const approveRegistrationAction = defineAction(
  {
    name: 'tournaments.registrations.approve',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.registrationsManage,
    schema: z.object({ registrationId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { prisma } = await import('@swisshub/database');
    const eintrag = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: input.registrationId },
      select: { tournamentId: true, username: true, discordId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, eintrag.tournamentId);
    assertRecht(zugriff, 'registrationsManage', 'Du kannst hier keine Anmeldungen freigeben.');

    await tournaments.approveRegistration(input.registrationId, tournamentActor(ctx));

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_REGISTRATION_APPROVED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: eintrag.discordId,
      targetLabel: eintrag.username,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const rejectRegistrationAction = defineAction(
  {
    name: 'tournaments.registrations.reject',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.registrationsManage,
    schema: z.object({ registrationId: z.string().cuid(), reason: z.string().min(3).max(500) }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { prisma } = await import('@swisshub/database');
    const eintrag = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: input.registrationId },
      select: { tournamentId: true, username: true, discordId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, eintrag.tournamentId);
    assertRecht(zugriff, 'registrationsManage', 'Du kannst hier keine Anmeldungen ablehnen.');

    await tournaments.rejectRegistration(input.registrationId, input.reason, tournamentActor(ctx));

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_REGISTRATION_REMOVED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: eintrag.discordId,
      targetLabel: eintrag.username,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { grund: input.reason },
    });

    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const promoteWaitlistAction = defineAction(
  {
    name: 'tournaments.registrations.promote',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.registrationsManage,
    schema: turnierSchema,
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'registrationsManage', 'Du kannst hier nicht nachrücken lassen.');

    const anzahl = await tournaments.rueckeAlleNach(input.tournamentId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { nachgerueckt: anzahl };
  },
);

// --- Check-in --------------------------------------------------------------

export const adminCheckinAction = defineAction(
  {
    name: 'tournaments.checkin.confirm',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.checkinManage,
    schema: z.object({ registrationId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const eintrag = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: input.registrationId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, eintrag.tournamentId);
    assertRecht(zugriff, 'checkinManage', 'Du kannst hier keinen Check-in bestätigen.');

    await tournaments.adminConfirmCheckin(input.registrationId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const closeCheckinAction = defineAction(
  {
    name: 'tournaments.checkin.close',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.checkinManage,
    schema: turnierSchema,
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'checkinManage', 'Du kannst den Check-in nicht schliessen.');

    const ergebnis = await tournaments.closeCheckin(input.tournamentId, tournamentActor(ctx));
    await tournaments.setTournamentStatus(input.tournamentId, 'CHECKIN_CLOSED', tournamentActor(ctx));

    revalidatePath('/turniere');
    return ergebnis;
  },
);

// --- Bracket ---------------------------------------------------------------

export const generateBracketAction = defineAction(
  {
    name: 'tournaments.bracket.generate',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.bracketManage,
    schema: turnierSchema.extend({
      setzliste: z.array(z.string().cuid()).max(1024).optional(),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { zugriff, tournament } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'bracketManage', 'Du kannst hier kein Bracket erzeugen.');

    const ergebnis = await tournaments.generateBracket(
      input.tournamentId,
      tournamentActor(ctx),
      input.setzliste ? { setzliste: input.setzliste } : {},
    );

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_BRACKET_GENERATED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: tournament.name,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { matches: ergebnis.matches },
    });

    revalidatePath('/turniere');
    return ergebnis;
  },
);

export const discardBracketAction = defineAction(
  {
    name: 'tournaments.bracket.discard',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.bracketManage,
    schema: turnierSchema,
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'bracketManage', 'Du kannst dieses Bracket nicht verwerfen.');

    await tournaments.discardBracket(input.tournamentId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const generateKnockoutAction = defineAction(
  {
    name: 'tournaments.bracket.knockout',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.bracketManage,
    schema: turnierSchema,
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'bracketManage', 'Du kannst hier keine Endrunde erzeugen.');

    const ergebnis = await tournaments.generateKnockoutFromGroups(input.tournamentId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return ergebnis;
  },
);

export const nextSwissRoundAction = defineAction(
  {
    name: 'tournaments.bracket.swissRound',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.bracketManage,
    schema: turnierSchema,
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'bracketManage', 'Du kannst hier keine Runde auslosen.');

    const ergebnis = await tournaments.generateNextSwissRound(input.tournamentId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return ergebnis ?? { matches: 0, runde: 0 };
  },
);

// --- Matches ---------------------------------------------------------------

export const scheduleRoundAction = defineAction(
  {
    name: 'tournaments.matches.scheduleRound',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.matchesManage,
    schema: turnierSchema.extend({
      stageId: z.string().cuid(),
      round: z.number().int().min(1).max(64),
      scheduledAt: zeitpunktPflicht,
      kanaeleAnlegen: z.boolean().default(false),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'matchesManage', 'Du kannst hier keine Matches ansetzen.');

    // Der Abschnitt muss zu genau diesem Turnier gehoeren. Geprueft wird
    // sonst das eine Turnier und angesetzt das andere: wer irgendwo Leitung
    // ist, koennte damit die Runde eines fremden Turniers verschieben.
    const { prisma } = await import('@swisshub/database');
    const abschnitt = await prisma.tournamentStage.findUnique({
      where: { id: input.stageId },
      select: { id: true, tournamentId: true },
    });
    if (!abschnitt || abschnitt.tournamentId !== input.tournamentId) {
      throw new AppError('NOT_FOUND', {
        userMessage: 'Dieser Turnierabschnitt existiert nicht.',
      });
    }

    const anzahl = await tournaments.scheduleRound(
      input.stageId,
      input.round,
      input.scheduledAt,
      tournamentActor(ctx),
    );

    if (input.kanaeleAnlegen) {
      const matches = await tournaments.listMatches({
        tournamentId: input.tournamentId,
        stageId: input.stageId,
        round: input.round,
      });
      for (const match of matches) {
        // Ein Kanal ohne feststehende Gegner nuetzt niemandem - er bekaeme
        // keine Berechtigungen, weil noch nicht klar ist, für wen.
        if (!match.participantA || !match.participantB) {
          continue;
        }
        const kanal = await tournaments.createMatchChannel(match.id).catch(() => null);
        if (kanal) {
          await tournaments.sendeMatchStart(match.id);
        }
      }
    }

    await tournaments.announce(input.tournamentId, 'ROUND_START', {
      erneut: true,
      actorDiscordId: ctx.user.discordId,
    });

    revalidatePath('/turniere');
    return { angesetzt: anzahl };
  },
);

export const scheduleMatchAction = defineAction(
  {
    name: 'tournaments.matches.schedule',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.matchesManage,
    schema: z.object({
      matchId: z.string().cuid(),
      scheduledAt: zeitpunktNullbar,
    }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const match = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: input.matchId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, match.tournamentId);
    assertRecht(zugriff, 'matchesManage', 'Du kannst dieses Match nicht ansetzen.');

    await tournaments.scheduleMatch(input.matchId, input.scheduledAt, tournamentActor(ctx));
    revalidatePath(`/turniere/matches/${input.matchId}`);
    return { ok: true };
  },
);

export const createMatchChannelAction = defineAction(
  {
    name: 'tournaments.matches.channel',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.matchesManage,
    schema: z.object({ matchId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const match = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: input.matchId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, match.tournamentId);
    assertRecht(zugriff, 'matchesManage', 'Du kannst hier keinen Channel anlegen.');

    const kanal = await tournaments.createMatchChannel(input.matchId);
    if (kanal) {
      await tournaments.sendeMatchStart(input.matchId);
    }

    revalidatePath(`/turniere/matches/${input.matchId}`);
    return { channelId: kanal };
  },
);

export const overrideResultAction = defineAction(
  {
    name: 'tournaments.matches.override',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.resultsOverride,
    schema: z.object({
      matchId: z.string().cuid(),
      scoreA: z.number().int().min(0).max(99),
      scoreB: z.number().int().min(0).max(99),
      reason: z.enum(['PLAYED', 'FORFEIT', 'NO_SHOW', 'ADMIN_DECISION']).default('ADMIN_DECISION'),
      grund: z.string().min(5).max(1000),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { prisma } = await import('@swisshub/database');
    const vorher = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: input.matchId },
      select: { tournamentId: true, matchNumber: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, vorher.tournamentId);
    assertRecht(zugriff, 'resultsOverride', 'Du kannst dieses Resultat nicht korrigieren.');

    await tournaments.overrideResult(
      input.matchId,
      { scoreA: input.scoreA, scoreB: input.scoreB, reason: input.reason },
      input.grund,
      tournamentActor(ctx),
    );

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_MATCH_RESULT_OVERRIDDEN,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: `Match #${vorher.matchNumber}`,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { resultat: `${input.scoreA}:${input.scoreB}`, grund: input.grund },
    });

    revalidatePath(`/turniere/matches/${input.matchId}`);
    return { ok: true };
  },
);

export const resolveDisputeAction = defineAction(
  {
    name: 'tournaments.disputes.resolve',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.disputesManage,
    schema: z.object({
      disputeId: z.string().cuid(),
      entscheidung: z.string().min(5).max(2000),
      ablehnen: z.boolean().default(false),
      staffNote: z.string().max(2000).optional(),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { prisma } = await import('@swisshub/database');
    const einspruch = await prisma.tournamentDispute.findUniqueOrThrow({
      where: { id: input.disputeId },
      select: { tournamentId: true, matchId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, einspruch.tournamentId);
    assertRecht(zugriff, 'disputesManage', 'Du kannst diesen Einspruch nicht entscheiden.');

    await tournaments.resolveDispute(input.disputeId, input.entscheidung, tournamentActor(ctx), {
      ablehnen: input.ablehnen,
      ...(input.staffNote !== undefined ? { staffNote: input.staffNote } : {}),
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_DISPUTE_RESOLVED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: input.disputeId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/turniere/einsprueche');
    return { ok: true };
  },
);

// --- Teams (Verwaltung) ----------------------------------------------------

export const disqualifyTeamAction = defineAction(
  {
    name: 'tournaments.teams.disqualify',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.teamsManage,
    schema: z.object({ teamId: z.string().cuid(), reason: z.string().min(5).max(500) }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const team = await prisma.tournamentTeam.findUniqueOrThrow({
      where: { id: input.teamId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, team.tournamentId);
    assertRecht(zugriff, 'teamsManage', 'Du kannst dieses Team nicht disqualifizieren.');

    await tournaments.disqualifyTeam(input.teamId, input.reason, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const unlockRosterAction = defineAction(
  {
    name: 'tournaments.teams.unlockRoster',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.teamsManage,
    schema: z.object({ teamId: z.string().cuid(), offen: z.boolean() }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const team = await prisma.tournamentTeam.findUniqueOrThrow({
      where: { id: input.teamId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, team.tournamentId);
    assertRecht(zugriff, 'teamsManage', 'Du kannst dieses Roster nicht ändern.');

    if (input.offen) {
      await tournaments.unlockRoster(input.teamId, tournamentActor(ctx));
    } else {
      await tournaments.lockRoster(input.teamId, tournamentActor(ctx));
    }
    revalidatePath('/turniere');
    return { ok: true };
  },
);

// --- Leitung, Stream, Preise ----------------------------------------------

export const setStaffAction = defineAction(
  {
    name: 'tournaments.staff.set',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.staffManage,
    schema: turnierSchema.extend({
      staff: z
        .array(
          z.object({
            discordId: z.string().regex(/^\d{17,20}$/u),
            username: z.string().min(1).max(64),
            role: z.enum(['OWNER', 'ADMIN', 'REFEREE', 'CASTER', 'OBSERVER']),
          }),
        )
        .min(1)
        .max(50),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'staffManage', 'Du kannst die Turnierleitung nicht ändern.');

    await tournaments.setStaff(input.tournamentId, input.staff, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const setMatchStreamAction = defineAction(
  {
    name: 'tournaments.stream.set',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.streamManage,
    schema: z.object({
      matchId: z.string().cuid(),
      status: z.enum(['NOT_STREAMED', 'PLANNED', 'LIVE', 'FINISHED']),
      streamUrl: z.string().url().max(500).nullable().optional(),
      vodUrl: z.string().url().max(500).nullable().optional(),
      highlightUrl: z.string().url().max(500).nullable().optional(),
    }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const match = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: input.matchId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, match.tournamentId);
    assertRecht(zugriff, 'streamManage', 'Du kannst den Stream nicht verwalten.');

    const { matchId, ...rest } = input;
    await tournaments.setMatchStream(matchId, rest, tournamentActor(ctx));
    revalidatePath('/turniere/livestream');
    return { ok: true };
  },
);

export const setCastersAction = defineAction(
  {
    name: 'tournaments.stream.casters',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.streamManage,
    schema: z.object({
      matchId: z.string().cuid(),
      caster: z
        .array(
          z.object({
            discordId: z.string().regex(/^\d{17,20}$/u),
            username: z.string().min(1).max(64),
            role: z.enum(['CASTER', 'OBSERVER', 'HOST']).default('CASTER'),
          }),
        )
        .max(10),
    }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const match = await prisma.tournamentMatch.findUniqueOrThrow({
      where: { id: input.matchId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, match.tournamentId);
    assertRecht(zugriff, 'streamManage', 'Du kannst keine Caster zuweisen.');

    await tournaments.setMatchCasters(input.matchId, input.caster, tournamentActor(ctx));
    revalidatePath('/turniere/livestream');
    return { ok: true };
  },
);

export const upsertPrizeAction = defineAction(
  {
    name: 'tournaments.prizes.upsert',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.prizesManage,
    schema: turnierSchema.extend({
      placement: z.number().int().min(1).max(64),
      title: z.string().min(1).max(120),
      description: z.string().max(500).nullable().optional(),
      value: z.string().max(120).nullable().optional(),
      sponsorName: z.string().max(120).nullable().optional(),
      sponsorUrl: z.string().url().max(500).nullable().optional(),
      sponsorLogoUrl: z.string().url().max(500).nullable().optional(),
    }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'prizesManage', 'Du kannst die Preise nicht ändern.');

    const { tournamentId, ...rest } = input;
    await tournaments.upsertPrize(tournamentId, rest, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const deletePrizeAction = defineAction(
  {
    name: 'tournaments.prizes.delete',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.prizesManage,
    schema: z.object({ prizeId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const preis = await prisma.tournamentPrize.findUniqueOrThrow({
      where: { id: input.prizeId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, preis.tournamentId);
    assertRecht(zugriff, 'prizesManage', 'Du kannst die Preise nicht ändern.');

    await tournaments.deletePrize(input.prizeId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

export const markPrizeDeliveredAction = defineAction(
  {
    name: 'tournaments.prizes.delivered',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.prizesManage,
    schema: z.object({ prizeId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { prisma } = await import('@swisshub/database');
    const preis = await prisma.tournamentPrize.findUniqueOrThrow({
      where: { id: input.prizeId },
      select: { tournamentId: true },
    });
    const { zugriff } = await ladeTurnierMitZugriff(ctx, preis.tournamentId);
    assertRecht(zugriff, 'prizesManage', 'Du kannst die Preise nicht ändern.');

    await tournaments.markPrizeDelivered(input.prizeId, tournamentActor(ctx));
    revalidatePath('/turniere');
    return { ok: true };
  },
);

// --- Formularfelder --------------------------------------------------------

export const setCustomFieldsAction = defineAction(
  {
    name: 'tournaments.fields.set',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.manage,
    schema: turnierSchema.extend({
      felder: z
        .array(
          z.object({
            kind: z.enum(['SHORT_TEXT', 'LONG_TEXT', 'URL', 'SELECT']),
            label: z.string().min(1).max(80),
            description: z.string().max(200).nullable().optional(),
            placeholder: z.string().max(100).nullable().optional(),
            required: z.boolean().default(false),
            options: z.array(z.string().max(60)).max(25).default([]),
            maxLength: z.number().int().min(1).max(4000).nullable().optional(),
          }),
        )
        .max(10),
    }),
    rateLimit: 'tournamentAdmin',
  },
  async ({ ctx, input }) => {
    const { zugriff } = await ladeTurnierMitZugriff(ctx, input.tournamentId);
    assertRecht(zugriff, 'manage', 'Du kannst dieses Turnier nicht bearbeiten.');

    const { prisma } = await import('@swisshub/database');

    // Nur solange noch niemand geantwortet hat: Felder zu ersetzen, auf die
    // bereits Antworten zeigen, loescht die Antworten mit.
    const antworten = await prisma.tournamentCustomFieldResponse.count({
      where: { field: { tournamentId: input.tournamentId } },
    });
    if (antworten > 0) {
      throw new AppError('CONFLICT', {
        userMessage: `Es gibt bereits ${antworten} ausgefüllte Antworten. Die Fragen lassen sich nicht mehr ändern.`,
      });
    }

    await prisma.$transaction([
      prisma.tournamentCustomField.deleteMany({ where: { tournamentId: input.tournamentId } }),
      prisma.tournamentCustomField.createMany({
        data: input.felder.map((feld, index) => ({
          tournamentId: input.tournamentId,
          kind: feld.kind,
          label: feld.label,
          description: feld.description ?? null,
          placeholder: feld.placeholder ?? null,
          required: feld.required,
          options: feld.options,
          maxLength: feld.maxLength ?? null,
          sortOrder: index,
        })),
      }),
    ]);

    revalidatePath('/turniere');
    return { ok: true };
  },
);

// --- Turniersperren --------------------------------------------------------

export const blockMemberAction = defineAction(
  {
    name: 'tournaments.block',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.blockManage,
    schema: z.object({
      discordId: z.string().regex(/^\d{17,20}$/u),
      username: z.string().max(100).nullable().optional(),
      reason: z.string().min(5).max(500),
      /** Dauer in Tagen; 0 = unbefristet. */
      days: z.number().int().min(0).max(3650),
    }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    // Kein Turnier im Spiel: eine Sperre gilt fuer den Server, nicht fuer ein
    // einzelnes Turnier. Deshalb entscheidet hier allein die zentrale
    // Berechtigung - es gibt keine Zustaendigkeit, an der zu messen waere.
    const eintrag = await tournaments.blockMember(
      {
        discordId: input.discordId,
        username: input.username ?? null,
        reason: input.reason,
        expiresAt: input.days > 0 ? new Date(Date.now() + input.days * 24 * 60 * 60 * 1000) : null,
      },
      tournamentActor(ctx),
    );

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_BLOCKED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: input.discordId,
      targetLabel: input.username ?? input.discordId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
      metadata: { grund: input.reason, tage: input.days },
    });

    revalidatePath('/turniere/sperren');
    return { blockId: eintrag.id };
  },
);

export const liftBlockAction = defineAction(
  {
    name: 'tournaments.block.lift',
    module: 'tournaments',
    permission: tournaments.TOURNAMENT_PERMISSIONS.blockManage,
    schema: z.object({ blockId: z.string().cuid() }),
    rateLimit: 'tournamentAdmin',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    const { prisma } = await import('@swisshub/database');
    const { resolveGuildId } = await import('@swisshub/discord');

    // Die Sperre muss zu diesem Server gehoeren. Ohne diese Pruefung liesse
    // sich mit einer fremden Kennung eine Sperre anderswo aufheben.
    const guildId = await resolveGuildId();
    const eintrag = await prisma.tournamentBlockEntry.findUnique({
      where: { id: input.blockId },
      select: { id: true, guildId: true, discordId: true, username: true },
    });
    if (!eintrag || eintrag.guildId !== guildId) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diese Sperre existiert nicht.' });
    }

    await tournaments.liftBlock(input.blockId);

    await safeRecordAudit({
      action: AUDIT_ACTIONS.TOURNAMENT_UNBLOCKED,
      module: 'tournaments',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: eintrag.discordId,
      targetLabel: eintrag.username ?? eintrag.discordId,
      success: true,
      ipHash: metadata.ipHash,
      userAgent: metadata.userAgent,
    });

    revalidatePath('/turniere/sperren');
    return { ok: true };
  },
);
