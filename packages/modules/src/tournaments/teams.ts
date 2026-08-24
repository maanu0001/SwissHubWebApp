import { prisma } from '@swisshub/database';
import type { Tournament, TournamentTeam, TournamentTeamMemberRole } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { tournamentEvent, type TournamentActor } from './events';

const logger = createLogger('tournaments:teams');

/**
 * Teams und ihre Roster.
 *
 * Ein Team gehoert immer genau einem Turnier. Bewusst keine
 * turnieruebergreifenden Dauerteams: ein Roster, das sich zwischen zwei
 * Turnieren aendert, macht die Frage «wer hat damals gespielt?» unbeantwortbar
 * - und genau die stellt sich bei einem Einspruch.
 */

/** Wie lange eine Einladung offen bleibt. */
const EINLADUNG_GUELTIG_MS = 7 * 24 * 3600_000;

export interface CreateTeamInput {
  tournamentId: string;
  name: string;
  tag?: string | null;
  logoUrl?: string | null;
  captainDiscordId: string;
  captainUsername: string;
}

export async function createTeam(
  input: CreateTeamInput,
  actor: TournamentActor,
): Promise<TournamentTeam> {
  const tournament = await prisma.tournament.findUniqueOrThrow({
    where: { id: input.tournamentId },
  });

  if (tournament.mode !== 'TEAM') {
    throw new AppError('CONFLICT', {
      userMessage: 'Dieses Turnier wird einzeln gespielt - es braucht kein Team.',
    });
  }
  if (tournament.status !== 'REGISTRATION_OPEN') {
    throw new AppError('CONFLICT', {
      userMessage: 'Teams lassen sich nur gründen, solange die Anmeldung offen ist.',
    });
  }

  // Ein Captain fuehrt hoechstens ein Team je Turnier, und niemand spielt in
  // zwei Teams desselben Turniers.
  const schonDabei = await prisma.tournamentTeamMember.findFirst({
    where: {
      discordId: input.captainDiscordId,
      removedAt: null,
      team: { tournamentId: input.tournamentId },
    },
    select: { team: { select: { name: true } } },
  });
  if (schonDabei) {
    throw new AppError('CONFLICT', {
      userMessage: `Du bist in diesem Turnier bereits bei «${schonDabei.team.name}».`,
    });
  }

  const name = input.name.trim().slice(0, 60);
  if (name.length < 2) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Teamname ist zu kurz.' });
  }

  const belegt = await prisma.tournamentTeam.findUnique({
    where: { tournamentId_name: { tournamentId: input.tournamentId, name } },
    select: { id: true },
  });
  if (belegt) {
    throw new AppError('CONFLICT', {
      userMessage: `In diesem Turnier gibt es bereits ein Team «${name}».`,
    });
  }

  const team = await prisma.tournamentTeam.create({
    data: {
      tournamentId: input.tournamentId,
      name,
      tag: input.tag?.trim().slice(0, 8) || null,
      logoUrl: input.logoUrl ?? null,
      captainDiscordId: input.captainDiscordId,
      captainUsername: input.captainUsername.slice(0, 64),
      status: 'FORMING',
      members: {
        // Der Captain ist von Anfang an im Roster. Ein Team, dessen Gruender
        // erst noch beitreten muss, waere eine Falle.
        create: {
          discordId: input.captainDiscordId,
          username: input.captainUsername.slice(0, 64),
          role: 'CAPTAIN',
        },
      },
    },
  });

  await tournamentEvent(input.tournamentId, 'TEAM_CREATED', actor, { team: team.name });
  logger.info('Team gegründet', { tournamentId: input.tournamentId, teamId: team.id });
  return team;
}

export async function updateTeam(
  teamId: string,
  input: { name?: string; tag?: string | null; logoUrl?: string | null },
  actor: TournamentActor,
): Promise<TournamentTeam> {
  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: teamId },
    include: { tournament: { select: { id: true, status: true } } },
  });

  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 60);
    if (name.length < 2) {
      throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Teamname ist zu kurz.' });
    }
    const belegt = await prisma.tournamentTeam.findUnique({
      where: { tournamentId_name: { tournamentId: team.tournamentId, name } },
      select: { id: true },
    });
    if (belegt && belegt.id !== teamId) {
      throw new AppError('CONFLICT', {
        userMessage: `In diesem Turnier gibt es bereits ein Team «${name}».`,
      });
    }
  }

  const aktualisiert = await prisma.tournamentTeam.update({
    where: { id: teamId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 60) } : {}),
      ...(input.tag !== undefined ? { tag: input.tag?.trim().slice(0, 8) || null } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
    },
  });

  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, { team: aktualisiert.name });
  return aktualisiert;
}

