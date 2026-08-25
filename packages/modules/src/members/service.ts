import { prisma } from '@swisshub/database';
import {
  discord as defaultDiscord,
  type DiscordGateway,
  type GuildMember,
  type GuildRole,
} from '@swisshub/discord';
import { isSnowflake, sanitizeText } from '@swisshub/shared';
import type { JailEntry, ModerationAction } from '@swisshub/database';
import { getCoreSettings } from '../settings';

/**
 * Mitglieder-Service.
 *
 * Mitgliederdaten werden bei Discord gelesen und NICHT dauerhaft gespiegelt
 * (Datensparsamkeit). Persistiert wird nur, was für Moderation und
 * Nachvollziehbarkeit gebraucht wird.
 */
export interface MemberRoleView {
  id: string;
  name: string;
  color: number;
  position: number;
}

export interface MemberSummary {
  discordId: string;
  username: string;
  displayName: string;
  avatarHash: string | null;
  isBot: boolean;
  roles: MemberRoleView[];
  joinedAt: Date | null;
  accountCreatedAt: Date | null;
  boosting: boolean;
  /** Aktiver Jail, falls vorhanden. */
  /** Aktiver Jail; `endsAt` ist `null` bei einem permanenten Jail. */
  activeJail: { id: string; endsAt: Date | null; reason: string } | null;
  timedOut: boolean;
}

export interface MemberProfile extends MemberSummary {
  jailHistory: JailEntry[];
  moderationHistory: ModerationAction[];
}

function toRoleViews(roleIds: readonly string[], roles: readonly GuildRole[]): MemberRoleView[] {
  return roleIds
    .map((roleId) => roles.find((role) => role.id === roleId))
    .filter((role): role is GuildRole => role !== undefined)
    .sort((a, b) => b.position - a.position)
    .map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position }));
}

