/**
 * Die feinen Ereignistypen - als eigene Datei ohne jede Abhaengigkeit.
 *
 * Sie stehen bewusst getrennt von `events.ts`: dort haengt inzwischen die
 * Discord-Ausgabe mit dran, und die Formatter brauchen ebenfalls diese Liste.
 * Laege sie weiter in `events.ts`, zeigten die beiden Dateien im Kreis
 * aufeinander - und ein Kreis unter Konstanten faellt nicht beim Uebersetzen
 * auf, sondern zur Laufzeit, wenn eine davon noch `undefined` ist.
 */
/** Feiner Ereignistyp. Als String, damit neue Arten keinen Enum-Umbau erzwingen. */
export const EVENT_TYPES = {
  MESSAGE_EDIT: 'MESSAGE_EDIT',
  MESSAGE_DELETE: 'MESSAGE_DELETE',
  MESSAGE_BULK_DELETE: 'MESSAGE_BULK_DELETE',

  VOICE_JOIN: 'VOICE_JOIN',
  VOICE_LEAVE: 'VOICE_LEAVE',
  VOICE_MOVE: 'VOICE_MOVE',

  MEMBER_JOIN: 'MEMBER_JOIN',
  MEMBER_LEAVE: 'MEMBER_LEAVE',
  MEMBER_ROLE_ADD: 'MEMBER_ROLE_ADD',
  MEMBER_ROLE_REMOVE: 'MEMBER_ROLE_REMOVE',
  MEMBER_NICKNAME: 'MEMBER_NICKNAME',
  MEMBER_TIMEOUT: 'MEMBER_TIMEOUT',
  MEMBER_TIMEOUT_END: 'MEMBER_TIMEOUT_END',
  MEMBER_BAN: 'MEMBER_BAN',
  MEMBER_UNBAN: 'MEMBER_UNBAN',

  ROLE_CREATE: 'ROLE_CREATE',
  ROLE_UPDATE: 'ROLE_UPDATE',
  ROLE_DELETE: 'ROLE_DELETE',

  CHANNEL_CREATE: 'CHANNEL_CREATE',
  CHANNEL_UPDATE: 'CHANNEL_UPDATE',
  CHANNEL_DELETE: 'CHANNEL_DELETE',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
