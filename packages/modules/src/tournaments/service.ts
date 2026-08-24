import { prisma } from '@swisshub/database';
import type { Tournament, TournamentStatus } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { discord, resolveGuildId } from '@swisshub/discord';
import { getModuleSettings } from '../module-state';
import { TOURNAMENTS_MODULE_ID, type TournamentSettings } from './config';
import { slugify, tournamentEvent, type TournamentActor } from './events';

const logger = createLogger('tournaments:service');

/**
 * Erlaubte Statuswechsel.
 *
 * Bewusst eine Tabelle und keine Kette von `if`. Ein Turnier, das aus dem
 * Entwurf direkt in den laufenden Betrieb springt, hat kein Bracket - und der
 * Fehler faellt erst auf, wenn dreissig Leute warten. Was hier nicht steht,
 * geht nicht.
 */
const UEBERGAENGE: Record<TournamentStatus, TournamentStatus[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'CANCELLED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED', 'CANCELLED'],
  REGISTRATION_CLOSED: ['REGISTRATION_OPEN', 'CHECKIN_OPEN', 'READY', 'CANCELLED'],
  CHECKIN_OPEN: ['CHECKIN_CLOSED', 'CANCELLED'],
  CHECKIN_CLOSED: ['CHECKIN_OPEN', 'READY', 'CANCELLED'],
  READY: ['RUNNING', 'CHECKIN_OPEN', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  COMPLETED: ['ARCHIVED'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** Zustaende, in denen ein Turnier oeffentlich sichtbar ist. */
export const OEFFENTLICHE_STATUS: TournamentStatus[] = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECKIN_OPEN',
  'CHECKIN_CLOSED',
  'READY',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
];

/** Zustaende, in denen ein Turnier noch laeuft. */
export const AKTIVE_STATUS: TournamentStatus[] = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECKIN_OPEN',
  'CHECKIN_CLOSED',
  'READY',
  'RUNNING',
  'PAUSED',
];

export function darfWechseln(von: TournamentStatus, nach: TournamentStatus): boolean {
  return UEBERGAENGE[von].includes(nach);
}

export interface CreateTournamentInput {
  name: string;
  slug?: string;
  gameName: string;
  gameId?: string | null;
  description?: string | null;
  rules?: string | null;
  mode: 'SOLO' | 'TEAM';
  access: 'OPEN' | 'APPROVAL' | 'INVITE_ONLY';
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'ROUND_ROBIN' | 'SWISS' | 'GROUPS_THEN_ELIMINATION';
  seeding: 'RANDOM' | 'MANUAL' | 'REGISTRATION_ORDER' | 'RATING';
  minTeamSize?: number;
  maxTeamSize?: number;
  maxSubstitutes?: number;
  maxParticipants?: number;
  minParticipants?: number;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  checkinOpensAt?: Date | null;
  checkinClosesAt?: Date | null;
  rosterLockAt?: Date | null;
  startsAt?: Date | null;
  estimatedEndAt?: Date | null;
  checkinRequired?: boolean;
  autoRemoveMissedCheckin?: boolean;
  groupCount?: number;
  advancePerGroup?: number;
  swissRounds?: number;
  pointsPerWin?: number;
  pointsPerDraw?: number;
  pointsPerLoss?: number;
  tiebreakers?: string[];
  defaultBestOf?: number;
  mapPool?: string[];
  serverRegion?: string | null;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  accentColor?: number | null;
  announcementChannelId?: string | null;
  matchCategoryId?: string | null;
  staffCategoryId?: string | null;
  streamChannelId?: string | null;
  pingRoleIds?: string[];
  participantRoleId?: string | null;
  winnerRoleId?: string | null;
  matchChannelRetentionHours?: number;
  createMatchChannels?: boolean;
  twitchUrl?: string | null;
  youtubeUrl?: string | null;
  streamUrl?: string | null;
  requiredRoleId?: string | null;
  minLevel?: number;
  requiresPremium?: boolean;
}

/**
 * Ein Turnier anlegen.
 *
 * Immer als Entwurf. Oeffentlich wird es erst durch `publishTournament` -
 * ein halb ausgefuelltes Turnier, das schon jemand sieht und in das sich
 * jemand anmeldet, laesst sich hinterher nicht mehr geradebiegen.
 */
