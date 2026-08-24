import { prisma } from '@swisshub/database';
import type { Prisma, TournamentStatus } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { tournamentSichtbarkeitsFilter, type TournamentViewer } from './access';
import { AKTIVE_STATUS } from './service';

/**
 * Der verbundene Server als Filter.
 *
 * SwissHub bedient heute genau einen Discord-Server, und der Datenbestand
 * traegt trotzdem ueberall eine Serverkennung. Die hier auszuwerten kostet
 * nichts und schliesst aus, dass eine Uebersicht Turniere eines anderen
 * Bestandes zeigt - etwa nach einer Wiederherstellung aus einer fremden
 * Sicherung oder wenn spaeter ein zweiter Server dazukommt.
 *
 * Faellt Discord aus, gibt es keine Kennung. Dann wird nichts gezeigt statt
 * alles: eine Liste, die im Stoerungsfall mehr zeigt als sonst, ist die
 * falsche Richtung.
 */
async function guildFilter(): Promise<{ guildId: string }> {
  return { guildId: await resolveGuildId() };
}

/**
 * Abfragen fuer Uebersicht, Statistik und Archiv.
 *
 * Alles, was mehr als eine Seite braucht, steht hier - damit nicht jede Seite
 * ihre eigene Fassung derselben Frage stellt und die Antworten auseinander
 * laufen.
 */

export interface TournamentListQuery {
  status?: TournamentStatus[];
  gameId?: string;
  search?: string;
  /** Nur Turniere, die noch laufen. */
  aktiv?: boolean;
  /** Nur abgeschlossene, abgesagte und archivierte. */
  archiv?: boolean;
  page: number;
  pageSize: number;
}

/**
 * Turniere im Verwaltungsbereich.
 *
 * Immer durch die Sichtbarkeit gefiltert: ein Gastorganisator soll ueber die
 * Uebersicht keine Turniere finden, die er einzeln nie oeffnen duerfte.
 */
export async function listTournaments(viewer: TournamentViewer, query: TournamentListQuery) {
  const sichtbar = await tournamentSichtbarkeitsFilter(viewer);

  const where: Prisma.TournamentWhereInput = { ...(await guildFilter()), ...sichtbar };

  if (query.status && query.status.length > 0) {
    where.status = { in: query.status };
  } else if (query.aktiv) {
    where.status = { in: AKTIVE_STATUS };
  } else if (query.archiv) {
    where.status = { in: ['COMPLETED', 'CANCELLED', 'ARCHIVED'] };
  }

  if (query.gameId) {
    where.gameId = query.gameId;
  }
  if (query.search) {
    const begriff = query.search.trim();
    where.OR = [
      { name: { contains: begriff, mode: 'insensitive' } },
      { gameName: { contains: begriff, mode: 'insensitive' } },
      { slug: { contains: begriff, mode: 'insensitive' } },
    ];
  }

  const [eintraege, total] = await Promise.all([
    prisma.tournament.findMany({
      where,
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        _count: { select: { registrations: true, matches: true } },
        game: { select: { id: true, name: true } },
      },
    }),
    prisma.tournament.count({ where }),
  ]);

  return {
    rows: eintraege.map(({ _count, ...tournament }) => ({
      tournament,
      anmeldungen: _count.registrations,
      matches: _count.matches,
    })),
    total,
  };
}

/**
 * Turniere, die auf der oeffentlichen Seite erscheinen.
 *
 * Entwuerfe bleiben aussen vor - ein halb ausgefuelltes Turnier, in das sich
 * jemand anmeldet, laesst sich hinterher nicht mehr geradebiegen.
 */
export async function listPublicTournaments(options: { archiv?: boolean; limit?: number } = {}) {
  return prisma.tournament.findMany({
    where: {
      ...(await guildFilter()),
      // Beide Listen muessen sich ausschliessen, sonst steht dasselbe
      // Turnier unter «Aktuell» und unter «Vorbei».
      status: options.archiv
        ? { in: ['COMPLETED', 'CANCELLED', 'ARCHIVED'] }
        : { in: AKTIVE_STATUS },
    },
    orderBy: options.archiv ? [{ completedAt: 'desc' }] : [{ startsAt: 'asc' }],
    take: options.limit ?? 50,
    include: {
      game: { select: { name: true } },
      _count: { select: { registrations: true } },
    },
  });
}

