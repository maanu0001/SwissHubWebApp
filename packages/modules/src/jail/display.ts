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