export async function createTournament(
  input: CreateTournamentInput,
  actor: TournamentActor,
): Promise<Tournament> {
  const guildId = await resolveGuildId();
  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);

  const slug = await freierSlug(guildId, input.slug?.trim() || input.name);

  pruefeZeitfolge(input);

  const tournament = await prisma.tournament.create({
    data: {
      guildId,
      slug,
      name: input.name.trim().slice(0, 120),
      gameName: input.gameName.trim().slice(0, 60),
      gameId: input.gameId ?? null,
      description: input.description?.slice(0, 4000) ?? null,
      rules: input.rules?.slice(0, 40_000) ?? null,
      mode: input.mode,
      access: input.access,
      format: input.format,
      seeding: input.seeding,
      minTeamSize: input.minTeamSize ?? settings.defaultMinTeamSize,
      maxTeamSize: input.maxTeamSize ?? settings.defaultMaxTeamSize,
      maxSubstitutes: input.maxSubstitutes ?? settings.defaultMaxSubstitutes,
      maxParticipants: input.maxParticipants ?? 0,
      minParticipants: input.minParticipants ?? 2,
      registrationOpensAt: input.registrationOpensAt ?? null,
      registrationClosesAt: input.registrationClosesAt ?? null,
      checkinOpensAt: input.checkinOpensAt ?? null,
      checkinClosesAt: input.checkinClosesAt ?? null,
      rosterLockAt: input.rosterLockAt ?? null,
      startsAt: input.startsAt ?? null,
      estimatedEndAt: input.estimatedEndAt ?? null,
      checkinRequired: input.checkinRequired ?? settings.defaultCheckinRequired,
      autoRemoveMissedCheckin: input.autoRemoveMissedCheckin ?? false,
      groupCount: input.groupCount ?? 0,
      advancePerGroup: input.advancePerGroup ?? 2,
      swissRounds: input.swissRounds ?? 0,
      pointsPerWin: input.pointsPerWin ?? 3,
      pointsPerDraw: input.pointsPerDraw ?? 1,
      pointsPerLoss: input.pointsPerLoss ?? 0,
      tiebreakers: input.tiebreakers ?? ['HEAD_TO_HEAD', 'SCORE_DIFFERENCE', 'SCORE_FOR'],
      defaultBestOf: input.defaultBestOf ?? settings.defaultBestOf,
      mapPool: input.mapPool ?? [],
      serverRegion: input.serverRegion ?? null,
      bannerUrl: input.bannerUrl ?? null,
      logoUrl: input.logoUrl ?? null,
      accentColor: input.accentColor ?? null,
      announcementChannelId:
        input.announcementChannelId ?? settings.defaultAnnouncementChannelId,
      matchCategoryId: input.matchCategoryId ?? settings.defaultMatchCategoryId,
      staffCategoryId: input.staffCategoryId ?? settings.defaultStaffCategoryId,
      streamChannelId: input.streamChannelId ?? settings.defaultStreamChannelId,
      pingRoleIds: input.pingRoleIds ?? [],
      participantRoleId: input.participantRoleId ?? null,
      winnerRoleId: input.winnerRoleId ?? null,
      matchChannelRetentionHours:
        input.matchChannelRetentionHours ?? settings.matchChannelRetentionHours,
      createMatchChannels: input.createMatchChannels ?? settings.createMatchChannels,
      twitchUrl: input.twitchUrl ?? null,
      youtubeUrl: input.youtubeUrl ?? null,
      streamUrl: input.streamUrl ?? null,
      requiredRoleId: input.requiredRoleId ?? null,
      minLevel: input.minLevel ?? 0,
      requiresPremium: input.requiresPremium ?? false,
      createdByDiscordId: actor.discordId,
      staff: {
        // Wer das Turnier anlegt, leitet es. Sonst muesste jemand erst sich
        // selbst eintragen, um das eigene Turnier bearbeiten zu duerfen.
        create: {
          discordId: actor.discordId,
          username: actor.username,
          role: 'OWNER',
          addedByDiscordId: actor.discordId,
        },
      },
    },
  });

  await tournamentEvent(tournament.id, 'CREATED', actor, { name: tournament.name, slug });
  logger.info('Turnier angelegt', { tournamentId: tournament.id, slug });
  return tournament;
}