/**
 * Ein Turnier mit allem, was die oeffentliche Seite braucht.
 *
 * Eine Abfrage statt zehn: die Turnierseite zeigt Hero, Teilnehmer, Bracket,
 * Preise und Leitung auf einmal.
 */
export async function getPublicTournament(slug: string) {
  const { resolveGuildId } = await import('@swisshub/discord');
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }

  return prisma.tournament.findUnique({
    where: { guildId_slug: { guildId, slug } },
    include: {
      game: { select: { id: true, name: true } },
      staff: {
        where: { role: { in: ['OWNER', 'ADMIN'] } },
        select: { discordId: true, username: true, role: true },
      },
      prizes: { orderBy: { placement: 'asc' } },
      customFields: { orderBy: { sortOrder: 'asc' } },
      _count: { select: { registrations: true, teams: true, matches: true } },
    },
  });
}

/** Die Teilnehmerliste, wie sie oeffentlich erscheinen darf. */
export async function getPublicParticipants(tournamentId: string) {
  const anmeldungen = await prisma.tournamentRegistration.findMany({
    where: { tournamentId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
    orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { createdAt: 'asc' }],
    include: {
      team: {
        select: {
          id: true,
          name: true,
          tag: true,
          logoUrl: true,
          captainUsername: true,
          members: {
            where: { removedAt: null },
            select: { username: true, role: true },
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          },
        },
      },
      participant: { select: { id: true, seed: true, placement: true, eliminatedAt: true } },
    },
  });

  // Discord-Kennungen erscheinen bewusst nicht: der Name genuegt, um zu
  // zeigen, wer mitspielt, und eine Kennungsliste ist eine Einladung, sie
  // anderswo zu verwenden.
  return anmeldungen.map((eintrag) => ({
    registrationId: eintrag.id,
    status: eintrag.status,
    checkinStatus: eintrag.checkinStatus,
    waitlistPosition: eintrag.waitlistPosition,
    username: eintrag.username,
    team: eintrag.team,
    participant: eintrag.participant,
  }));
}

// --- Statistiken -----------------------------------------------------------

export interface TournamentStats {
  gesamt: number;
  aktiv: number;
  abgeschlossen: number;
  teilnehmerGesamt: number;
  teamsGesamt: number;
  matchesGesamt: number;
  noShows: number;
  forfeits: number;
  einspruecheOffen: number;
  einspruecheGesamt: number;
  /** Prozent der Eingecheckten unter den Bestaetigten, ueber alle Turniere. */
  checkinQuote: number | null;
  /** Prozent der abgeschlossenen unter den gestarteten Turnieren. */
  abschlussQuote: number | null;
  beliebtesteSpiele: Array<{ name: string; anzahl: number }>;
}

/**
 * Kennzahlen ueber alle Turniere.
 *
 * Nur echte Zahlen. Wo nichts gemessen wurde, steht `null` und die
 * Oberflaeche zeigt einen Strich - eine erfundene Quote waere schlimmer als
 * gar keine, weil man sich auf sie verliesse.
 */
