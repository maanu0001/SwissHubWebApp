import { formatDateTime, formatDayTime, formatDuration } from '@swisshub/shared';

/**
 * Einheitliche Darstellung von Dauer und Ende eines Jails.
 *
 * Permanente Jails haben bewusst kein Enddatum. Damit "Permanent" überall
 * gleich aussieht - Liste, Detailseite, Dashboard, Discord-Embed - steht die
 * Formatierung hier einmal zentral statt in jeder Komponente erneut.
 */
export interface JailDurationView {
  type: string;
  durationSeconds: number | null;
  endsAt: Date | null;
}

export const PERMANENT_LABEL = 'Permanent';

export const isPermanentJail = (jail: { type: string }): boolean => jail.type === 'PERMANENT';

/** "Permanent" oder die formatierte Dauer. */
export function jailDurationLabel(jail: JailDurationView): string {
  if (isPermanentJail(jail) || jail.durationSeconds === null) {
    return PERMANENT_LABEL;
  }
  return formatDuration(jail.durationSeconds * 1000);
}

/** "Permanent" oder das formatierte Enddatum. */
export function jailEndLabel(jail: JailDurationView, options: { short?: boolean } = {}): string {
  if (jail.endsAt === null) {
    return PERMANENT_LABEL;
  }
  return options.short ? formatDayTime(jail.endsAt) : formatDateTime(jail.endsAt);
}

/**
 * Beschriftung der Herkunft.
 *
 * Dashboard und Slash Command führen durch denselben Service - die Herkunft
 * sagt nur, wo die Aktion ausgelöst wurde.
 */
export const JAIL_SOURCE_LABEL: Record<string, string> = {
  DASHBOARD: 'Dashboard',
  SLASH_COMMAND: 'Slash Command',
  VOTE_JAIL: 'Community-Abstimmung',
  IMPORT: 'Übernahme aus dem alten Bot',
  AUTO_RESTORE: 'Automatische Wiederherstellung',
};

export const jailSourceLabel = (source: string): string => JAIL_SOURCE_LABEL[source] ?? source;

/** Beschriftung und Ton des fachlichen Zustands. */
export const JAIL_LIFECYCLE_LABEL: Record<string, { label: string; tone: 'active' | 'done' | 'problem' }> = {
  PENDING: { label: 'Wird ausgeführt', tone: 'active' },
  ACTIVE: { label: 'Aktiv', tone: 'active' },
  RELEASED: { label: 'Freigelassen', tone: 'done' },
  EXPIRED: { label: 'Abgelaufen', tone: 'done' },
  RESTORE_FAILED: { label: 'Rollen nicht vollständig zurück', tone: 'problem' },
  PENDING_REJOIN: { label: 'Server verlassen - wartet auf Wiedereintritt', tone: 'problem' },
  FAILED: { label: 'Fehlgeschlagen', tone: 'problem' },
};

export const jailLifecycleLabel = (
  lifecycle: string,
): { label: string; tone: 'active' | 'done' | 'problem' } =>
  JAIL_LIFECYCLE_LABEL[lifecycle] ?? { label: lifecycle, tone: 'done' };