export async function updateTournament(
  tournamentId: string,
  input: Partial<CreateTournamentInput>,
  actor: TournamentActor,
): Promise<Tournament> {
  const vorher = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  if (vorher.status === 'ARCHIVED') {
    throw new AppError('CONFLICT', {
      userMessage: 'Ein archiviertes Turnier lässt sich nicht mehr ändern.',
    });
  }

  pruefeZeitfolge({ ...vorher, ...input } as CreateTournamentInput);

  const slug =
    input.slug !== undefined && input.slug.trim() !== vorher.slug
      ? await freierSlug(vorher.guildId, input.slug.trim(), tournamentId)
      : vorher.slug;

  // Die Regeln zaehlen als geaendert, wenn ihr Text ein anderer ist. Dann
  // steigt die Fassungsnummer, und wer die alte bestaetigt hat, sieht das.
  const regelnGeaendert =
    input.rules !== undefined && (input.rules ?? '') !== (vorher.rules ?? '');

  const tournament = await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim().slice(0, 120) } : {}),
      slug,
      ...(input.gameName !== undefined ? { gameName: input.gameName.trim().slice(0, 60) } : {}),
      ...(input.gameId !== undefined ? { gameId: input.gameId } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.slice(0, 4000) ?? null }
        : {}),
      ...(input.rules !== undefined ? { rules: input.rules?.slice(0, 40_000) ?? null } : {}),
      ...(regelnGeaendert ? { rulesVersion: vorher.rulesVersion + 1 } : {}),
      ...felderAusEingabe(input),
    },
  });

  await tournamentEvent(tournamentId, 'CREATED', actor, {
    geaendert: Object.keys(input),
    ...(regelnGeaendert ? { regelfassung: tournament.rulesVersion } : {}),
  });

  return tournament;
}

/** Die schlichten Felder - getrennt, damit `updateTournament` lesbar bleibt. */
function felderAusEingabe(input: Partial<CreateTournamentInput>): Record<string, unknown> {
  const daten: Record<string, unknown> = {};
  const uebernehmen = <K extends keyof CreateTournamentInput>(schluessel: K): void => {
    if (input[schluessel] !== undefined) {
      daten[schluessel as string] = input[schluessel];
    }
  };

  for (const schluessel of [
    'mode', 'access', 'format', 'seeding',
    'minTeamSize', 'maxTeamSize', 'maxSubstitutes', 'maxParticipants', 'minParticipants',
    'registrationOpensAt', 'registrationClosesAt', 'checkinOpensAt', 'checkinClosesAt',
    'rosterLockAt', 'startsAt', 'estimatedEndAt',
    'checkinRequired', 'autoRemoveMissedCheckin',
    'groupCount', 'advancePerGroup', 'swissRounds',
    'pointsPerWin', 'pointsPerDraw', 'pointsPerLoss', 'tiebreakers',
    'defaultBestOf', 'mapPool', 'serverRegion',
    'bannerUrl', 'logoUrl', 'accentColor',
    'announcementChannelId', 'matchCategoryId', 'staffCategoryId', 'streamChannelId',
    'pingRoleIds', 'participantRoleId', 'winnerRoleId',
    'matchChannelRetentionHours', 'createMatchChannels',
    'twitchUrl', 'youtubeUrl', 'streamUrl',
    'requiredRoleId', 'minLevel', 'requiresPremium',
  ] as Array<keyof CreateTournamentInput>) {
    uebernehmen(schluessel);
  }

  return daten;
}

/**
 * Zeitliche Reihenfolge pruefen.
 *
 * Ein Check-in, der vor der Anmeldung endet, ist kein Tippfehler, den man
 * spaeter bemerkt - er macht das Turnier unbrauchbar, und zwar genau in dem
 * Moment, in dem alle darauf warten.
 */