export async function getTournamentStats(): Promise<TournamentStats> {
  // Alle Zaehlungen auf denselben Server begrenzen - eine Kennzahl, die
  // Turniere eines anderen Bestandes mitzaehlt, waere schlimmer als keine.
  const guild = await guildFilter();
  const imTurnier = { tournament: guild };

  const [
    gesamt,
    aktiv,
    abgeschlossen,
    gestartet,
    teilnehmerGesamt,
    teamsGesamt,
    matchesGesamt,
    noShows,
    forfeits,
    einspruecheOffen,
    einspruecheGesamt,
    bestaetigt,
    eingecheckt,
    nachSpiel,
  ] = await Promise.all([
    prisma.tournament.count({ where: guild }),
    prisma.tournament.count({ where: { ...guild, status: { in: AKTIVE_STATUS } } }),
    prisma.tournament.count({
      where: { ...guild, status: { in: ['COMPLETED', 'ARCHIVED'] } },
    }),
    prisma.tournament.count({ where: { ...guild, startedAt: { not: null } } }),
    prisma.tournamentRegistration.count({ where: { ...imTurnier, status: 'CONFIRMED' } }),
    prisma.tournamentTeam.count({
      where: { ...imTurnier, status: { in: ['CONFIRMED', 'REGISTERED'] } },
    }),
    prisma.tournamentMatch.count({ where: imTurnier }),
    prisma.tournamentMatch.count({ where: { ...imTurnier, resultReason: 'NO_SHOW' } }),
    prisma.tournamentMatch.count({ where: { ...imTurnier, resultReason: 'FORFEIT' } }),
    prisma.tournamentDispute.count({
      where: { ...imTurnier, status: { in: ['OPEN', 'IN_REVIEW'] } },
    }),
    prisma.tournamentDispute.count({ where: imTurnier }),
    prisma.tournamentRegistration.count({
      where: { ...imTurnier, status: 'CONFIRMED', checkinStatus: { not: 'NOT_REQUIRED' } },
    }),
    prisma.tournamentRegistration.count({
      where: {
        ...imTurnier,
        status: 'CONFIRMED',
        checkinStatus: { in: ['CHECKED_IN', 'ADMIN_CONFIRMED'] },
      },
    }),
    prisma.tournament.groupBy({
      by: ['gameName'],
      where: guild,
      _count: { _all: true },
      orderBy: { _count: { gameName: 'desc' } },
      take: 5,
    }),
  ]);

  return {
    gesamt,
    aktiv,
    abgeschlossen,
    teilnehmerGesamt,
    teamsGesamt,
    matchesGesamt,
    noShows,
    forfeits,
    einspruecheOffen,
    einspruecheGesamt,
    checkinQuote: bestaetigt === 0 ? null : Math.round((eingecheckt / bestaetigt) * 100),
    abschlussQuote: gestartet === 0 ? null : Math.round((abgeschlossen / gestartet) * 100),
    beliebtesteSpiele: nachSpiel.map((eintrag) => ({
      name: eintrag.gameName,
      anzahl: eintrag._count._all,
    })),
  };
}

export interface EinzelStats {
  angemeldet: number;
  bestaetigt: number;
  warteliste: number;
  eingecheckt: number;
  checkinQuote: number | null;
  matchesGesamt: number;
  matchesGespielt: number;
  matchesOffen: number;
  einsprueche: number;
  noShows: number;
  forfeits: number;
  /** Durchschnittliche Matchdauer in Minuten; `null`, wenn nichts gemessen. */
  matchdauerMinuten: number | null;
}

