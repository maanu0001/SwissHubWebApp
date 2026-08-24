import { prisma } from '@swisshub/database';
import type { TournamentCheckinStatus } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { tournamentEvent, type TournamentActor } from './events';
import { rueckeAlleNach } from './registrations';

const logger = createLogger('tournaments:checkin');

/**
 * Check-in.
 *
 * Der Zweck ist nicht Buerokratie, sondern eine Frage: wer ist wirklich da?
 * Ein Bracket mit acht angemeldeten und drei anwesenden Teams ist schlimmer
 * als eines mit fuenf - es haelt alle auf, waehrend die Leitung
 * hinterhertelefoniert.
 *
 * Derselbe Dienst bedient Dashboard und Discord-Knopf. Zwei Wege, ein
 * Verfahren: sonst laufen sie auseinander, und ein Teilnehmer gilt je nach
 * Weg als eingecheckt oder nicht.
 */

export interface CheckinResult {
  status: TournamentCheckinStatus;
  /** Kurze Rueckmeldung fuer Oberflaeche oder Discord. */
  message: string;
}

/**
 * Einchecken.
 *
 * Bei Teams durch den Captain fuer das ganze Team - das Team tritt als
 * Einheit an, und fuenf einzelne Bestaetigungen einzusammeln waere eine
 * Fehlerquelle ohne Nutzen.
 */
export async function checkIn(
  tournamentId: string,
  discordId: string,
  actor: TournamentActor,
): Promise<CheckinResult> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  if (!tournament.checkinRequired) {
    return { status: 'NOT_REQUIRED', message: 'Für dieses Turnier braucht es keinen Check-in.' };
  }
  if (tournament.status !== 'CHECKIN_OPEN') {
    throw new AppError('CONFLICT', {
      userMessage:
        tournament.status === 'CHECKIN_CLOSED' || tournament.status === 'READY'
          ? 'Der Check-in ist bereits geschlossen.'
          : 'Der Check-in ist noch nicht offen.',
    });
  }
  if (tournament.checkinClosesAt && tournament.checkinClosesAt.getTime() < Date.now()) {
    throw new AppError('CONFLICT', { userMessage: 'Der Check-in ist bereits abgelaufen.' });
  }

  const registration = await ladeEigeneAnmeldung(tournamentId, discordId);

  if (registration.status !== 'CONFIRMED') {
    throw new AppError('CONFLICT', {
      userMessage:
        registration.status === 'WAITLISTED'
          ? 'Du stehst auf der Warteliste - einchecken kannst du erst, wenn ein Platz frei wird.'
          : 'Deine Anmeldung ist noch nicht bestätigt.',
    });
  }
  if (registration.checkinStatus === 'CHECKED_IN' || registration.checkinStatus === 'ADMIN_CONFIRMED') {
    return { status: registration.checkinStatus, message: 'Du bist bereits eingecheckt.' };
  }

  // Bei Teams darf nur der Captain einchecken: er meldet das Team, nicht sich.
  if (registration.teamId && registration.discordId !== discordId) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Nur der Captain kann das Team einchecken.',
    });
  }

  await prisma.tournamentRegistration.update({
    where: { id: registration.id },
    data: { checkinStatus: 'CHECKED_IN', checkedInAt: new Date(), checkedInBy: discordId },
  });

  await tournamentEvent(tournamentId, 'CHECKED_IN', actor, {
    wer: registration.username,
    eingecheckt: true,
  });

  return { status: 'CHECKED_IN', message: 'Check-in erledigt. Bis gleich!' };
}

/** Den Check-in wieder zuruecknehmen - solange er offen ist. */
export async function undoCheckIn(tournamentId: string, discordId: string): Promise<CheckinResult> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
  if (tournament.status !== 'CHECKIN_OPEN') {
    throw new AppError('CONFLICT', {
      userMessage: 'Der Check-in ist geschlossen - eine Abmeldung läuft über die Turnierleitung.',
    });
  }

  const registration = await ladeEigeneAnmeldung(tournamentId, discordId);
  await prisma.tournamentRegistration.update({
    where: { id: registration.id },
    data: { checkinStatus: 'PENDING', checkedInAt: null, checkedInBy: null },
  });

  return { status: 'PENDING', message: 'Check-in zurückgenommen.' };
}

/**
 * Die Leitung checkt jemanden von Hand ein.
 *
 * Getrennt von `CHECKED_IN` festgehalten: bei einem Einspruch macht es einen
 * Unterschied, ob jemand selbst da war oder ob ihn jemand eingetragen hat.
 */
export async function adminConfirmCheckin(registrationId: string, actor: TournamentActor): Promise<void> {
  const eintrag = await prisma.tournamentRegistration.update({
    where: { id: registrationId },
    data: {
      checkinStatus: 'ADMIN_CONFIRMED',
      checkedInAt: new Date(),
      checkedInBy: actor.discordId,
    },
  });
  await tournamentEvent(eintrag.tournamentId, 'CHECKED_IN', actor, {
    wer: eintrag.username,
    vonHand: true,
  });
}

