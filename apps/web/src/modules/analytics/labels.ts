import type { DiscordActorSource, DiscordEventCategory, DiscordEventSeverity } from '@swisshub/database';

/**
 * Beschriftungen der Zeitleiste - als reine Daten.
 *
 * Ohne `server-only` und ohne JSX, damit Server- und Client-Teile dieselben
 * Worte benutzen. Ein Ereignis, das in der Liste anders heisst als im Detail,
 * ist ein zweites Ereignis fuer den, der es liest.
 */

export const CATEGORY_LABEL: Record<DiscordEventCategory, string> = {
  MESSAGE: 'Nachrichten',
  VOICE: 'Sprachkanäle',
  MEMBER: 'Mitglieder',
  ROLE: 'Rollen',
  CHANNEL: 'Kanäle',
  SERVER: 'Server',
};

export const CATEGORIES = Object.keys(CATEGORY_LABEL) as DiscordEventCategory[];

export const SEVERITY_LABEL: Record<DiscordEventSeverity, string> = {
  INFO: 'Information',
  NOTICE: 'Hinweis',
  WARNING: 'Warnung',
  CRITICAL: 'Kritisch',
};

export const SEVERITIES = Object.keys(SEVERITY_LABEL) as DiscordEventSeverity[];

/**
 * Woher die Zuordnung des Verursachers stammt.
 *
 * Der Text steht so in der Oberflaeche, weil der Unterschied zaehlt: «laut
 * Discord Audit Log» ist eine andere Aussage als «über dieses Dashboard», und
 * «nicht zuzuordnen» ist keine Auslassung, sondern die Antwort.
 */
export const ACTOR_SOURCE_LABEL: Record<DiscordActorSource, string> = {
  GATEWAY: 'Von Discord gemeldet',
  AUDIT_LOG: 'Laut Discord Audit Log',
  WEBAPP: 'Über dieses Dashboard',
  UNKNOWN: 'Nicht zuzuordnen',
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  MESSAGE_EDIT: 'Nachricht bearbeitet',
  MESSAGE_DELETE: 'Nachricht gelöscht',
  MESSAGE_BULK_DELETE: 'Nachrichten gesammelt gelöscht',

  VOICE_JOIN: 'Sprachkanal betreten',
  VOICE_LEAVE: 'Sprachkanal verlassen',
  VOICE_MOVE: 'Verschoben',

  MEMBER_JOIN: 'Beigetreten',
  MEMBER_LEAVE: 'Ausgetreten',
  MEMBER_ROLE_ADD: 'Rolle erhalten',
  MEMBER_ROLE_REMOVE: 'Rolle entzogen',
  MEMBER_NICKNAME: 'Nickname geändert',
  MEMBER_TIMEOUT: 'Timeout gesetzt',
  MEMBER_TIMEOUT_END: 'Timeout beendet',
  MEMBER_BAN: 'Gebannt',
  MEMBER_UNBAN: 'Bann aufgehoben',

  ROLE_CREATE: 'Rolle angelegt',
  ROLE_UPDATE: 'Rolle geändert',
  ROLE_DELETE: 'Rolle gelöscht',

  CHANNEL_CREATE: 'Kanal angelegt',
  CHANNEL_UPDATE: 'Kanal geändert',
  CHANNEL_DELETE: 'Kanal gelöscht',
};

/** Sprechender Name - unbekannte Typen erscheinen unverändert statt leer. */
export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type;
}

export const SEVERITY_TONE: Record<DiscordEventSeverity, 'neutral' | 'warn' | 'hart'> = {
  INFO: 'neutral',
  NOTICE: 'neutral',
  WARNING: 'warn',
  CRITICAL: 'hart',
};