/** Kennzahlen eines einzelnen Turniers. */
export async function getEinzelStats(tournamentId: string): Promise<EinzelStats> {
  const [
    angemeldet,
    bestaetigt,
    warteliste,
    eingecheckt,
    checkinPflichtig,
    matchesGesamt,
    matchesGespielt,
    einsprueche,
    noShows,
    forfeits,
    gemessene,
  ] = await Promise.all([
    prisma.tournamentRegistration.count({
      where: { tournamentId, status: { notIn: ['CANCELLED', 'REJECTED'] } },
    }),
    prisma.tournamentRegistration.count({ where: { tournamentId, status: 'CONFIRMED' } }),
    prisma.tournamentRegistration.count({ where: { tournamentId, status: 'WAITLISTED' } }),
    prisma.tournamentRegistration.count({
      where: {
        tournamentId,
        status: 'CONFIRMED',
        checkinStatus: { in: ['CHECKED_IN', 'ADMIN_CONFIRMED'] },
      },
    }),
    prisma.tournamentRegistration.count({
      where: { tournamentId, status: 'CONFIRMED', checkinStatus: { not: 'NOT_REQUIRED' } },
    }),
    prisma.tournamentMatch.count({ where: { tournamentId } }),
    prisma.tournamentMatch.count({
      where: { tournamentId, status: { in: ['COMPLETED', 'FORFEIT'] } },
    }),
    prisma.tournamentDispute.count({ where: { tournamentId } }),
    prisma.tournamentMatch.count({ where: { tournamentId, resultReason: 'NO_SHOW' } }),
    prisma.tournamentMatch.count({ where: { tournamentId, resultReason: 'FORFEIT' } }),
    // Nur Matches, die tatsaechlich einen Anfang und ein Ende haben. Fehlende
    // Zeiten mitzurechnen ergaebe eine schoenere, falsche Zahl.
    prisma.tournamentMatch.findMany({
      where: {
        tournamentId,
        startedAt: { not: null },
        completedAt: { not: null },
        resultReason: 'PLAYED',
      },
      select: { startedAt: true, completedAt: true },
      take: 500,
    }),
  ]);

  const dauern = gemessene.map(
    (match) => (match.completedAt!.getTime() - match.startedAt!.getTime()) / 60_000,
  );

  return {
    angemeldet,
    bestaetigt,
    warteliste,
    eingecheckt,
    checkinQuote:
      checkinPflichtig === 0 ? null : Math.round((eingecheckt / checkinPflichtig) * 100),
    matchesGesamt,
    matchesGespielt,
    matchesOffen: matchesGesamt - matchesGespielt,
    einsprueche,
    noShows,
    forfeits,
    matchdauerMinuten:
      dauern.length === 0
        ? null
        : Math.round(dauern.reduce((a, b) => a + b, 0) / dauern.length),
  };
}

/**
 * Der Live-Stand eines Turniers.
 *
 * Grundlage des Leitstands und des Live-Stroms. Bewusst schlank: er wird
 * mehrmals je Minute abgefragt, und jede zusaetzliche Angabe kostet dort am
 * meisten.
 */
export interface LiveZustand {
  status: TournamentStatus;
  runde: number | null;
  abschnitt: string | null;
  matchesLive: number;
  matchesWartend: number;
  matchesOffen: number;
  matchesFertig: number;
  einspruecheOffen: number;
  eingecheckt: number;
  bestaetigt: number;
}

export async function getLiveZustand(tournamentId: string): Promise<LiveZustand> {
  const tournament = await prisma.tournament.findUniqueOrThrow({
    where: { id: tournamentId },
    select: { status: true },
  });

  const [nachStatus, einspruecheOffen, eingecheckt, bestaetigt, laufenderAbschnitt] =
    await Promise.all([
      prisma.tournamentMatch.groupBy({
        by: ['status'],
        where: { tournamentId },
        _count: { _all: true },
      }),
      prisma.tournamentDispute.count({
        where: { tournamentId, status: { in: ['OPEN', 'IN_REVIEW'] } },
      }),
      prisma.tournamentRegistration.count({
        where: {
          tournamentId,
          status: 'CONFIRMED',
          checkinStatus: { in: ['CHECKED_IN', 'ADMIN_CONFIRMED'] },
        },
      }),
      prisma.tournamentRegistration.count({ where: { tournamentId, status: 'CONFIRMED' } }),
      prisma.tournamentMatch.findFirst({
        where: { tournamentId, status: { notIn: ['COMPLETED', 'FORFEIT', 'CANCELLED'] } },
        orderBy: [{ round: 'asc' }, { position: 'asc' }],
        select: { round: true, stage: { select: { name: true } } },
      }),
    ]);

  const zaehle = (...status: string[]): number =>
    nachStatus
      .filter((eintrag) => status.includes(eintrag.status))
      .reduce((summe, eintrag) => summe + eintrag._count._all, 0);

  return {
    status: tournament.status,
    runde: laufenderAbschnitt?.round ?? null,
    abschnitt: laufenderAbschnitt?.stage.name ?? null,
    matchesLive: zaehle('LIVE'),
    matchesWartend: zaehle('AWAITING_RESULT', 'DISPUTED'),
    matchesOffen: zaehle('PENDING', 'READY', 'SCHEDULED'),
    matchesFertig: zaehle('COMPLETED', 'FORFEIT'),
    einspruecheOffen,
    eingecheckt,
    bestaetigt,
  };
}