async function ladeEigeneAnmeldung(tournamentId: string, discordId: string) {
  // Zuerst die eigene Anmeldung, dann die des eigenen Teams: ein Teammitglied
  // hat keine eigene Anmeldung, gehoert aber zu einer.
  const eigene = await prisma.tournamentRegistration.findUnique({
    where: { tournamentId_discordId: { tournamentId, discordId } },
  });
  if (eigene) {
    return eigene;
  }

  const mitgliedschaft = await prisma.tournamentTeamMember.findFirst({
    where: { discordId, removedAt: null, team: { tournamentId } },
    select: { teamId: true },
  });
  if (mitgliedschaft) {
    const desTeams = await prisma.tournamentRegistration.findFirst({
      where: { tournamentId, teamId: mitgliedschaft.teamId },
    });
    if (desTeams) {
      return desTeams;
    }
  }

  throw new AppError('NOT_FOUND', { userMessage: 'Du bist für dieses Turnier nicht angemeldet.' });
}

export interface CheckinOverview {
  bestaetigt: number;
  eingecheckt: number;
  offen: number;
  verpasst: number;
  warteliste: number;
  /** Prozentsatz der eingecheckten unter den bestaetigten. */
  quote: number;
}

export async function getCheckinOverview(tournamentId: string): Promise<CheckinOverview> {
  const [bestaetigt, eingecheckt, offen, verpasst, warteliste] = await Promise.all([
    prisma.tournamentRegistration.count({ where: { tournamentId, status: 'CONFIRMED' } }),
    prisma.tournamentRegistration.count({
      where: {
        tournamentId,
        status: 'CONFIRMED',
        checkinStatus: { in: ['CHECKED_IN', 'ADMIN_CONFIRMED'] },
      },
    }),
    prisma.tournamentRegistration.count({
      where: { tournamentId, status: 'CONFIRMED', checkinStatus: 'PENDING' },
    }),
    prisma.tournamentRegistration.count({
      where: { tournamentId, status: 'CONFIRMED', checkinStatus: 'MISSED' },
    }),
    prisma.tournamentRegistration.count({ where: { tournamentId, status: 'WAITLISTED' } }),
  ]);

  return {
    bestaetigt,
    eingecheckt,
    offen,
    verpasst,
    warteliste,
    quote: bestaetigt === 0 ? 0 : Math.round((eingecheckt / bestaetigt) * 100),
  };
}

/**
 * Den Check-in schliessen.
 *
 * Wer nicht eingecheckt hat, gilt als verpasst. Ob er damit auch aus dem
 * Turnier faellt, entscheidet die Einstellung - und die Voreinstellung ist
 * bewusst «nein»: jemanden automatisch hinauszuwerfen, weil er drei Minuten
 * zu spaet war, ist eine Entscheidung, die ein Mensch treffen soll.
 */
export async function closeCheckin(
  tournamentId: string,
  actor: TournamentActor,
): Promise<{ verpasst: number; nachgerueckt: number }> {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  const { count: verpasst } = await prisma.tournamentRegistration.updateMany({
    where: { tournamentId, status: 'CONFIRMED', checkinStatus: 'PENDING' },
    data: { checkinStatus: 'MISSED' },
  });

  let nachgerueckt = 0;

  if (tournament.autoRemoveMissedCheckin && verpasst > 0) {
    // Die Verpassten heraus, dann die Warteliste auffuellen. In dieser
    // Reihenfolge: sonst ist noch kein Platz frei, wenn nachgerueckt wird.
    const betroffene = await prisma.tournamentRegistration.findMany({
      where: { tournamentId, status: 'CONFIRMED', checkinStatus: 'MISSED' },
      select: { id: true, teamId: true, participantId: true, username: true },
    });

    for (const eintrag of betroffene) {
      await prisma.tournamentRegistration.update({
        where: { id: eintrag.id },
        data: { status: 'CANCELLED', reason: 'Check-in verpasst' },
      });
      if (eintrag.teamId) {
        await prisma.tournamentTeam.update({
          where: { id: eintrag.teamId },
          data: { status: 'WITHDRAWN' },
        });
      }
      const teilnehmerId =
        eintrag.participantId ??
        (eintrag.teamId
          ? (
              await prisma.tournamentParticipant.findUnique({
                where: { teamId: eintrag.teamId },
                select: { id: true },
              })
            )?.id
          : null);
      if (teilnehmerId) {
        await prisma.tournamentParticipant.delete({ where: { id: teilnehmerId } }).catch(() => undefined);
      }
    }

    nachgerueckt = await rueckeAlleNach(tournamentId, actor);
  }

  await tournamentEvent(tournamentId, 'CHECKIN_CLOSED', actor, { verpasst, nachgerueckt });
  logger.info('Check-in geschlossen', { tournamentId, verpasst, nachgerueckt });

  return { verpasst, nachgerueckt };
}

/**
 * Wer antritt.
 *
 * Grundlage der Setzliste. Ohne Check-in-Pflicht zaehlen alle bestaetigten
 * Anmeldungen, sonst nur die anwesenden.
 */
export async function listAntretende(tournamentId: string) {
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  return prisma.tournamentRegistration.findMany({
    where: {
      tournamentId,
      status: 'CONFIRMED',
      ...(tournament.checkinRequired ? { checkinStatus: { in: ['CHECKED_IN', 'ADMIN_CONFIRMED'] } } : {}),
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          tag: true,
          logoUrl: true,
          captainDiscordId: true,
          captainUsername: true,
        },
      },
      participant: { select: { id: true, seed: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
