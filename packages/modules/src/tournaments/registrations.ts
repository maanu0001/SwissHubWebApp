import { prisma } from '@swisshub/database';
import type {
  Prisma,
  TournamentRegistration,
  TournamentRegistrationStatus,
} from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { getModuleSettings } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from './config';
import { checkEligibility } from './eligibility';
import { tournamentEvent, type TournamentActor } from './events';

const logger = createLogger('tournaments:registrations');

export interface RegisterInput {
  tournamentId: string;
  discordId: string;
  username: string;
  /** Bei Teamturnieren das eigene Team. */
  teamId?: string | null;
  /** Bestaetigte Fassung des Regelwerks. */
  rulesVersion: number;
  /** Antworten auf die Zusatzfragen, nach Feldkennung. */
  answers?: Record<string, string>;
}

/**
 * Sich zu einem Turnier anmelden.
 *
 * Der entscheidende Teil laeuft in einer Transaktion, die zuerst die
 * Turnierzeile sperrt. Ohne diese Sperre entscheiden zwei gleichzeitige
 * Anmeldungen beide, dass noch ein Platz frei ist - und das Turnier hat einen
 * Teilnehmer zu viel. Die Sperre serialisiert nur Anmeldungen desselben
 * Turniers; andere Turniere laufen unbehelligt weiter.
 */