function pruefeZeitfolge(input: Partial<CreateTournamentInput>): void {
  const paare: Array<[string, Date | null | undefined, string, Date | null | undefined]> = [
    ['Anmeldungsbeginn', input.registrationOpensAt, 'Anmeldeschluss', input.registrationClosesAt],
    ['Anmeldeschluss', input.registrationClosesAt, 'Check-in-Ende', input.checkinClosesAt],
    ['Check-in-Beginn', input.checkinOpensAt, 'Check-in-Ende', input.checkinClosesAt],
    ['Check-in-Ende', input.checkinClosesAt, 'Turnierstart', input.startsAt],
    ['Turnierstart', input.startsAt, 'voraussichtliches Ende', input.estimatedEndAt],
  ];

  for (const [nameFrueh, frueh, nameSpaet, spaet] of paare) {
    if (frueh && spaet && frueh.getTime() > spaet.getTime()) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `${nameFrueh} liegt nach ${nameSpaet}.`,
      });
    }
  }

  if (
    input.minTeamSize !== undefined &&
    input.maxTeamSize !== undefined &&
    input.minTeamSize > input.maxTeamSize
  ) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Mindest-Teamgrösse ist grösser als die Höchst-Teamgrösse.',
    });
  }

  if (
    input.maxParticipants !== undefined &&
    input.maxParticipants > 0 &&
    input.minParticipants !== undefined &&
    input.minParticipants > input.maxParticipants
  ) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Die Mindestteilnehmerzahl ist grösser als die Obergrenze.',
    });
  }
}

/** Eine noch freie Kennung fuer die Adresszeile. */
async function freierSlug(guildId: string, wunsch: string, eigeneId?: string): Promise<string> {
  const basis = slugify(wunsch) || 'turnier';

  for (let versuch = 0; versuch < 50; versuch += 1) {
    const kandidat = versuch === 0 ? basis : `${basis}-${versuch + 1}`;
    const belegt = await prisma.tournament.findUnique({
      where: { guildId_slug: { guildId, slug: kandidat } },
      select: { id: true },
    });
    if (!belegt || belegt.id === eigeneId) {
      return kandidat;
    }
  }

  throw new AppError('CONFLICT', {
    userMessage: 'Zu dieser Kennung gibt es bereits zu viele Turniere. Bitte einen anderen Namen wählen.',
  });
}

// --- Statuswechsel ---------------------------------------------------------

/**
 * Den Status setzen.
 *
 * Einzige Stelle, die `status` schreibt. Jeder Wechsel geht durch die Tabelle
 * oben und hinterlaesst einen Eintrag im Verlauf.
 */
export async function setTournamentStatus(
  tournamentId: string,
  nach: TournamentStatus,
  actor: TournamentActor,
  detail: Record<string, unknown> = {},
): Promise<Tournament> {
  const vorher = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

  if (vorher.status === nach) {
    return vorher;
  }
  if (!darfWechseln(vorher.status, nach)) {
    throw new AppError('CONFLICT', {
      userMessage: `Ein Turnier im Zustand «${STATUS_TEXT[vorher.status]}» lässt sich nicht auf «${STATUS_TEXT[nach]}» setzen.`,
    });
  }

  const jetzt = new Date();
  const tournament = await prisma.tournament.update({
    where: { id: tournamentId },
    data: {
      status: nach,
      ...(nach === 'REGISTRATION_OPEN' && vorher.publishedAt === null
        ? { publishedAt: jetzt }
        : {}),
      ...(nach === 'RUNNING' && vorher.startedAt === null ? { startedAt: jetzt } : {}),
      ...(nach === 'RUNNING' ? { pausedAt: null } : {}),
      ...(nach === 'PAUSED' ? { pausedAt: jetzt } : {}),
      ...(nach === 'COMPLETED' ? { completedAt: jetzt } : {}),
      ...(nach === 'CANCELLED' ? { cancelledAt: jetzt } : {}),
      ...(nach === 'ARCHIVED' ? { archivedAt: jetzt } : {}),
    },
  });

  const EREIGNIS: Partial<Record<TournamentStatus, Parameters<typeof tournamentEvent>[1]>> = {
    REGISTRATION_OPEN: 'REGISTRATION_OPENED',
    REGISTRATION_CLOSED: 'REGISTRATION_CLOSED',
    CHECKIN_OPEN: 'CHECKIN_OPENED',
    CHECKIN_CLOSED: 'CHECKIN_CLOSED',
    RUNNING: vorher.status === 'PAUSED' ? 'RESUMED' : 'STARTED',
    PAUSED: 'PAUSED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    ARCHIVED: 'ARCHIVED',
  };

  const ereignis = EREIGNIS[nach];
  if (ereignis) {
    await tournamentEvent(tournamentId, ereignis, actor, { von: vorher.status, ...detail });
  }

  logger.info('Turnierstatus gewechselt', { tournamentId, von: vorher.status, nach });
  return tournament;
}