/**
 * Ist das Roster gerade veraenderbar?
 *
 * Nach dem Roster Lock nicht mehr - sonst tauscht ein Team zwischen Halbfinale
 * und Finale die halbe Aufstellung aus. Die Leitung kann es fuer ein
 * einzelnes Team wieder oeffnen; das steht dann im Verlauf.
 */
export function rosterOffen(
  tournament: Pick<Tournament, 'status' | 'rosterLockAt'>,
  team: Pick<TournamentTeam, 'rosterUnlockedAt'>,
  jetzt = new Date(),
): boolean {
  if (team.rosterUnlockedAt !== null) {
    return true;
  }
  if (tournament.status === 'RUNNING' || tournament.status === 'PAUSED') {
    return false;
  }
  if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED' || tournament.status === 'ARCHIVED') {
    return false;
  }
  if (tournament.rosterLockAt && tournament.rosterLockAt.getTime() <= jetzt.getTime()) {
    return false;
  }
  return true;
}

async function assertRosterOffen(teamId: string): Promise<void> {
  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: teamId },
    include: { tournament: { select: { status: true, rosterLockAt: true } } },
  });
  if (!rosterOffen(team.tournament, team)) {
    throw new AppError('CONFLICT', {
      userMessage:
        'Das Roster ist gesperrt. Änderungen müssen jetzt über die Turnierleitung laufen.',
    });
  }
}

// --- Einladungen -----------------------------------------------------------

export async function inviteToTeam(
  input: { teamId: string; discordId: string; username: string; role?: TournamentTeamMemberRole },
  actor: TournamentActor,
): Promise<void> {
  await assertRosterOffen(input.teamId);

  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: input.teamId },
    include: {
      tournament: { select: { id: true, maxTeamSize: true, maxSubstitutes: true } },
      members: { where: { removedAt: null } },
      invites: { where: { status: 'PENDING' } },
    },
  });

  if (input.discordId === team.captainDiscordId) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Der Captain ist bereits im Team.' });
  }

  const schonDrin = team.members.some((mitglied) => mitglied.discordId === input.discordId);
  if (schonDrin) {
    throw new AppError('CONFLICT', { userMessage: 'Diese Person ist bereits im Team.' });
  }

  // In einem anderen Team desselben Turniers?
  const anderswo = await prisma.tournamentTeamMember.findFirst({
    where: {
      discordId: input.discordId,
      removedAt: null,
      team: { tournamentId: team.tournamentId },
    },
    select: { team: { select: { name: true } } },
  });
  if (anderswo) {
    throw new AppError('CONFLICT', {
      userMessage: `Diese Person spielt in diesem Turnier bereits für «${anderswo.team.name}».`,
    });
  }

  const offen = team.invites.some((einladung) => einladung.discordId === input.discordId);
  if (offen) {
    throw new AppError('CONFLICT', { userMessage: 'Diese Person wurde bereits eingeladen.' });
  }

  const rolle = input.role ?? 'PLAYER';
  pruefePlatz(team, rolle);

  await prisma.tournamentTeamInvite.create({
    data: {
      tournamentId: team.tournamentId,
      teamId: team.id,
      discordId: input.discordId,
      username: input.username.slice(0, 64),
      role: rolle,
      invitedByDiscordId: actor.discordId,
      expiresAt: new Date(Date.now() + EINLADUNG_GUELTIG_MS),
    },
  });

  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    eingeladen: input.username,
  });
}

/**
 * Ist im Roster noch Platz fuer diese Rolle?
 *
 * Stammspieler und Ersatz haben eigene Grenzen. Offene Einladungen zaehlen
 * mit: sonst laedt ein Captain zehn Leute ein, und wer zuerst annimmt,
 * gewinnt - der Rest bekommt einen Fehler, den er nicht erwartet hat.
 */
