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
  activeJail: { id: string; endsAt: Date; reason: string } | null;
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
