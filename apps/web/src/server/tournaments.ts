import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { tournaments } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';

/**
 * Der Betrachter, wie ihn die Zugriffspruefung erwartet.
 *
 * Bewusst eine Uebersetzung und keine zweite Regel: `can` und die Rollen
 * kommen aus dem bestehenden Sitzungskontext, entschieden wird im Modul.
 */
export function tournamentViewer(context: AuthContext): tournaments.TournamentViewer {
  return {
    discordId: context.user.discordId,
    roleIds: context.roleIds,
    can: (permission: string) => can(context, permission),
  };
}

/** Wer eine Aktion ausloest - in der Form, die die Dienste erwarten. */
export function tournamentActor(context: AuthContext): tournaments.TournamentActor {
  return {
    discordId: context.user.discordId,
    username: context.user.username,
    source: 'WEBAPP',
  };
}

/**
 * Ein Turnier laden und den Verwaltungszugriff pruefen.
 *
 * Jede Verwaltungsseite und jede Verwaltungsaktion geht hier durch. Eine
 * Turnierkennung aus der Adresse sagt nichts darueber aus, ob sie jemanden
 * etwas angeht - und ohne diese Stelle waere die Pruefung vierzigmal einzeln
 * zu wiederholen.
 */
export async function ladeTurnierMitZugriff(
  context: AuthContext,
  tournamentId: string,
): Promise<{
  tournament: NonNullable<Awaited<ReturnType<typeof ladeTurnier>>>;
  zugriff: tournaments.TournamentAccess;
}> {
  const tournament = await ladeTurnier(tournamentId);
  if (!tournament) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Turnier existiert nicht.' });
  }

  const zugriff = await tournaments.getTournamentAccess(tournamentViewer(context), tournament);
  if (!zugriff.view) {
    // Bewusst dieselbe Meldung wie bei einem nicht vorhandenen Turnier: sonst
    // liesse sich an der Antwort ablesen, welche Turniere es gibt.
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Turnier existiert nicht.' });
  }

  return { tournament, zugriff };
}

async function ladeTurnier(tournamentId: string) {
  const { prisma } = await import('@swisshub/database');
  return prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      game: { select: { id: true, name: true } },
      staff: { orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] },
      _count: { select: { registrations: true, teams: true, matches: true } },
    },
  });
}

/**
 * Ein Match laden und pruefen, wer dafuer sprechen darf.
 *
 * Liefert beides: den Verwaltungszugriff auf das Turnier und die Seite, fuer
 * die der Aufrufer als Captain sprechen kann. Eine Match-Kennung aus dem
 * Browser ist keine Berechtigung.
 */
export async function ladeMatchMitZugriff(
  context: AuthContext,
  matchId: string,
): Promise<{
  match: NonNullable<Awaited<ReturnType<typeof tournaments.getMatch>>>;
  zugriff: tournaments.TournamentAccess;
  slot: 'A' | 'B' | null;
}> {
  const match = await tournaments.getMatch(matchId);
  if (!match) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Match existiert nicht.' });
  }

  // Das Turnier ausdruecklich nachladen statt eine leere Erstellerkennung
  // einzusetzen: die Zugriffspruefung faellt sonst fuer den Ersteller anders
  // aus als auf jeder anderen Seite.
  const { prisma } = await import('@swisshub/database');
  const turnier = await prisma.tournament.findUniqueOrThrow({
    where: { id: match.tournament.id },
    select: { id: true, createdByDiscordId: true },
  });

  const zugriff = await tournaments.getTournamentAccess(tournamentViewer(context), turnier);

  const slot = await tournaments.getMatchSlot(matchId, context.user.discordId);

  return { match, zugriff, slot };
}

export interface TournamentSection {
  href: string;
  label: string;
}