function pruefePlatz(
  team: {
    tournament: { maxTeamSize: number; maxSubstitutes: number };
    members: Array<{ role: TournamentTeamMemberRole }>;
    invites: Array<{ role: TournamentTeamMemberRole }>;
  },
  rolle: TournamentTeamMemberRole,
): void {
  const zaehle = (rollen: TournamentTeamMemberRole[]): number =>
    team.members.filter((eintrag) => rollen.includes(eintrag.role)).length +
    team.invites.filter((eintrag) => rollen.includes(eintrag.role)).length;

  if (rolle === 'SUBSTITUTE') {
    if (zaehle(['SUBSTITUTE']) >= team.tournament.maxSubstitutes) {
      throw new AppError('CONFLICT', {
        userMessage:
          team.tournament.maxSubstitutes === 0
            ? 'Dieses Turnier lässt keine Ersatzspieler zu.'
            : `Das Team hat bereits ${team.tournament.maxSubstitutes} Ersatzspieler.`,
      });
    }
    return;
  }

  if (rolle === 'COACH') {
    if (zaehle(['COACH']) >= 1) {
      throw new AppError('CONFLICT', { userMessage: 'Das Team hat bereits einen Coach.' });
    }
    return;
  }

  if (zaehle(['CAPTAIN', 'PLAYER']) >= team.tournament.maxTeamSize) {
    throw new AppError('CONFLICT', {
      userMessage: `Das Team ist mit ${team.tournament.maxTeamSize} Spielern voll.`,
    });
  }
}

export async function revokeInvite(inviteId: string, actor: TournamentActor): Promise<void> {
  const einladung = await prisma.tournamentTeamInvite.findUniqueOrThrow({
    where: { id: inviteId },
  });
  if (einladung.status !== 'PENDING') {
    return;
  }
  await prisma.tournamentTeamInvite.update({
    where: { id: inviteId },
    data: { status: 'REVOKED', respondedAt: new Date() },
  });
  await tournamentEvent(einladung.tournamentId, 'TEAM_UPDATED', actor, {
    zurueckgezogen: einladung.username,
  });
}

/**
 * Eine Einladung annehmen.
 *
 * Die Platzpruefung laeuft hier erneut: zwischen Einladung und Annahme kann
 * das Team voll geworden sein, und die Einladung allein ist kein Anspruch.
 */
export async function acceptInvite(
  inviteId: string,
  discordId: string,
  actor: TournamentActor,
): Promise<void> {
  const einladung = await prisma.tournamentTeamInvite.findUniqueOrThrow({
    where: { id: inviteId },
  });

  if (einladung.discordId !== discordId) {
    // Bewusst dieselbe Meldung wie bei einer nicht vorhandenen Einladung:
    // sonst liesse sich an der Antwort ablesen, welche Einladungen es gibt.
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Einladung existiert nicht.' });
  }
  if (einladung.status !== 'PENDING') {
    throw new AppError('CONFLICT', { userMessage: 'Diese Einladung ist nicht mehr offen.' });
  }
  if (einladung.expiresAt && einladung.expiresAt.getTime() < Date.now()) {
    await prisma.tournamentTeamInvite.update({
      where: { id: inviteId },
      data: { status: 'EXPIRED' },
    });
    throw new AppError('CONFLICT', { userMessage: 'Diese Einladung ist abgelaufen.' });
  }

  await assertRosterOffen(einladung.teamId);

  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: einladung.teamId },
    include: {
      tournament: { select: { maxTeamSize: true, maxSubstitutes: true } },
      members: { where: { removedAt: null } },
      invites: { where: { status: 'PENDING', NOT: { id: inviteId } } },
    },
  });
  pruefePlatz(team, einladung.role);

  const anderswo = await prisma.tournamentTeamMember.findFirst({
    where: { discordId, removedAt: null, team: { tournamentId: einladung.tournamentId } },
    select: { id: true },
  });
  if (anderswo) {
    throw new AppError('CONFLICT', {
      userMessage: 'Du spielst in diesem Turnier bereits für ein anderes Team.',
    });
  }

  await prisma.$transaction([
    prisma.tournamentTeamInvite.update({
      where: { id: inviteId },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    }),
    prisma.tournamentTeamMember.upsert({
      where: { teamId_discordId: { teamId: einladung.teamId, discordId } },
      create: {
        teamId: einladung.teamId,
        discordId,
        username: einladung.username,
        role: einladung.role,
      },
      update: { removedAt: null, role: einladung.role, username: einladung.username },
    }),
  ]);

  await tournamentEvent(einladung.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    beigetreten: einladung.username,
  });
}