export const STATUS_TEXT: Record<TournamentStatus, string> = {
  DRAFT: 'Entwurf',
  REGISTRATION_OPEN: 'Anmeldung offen',
  REGISTRATION_CLOSED: 'Anmeldung geschlossen',
  CHECKIN_OPEN: 'Check-in offen',
  CHECKIN_CLOSED: 'Check-in geschlossen',
  READY: 'Startbereit',
  RUNNING: 'Läuft',
  PAUSED: 'Pausiert',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgesagt',
  ARCHIVED: 'Archiviert',
};

/**
 * Ein Turnier veroeffentlichen.
 *
 * Ab hier ist es unter seiner Adresse sichtbar und nimmt Anmeldungen an.
 * Vorher laeuft der Startcheck - ein Turnier ohne Spiel, ohne Datum oder mit
 * widerspruechlichen Zeiten soll gar nicht erst sichtbar werden.
 */
export async function publishTournament(
  tournamentId: string,
  actor: TournamentActor,
): Promise<Tournament> {
  const bericht = await preflight(tournamentId, 'PUBLISH');
  const blocker = bericht.filter((eintrag) => eintrag.status === 'error');
  if (blocker.length > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `Das Turnier ist noch nicht bereit: ${blocker[0]!.detail}`,
    });
  }

  const tournament = await setTournamentStatus(tournamentId, 'REGISTRATION_OPEN', actor);
  await tournamentEvent(tournamentId, 'PUBLISHED', actor);
  return tournament;
}

export async function cancelTournament(
  tournamentId: string,
  reason: string,
  actor: TournamentActor,
): Promise<Tournament> {
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { cancelReason: reason.slice(0, 500) },
  });
  return setTournamentStatus(tournamentId, 'CANCELLED', actor, { grund: reason });
}

export async function archiveTournament(
  tournamentId: string,
  actor: TournamentActor,
): Promise<Tournament> {
  return setTournamentStatus(tournamentId, 'ARCHIVED', actor);
}

// --- Startcheck ------------------------------------------------------------

export interface PreflightCheck {
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
}

export type PreflightPhase = 'PUBLISH' | 'CHECKIN_CLOSE' | 'START';

/**
 * Das Turnier durchsehen, bevor etwas Unumkehrbares geschieht.
 *
 * Drei Zeitpunkte, drei Fragestellungen: beim Veroeffentlichen geht es um
 * Vollstaendigkeit, beim Check-in-Ende um die Teilnehmer, beim Start um
 * Bracket und Discord. Ein Fehler blockiert; eine Warnung nicht.
 */