/**
 * Die Turnierhistorie einer Person.
 *
 * Nur echte Teilnahmen und echte Platzierungen. Ein Mitgliederprofil, das
 * «3 Turniere, 1 Sieg» behauptet, muss das belegen koennen.
 */
export async function getMemberHistory(discordId: string) {
  const anmeldungen = await prisma.tournamentRegistration.findMany({
    where: { discordId, status: 'CONFIRMED' },
    include: {
      tournament: {
        select: { id: true, slug: true, name: true, gameName: true, status: true, startsAt: true },
      },
      participant: { select: { placement: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Auch Teilnahmen als gewoehnliches Teammitglied zaehlen - nicht nur die
  // des Captains, der angemeldet hat.
  const alsMitglied = await prisma.tournamentTeamMember.findMany({
    where: { discordId, removedAt: null },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          participant: { select: { placement: true } },
          tournament: {
            select: { id: true, slug: true, name: true, gameName: true, status: true, startsAt: true },
          },
        },
      },
    },
  });

  const nachTurnier = new Map<
    string,
    {
      tournament: { id: string; slug: string; name: string; gameName: string; status: TournamentStatus; startsAt: Date | null };
      team: string | null;
      placement: number | null;
    }
  >();

  for (const eintrag of anmeldungen) {
    nachTurnier.set(eintrag.tournament.id, {
      tournament: eintrag.tournament,
      team: null,
      placement: eintrag.participant?.placement ?? null,
    });
  }
  for (const eintrag of alsMitglied) {
    nachTurnier.set(eintrag.team.tournament.id, {
      tournament: eintrag.team.tournament,
      team: eintrag.team.name,
      placement: eintrag.team.participant?.placement ?? null,
    });
  }

  const teilnahmen = [...nachTurnier.values()].sort(
    (a, b) => (b.tournament.startsAt?.getTime() ?? 0) - (a.tournament.startsAt?.getTime() ?? 0),
  );

  return {
    teilnahmen,
    gesamt: teilnahmen.length,
    siege: teilnahmen.filter((eintrag) => eintrag.placement === 1).length,
    podeste: teilnahmen.filter(
      (eintrag) => eintrag.placement !== null && eintrag.placement <= 3,
    ).length,
  };
}

/** Der Verlauf eines Turniers - fuer die Leitung. */
export async function getTournamentEvents(tournamentId: string, limit = 100) {
  return prisma.tournamentEvent.findMany({
    where: { tournamentId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Offene Einsprueche - der eigene Filter des Leitstands. */
export async function listDisputes(
  options: { tournamentId?: string; tournamentIds?: string[]; offen?: boolean } = {},
) {
  return prisma.tournamentDispute.findMany({
    where: {
      ...(options.tournamentId ? { tournamentId: options.tournamentId } : {}),
      ...(options.tournamentIds ? { tournamentId: { in: options.tournamentIds } } : {}),
      ...(options.offen ? { status: { in: ['OPEN', 'IN_REVIEW'] } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      match: {
        select: {
          id: true,
          matchNumber: true,
          scoreA: true,
          scoreB: true,
          status: true,
          participantA: { select: { username: true, team: { select: { name: true } } } },
          participantB: { select: { username: true, team: { select: { name: true } } } },
        },
      },
      tournament: { select: { id: true, slug: true, name: true } },
    },
  });
}

// --- Der eigene Stand ------------------------------------------------------

export interface EigenerStand {
  angemeldet: boolean;
  registrationId: string | null;
  status: string | null;
  waitlistPosition: number | null;
  checkinStatus: string | null;
  teamId: string | null;
  teamName: string | null;
  istCaptain: boolean;
}

/**
 * Wo eine Person in einem Turnier steht.
 *
 * Beantwortet in einer Abfrage, was die Turnierseite fuer den naechsten
 * sinnvollen Knopf wissen muss: angemeldet oder nicht, Warteliste oder
 * bestaetigt, eingecheckt oder nicht, und ob sie ein Team fuehrt.
 *
 * Die Anmeldung eines Teams steht beim Captain. Wer als Spieler in einem Team
 * ist, hat selbst keine Anmeldung - deshalb wird zusaetzlich ueber die
 * Mitgliedschaft gesucht.
 */
export async function getEigenerStand(
  tournamentId: string,
  discordId: string,
): Promise<EigenerStand> {
  const leer: EigenerStand = {
    angemeldet: false,
    registrationId: null,
    status: null,
    waitlistPosition: null,
    checkinStatus: null,
    teamId: null,
    teamName: null,
    istCaptain: false,
  };

  const eigene = await prisma.tournamentRegistration.findUnique({
    where: { tournamentId_discordId: { tournamentId, discordId } },
    include: { team: { select: { id: true, name: true, captainDiscordId: true } } },
  });

  if (eigene && eigene.status !== 'CANCELLED' && eigene.status !== 'REJECTED') {
    return {
      angemeldet: true,
      registrationId: eigene.id,
      status: eigene.status,
      waitlistPosition: eigene.waitlistPosition,
      checkinStatus: eigene.checkinStatus,
      teamId: eigene.team?.id ?? null,
      teamName: eigene.team?.name ?? null,
      istCaptain: eigene.team ? eigene.team.captainDiscordId === discordId : true,
    };
  }

  // Als Spieler in einem fremden Team: die Anmeldung steht dort, nicht hier.
  const mitgliedschaft = await prisma.tournamentTeamMember.findFirst({
    where: {
      discordId,
      removedAt: null,
      team: { tournamentId, status: { not: 'DISQUALIFIED' } },
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          captainDiscordId: true,
          registration: {
            select: { id: true, status: true, waitlistPosition: true, checkinStatus: true },
          },
        },
      },
    },
  });

  if (!mitgliedschaft) {
    return leer;
  }

  const anmeldung = mitgliedschaft.team.registration;
  return {
    angemeldet: anmeldung !== null,
    registrationId: anmeldung?.id ?? null,
    status: anmeldung?.status ?? null,
    waitlistPosition: anmeldung?.waitlistPosition ?? null,
    checkinStatus: anmeldung?.checkinStatus ?? null,
    teamId: mitgliedschaft.team.id,
    teamName: mitgliedschaft.team.name,
    istCaptain: mitgliedschaft.team.captainDiscordId === discordId,
  };
}

/**
 * Teams, die diese Person in diesem Turnier fuehrt.
 *
 * Fuer den Anmeldeknopf: nur ein Team mit genuegend Spielern kann antreten,
 * und die Zahl steht gleich dabei, damit niemand raten muss, warum der Knopf
 * nicht geht.
 */
export async function listEigeneTeams(tournamentId: string, discordId: string) {
  const teams = await prisma.tournamentTeam.findMany({
    where: { tournamentId, captainDiscordId: discordId, status: { not: 'DISQUALIFIED' } },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { members: { where: { removedAt: null, role: { not: 'COACH' } } } } },
      registration: { select: { id: true, status: true } },
    },
  });

  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    spieler: team._count.members,
    angemeldet: team.registration !== null,
  }));
}

/** Ein Team mit Roster und offenen Einladungen - fuer die Teamverwaltung. */
export async function getTeamMitEinladungen(teamId: string) {
  return prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    include: {
      tournament: {
        select: { id: true, slug: true, name: true, maxTeamSize: true, maxSubstitutes: true },
      },
      members: {
        where: { removedAt: null },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      },
      invites: {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}