export async function declineInvite(inviteId: string, discordId: string): Promise<void> {
  const einladung = await prisma.tournamentTeamInvite.findUniqueOrThrow({
    where: { id: inviteId },
  });
  if (einladung.discordId !== discordId) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Einladung existiert nicht.' });
  }
  if (einladung.status !== 'PENDING') {
    return;
  }
  await prisma.tournamentTeamInvite.update({
    where: { id: inviteId },
    data: { status: 'DECLINED', respondedAt: new Date() },
  });
}

/** Offene Einladungen einer Person - fuer die Turnierseite. */
export async function listInvitesFor(discordId: string, tournamentId?: string) {
  return prisma.tournamentTeamInvite.findMany({
    where: {
      discordId,
      status: 'PENDING',
      ...(tournamentId ? { tournamentId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      tournament: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// --- Roster ----------------------------------------------------------------

export async function removeMember(
  teamId: string,
  discordId: string,
  actor: TournamentActor,
  options: { alsLeitung?: boolean } = {},
): Promise<void> {
  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: teamId },
    include: { tournament: { select: { status: true, rosterLockAt: true } } },
  });

  if (!options.alsLeitung && !rosterOffen(team.tournament, team)) {
    throw new AppError('CONFLICT', {
      userMessage: 'Das Roster ist gesperrt. Änderungen müssen über die Turnierleitung laufen.',
    });
  }

  if (discordId === team.captainDiscordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Der Captain kann nicht aus dem eigenen Team entfernt werden. Übergib zuerst die Führung.',
    });
  }

  const mitglied = await prisma.tournamentTeamMember.findUnique({
    where: { teamId_discordId: { teamId, discordId } },
  });
  if (!mitglied || mitglied.removedAt) {
    return;
  }

  await prisma.tournamentTeamMember.update({
    where: { id: mitglied.id },
    data: { removedAt: new Date() },
  });

  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    entfernt: mitglied.username,
  });
}

/**
 * Die Teamfuehrung uebergeben.
 *
 * Braucht es, weil sonst ein Captain, der nicht mehr spielt, das Team
 * blockiert - er kann sich weder entfernen noch jemand anderen bestimmen.
 */
export async function transferCaptaincy(
  teamId: string,
  neuerCaptainDiscordId: string,
  actor: TournamentActor,
): Promise<void> {
  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: teamId },
    include: { members: { where: { removedAt: null } } },
  });

  const neuer = team.members.find((mitglied) => mitglied.discordId === neuerCaptainDiscordId);
  if (!neuer) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diese Person ist nicht im Team.',
    });
  }
  if (neuer.role === 'SUBSTITUTE' || neuer.role === 'COACH') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Nur ein Stammspieler kann Captain werden.',
    });
  }

  const alter = team.members.find((mitglied) => mitglied.discordId === team.captainDiscordId);

  await prisma.$transaction([
    prisma.tournamentTeam.update({
      where: { id: teamId },
      data: { captainDiscordId: neuer.discordId, captainUsername: neuer.username },
    }),
    prisma.tournamentTeamMember.update({ where: { id: neuer.id }, data: { role: 'CAPTAIN' } }),
    ...(alter ? [prisma.tournamentTeamMember.update({ where: { id: alter.id }, data: { role: 'PLAYER' } })] : []),
    // Die Anmeldung haengt am Captain - sonst kann der neue sein Team nicht
    // mehr verwalten und der alte weiterhin.
    prisma.tournamentRegistration.updateMany({
      where: { teamId },
      data: { discordId: neuer.discordId, username: neuer.username },
    }),
  ]);

  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    neuerCaptain: neuer.username,
  });
}