export async function preflight(
  tournamentId: string,
  phase: PreflightPhase,
): Promise<PreflightCheck[]> {
  const tournament = await prisma.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    include: {
      staff: { select: { id: true } },
      customFields: { select: { id: true } },
    },
  });

  const checks: PreflightCheck[] = [];
  const fehler = (label: string, detail: string): void => {
    checks.push({ label, status: 'error', detail });
  };
  const warnung = (label: string, detail: string): void => {
    checks.push({ label, status: 'warning', detail });
  };
  const gut = (label: string, detail: string): void => {
    checks.push({ label, status: 'ok', detail });
  };

  // --- Immer -----------------------------------------------------------
  if (tournament.name.trim().length < 3) {
    fehler('Name', 'Das Turnier braucht einen Namen.');
  } else {
    gut('Name', tournament.name);
  }

  if (tournament.gameName.trim().length === 0) {
    fehler('Spiel', 'Es ist kein Spiel gewählt.');
  } else {
    gut('Spiel', tournament.gameName);
  }

  if (!tournament.startsAt) {
    fehler('Turnierstart', 'Es ist kein Startzeitpunkt gesetzt.');
  } else {
    gut('Turnierstart', tournament.startsAt.toISOString());
  }

  if (!tournament.rules || tournament.rules.trim().length < 20) {
    warnung('Regelwerk', 'Kein Regelwerk hinterlegt - bei einem Einspruch fehlt die Grundlage.');
  } else {
    gut('Regelwerk', `Fassung ${tournament.rulesVersion}`);
  }

  if (tournament.staff.length === 0) {
    warnung('Turnierleitung', 'Niemand ist ausdrücklich als Leitung eingetragen.');
  } else {
    gut('Turnierleitung', `${tournament.staff.length} eingetragen`);
  }

  // --- Discord ---------------------------------------------------------
  const kanaele = await discord.channels.list().catch(() => null);
  const findeKanal = (id: string | null): boolean =>
    id === null ? false : (kanaele?.some((kanal) => kanal.id === id) ?? true);

  if (!tournament.announcementChannelId) {
    warnung('Ankündigungs-Channel', 'Nicht gesetzt - es werden keine Ankündigungen gesendet.');
  } else if (!findeKanal(tournament.announcementChannelId)) {
    fehler('Ankündigungs-Channel', 'Der gewählte Channel existiert auf Discord nicht mehr.');
  } else {
    gut('Ankündigungs-Channel', 'Vorhanden');
  }

  if (tournament.createMatchChannels) {
    if (!tournament.matchCategoryId) {
      fehler('Match-Kategorie', 'Nicht gesetzt - ohne sie entsteht kein Match-Channel.');
    } else if (!findeKanal(tournament.matchCategoryId)) {
      fehler('Match-Kategorie', 'Die gewählte Kategorie existiert auf Discord nicht mehr.');
    } else {
      gut('Match-Kategorie', 'Vorhanden');
    }
  }

  // --- Teilnehmer ------------------------------------------------------
  if (phase !== 'PUBLISH') {
    const bestaetigt = await prisma.tournamentRegistration.count({
      where: { tournamentId, status: 'CONFIRMED' },
    });
    const eingecheckt = await prisma.tournamentRegistration.count({
      where: {
        tournamentId,
        status: 'CONFIRMED',
        checkinStatus: { in: ['CHECKED_IN', 'ADMIN_CONFIRMED', 'NOT_REQUIRED'] },
      },
    });

    const antretend = tournament.checkinRequired ? eingecheckt : bestaetigt;

    if (antretend < tournament.minParticipants) {
      fehler(
        'Teilnehmerzahl',
        `Nur ${antretend} von mindestens ${tournament.minParticipants} treten an.`,
      );
    } else {
      gut('Teilnehmerzahl', `${antretend} treten an`);
    }

    if (tournament.mode === 'TEAM') {
      const unvollstaendig = await unvollstaendigeTeams(tournamentId, tournament.minTeamSize);
      if (unvollstaendig.length > 0) {
        fehler(
          'Teams vollständig',
          `${unvollstaendig.length} Teams haben weniger als ${tournament.minTeamSize} Spieler: ${unvollstaendig.slice(0, 3).join(', ')}${unvollstaendig.length > 3 ? ' …' : ''}`,
        );
      } else {
        gut('Teams vollständig', 'Alle Teams sind besetzt');
      }
    }
  }

  // --- Start -----------------------------------------------------------
  if (phase === 'START') {
    const matches = await prisma.tournamentMatch.count({ where: { tournamentId } });
    if (matches === 0) {
      fehler('Bracket', 'Es ist noch kein Bracket erzeugt.');
    } else {
      gut('Bracket', `${matches} Matches`);
    }

    const offeneEinsprueche = await prisma.tournamentDispute.count({
      where: { tournamentId, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    if (offeneEinsprueche > 0) {
      warnung('Einsprüche', `${offeneEinsprueche} offen.`);
    }
  }

  return checks;
}

/** Teams, die die Mindestgroesse nicht erreichen. */
async function unvollstaendigeTeams(tournamentId: string, minTeamSize: number): Promise<string[]> {
  const teams = await prisma.tournamentTeam.findMany({
    where: { tournamentId, status: { in: ['REGISTERED', 'CONFIRMED'] } },
    select: {
      name: true,
      members: {
        where: { removedAt: null, role: { in: ['CAPTAIN', 'PLAYER'] } },
        select: { id: true },
      },
    },
  });

  return teams
    .filter((team) => team.members.length < minTeamSize)
    .map((team) => team.name);
}

// --- Vorlagen und Duplizieren ---------------------------------------------

/**
 * Ein Turnier als Vorlage fuer ein neues nehmen.
 *
 * Uebernommen wird nur die Einrichtung - Format, Zeiten als Dauer, Discord,
 * Regeln, Preise, Formularfelder. Teilnehmer und Resultate bleiben, wo sie
 * sind: ein Turnier mit den Teams des letzten Mals waere schlimmer als eines
 * ohne Teams, weil niemand sie erwartet.
 */
export async function duplicateTournament(
  tournamentId: string,
  name: string,
  actor: TournamentActor,
): Promise<Tournament> {
  const vorlage = await prisma.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    include: {
      prizes: { orderBy: { placement: 'asc' } },
      customFields: { orderBy: { sortOrder: 'asc' } },
    },
  });

  const neu = await createTournament(
    {
      name,
      gameName: vorlage.gameName,
      gameId: vorlage.gameId,
      description: vorlage.description,
      rules: vorlage.rules,
      mode: vorlage.mode,
      access: vorlage.access,
      format: vorlage.format,
      seeding: vorlage.seeding,
      minTeamSize: vorlage.minTeamSize,
      maxTeamSize: vorlage.maxTeamSize,
      maxSubstitutes: vorlage.maxSubstitutes,
      maxParticipants: vorlage.maxParticipants,
      minParticipants: vorlage.minParticipants,
      checkinRequired: vorlage.checkinRequired,
      autoRemoveMissedCheckin: vorlage.autoRemoveMissedCheckin,
      groupCount: vorlage.groupCount,
      advancePerGroup: vorlage.advancePerGroup,
      swissRounds: vorlage.swissRounds,
      pointsPerWin: vorlage.pointsPerWin,
      pointsPerDraw: vorlage.pointsPerDraw,
      pointsPerLoss: vorlage.pointsPerLoss,
      tiebreakers: vorlage.tiebreakers,
      defaultBestOf: vorlage.defaultBestOf,
      mapPool: vorlage.mapPool,
      serverRegion: vorlage.serverRegion,
      bannerUrl: vorlage.bannerUrl,
      logoUrl: vorlage.logoUrl,
      accentColor: vorlage.accentColor,
      announcementChannelId: vorlage.announcementChannelId,
      matchCategoryId: vorlage.matchCategoryId,
      staffCategoryId: vorlage.staffCategoryId,
      streamChannelId: vorlage.streamChannelId,
      pingRoleIds: vorlage.pingRoleIds,
      matchChannelRetentionHours: vorlage.matchChannelRetentionHours,
      createMatchChannels: vorlage.createMatchChannels,
      requiredRoleId: vorlage.requiredRoleId,
      minLevel: vorlage.minLevel,
      requiresPremium: vorlage.requiresPremium,
    },
    actor,
  );

  // Preise und Formularfelder mit, aber ohne Zuteilung und ohne Antworten.
  if (vorlage.prizes.length > 0) {
    await prisma.tournamentPrize.createMany({
      data: vorlage.prizes.map((preis) => ({
        tournamentId: neu.id,
        placement: preis.placement,
        title: preis.title,
        description: preis.description,
        value: preis.value,
        sponsorName: preis.sponsorName,
        sponsorUrl: preis.sponsorUrl,
        sponsorLogoUrl: preis.sponsorLogoUrl,
      })),
    });
  }
  if (vorlage.customFields.length > 0) {
    await prisma.tournamentCustomField.createMany({
      data: vorlage.customFields.map((feld) => ({
        tournamentId: neu.id,
        kind: feld.kind,
        label: feld.label,
        description: feld.description,
        placeholder: feld.placeholder,
        required: feld.required,
        options: feld.options,
        maxLength: feld.maxLength,
        sortOrder: feld.sortOrder,
      })),
    });
  }

  return neu;
}

/** Ein Turnier ueber seine Adresskennung. */
export async function getTournamentBySlug(slug: string): Promise<Tournament | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.tournament.findUnique({ where: { guildId_slug: { guildId, slug } } });
}