export async function register(
  input: RegisterInput,
  actor: TournamentActor,
): Promise<TournamentRegistration> {
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  if (settings.maintenanceMode) {
    throw new AppError('CONFLICT', {
      userMessage: 'Es werden derzeit keine neuen Anmeldungen angenommen.',
    });
  }

  const vorab = await prisma.tournament.findUnique({ where: { id: input.tournamentId } });
  if (!vorab) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Turnier existiert nicht.' });
  }
  if (vorab.status !== 'REGISTRATION_OPEN') {
    throw new AppError('CONFLICT', {
      userMessage:
        vorab.status === 'DRAFT'
          ? 'Dieses Turnier ist noch nicht veröffentlicht.'
          : 'Die Anmeldung für dieses Turnier ist geschlossen.',
    });
  }
  if (vorab.registrationClosesAt && vorab.registrationClosesAt.getTime() < Date.now()) {
    throw new AppError('CONFLICT', { userMessage: 'Der Anmeldeschluss ist vorbei.' });
  }
  if (input.rulesVersion !== vorab.rulesVersion) {
    throw new AppError('CONFLICT', {
      userMessage: 'Das Regelwerk wurde inzwischen geändert. Bitte die Seite neu laden.',
    });
  }

  const eignung = await checkEligibility(vorab, input.discordId);
  if (!eignung.eligible) {
    throw new AppError('FORBIDDEN', { userMessage: eignung.reasons.join(' ') });
  }

  // --- Team pruefen ----------------------------------------------------
  if (vorab.mode === 'TEAM') {
    if (!input.teamId) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: 'Für dieses Turnier braucht es ein Team.',
      });
    }
    const team = await prisma.tournamentTeam.findUnique({
      where: { id: input.teamId },
      include: {
        members: {
          where: { removedAt: null, role: { in: ['CAPTAIN', 'PLAYER'] } },
          select: { id: true },
        },
      },
    });
    if (!team || team.tournamentId !== input.tournamentId) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Team gehört nicht zu diesem Turnier.' });
    }
    if (team.captainDiscordId !== input.discordId) {
      throw new AppError('FORBIDDEN', { userMessage: 'Nur der Captain kann das Team anmelden.' });
    }
    if (team.members.length < vorab.minTeamSize) {
      throw new AppError('CONFLICT', {
        userMessage: `Das Team braucht mindestens ${vorab.minTeamSize} Spieler (aktuell ${team.members.length}).`,
      });
    }
  }

  // --- Pflichtfelder ---------------------------------------------------
  const antworten = await pruefeAntworten(input.tournamentId, input.answers);

  // --- Anmeldung -------------------------------------------------------
  const registration = await prisma.$transaction(async (tx) => {
    // Die Turnierzeile sperren. Ab hier entscheidet nur dieser Vorgang, ob
    // noch ein Platz frei ist.
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${input.tournamentId} FOR UPDATE`;

    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: input.tournamentId },
    });

    const vorhanden = await tx.tournamentRegistration.findUnique({
      where: {
        tournamentId_discordId: {
          tournamentId: input.tournamentId,
          discordId: input.discordId,
        },
      },
    });
    if (vorhanden && vorhanden.status !== 'CANCELLED' && vorhanden.status !== 'REJECTED') {
      throw new AppError('CONFLICT', { userMessage: 'Du bist bereits angemeldet.' });
    }

    const belegt = await tx.tournamentRegistration.count({
      where: { tournamentId: input.tournamentId, status: 'CONFIRMED' },
    });
    const wartend = await tx.tournamentRegistration.count({
      where: { tournamentId: input.tournamentId, status: 'WAITLISTED' },
    });

    const voll = tournament.maxParticipants > 0 && belegt >= tournament.maxParticipants;

    // Offen und Platz frei: sofort bestaetigt. Freigabepflicht oder nur auf
    // Einladung: erst einmal wartend. Voll: Warteliste.
    const status: TournamentRegistrationStatus = voll
      ? 'WAITLISTED'
      : tournament.access === 'OPEN'
        ? 'CONFIRMED'
        : 'PENDING';

    const daten = {
      tournamentId: input.tournamentId,
      discordId: input.discordId,
      username: input.username.slice(0, 64),
      teamId: input.teamId ?? null,
      status,
      waitlistPosition: voll ? wartend + 1 : null,
      checkinStatus: tournament.checkinRequired ? ('PENDING' as const) : ('NOT_REQUIRED' as const),
      rulesAcceptedAt: new Date(),
      rulesVersion: input.rulesVersion,
      reason: null,
    };

    const eintrag = vorhanden
      ? await tx.tournamentRegistration.update({ where: { id: vorhanden.id }, data: daten })
      : await tx.tournamentRegistration.create({ data: daten });

    // Antworten ersetzen - eine erneute Anmeldung nach einer Absage soll
    // nicht die alten Angaben behalten.
    await tx.tournamentCustomFieldResponse.deleteMany({ where: { registrationId: eintrag.id } });
    if (antworten.size > 0) {
      await tx.tournamentCustomFieldResponse.createMany({
        data: [...antworten].map(([fieldId, value]) => ({
          fieldId,
          registrationId: eintrag.id,
          value,
        })),
      });
    }

    // Bestaetigte Anmeldungen treten an - dafuer braucht es einen Eintrag im
    // Teilnehmerfeld, aus dem spaeter das Bracket entsteht.
    if (status === 'CONFIRMED') {
      await stelleTeilnehmerSicher(tx, tournament.id, eintrag, tournament.mode);
    }
    if (input.teamId) {
      await tx.tournamentTeam.update({
        where: { id: input.teamId },
        data: {
          status:
            status === 'CONFIRMED'
              ? 'CONFIRMED'
              : status === 'WAITLISTED'
                ? 'WAITLISTED'
                : 'REGISTERED',
        },
      });
    }

    return eintrag;
  });

  await tournamentEvent(input.tournamentId, 'REGISTRATION_APPROVED', actor, {
    wer: registration.username,
    status: registration.status,
    teamId: registration.teamId,
  });
  logger.info('Anmeldung eingegangen', {
    tournamentId: input.tournamentId,
    status: registration.status,
  });
  return registration;
}

/**
 * Antworten auf die Zusatzfragen pruefen.
 *
 * Was ein Feld bedeutet, entscheidet das Turnier - nicht der Browser. Ein
 * manipuliertes Formular kann so weder Pflichtfelder weglassen noch eigene
 * erfinden.
 */
async function pruefeAntworten(
  tournamentId: string,
  answers: Record<string, string> | undefined,
): Promise<Map<string, string>> {
  const felder = await prisma.tournamentCustomField.findMany({
    where: { tournamentId },
    orderBy: { sortOrder: 'asc' },
  });

  const antworten = new Map<string, string>();
  for (const feld of felder) {
    const wert = (answers?.[feld.id] ?? '').trim();
    if (feld.required && wert.length === 0) {
      throw new AppError('VALIDATION_FAILED', { userMessage: `Bitte «${feld.label}» ausfüllen.` });
    }
    if (wert.length === 0) {
      continue;
    }
    if (feld.maxLength !== null && wert.length > feld.maxLength) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `«${feld.label}» darf höchstens ${feld.maxLength} Zeichen haben.`,
      });
    }
    if (feld.kind === 'SELECT' && !feld.options.includes(wert)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `«${wert}» steht bei «${feld.label}» nicht zur Auswahl.`,
      });
    }
    if (feld.kind === 'URL' && !/^https:\/\/\S+$/u.test(wert)) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `«${feld.label}» braucht eine vollständige https-Adresse.`,
      });
    }
    antworten.set(feld.id, wert.slice(0, feld.maxLength ?? 2000));
  }

  return antworten;
}

/**
 * Den Teilnehmereintrag anlegen, falls er fehlt.
 *
 * Ein Teilnehmer ist das, was im Bracket antritt - eine Person oder ein Team.
 * Ohne diese Zwischenschicht muesste jedes Match zwei Arten von Gegnern
 * kennen, und jede Abfrage beide Faelle unterscheiden.
 */
async function stelleTeilnehmerSicher(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  registration: TournamentRegistration,
  mode: 'SOLO' | 'TEAM',
): Promise<string> {
  const teilnehmerId = await (async (): Promise<string> => {
    if (mode === 'TEAM') {
      if (!registration.teamId) {
        throw new AppError('VALIDATION_FAILED', {
          userMessage: 'Für dieses Turnier braucht es ein Team.',
        });
      }
      const vorhanden = await tx.tournamentParticipant.findUnique({
        where: { teamId: registration.teamId },
        select: { id: true },
      });
      if (vorhanden) {
        return vorhanden.id;
      }
      const teilnehmer = await tx.tournamentParticipant.create({
        data: { tournamentId, teamId: registration.teamId },
      });
      return teilnehmer.id;
    }

    const vorhanden = await tx.tournamentParticipant.findUnique({
      where: { tournamentId_discordId: { tournamentId, discordId: registration.discordId } },
      select: { id: true },
    });
    if (vorhanden) {
      return vorhanden.id;
    }
    const teilnehmer = await tx.tournamentParticipant.create({
      data: {
        tournamentId,
        discordId: registration.discordId,
        username: registration.username,
      },
    });
    return teilnehmer.id;
  })();

  // Der Rueckverweis gehoert an das Ende und nicht in einen der Zweige: er
  // fehlte bei Teams, und damit hatte eine Teamanmeldung keinen Teilnehmer -
  // `listAntretende` fand nichts, und ein Teamturnier liess sich nicht
  // auslosen.
  await tx.tournamentRegistration.update({
    where: { id: registration.id },
    data: { participantId: teilnehmerId },
  });
  return teilnehmerId;
}

/**
 * Eine Anmeldung freigeben.
 *
 * Bei Freigabepflicht oder nach einer Ablehnung. Ist inzwischen kein Platz
 * mehr frei, bleibt die Anmeldung, wo sie ist - eine Freigabe darf die
 * Obergrenze nicht ueberschreiten.
 */
export async function approveRegistration(
  registrationId: string,
  actor: TournamentActor,
): Promise<TournamentRegistration> {
  const registration = await prisma.$transaction(async (tx) => {
    const eintrag = await tx.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${eintrag.tournamentId} FOR UPDATE`;
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: eintrag.tournamentId },
    });

    if (eintrag.status === 'CONFIRMED') {
      return eintrag;
    }

    const belegt = await tx.tournamentRegistration.count({
      where: { tournamentId: eintrag.tournamentId, status: 'CONFIRMED' },
    });
    if (tournament.maxParticipants > 0 && belegt >= tournament.maxParticipants) {
      throw new AppError('CONFLICT', {
        userMessage: 'Das Turnier ist voll. Die Anmeldung bleibt auf der Warteliste.',
      });
    }

    const bestaetigt = await tx.tournamentRegistration.update({
      where: { id: registrationId },
      data: { status: 'CONFIRMED', waitlistPosition: null, reason: null },
    });
    await stelleTeilnehmerSicher(tx, tournament.id, bestaetigt, tournament.mode);
    if (bestaetigt.teamId) {
      await tx.tournamentTeam.update({
        where: { id: bestaetigt.teamId },
        data: { status: 'CONFIRMED' },
      });
    }
    return bestaetigt;
  });

  await tournamentEvent(registration.tournamentId, 'REGISTRATION_APPROVED', actor, {
    wer: registration.username,
  });
  return registration;
}

