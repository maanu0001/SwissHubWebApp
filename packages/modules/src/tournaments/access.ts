import { prisma } from '@swisshub/database';
import type { Tournament, TournamentStaffRole } from '@swisshub/database';
import { getModuleSettings } from '../module-state';
import { TOURNAMENTS_MODULE_ID, TOURNAMENT_PERMISSIONS, type TournamentSettings } from './config';

/**
 * Wer darf was mit einem Turnier?
 *
 * Eine Stelle statt einer Pruefung je Route. Der Unterschied ist nicht
 * Bequemlichkeit: eine vergessene Pruefung in einer von vierzig Routen ist
 * genau die Luecke, durch die jemand ein fremdes Resultat aendert.
 *
 * Es wirken zwei Ebenen. Die erste ist das zentrale Rechtesystem - darf diese
 * Person ueberhaupt Turniere leiten? Die zweite ist die Zustaendigkeit fuer
 * dieses eine Turnier: wer bei Turnier A als Leitung eingetragen ist, hat bei
 * Turnier B nichts zu sagen. Ohne die zweite Ebene waere jede Turnierrolle
 * faktisch eine Vollberechtigung.
 *
 * `tournaments.admin` ist die einzige Abkuerzung, und sie ist ausdruecklich
 * vergeben.
 */

export interface TournamentViewer {
  discordId: string;
  /** Discord-Rollen - Grundlage der Standard-Zustaendigkeit. */
  roleIds: string[];
  can(permission: string): boolean;
}

export interface TournamentAccess {
  /** Turnier im Verwaltungsbereich sichtbar? */
  view: boolean;
  /** Stammdaten aendern. */
  manage: boolean;
  /** Veroeffentlichen, starten, abschliessen. */
  publish: boolean;
  registrationsView: boolean;
  registrationsManage: boolean;
  teamsManage: boolean;
  checkinManage: boolean;
  bracketManage: boolean;
  matchesManage: boolean;
  resultsOverride: boolean;
  disputesManage: boolean;
  streamManage: boolean;
  prizesManage: boolean;
  staffManage: boolean;
  /** Betrachtet als Turnierleitung - entscheidet Ansicht und Zuschreibung. */
  asStaff: boolean;
  /** Rolle in diesem Turnier, falls eingetragen. */
  staffRole: TournamentStaffRole | null;
}

const KEIN_ZUGRIFF: TournamentAccess = {
  view: false,
  manage: false,
  publish: false,
  registrationsView: false,
  registrationsManage: false,
  teamsManage: false,
  checkinManage: false,
  bracketManage: false,
  matchesManage: false,
  resultsOverride: false,
  disputesManage: false,
  streamManage: false,
  prizesManage: false,
  staffManage: false,
  asStaff: false,
  staffRole: null,
};

/**
 * Was eine Turnierrolle hoechstens darf.
 *
 * Die zentrale Berechtigung entscheidet weiterhin mit: die Rolle kann nichts
 * erlauben, was das Rechtesystem nicht ohnehin vergeben hat. Sie kann aber
 * einschraenken - ein Schiedsrichter entscheidet Einsprueche und bestaetigt
 * Resultate, aber er loescht kein Turnier.
 */
const ROLLEN_UMFANG: Record<TournamentStaffRole, Array<keyof TournamentAccess>> = {
  OWNER: [
    'manage', 'publish', 'registrationsView', 'registrationsManage', 'teamsManage',
    'checkinManage', 'bracketManage', 'matchesManage', 'resultsOverride', 'disputesManage',
    'streamManage', 'prizesManage', 'staffManage',
  ],
  ADMIN: [
    'manage', 'publish', 'registrationsView', 'registrationsManage', 'teamsManage',
    'checkinManage', 'bracketManage', 'matchesManage', 'resultsOverride', 'disputesManage',
    'streamManage', 'prizesManage',
  ],
  REFEREE: [
    'registrationsView', 'checkinManage', 'matchesManage', 'resultsOverride', 'disputesManage',
  ],
  CASTER: ['registrationsView', 'streamManage'],
  OBSERVER: ['registrationsView'],
};

/** Welche zentrale Berechtigung zu welchem Recht gehoert. */
const BENOETIGTE_BERECHTIGUNG: Record<
  Exclude<keyof TournamentAccess, 'view' | 'asStaff' | 'staffRole'>,
  string
