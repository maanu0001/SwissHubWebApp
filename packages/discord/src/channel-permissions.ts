import { DISCORD_PERMISSIONS } from './permissions';

/**
 * Effektive Berechtigungen des Bots in einem Channel - als reine Rechnung.
 *
 * Discord liefert die Rechte-Ausnahmen bereits beim Abruf der Kanalliste mit
 * (`GET /guilds/{id}/channels`). Sie hier auszurechnen statt je Kanal einzeln
 * nachzufragen macht aus N Anfragen eine einzige. Das ist kein Feinschliff:
 * die Kommunikationsseite fragte vorher für jeden Textkanal einzeln nach und
 * liess sich unter Discords Ratenbegrenzung minutenlang nicht öffnen.
 */

export interface ChannelOverwriteEntry {
  id: string;
  /** 0 = Rolle, 1 = Mitglied. */
  type: number;
  allow: string;
  deny: string;
}

const toBits = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

export interface ChannelPermissionInput {
  /** Berechtigungen aus den Rollen des Bots, ohne Kanal-Ausnahmen. */
  basePermissions: bigint;
  overwrites: readonly ChannelOverwriteEntry[];
  /** Rollen des Bots. */
  botRoleIds: readonly string[];
  /** Die Server-ID ist zugleich die ID der @everyone-Rolle. */
  guildId: string;
  botUserId: string;
}

/**
 * Reihenfolge nach Discord: @everyone-Ausnahme, dann alle Rollen-Ausnahmen
 * (erst sämtliche Verbote, dann sämtliche Erlaubnisse), zuletzt die Ausnahme
 * für das Mitglied selbst. `ADMINISTRATOR` sticht alles.
 */
export function computeChannelPermissions(input: ChannelPermissionInput): bigint {
  if ((input.basePermissions & DISCORD_PERMISSIONS.ADMINISTRATOR) !== 0n) {
    return input.basePermissions;
  }

  let total = input.basePermissions;

  const everyone = input.overwrites.find((entry) => entry.id === input.guildId);
  if (everyone) {
    total = (total & ~toBits(everyone.deny)) | toBits(everyone.allow);
  }

  let allow = 0n;
  let deny = 0n;
  for (const entry of input.overwrites) {
    if (entry.type === 0 && entry.id !== input.guildId && input.botRoleIds.includes(entry.id)) {
      allow |= toBits(entry.allow);
      deny |= toBits(entry.deny);
    }
  }
  total = (total & ~deny) | allow;

  const member = input.overwrites.find((entry) => entry.type === 1 && entry.id === input.botUserId);
  if (member) {
    total = (total & ~toBits(member.deny)) | toBits(member.allow);
  }

  return total;
}
