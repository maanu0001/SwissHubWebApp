import type { CachedChannel, CachedRole } from '../discord/sync';

/**
 * Gesundheitsprüfung eines Moduls.
 *
 * Module liefern damit konkrete, umsetzbare Aussagen statt eines pauschalen
 * "konfiguriert / nicht konfiguriert".
 */
export type HealthStatus = 'ok' | 'warning' | 'error';

export interface ModuleHealthCheck {
  /** Kurzer Titel, z.B. "Jail-Rolle". */
  label: string;
  status: HealthStatus;
  /** Erklärung, was fehlt bzw. warum es passt. */
  detail?: string;
  /** Link, der direkt zur passenden Einstellung führt. */
  fixHref?: string;
}

export interface ModuleHealthContext {
  roles: CachedRole[];
  channels: CachedChannel[];
  /** Höchste Rollenposition des Bots. */
  botHighestPosition: number;
  /** Discord ist erreichbar bzw. es liegen synchronisierte Daten vor. */
  discordAvailable: boolean;
}

export interface ModuleHealthReport {
  moduleId: string;
  moduleName: string;
  enabled: boolean;
  status: HealthStatus;
  checks: ModuleHealthCheck[];
  settingsHref: string | null;
}

/** Schlechtester Status einer Prüfungsliste. */
export function worstStatus(checks: readonly ModuleHealthCheck[]): HealthStatus {
  if (checks.some((check) => check.status === 'error')) {
    return 'error';
  }
  if (checks.some((check) => check.status === 'warning')) {
    return 'warning';
  }
  return 'ok';
}