/** Die Rolle eines Mitglieds aendern - Stammspieler, Ersatz, Coach. */
export async function setMemberRole(
  teamId: string,
  discordId: string,
  rolle: TournamentTeamMemberRole,
  actor: TournamentActor,
): Promise<void> {
  if (rolle === 'CAPTAIN') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Teamführung wird über «Führung übergeben» gewechselt.',
    });
  }

  await assertRosterOffen(teamId);

  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: teamId },
    include: {
      tournament: { select: { maxTeamSize: true, maxSubstitutes: true } },
      members: { where: { removedAt: null } },
      invites: { where: { status: 'PENDING' } },
    },
  });

  const mitglied = team.members.find((eintrag) => eintrag.discordId === discordId);
  if (!mitglied) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diese Person ist nicht im Team.' });
  }
  if (mitglied.role === 'CAPTAIN') {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Der Captain behält seine Rolle, bis die Führung übergeben wird.',
    });
  }
  if (mitglied.role === rolle) {
    return;
  }

  // Ohne das eigene Mitglied rechnen: sonst zaehlt es beim Wechsel doppelt.
  pruefePlatz(
    { ...team, members: team.members.filter((eintrag) => eintrag.id !== mitglied.id) },
    rolle,
  );

  await prisma.tournamentTeamMember.update({ where: { id: mitglied.id }, data: { role: rolle } });
  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    wer: mitglied.username,
    rolle,
  });
}

/** Das Roster eines Teams fuer die Verwaltung wieder oeffnen. */
export async function unlockRoster(teamId: string, actor: TournamentActor): Promise<void> {
  const team = await prisma.tournamentTeam.update({
    where: { id: teamId },
    data: { rosterUnlockedAt: new Date() },
  });
  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    rosterGeoeffnet: true,
  });
}

export async function lockRoster(teamId: string, actor: TournamentActor): Promise<void> {
  const team = await prisma.tournamentTeam.update({
    where: { id: teamId },
    data: { rosterUnlockedAt: null },
  });
  await tournamentEvent(team.tournamentId, 'TEAM_UPDATED', actor, {
    team: team.name,
    rosterGeoeffnet: false,
  });
}

/**
 * Ein Team disqualifizieren.
 *
 * Es bleibt im Turnier sichtbar - ein Team, das aus dem Bracket verschwindet,
 * macht die Runde unleserlich. Stattdessen ist es ausgeschieden, und
 * offene Matches gehen als Freilos an den Gegner.
 */
export async function disqualifyTeam(
  teamId: string,
  reason: string,
  actor: TournamentActor,
): Promise<void> {
  const team = await prisma.tournamentTeam.findUniqueOrThrow({
    where: { id: teamId },
    include: { participant: { select: { id: true } } },
  });

  await prisma.tournamentTeam.update({ where: { id: teamId }, data: { status: 'DISQUALIFIED' } });
  if (team.participant) {
    await prisma.tournamentParticipant.update({
      where: { id: team.participant.id },
      data: { eliminatedAt: new Date() },
    });
  }
  await prisma.tournamentRegistration.updateMany({
    where: { teamId },
    data: { status: 'REJECTED', reason: reason.slice(0, 500) },
  });

  await tournamentEvent(team.tournamentId, 'TEAM_DISQUALIFIED', actor, {
    team: team.name,
    grund: reason,
  });
  logger.info('Team disqualifiziert', { teamId, grund: reason });
}

/** Ein Team mit allem, was die Oberflaeche braucht. */
export async function getTeam(teamId: string) {
  return prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    include: {
      members: { where: { removedAt: null }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] },
      invites: { where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } },
      registration: true,
      participant: { select: { id: true, seed: true, placement: true, eliminatedAt: true } },
      tournament: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          mode: true,
          minTeamSize: true,
          maxTeamSize: true,
          maxSubstitutes: true,
          rosterLockAt: true,
          rulesVersion: true,
        },
      },
    },
  });
}

/** Abgelaufene Einladungen als solche markieren. */
export async function expireInvites(jetzt = new Date()): Promise<number> {
  const { count } = await prisma.tournamentTeamInvite.updateMany({
    where: { status: 'PENDING', expiresAt: { not: null, lte: jetzt } },
    data: { status: 'EXPIRED', respondedAt: jetzt },
  });
  return count;
}