export async function rejectRegistration(
  registrationId: string,
  reason: string,
  actor: TournamentActor,
): Promise<void> {
  const eintrag = await prisma.tournamentRegistration.update({
    where: { id: registrationId },
    data: { status: 'REJECTED', reason: reason.slice(0, 500), waitlistPosition: null },
  });
  await entferneTeilnehmer(eintrag.tournamentId, eintrag);
  await tournamentEvent(eintrag.tournamentId, 'REGISTRATION_REJECTED', actor, {
    wer: eintrag.username,
    grund: reason,
  });
  await rueckeNach(eintrag.tournamentId, actor);
}

/**
 * Die eigene Anmeldung zurueckziehen.
 *
 * Vor dem Turnierstart jederzeit. Danach nur ueber die Turnierleitung, weil
 * ein Rueckzug aus einem laufenden Bracket ein Freilos fuer den Gegner
 * bedeutet und die ganze Runde verschiebt.
 */
export async function withdrawRegistration(
  registrationId: string,
  actor: TournamentActor,
): Promise<void> {
  const eintrag = await prisma.tournamentRegistration.findUniqueOrThrow({
    where: { id: registrationId },
    include: { tournament: { select: { status: true } } },
  });

  if (
    eintrag.tournament.status === 'RUNNING' ||
    eintrag.tournament.status === 'PAUSED' ||
    eintrag.tournament.status === 'COMPLETED'
  ) {
    throw new AppError('CONFLICT', {
      userMessage: 'Das Turnier läuft bereits. Ein Rückzug muss über die Turnierleitung laufen.',
    });
  }

  await prisma.tournamentRegistration.update({
    where: { id: registrationId },
    data: { status: 'CANCELLED', waitlistPosition: null },
  });
  await entferneTeilnehmer(eintrag.tournamentId, eintrag);

  if (eintrag.teamId) {
    await prisma.tournamentTeam.update({
      where: { id: eintrag.teamId },
      data: { status: 'WITHDRAWN' },
    });
  }

  await tournamentEvent(eintrag.tournamentId, 'REGISTRATION_WITHDRAWN', actor, {
    wer: eintrag.username,
  });
  await rueckeNach(eintrag.tournamentId, actor);
}

