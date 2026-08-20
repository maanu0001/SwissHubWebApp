/**
 * Discord Permission Bits.
 *
 * Bewusst als BigInt-Konstanten statt einer Bibliothek: es geht nur um wenige
 * Berechtigungen, und die Berechnung soll ohne Discord-Verbindung testbar sein.
 */
export const DISCORD_PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_AUDIT_LOG: 1n << 7n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

export type DiscordPermissionName = keyof typeof DISCORD_PERMISSIONS;

/** Deutsche Bezeichnungen für die Anzeige im Dashboard. */
export const DISCORD_PERMISSION_LABELS: Record<DiscordPermissionName, string> = {
  KICK_MEMBERS: 'Mitglieder kicken',
  BAN_MEMBERS: 'Mitglieder bannen',
  ADMINISTRATOR: 'Administrator',
  MANAGE_CHANNELS: 'Channels verwalten',
  MANAGE_GUILD: 'Server verwalten',
  VIEW_AUDIT_LOG: 'Audit Log ansehen',
  ADD_REACTIONS: 'Reaktionen hinzufügen',
  VIEW_CHANNEL: 'Channels ansehen',
  SEND_MESSAGES: 'Nachrichten senden',
  MANAGE_MESSAGES: 'Nachrichten verwalten',
  EMBED_LINKS: 'Embeds senden',
  ATTACH_FILES: 'Dateien anhängen',
  READ_MESSAGE_HISTORY: 'Nachrichtenverlauf lesen',
  MENTION_EVERYONE: '@everyone erwähnen',
  CONNECT: 'Sprachkanäle betreten',
  SPEAK: 'Sprechen',
  MUTE_MEMBERS: 'Mitglieder stummschalten',
  DEAFEN_MEMBERS: 'Mitglieder taub schalten',
  USE_VAD: 'Sprachaktivierung nutzen',
  PRIORITY_SPEAKER: 'Prioritäts-Sprecher',
  STREAM: 'Video / Stream',
  MOVE_MEMBERS: 'Mitglieder verschieben',
  MANAGE_NICKNAMES: 'Nicknames verwalten',
  MANAGE_ROLES: 'Rollen verwalten',
  MANAGE_WEBHOOKS: 'Webhooks verwalten',
  USE_APPLICATION_COMMANDS: 'Slash Commands verwenden',
  MODERATE_MEMBERS: 'Mitglieder timeouten',
};

/** Wandelt einen Discord-Permission-String sicher in BigInt um. */
export function toPermissionBits(value: string | null | undefined): bigint {
  if (!value) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Vereinigt die Berechtigungen mehrerer Rollen. */
export function combinePermissions(values: ReadonlyArray<string | null | undefined>): bigint {
  return values.reduce<bigint>((total, value) => total | toPermissionBits(value), 0n);
}

/**
 * Prüft eine Berechtigung. `ADMINISTRATOR` schliesst - wie bei Discord - alle
 * anderen Berechtigungen ein.
 */
export function hasDiscordPermission(total: bigint, permission: DiscordPermissionName): boolean {
  if ((total & DISCORD_PERMISSIONS.ADMINISTRATOR) !== 0n) {
    return true;
  }
  const bit = DISCORD_PERMISSIONS[permission];
  return (total & bit) === bit;
}

/** Alle fehlenden Berechtigungen aus einer geforderten Liste. */
export function missingPermissions(
  total: bigint,
  required: readonly DiscordPermissionName[],
): DiscordPermissionName[] {
  return required.filter((permission) => !hasDiscordPermission(total, permission));
}