async function decorate(members: GuildMember[], gateway: DiscordGateway): Promise<MemberSummary[]> {
  if (members.length === 0) {
    return [];
  }
  const [roles, activeJails] = await Promise.all([
    gateway.roles.list(),
    prisma.jailEntry.findMany({
      where: {
        targetDiscordId: { in: members.map((member) => member.discordId) },
        releasedAt: null,
        status: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { id: true, targetDiscordId: true, endsAt: true, reason: true },
    }),
  ]);

  const jailByDiscordId = new Map(activeJails.map((jail) => [jail.targetDiscordId, jail]));

  return members.map((member) => {
    const jail = jailByDiscordId.get(member.discordId);
    return {
      discordId: member.discordId,
      username: member.username,
      displayName: member.displayName,
      avatarHash: member.avatarHash,
      isBot: member.isBot,
      roles: toRoleViews(member.roleIds, roles),
      joinedAt: member.joinedAt,
      accountCreatedAt: member.accountCreatedAt,
      boosting: member.boosting,
      activeJail: jail ? { id: jail.id, endsAt: jail.endsAt, reason: jail.reason } : null,
      timedOut: member.timedOutUntil !== null && member.timedOutUntil > new Date(),
    };
  });
}

/**
 * Serverseitige Mitgliedersuche nach Username, Anzeigename oder Discord ID.
 * Es wird niemals die vollständige Mitgliederliste an den Browser gesendet.
 */
export async function searchMembers(
  rawQuery: string,
  options: { limit?: number; gateway?: DiscordGateway } = {},
): Promise<MemberSummary[]> {
  const gateway = options.gateway ?? defaultDiscord;
  const query = sanitizeText(rawQuery, 100);
  const settings = await getCoreSettings();
  const limit = Math.min(options.limit ?? settings.memberSearchLimit, 100);

  if (query.length === 0) {
    return decorate(await gateway.members.list({ limit }), gateway);
  }

  if (isSnowflake(query)) {
    const member = await gateway.members.get(query);
    return member ? decorate([member], gateway) : [];
  }

  if (query.length < 2) {
    return [];
  }

  return decorate(await gateway.members.search(query, limit), gateway);
}

/**
 * Die Basisdaten eines Mitglieds.
 *
 * Ohne Verlauf: wer den Jail-Verlauf oder die Moderationshistorie braucht,
 * fragt sie einzeln an. Frueher lieferte diese Datei beides ungefragt mit,
 * und die Profilseite zeigte es jedem, der Mitglieder ansehen durfte - das
 * Member Center entscheidet nun je Abschnitt.
 */
export async function getMemberSummary(
  discordId: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<MemberSummary | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const member = await gateway.members.get(discordId);
  if (!member) {
    return null;
  }
  const [summary] = await decorate([member], gateway);
  return summary ?? null;
}

export async function getMemberProfile(
  discordId: string,
  options: { gateway?: DiscordGateway } = {},
): Promise<MemberProfile | null> {
  const gateway = options.gateway ?? defaultDiscord;
  const member = await gateway.members.get(discordId);
  if (!member) {
    return null;
  }
  const [summary] = await decorate([member], gateway);
  if (!summary) {
    return null;
  }

  const [jailHistory, moderationHistory] = await Promise.all([
    prisma.jailEntry.findMany({
      where: { targetDiscordId: discordId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }),
    prisma.moderationAction.findMany({
      where: { targetDiscordId: discordId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return { ...summary, jailHistory, moderationHistory };
}

/**
 * Filter der Mitgliederliste.
 *
 * Bewusst nur diese vier. Ein Filter ist ein Versprechen, dass die Liste
 * danach vollstaendig ist - und das laesst sich nur halten, wo die Daten
 * ohne zusaetzliche Anfrage je Mitglied vorliegen. «Online» zum Beispiel
 * fehlt: die Anwesenheit kennt nur das Gateway, und sie fuer eine
 * Filterzeile abzufragen hiesse, sie dauerhaft zu speichern.
 */
export interface MemberFilter {
  /** Nur Mitglieder mit dieser Rolle. */
  roleId?: string | null;
  /** Nur Mitglieder mit laufendem Jail. */
  jailed?: boolean;
  /** Nur Mitglieder mit laufendem Premium. */
  premium?: boolean;
  /** Bots ausblenden. */
  ohneBots?: boolean;
}

export interface MemberPage {
  members: MemberSummary[];
  /** Treffer vor der Seitenaufteilung. */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Mitglieder suchen, filtern und seitenweise ausgeben.
 *
 * Die Suche selbst laeuft weiterhin bei Discord und serverseitig; gefiltert
 * und geblaettert wird danach hier. Die vollstaendige Mitgliederliste
 * verlaesst den Server nie.
 */
export async function listMembersPage(
  rawQuery: string,
  filter: MemberFilter = {},
  options: { page?: number; pageSize?: number; gateway?: DiscordGateway } = {},
): Promise<MemberPage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  // Genug Kandidaten holen, damit auch nach dem Filtern noch Seiten
  // uebrigbleiben - aber gedeckelt, damit niemand die Guild abraeumt.
  const kandidaten = await searchMembers(rawQuery, {
    limit: 200,
    gateway: options.gateway,
  });

  let gefiltert = kandidaten;

  if (filter.ohneBots === true) {
    gefiltert = gefiltert.filter((member) => !member.isBot);
  }
  if (filter.roleId) {
    gefiltert = gefiltert.filter((member) =>
      member.roles.some((role) => role.id === filter.roleId),
    );
  }
  if (filter.jailed === true) {
    gefiltert = gefiltert.filter((member) => member.activeJail !== null);
  }
  if (filter.premium === true) {
    // Eine Abfrage fuer alle Kandidaten statt einer je Mitglied.
    const mitPremium = await prisma.premiumSubscription.findMany({
      where: {
        discordId: { in: gefiltert.map((member) => member.discordId) },
        status: 'ACTIVE',
      },
      select: { discordId: true },
    });
    const menge = new Set(mitPremium.map((eintrag) => eintrag.discordId));
    gefiltert = gefiltert.filter((member) => menge.has(member.discordId));
  }

  const start = (page - 1) * pageSize;
  return {
    members: gefiltert.slice(start, start + pageSize),
    total: gefiltert.length,
    page,
    pageSize,
  };
}
