import { prisma } from '@swisshub/database';
import type { JailEntry, ModerationAction } from '@swisshub/database';
import { discord as defaultDiscord, resolveGuildId, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import {
  darfProfilOeffnen,
  darfSehen,
  memberCapabilities,
  type MemberCapabilities,
  type MemberSection,
  type MemberViewer,
} from './access';
import { listMemberNotes, type MemberNoteView } from './notes';
import { getMemberSummary, type MemberSummary } from './service';

const log = createLogger('members:profile');

/**
 * Das Member Center - die Mitgliederakte.
 *
 * Es fuehrt zusammen, was ueber ein Dutzend Seiten verteilt liegt, und es
 * besitzt davon nichts: Level bleibt Eigentuemer der XP, Tickets der Tickets,
 * Premium der Abonnements, Discord der Identitaet. Hier wird gelesen und
 * zusammengelegt, nicht kopiert - eine Kopie waere eine zweite Wahrheit, die
 * irgendwann von der ersten abweicht und dann niemand mehr weiss, welche gilt.
 *
 * ## Erst fragen, dann laden
 *
 * Die Reihenfolge ist der eigentliche Sicherheitsgewinn dieser Datei. Zuerst
 * steht fest, was der Betrachter sehen darf; danach wird genau das geladen.
 *
 * Der bequeme Weg waere andersherum - alles laden, das Verbotene in der
 * Oberflaeche weglassen. Das ist keine Sicherheit, sondern eine Kulisse: die
 * Daten waeren trotzdem abgefragt, laegen in der Antwort und stuenden im
 * Fehlerfall im Log. Wer die Antwort direkt abruft, saehe sie.
 *
 * Ein verbotener Abschnitt ist deshalb nicht `null` und nicht `[]`, sondern
 * gar nicht vorhanden. Auch eine Null verraet etwas - «null Verwarnungen» ist
 * eine Aussage ueber die Moderationsakte.
 */

export interface MemberActivity {
  /** Gesamtzahlen - so, wie das Level-Modul sie fuehrt. */
  messagesGesamt: number;
  voiceMinutenGesamt: number;
  letzteNachricht: Date | null;
  letzteVoice: Date | null;
  /**
   * Zeitfenster, die sich aus vorhandenen Zeitstempeln ergeben.
   *
   * Bewusst nur diese: fuer Nachrichten und Voice-Zeit fuehrt das
   * Level-Modul Gesamtzahlen und keine Historie. Dafuer eine Erfassung
   * einzufuehren, nur damit hier ein Balken mehr steht, waere neue
   * Ueberwachung fuer eine Anzeige - das ist es nicht wert.
   */
  fenster: Array<{
    tage: number;
    xpBuchungen: number;
    xpSumme: number;
    spielersuchen: number;
    talks: number;
    turniere: number;
  }>;
}

export interface MemberLevelView {
  level: number;
  xp: number;
  rang: number | null;
  /** Hat diese Person eine eigene Levelkarte hinterlegt? */
  eigeneKarte: boolean;
  /** Fortschritt im aktuellen Level, 0 bis 1. */
  fortschritt: number;
  naechstesLevelXp: number;
  fehlendeXp: number;
  hoechstlevel: boolean;
  messages: number;
  voiceMinuten: number;
  letzteAktivitaet: Date | null;
}

export interface MemberModerationView {
  jailHistory: JailEntry[];
  moderationHistory: ModerationAction[];
  /**
   * Wie oft diese Person schon einmal im Jail war.
   *
   * Bewusst keine «Verwarnungen»: die kennt dieses System nicht.
   * `ModerationActionType` fuehrt ausschliesslich Jail-Vorgaenge, und eine
   * Zahl zu zeigen, hinter der nichts steht, waere eine erfundene Angabe
   * ueber einen Menschen.
   */
  jailsGesamt: number;
}

export interface MemberTicketRow {
  id: string;
  nummer: number;
  betreff: string;
  status: string;
  prioritaet: string;
  kategorie: string | null;
  zustaendig: string | null;
  erstelltAm: Date;
  letzteNachricht: Date | null;
}

export interface MemberTournamentRow {
  turnier: {
    id: string;
    slug: string;
    name: string;
    gameName: string;
    status: string;
    startsAt: Date | null;
  };
  team: string | null;
  platzierung: number | null;
}

export interface MemberTournamentView {
  teilnahmen: MemberTournamentRow[];
  gesamt: number;
  siege: number;
  podeste: number;
}

export interface MemberSpielersucheView {
  aktive: number;
  erstellt: number;
  beigetreten: number;
  voiceSekunden: number;
  letzte: Array<{ id: string; gameName: string; status: string; createdAt: Date }>;
}

export interface MemberPremiumView {
  aktiv: boolean;
  plan: string | null;
  status: string | null;
  beginn: Date | null;
  ende: Date | null;
  discordRolleGesetzt: boolean;
}

/**
 * Ein Abschnitt, der nicht geladen werden konnte.
 *
 * Faellt ein Modul aus, ist die Akte trotzdem brauchbar - der betroffene
 * Abschnitt sagt, dass er gerade nicht verfuegbar ist. Eine Fehlerseite fuer
 * das ganze Profil, weil eine Zahlungsschnittstelle klemmt, waere die
 * schlechtere Antwort.
 */
export interface AbschnittFehler {
  section: MemberSection;
}

export interface MemberCenterProfile {
  /** Immer vorhanden: ohne Basisdaten gaebe es kein Profil. */
  basic: MemberSummary;
  /** Nicht mehr auf dem Server - historische Daten koennen trotzdem stehen. */
  imServer: boolean;
  /** Discord war nicht erreichbar; die Basisdaten sind dann unvollstaendig. */
  discordVerfuegbar: boolean;

  roles?: MemberSummary['roles'];
  activity?: MemberActivity;
  level?: MemberLevelView;
  spielersuche?: MemberSpielersucheView;
  tournaments?: MemberTournamentView;
  tickets?: MemberTicketRow[];
  premium?: MemberPremiumView | null;
  moderation?: MemberModerationView;
  notes?: MemberNoteView[];

  /** Welche Abschnitte der Betrachter ueberhaupt sehen darf. */
  sichtbar: MemberSection[];
  /** Was er tun darf - nur fuer die Oberflaeche. */
  capabilities: MemberCapabilities;
  /** Abschnitte, deren Quelle gerade nicht antwortet. */
  fehler: AbschnittFehler[];
}

const FENSTER_TAGE = [7, 30, 90] as const;

/** Ein Abschnitt, der scheitern darf, ohne die Akte mitzunehmen. */
async function abschnitt<T>(
  section: MemberSection,
  laden: () => Promise<T>,
): Promise<{ section: MemberSection; wert: T } | { section: MemberSection; fehler: true }> {
  try {
    return { section, wert: await laden() };
  } catch (error) {
    log.warn('Abschnitt des Mitgliedsprofils konnte nicht geladen werden', {
      section,
      error: error instanceof Error ? error.message : 'unbekannt',
    });
    return { section, fehler: true };
  }
}

async function ladeLevel(discordId: string): Promise<MemberLevelView | null> {
  const { getProfile, getRank } = await import('../level/service');
  const { levelProgress } = await import('../level/curve');
  const profil = await getProfile(discordId);
  if (!profil) {
    return null;
  }
  const [rang, fortschritt] = [await getRank(discordId), levelProgress(profil.xp)];
  return {
    level: fortschritt.level,
    xp: profil.xp,
    rang,
    eigeneKarte: profil.customCardPath !== null,
    fortschritt: fortschritt.progress,
    naechstesLevelXp: fortschritt.nextLevelXp,
    fehlendeXp: fortschritt.remainingXp,
    hoechstlevel: fortschritt.isMaxLevel,
    messages: profil.messages,
    voiceMinuten: profil.voiceMinutes,
    letzteAktivitaet: profil.lastActivityAt,
  };
}

async function ladeAktivitaet(discordId: string): Promise<MemberActivity> {
  const profil = await prisma.levelProfile.findUnique({ where: { discordId } });

  const fenster = await Promise.all(
    FENSTER_TAGE.map(async (tage) => {
      const seit = new Date(Date.now() - tage * 86_400_000);
      const [xp, spielersuchen, talks, turniere] = await Promise.all([
        profil
          ? prisma.xpTransaction.aggregate({
              where: { profileId: profil.id, createdAt: { gte: seit } },
              _count: { _all: true },
              _sum: { delta: true },
            })
          : Promise.resolve(null),
        prisma.spielersucheMatch.count({
          where: { creatorDiscordId: discordId, createdAt: { gte: seit } },
        }),
        prisma.temporaryVoiceChannel.count({
          where: { ownerDiscordId: discordId, createdAt: { gte: seit } },
        }),
        prisma.tournamentRegistration.count({
          where: { discordId, createdAt: { gte: seit } },
        }),
      ]);
      return {
        tage,
        xpBuchungen: xp?._count._all ?? 0,
        xpSumme: xp?._sum.delta ?? 0,
        spielersuchen,
        talks,
        turniere,
      };
    }),
  );

  return {
    messagesGesamt: profil?.messages ?? 0,
    voiceMinutenGesamt: profil?.voiceMinutes ?? 0,
    letzteNachricht: profil?.lastMessageAt ?? null,
    letzteVoice: profil?.lastVoiceAt ?? null,
    fenster,
  };
}

async function ladeSpielersuche(discordId: string): Promise<MemberSpielersucheView> {
  const { getUserStats } = await import('../spielersuche/stats');
  const { getMemberSearches } = await import('../spielersuche/queries');
  const { getActiveSearchesForCreator } = await import('../spielersuche/service');

  const [stats, letzte, aktive] = await Promise.all([
    getUserStats(discordId),
    getMemberSearches(discordId, 10),
    getActiveSearchesForCreator(discordId),
  ]);

  return {
    aktive: aktive.length,
    erstellt: stats.createdSearches,
    beigetreten: stats.joinedSearches,
    voiceSekunden: stats.voiceSeconds,
    letzte: letzte.map((suche) => ({
      id: suche.id,
      gameName: suche.gameName,
      status: suche.status,
      createdAt: suche.createdAt,
    })),
  };
}

async function ladeTurniere(discordId: string): Promise<MemberTournamentView> {
  const { getMemberHistory } = await import('../tournaments/queries');
  const historie = await getMemberHistory(discordId);
  return {
    teilnahmen: historie.teilnahmen.map((eintrag) => ({
      turnier: {
        id: eintrag.tournament.id,
        slug: eintrag.tournament.slug,
        name: eintrag.tournament.name,
        gameName: eintrag.tournament.gameName,
        status: eintrag.tournament.status,
        startsAt: eintrag.tournament.startsAt,
      },
      team: eintrag.team,
      platzierung: eintrag.placement,
    })),
    gesamt: historie.gesamt,
    siege: historie.siege,
    podeste: historie.podeste,
  };
}

/**
 * Die Tickets dieser Person.
 *
 * Zwei Sperren hintereinander. Der Geltungsbereich hier entscheidet, ob der
 * Abschnitt ueberhaupt geladen wird; welche Zeilen darin stehen, entscheidet
 * das Ticketmodul mit seinem eigenen Sichtbarkeitsfilter. Und dass jemand
 * sieht, *dass* ein Ticket existiert, heisst nicht, dass er es oeffnen darf -
 * der Nachrichtenverlauf haengt weiterhin an den Ticket-Berechtigungen.
 */
async function ladeTickets(
  viewer: MemberViewer,
  discordId: string,
): Promise<MemberTicketRow[]> {
  const { listTickets } = await import('../tickets/queries');
  const { rows } = await listTickets(
    { discordId: viewer.discordId, roleIds: viewer.roleIds, can: viewer.can },
    { creatorDiscordId: discordId, page: 1, pageSize: 25 },
  );
  return rows.map(({ ticket, categoryName }) => ({
    id: ticket.id,
    nummer: ticket.ticketNumber,
    betreff: ticket.subject,
    status: ticket.status,
    prioritaet: ticket.priority,
    kategorie: categoryName,
    zustaendig: ticket.assignedToDiscordId,
    erstelltAm: ticket.createdAt,
    letzteNachricht: ticket.lastMessageAt,
  }));
}

/**
 * Premium ohne Zahlungsdaten.
 *
 * `getMemberPremium` liefert auch die Zahlungen mit. Sie gehoeren nicht in die
 * Mitgliederakte: wer wissen will, ob jemand Premium hat, braucht keine
 * Betraege und keine Belege.
 */
async function ladePremium(discordId: string): Promise<MemberPremiumView | null> {
  const { getMemberPremium } = await import('../premium/queries');
  const premium = await getMemberPremium(discordId);
  if (!premium) {
    return null;
  }
  const laufend = premium.current ?? premium.subscriptions.at(0) ?? null;

  return {
    aktiv: laufend?.status === 'ACTIVE',
    plan: laufend?.product.name ?? null,
    status: laufend?.status ?? null,
    beginn: laufend?.currentPeriodStart ?? null,
    ende: laufend?.currentPeriodEnd ?? null,
    // Nur die Tatsache, dass ein Stuebli besteht - nicht der Kanal.
    discordRolleGesetzt: premium.stuebli !== null,
  };
}

async function ladeModeration(discordId: string): Promise<MemberModerationView> {
  const [jailHistory, moderationHistory, jailsGesamt] = await Promise.all([
    prisma.jailEntry.findMany({
      where: { targetDiscordId: discordId },
      orderBy: { startedAt: 'desc' },
      take: 25,
    }),
    prisma.moderationAction.findMany({
      where: { targetDiscordId: discordId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    prisma.jailEntry.count({ where: { targetDiscordId: discordId } }),
  ]);
  return { jailHistory, moderationHistory, jailsGesamt };
}

export interface MemberCenterQuery {
  viewer: MemberViewer;
  targetDiscordId: string;
  gateway?: DiscordGateway;
}

/**
 * Die Mitgliederakte, zugeschnitten auf den Betrachter.
 *
 * Gibt `null` zurueck, wenn es nichts zu zeigen gibt - weil es die Person
 * nicht gibt oder weil dieser Betrachter nichts von ihr sehen darf. Beides
 * antwortet gleich: sonst liesse sich an der Antwort ablesen, wer auf dem
 * Server ist.
 */
export async function getMemberCenterProfile(
  query: MemberCenterQuery,
): Promise<MemberCenterProfile | null> {
  const { viewer, targetDiscordId } = query;
  const gateway = query.gateway ?? defaultDiscord;

  if (!darfProfilOeffnen(viewer, targetDiscordId)) {
    return null;
  }

  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }

  // --- Basisdaten --------------------------------------------------------
  //
  // Discord kann ausfallen, und die Akte soll trotzdem stehen: die
  // historischen Daten liegen in unserer Datenbank und haben mit Discords
  // Erreichbarkeit nichts zu tun.
  const basis = await getMemberSummary(targetDiscordId, { gateway }).catch((error: unknown) => {
    log.warn('Discord-Daten des Mitglieds nicht verfügbar', {
      error: error instanceof Error ? error.message : 'unbekannt',
    });
    return undefined;
  });

  const discordVerfuegbar = basis !== undefined;
  const imServer = basis !== undefined && basis !== null;

  const basic: MemberSummary = basis ?? {
    discordId: targetDiscordId,
    username: 'Unbekannt',
    displayName: 'Unbekanntes Mitglied',
    avatarHash: null,
    isBot: false,
    roles: [],
    joinedAt: null,
    accountCreatedAt: null,
    boosting: false,
    activeJail: null,
    timedOut: false,
  };

  // Wer nicht einmal die Basisdaten dieser Person sehen darf, bekommt gar
  // nichts - auch nicht die Auskunft, dass es sie gibt.
  if (!darfSehen(viewer, 'basic', targetDiscordId)) {
    return null;
  }

  // --- Erst fragen ------------------------------------------------------
  const erlaubt = (section: MemberSection): boolean =>
    darfSehen(viewer, section, targetDiscordId);

  // --- Dann laden -------------------------------------------------------
  //
  // Nebeneinander, weil die Quellen nichts voneinander wissen. Jede darf
  // einzeln scheitern.
  const aufgaben: Array<Promise<{ section: MemberSection; wert?: unknown; fehler?: true }>> = [];

  if (erlaubt('activity')) {
    aufgaben.push(abschnitt('activity', () => ladeAktivitaet(targetDiscordId)));
  }
  if (erlaubt('level')) {
    aufgaben.push(abschnitt('level', () => ladeLevel(targetDiscordId)));
  }
  if (erlaubt('spielersuche')) {
    aufgaben.push(abschnitt('spielersuche', () => ladeSpielersuche(targetDiscordId)));
  }
  if (erlaubt('tournaments')) {
    aufgaben.push(abschnitt('tournaments', () => ladeTurniere(targetDiscordId)));
  }
  if (erlaubt('tickets')) {
    aufgaben.push(abschnitt('tickets', () => ladeTickets(viewer, targetDiscordId)));
  }
  if (erlaubt('premium')) {
    aufgaben.push(abschnitt('premium', () => ladePremium(targetDiscordId)));
  }
  if (erlaubt('moderation')) {
    aufgaben.push(abschnitt('moderation', () => ladeModeration(targetDiscordId)));
  }
  if (erlaubt('notes')) {
    aufgaben.push(abschnitt('notes', () => listMemberNotes(viewer, targetDiscordId, guildId)));
  }

  const ergebnisse = await Promise.all(aufgaben);

  const profil: MemberCenterProfile = {
    basic,
    imServer,
    discordVerfuegbar,
    sichtbar: [],
    capabilities: memberCapabilities(viewer, { discordId: targetDiscordId, isBot: basic.isBot }),
    fehler: [],
  };

  if (erlaubt('roles')) {
    profil.roles = basic.roles;
  }

  for (const ergebnis of ergebnisse) {
    if (ergebnis.fehler === true) {
      profil.fehler.push({ section: ergebnis.section });
      continue;
    }
    switch (ergebnis.section) {
      case 'activity':
        profil.activity = ergebnis.wert as MemberActivity;
        break;
      case 'level':
        profil.level = (ergebnis.wert as MemberLevelView | null) ?? undefined;
        break;
      case 'spielersuche':
        profil.spielersuche = ergebnis.wert as MemberSpielersucheView;
        break;
      case 'tournaments':
        profil.tournaments = ergebnis.wert as MemberTournamentView;
        break;
      case 'tickets':
        profil.tickets = ergebnis.wert as MemberTicketRow[];
        break;
      case 'premium':
        profil.premium = ergebnis.wert as MemberPremiumView | null;
        break;
      case 'moderation':
        profil.moderation = ergebnis.wert as MemberModerationView;
        break;
      case 'notes':
        profil.notes = ergebnis.wert as MemberNoteView[];
        break;
      default:
        break;
    }
  }

  profil.sichtbar = (
    ['basic', 'roles', 'activity', 'level', 'spielersuche', 'tournaments', 'tickets', 'premium', 'moderation', 'notes'] as MemberSection[]
  ).filter((section) => erlaubt(section));

  return profil;
}
