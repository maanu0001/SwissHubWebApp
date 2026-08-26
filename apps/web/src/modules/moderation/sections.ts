import type { ModerationActionType } from '@swisshub/database';

/**
 * Die Bereiche und Beschriftungen des Moderation Center - als reine Daten.
 *
 * Bewusst ohne `server-only` und ohne JSX: gebaut wird die Liste auf dem
 * Server, gezeichnet von einer Client-Komponente. Dieselbe Aufteilung wie
 * beim Jail-Modul.
 */
export interface ModerationSection {
  href: string;
  label: string;
}

/** Sprechende Namen der Massnahmen - einmal, fuer alle Ansichten. */
export const ACTION_LABEL: Record<ModerationActionType, string> = {
  JAIL_CREATE: 'Jail erstellt',
  JAIL_RELEASE: 'Jail beendet',
  JAIL_EXTEND: 'Jail angepasst',
  BAN: 'Bann',
  UNBAN: 'Bann aufgehoben',
  KICK: 'Kick',
  TIMEOUT: 'Timeout',
  TIMEOUT_REMOVE: 'Timeout aufgehoben',
  NOTE: 'Notiz',
};

/** Die Massnahmen, nach denen sich der Verlauf filtern laesst. */
export const ACTION_TYPES = Object.keys(ACTION_LABEL) as ModerationActionType[];

/**
 * Faerbung einer Massnahme.
 *
 * Eine Notiz ist keine Strafe und soll auch nicht wie eine aussehen; ein Bann
 * ist die schwerste Massnahme und darf sich davon abheben.
 */
export const ACTION_TONE: Record<ModerationActionType, 'neutral' | 'warn' | 'hart' | 'gut'> = {
  JAIL_CREATE: 'warn',
  JAIL_RELEASE: 'gut',
  JAIL_EXTEND: 'warn',
  BAN: 'hart',
  UNBAN: 'gut',
  KICK: 'hart',
  TIMEOUT: 'warn',
  TIMEOUT_REMOVE: 'gut',
  NOTE: 'neutral',
};