/** Den Teilnehmereintrag entfernen, solange das Bracket ihn nicht braucht. */
async function entferneTeilnehmer(
  tournamentId: string,
  registration: Pick<TournamentRegistration, 'participantId' | 'teamId'>,
): Promise<void> {
  const teilnehmerId =
    registration.participantId ??
    (registration.teamId
      ? (
          await prisma.tournamentParticipant.findUnique({
            where: { teamId: registration.teamId },
            select: { id: true },
          })
        )?.id
      : null) ??
    null;

  if (!teilnehmerId) {
    return;
  }

  // Steht das Match schon, bleibt der Eintrag: ein Bracket, aus dem ein
  // Gegner spurlos verschwindet, laesst sich nicht mehr lesen. Stattdessen
  // wird er als ausgeschieden markiert, und die Leitung entscheidet.
  const imBracket = await prisma.tournamentMatch.count({
    where: {
      tournamentId,
      OR: [{ participantAId: teilnehmerId }, { participantBId: teilnehmerId }],
    },
  });

  if (imBracket > 0) {
    await prisma.tournamentParticipant.update({
      where: { id: teilnehmerId },
      data: { eliminatedAt: new Date() },
    });
    return;
  }

  await prisma.tournamentParticipant.delete({ where: { id: teilnehmerId } }).catch(() => undefined);
}