> = {
  manage: TOURNAMENT_PERMISSIONS.manage,
  publish: TOURNAMENT_PERMISSIONS.publish,
  registrationsView: TOURNAMENT_PERMISSIONS.registrationsView,
  registrationsManage: TOURNAMENT_PERMISSIONS.registrationsManage,
  teamsManage: TOURNAMENT_PERMISSIONS.teamsManage,
  checkinManage: TOURNAMENT_PERMISSIONS.checkinManage,
  bracketManage: TOURNAMENT_PERMISSIONS.bracketManage,
  matchesManage: TOURNAMENT_PERMISSIONS.matchesManage,
  resultsOverride: TOURNAMENT_PERMISSIONS.resultsOverride,
  disputesManage: TOURNAMENT_PERMISSIONS.disputesManage,
  streamManage: TOURNAMENT_PERMISSIONS.streamManage,
  prizesManage: TOURNAMENT_PERMISSIONS.prizesManage,
  staffManage: TOURNAMENT_PERMISSIONS.staffManage,
};

/** Ist diese Person ueber die Standardrollen fuer Turniere zustaendig? */
export function istStandardLeitung(viewer: TournamentViewer, standardRollen: string[]): boolean {
  if (standardRollen.length === 0) {
    return false;
  }
  return standardRollen.some((rolle) => viewer.roleIds.includes(rolle));
}

export async function getTournamentAccess(
  viewer: TournamentViewer,
  tournament: Pick<Tournament, 'id' | 'createdByDiscordId'>,
): Promise<TournamentAccess> {
  // Vollzugriff.
  if (viewer.can(TOURNAMENT_PERMISSIONS.admin)) {
    return {
      ...KEIN_ZUGRIFF,
      view: true,
      manage: true,
      publish: true,
      registrationsView: true,
      registrationsManage: true,
      teamsManage: true,
      checkinManage: true,
      bracketManage: true,
      matchesManage: true,
      resultsOverride: true,
      disputesManage: true,
      streamManage: true,
      prizesManage: true,
      staffManage: true,
      asStaff: true,
      staffRole: 'OWNER',
    };
  }

  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);

  const eintrag = await prisma.tournamentStaff.findUnique({
    where: { tournamentId_discordId: { tournamentId: tournament.id, discordId: viewer.discordId } },
    select: { role: true },
  });

  // Wer das Turnier angelegt hat, leitet es - auch ohne eigenen Eintrag. Sonst
  // spertte sich jemand mit dem ersten Speichern aus seinem eigenen Turnier aus.
  const istErsteller = tournament.createdByDiscordId === viewer.discordId;

  const rolle: TournamentStaffRole | null =
    eintrag?.role ??
    (istErsteller
      ? 'OWNER'
      : istStandardLeitung(viewer, settings.defaultStaffRoleIds)
        ? 'ADMIN'
        : null);

  if (rolle === null) {
    return KEIN_ZUGRIFF;
  }

  const umfang = new Set(ROLLEN_UMFANG[rolle]);
  const zugriff: TournamentAccess = { ...KEIN_ZUGRIFF, view: true, asStaff: true, staffRole: rolle };

  for (const [recht, berechtigung] of Object.entries(BENOETIGTE_BERECHTIGUNG) as Array<
    [Exclude<keyof TournamentAccess, 'view' | 'asStaff' | 'staffRole'>, string]
  >) {
    // Beides muss zutreffen: die Rolle im Turnier und die Berechtigung im
    // zentralen System. Die Rolle allein vergibt keine Rechte.
    zugriff[recht] = umfang.has(recht) && viewer.can(berechtigung);
  }

  return zugriff;
}

/**
 * Welche Turniere darf diese Person im Verwaltungsbereich sehen?
 *
 * Grundlage jeder Liste. Ohne diese Einschraenkung faende ein Gastorganisator
 * ueber die Uebersicht Turniere, die er einzeln nie oeffnen duerfte.
 */
