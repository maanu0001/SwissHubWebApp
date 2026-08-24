import type { ChatInputCommandInteraction, GuildMember, Interaction } from 'discord.js';
import { bootstrapConfig } from '@swisshub/config';
import {
  hasPermission,
  loadRoleConfiguration,
  moderationLevelOf,
  resolvePermissions,
} from '@swisshub/permissions';
import type { jail } from '@swisshub/modules';

/**
 * Berechtigungskontext einer Discord-Interaktion.
 *
 * Es gibt bewusst keine zweite Berechtigungslogik für Slash Commands: hier
 * werden dieselben Rollen-Zuordnungen ausgewertet wie im Dashboard. Wer im
 * Dashboard `jail.create` hat, kann `/jail` nutzen - und sonst niemand. Feste
 * Admin-Rollen-IDs wie im alten Bot gibt es nicht mehr.
 */
export interface CommandActor {
  discordId: string;
  username: string;
  avatarHash: string | null;
  roleIds: string[];
  isOwner: boolean;
  moderationLevel: number;
  /** Prüft eine Berechtigung gegen die Rollen des Aufrufers. */
  can(permission: string): boolean;
  /**
   * Die tatsächlich zugeteilten Berechtigungen.
   *
   * Manche Services entscheiden anhand der Liste selbst weiter - etwa das
   * Kommunikationsmodul, das eine Erwähnung stillschweigend entfernt, statt
   * den ganzen Versand abzulehnen.
   */
  permissionKeys: string[];
}

function memberRoleIds(member: Interaction['member'] | GuildMember | null): string[] {
  if (member && 'roles' in member && member.roles && 'cache' in member.roles) {
    return [...member.roles.cache.keys()];
  }
  return [];
}

export async function buildCommandActor(interaction: Interaction): Promise<CommandActor> {
  return buildActor(interaction.user, interaction.member);
}

/**
 * Derselbe Kontext ohne Interaktion.
 *
 * Wird gebraucht, wo kein Klick zugrunde liegt - etwa bei einer Nachricht in
 * einem Ticket-Kanal, bei der zu entscheiden ist, ob sie als Support-Antwort
 * zaehlt. Bewusst dieselbe Funktion: eine zweite Ableitung der Rechte waere
 * genau die Stelle, an der Discord und Dashboard auseinanderliefen.
 */
export async function buildActor(
  user: { id: string; username: string; avatar: string | null },
  member: Interaction['member'] | GuildMember | null,
): Promise<CommandActor> {
  const roleIds = memberRoleIds(member);
  const isOwner = bootstrapConfig.ownerDiscordId === user.id;
  const configuration = await loadRoleConfiguration();
  const resolution = resolvePermissions(
    { discordId: user.id, roleIds, isOwner },
    configuration.mappings,
  );

  return {
    discordId: user.id,
    username: user.username,
    avatarHash: user.avatar ?? null,
    roleIds,
    isOwner,
    moderationLevel: moderationLevelOf(roleIds, configuration.moderationLevels),
    can: (permission) => hasPermission(resolution, permission),
    permissionKeys: [...resolution.granted],
  };
}

/** Form, die der Jail-Service für den ausführenden Moderator erwartet. */
export function toJailActor(actor: CommandActor): jail.JailActor {
  return {
    discordId: actor.discordId,
    username: actor.username,
    avatarHash: actor.avatarHash,
    roleIds: actor.roleIds,
    isOwner: actor.isOwner,
    moderationLevel: actor.moderationLevel,
  };
}

/** Einheitliche Absage, wenn eine Berechtigung fehlt. */
export const NO_PERMISSION = 'Du hesch kei Berächtigung für de Befehl.';

export function isChatInput(interaction: Interaction): interaction is ChatInputCommandInteraction {
  return interaction.isChatInputCommand();
}