/**
 * Den naechsten von der Warteliste nachruecken lassen.
 *
 * Laeuft, sobald ein Platz frei wird. Bewusst nur einer je Aufruf und in
 * einer Transaktion mit Sperre: sonst ruecken bei zwei gleichzeitig frei
 * gewordenen Plaetzen drei Leute nach.
 */
export async function rueckeNach(
  tournamentId: string,
  actor: TournamentActor,
): Promise<TournamentRegistration | null> {
  const nachgerueckt = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
    const tournament = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    if (tournament.maxParticipants <= 0) {
      return null;
    }
    const belegt = await tx.tournamentRegistration.count({
      where: { tournamentId, status: 'CONFIRMED' },
    });
    if (belegt >= tournament.maxParticipants) {
      return null;
    }

    const naechster = await tx.tournamentRegistration.findFirst({
      where: { tournamentId, status: 'WAITLISTED' },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    });
    if (!naechster) {
      return null;
    }

    // Bei Freigabepflicht ruecken sie in die Pruefung, nicht direkt hinein.
    const status: TournamentRegistrationStatus =
      tournament.access === 'OPEN' ? 'CONFIRMED' : 'PENDING';

    const aktualisiert = await tx.tournamentRegistration.update({
      where: { id: naechster.id },
      data: { status, waitlistPosition: null },
    });

    if (status === 'CONFIRMED') {
      await stelleTeilnehmerSicher(tx, tournamentId, aktualisiert, tournament.mode);
      if (aktualisiert.teamId) {
        await tx.tournamentTeam.update({
          where: { id: aktualisiert.teamId },
          data: { status: 'CONFIRMED' },
        });
      }
    }

    // Die Warteliste zusammenschieben, damit die Positionen wieder stimmen.
    const rest = await tx.tournamentRegistration.findMany({
      where: { tournamentId, status: 'WAITLISTED' },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    for (const [index, eintrag] of rest.entries()) {
      await tx.tournamentRegistration.update({
        where: { id: eintrag.id },
        data: { waitlistPosition: index + 1 },
      });
    }

    return aktualisiert;
  });

  if (nachgerueckt) {
    await tournamentEvent(tournamentId, 'WAITLIST_PROMOTED', actor, {
      wer: nachgerueckt.username,
      status: nachgerueckt.status,
    });
    logger.info('Von der Warteliste nachgerückt', { tournamentId, wer: nachgerueckt.username });
  }
  return nachgerueckt;
}

/** Alle freien Plaetze mit der Warteliste auffuellen. */
export async function rueckeAlleNach(
  tournamentId: string,
  actor: TournamentActor,
): Promise<number> {
  let anzahl = 0;
  // Begrenzt, damit ein Fehler in der Bedingung keine Endlosschleife wird.
  for (let versuch = 0; versuch < 500; versuch += 1) {
    const naechster = await rueckeNach(tournamentId, actor);
    if (!naechster) {
      break;
    }
    anzahl += 1;
  }
  return anzahl;
}