export async function tournamentSichtbarkeitsFilter(
  viewer: TournamentViewer,
): Promise<Record<string, unknown>> {
  if (viewer.can(TOURNAMENT_PERMISSIONS.admin)) {
    return {};
  }

  const settings = await getModuleSettings<TournamentSettings>(TOURNAMENTS_MODULE_ID);
  if (istStandardLeitung(viewer, settings.defaultStaffRoleIds)) {
    return {};
  }

  return {
    OR: [
      { createdByDiscordId: viewer.discordId },
      { staff: { some: { discordId: viewer.discordId } } },
    ],
  };
}

// --- Teilnehmer ------------------------------------------------------------

export interface ParticipantScope {
  /** Angemeldet - als Einzelperson oder als Teammitglied. */
  registered: boolean;
  /** Kennung der eigenen Anmeldung. */
  registrationId: string | null;
  /** Eigenes Team, falls vorhanden. */
  teamId: string | null;
  /** Captain dieses Teams? Entscheidet ueber Roster und Resultatmeldung. */
  isCaptain: boolean;
  /** Eigene Teilnehmerkennung im Bracket. */
  participantId: string | null;
}

const KEIN_TEILNEHMER: ParticipantScope = {
  registered: false,
  registrationId: null,
  teamId: null,
  isCaptain: false,
  participantId: null,
};

/**
 * Was diese Person in diesem Turnier ist.
 *
 * Bewusst getrennt von der Leitung: ein Captain darf sein Team verwalten und
 * seine Resultate melden - und sonst nichts. Diese Auskunft entscheidet
 * jede Aktion, die auf eine Team- oder Match-Kennung aus dem Browser zeigt.
 */
export async function getParticipantScope(
  tournamentId: string,
  discordId: string,
): Promise<ParticipantScope> {
  const mitgliedschaft = await prisma.tournamentTeamMember.findFirst({
    where: { discordId, removedAt: null, team: { tournamentId } },
    select: { team: { select: { id: true, captainDiscordId: true } } },
  });

  const anmeldung = await prisma.tournamentRegistration.findUnique({
    where: { tournamentId_discordId: { tournamentId, discordId } },
    select: { id: true, participantId: true, teamId: true, status: true },
  });

  const teamId = mitgliedschaft?.team.id ?? anmeldung?.teamId ?? null;

  let participantId = anmeldung?.participantId ?? null;
  if (!participantId && teamId) {
    const teilnehmer = await prisma.tournamentParticipant.findUnique({
      where: { teamId },
      select: { id: true },
    });
    participantId = teilnehmer?.id ?? null;
  }

  if (!anmeldung && !mitgliedschaft) {
    return KEIN_TEILNEHMER;
  }

  return {
    registered:
      anmeldung !== null &&
      anmeldung.status !== 'CANCELLED' &&
      anmeldung.status !== 'REJECTED',
    registrationId: anmeldung?.id ?? null,
    teamId,
    isCaptain: mitgliedschaft?.team.captainDiscordId === discordId,
    participantId,
  };
}

/**
 * Darf diese Person fuer diese Seite eines Matches sprechen?
 *
 * Nur der Captain des beteiligten Teams - oder, bei Einzelturnieren, die
 * angetretene Person selbst. Eine Match-Kennung aus dem Browser sagt nichts
 * darueber aus, wen sie etwas angeht.
 */
export async function getMatchSlot(
  matchId: string,
  discordId: string,
): Promise<'A' | 'B' | null> {
  const match = await prisma.tournamentMatch.findUnique({
    where: { id: matchId },
    select: {
      tournamentId: true,
      participantA: { select: { id: true, discordId: true, teamId: true } },
      participantB: { select: { id: true, discordId: true, teamId: true } },
    },
  });
  if (!match) {
    return null;
  }

  const scope = await getParticipantScope(match.tournamentId, discordId);

  for (const [slot, teilnehmer] of [
    ['A', match.participantA],
    ['B', match.participantB],
  ] as const) {
    if (!teilnehmer) {
      continue;
    }
    // Einzelturnier: die angetretene Person selbst.
    if (teilnehmer.discordId && teilnehmer.discordId === discordId) {
      return slot;
    }
    // Teamturnier: ausdruecklich nur der Captain. Ein gewoehnliches
    // Teammitglied soll kein Resultat melden koennen, das die ganze Runde
    // weiterschiebt.
    if (teilnehmer.teamId && teilnehmer.teamId === scope.teamId && scope.isCaptain) {
      return slot;
    }
  }

  return null;
}