/** Unterseiten des Turniermoduls. */
export function tournamentSections(context: AuthContext): TournamentSection[] {
  const p = tournaments.TOURNAMENT_PERMISSIONS;
  const sections: TournamentSection[] = [
    { href: '/turniere/uebersicht', label: 'Übersicht' },
  ];

  if (can(context, p.manage) || can(context, p.admin)) {
    sections.push({ href: '/turniere/aktiv', label: 'Aktive Turniere' });
  }
  if (can(context, p.create)) {
    sections.push({ href: '/turniere/neu', label: 'Turnier erstellen' });
  }
  if (can(context, p.matchesManage) || can(context, p.admin)) {
    sections.push({ href: '/turniere/matches', label: 'Matches' });
  }
  if (can(context, p.disputesManage) || can(context, p.admin)) {
    sections.push({ href: '/turniere/einsprueche', label: 'Einsprüche' });
  }
  if (can(context, p.streamManage) || can(context, p.admin)) {
    sections.push({ href: '/turniere/livestream', label: 'Livestream' });
  }
  if (can(context, p.statsView)) {
    sections.push({ href: '/turniere/statistiken', label: 'Statistiken' });
  }
  if (can(context, p.archiveView)) {
    sections.push({ href: '/turniere/archiv', label: 'Archiv' });
  }
  if (can(context, p.blockManage)) {
    sections.push({ href: '/turniere/sperren', label: 'Sperren' });
  }
  sections.push({ href: '/modules/tournaments', label: 'Einstellungen' });

  return sections;
}

/** Ist diese Person Turnierleitung - entscheidet, welche Ansicht sie sieht. */
export function istTurnierleitung(context: AuthContext): boolean {
  return (
    can(context, tournaments.TOURNAMENT_PERMISSIONS.manage) ||
    can(context, tournaments.TOURNAMENT_PERMISSIONS.admin)
  );
}

// --- Listen ----------------------------------------------------------------

const TURNIERE_JE_SEITE = 20;

/**
 * Zustaende, die aus der Adresszeile kommen duerfen.
 *
 * Bewusst eine feste Liste statt eines Casts: der Wert stammt aus dem
 * Browser, und ein erfundener Status erreichte sonst Prisma und liesse die
 * Seite mit einem Fehler stehen.
 */
const ERLAUBTE_STATUS: string[] = [
  'DRAFT',
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

export interface TurnierListenSuche {
  q?: string;
  status?: string;
  spiel?: string;
  page?: string;
}

/** Die Turnierliste einer Verwaltungsseite - gefiltert, geblättert, sichtbar. */
export async function ladeTurnierListe(
  context: AuthContext,
  suche: TurnierListenSuche,
  basis: { aktiv?: boolean; archiv?: boolean } = {},
): Promise<{
  rows: Awaited<ReturnType<typeof tournaments.listTournaments>>['rows'];
  total: number;
  page: number;
  totalPages: number;
}> {
  const gewuenschteSeite = Number.parseInt(suche.page ?? '1', 10);
  const page = Number.isFinite(gewuenschteSeite) && gewuenschteSeite > 0 ? gewuenschteSeite : 1;

  const status = suche.status && ERLAUBTE_STATUS.includes(suche.status) ? [suche.status] : undefined;

  const { rows, total } = await tournaments.listTournaments(tournamentViewer(context), {
    ...basis,
    ...(status ? { status: status as never } : {}),
    ...(suche.spiel ? { gameId: suche.spiel } : {}),
    ...(suche.q ? { search: suche.q } : {}),
    page,
    pageSize: TURNIERE_JE_SEITE,
  });

  return { rows, total, page, totalPages: Math.max(1, Math.ceil(total / TURNIERE_JE_SEITE)) };
}

/** Adresse mit denselben Filtern, aber anderer Seitenzahl. */
export function turnierListenHref(
  basis: string,
  suche: TurnierListenSuche,
  seite: number,
): string {
  const parameter = new URLSearchParams();
  if (suche.q) {
    parameter.set('q', suche.q);
  }
  if (suche.status) {
    parameter.set('status', suche.status);
  }
  if (suche.spiel) {
    parameter.set('spiel', suche.spiel);
  }
  if (seite > 1) {
    parameter.set('page', String(seite));
  }
  const angehaengt = parameter.toString();
  return angehaengt.length > 0 ? `${basis}?${angehaengt}` : basis;
}

/** Die Verwaltungsadresse eines Turniers. */
export function turnierHref(tournamentId: string, unterseite?: string): string {
  return unterseite
    ? `/turniere/verwalten/${tournamentId}/${unterseite}`
    : `/turniere/verwalten/${tournamentId}`;
}
