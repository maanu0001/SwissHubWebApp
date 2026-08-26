import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { analytics } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';
import type { AnalyticsSection } from '@/modules/analytics/sections';

/**
 * Der Server, dessen Ereignisse gezeigt werden.
 *
 * Jede Analytics-Abfrage filtert danach - es gibt keine Abfrage ohne
 * Server-Filter, die versehentlich alles liefert. Steht kein Server fest,
 * wirft `resolveGuildId` selbst, und das ist die richtige Antwort: ohne
 * verbundenen Server gibt es nichts zu zeigen.
 */
export async function analyticsGuildId(): Promise<string> {
  return resolveGuildId();
}

/** Was ein Betrachter in der Zeitleiste sehen darf. */
export interface AnalyticsAbilities {
  view: boolean;
  /** Darf die Statistik sehen. */
  statistics: boolean;
  /** Darf Nachrichtentexte lesen. */
  content: boolean;
  /** Darf archivierte Dateien öffnen. */
  media: boolean;
  export: boolean;
  settings: boolean;
}

export function analyticsAbilities(context: AuthContext): AnalyticsAbilities {
  const p = analytics.ANALYTICS_PERMISSIONS;
  return {
    view: can(context, p.view),
    statistics: can(context, p.statisticsView),
    content: can(context, p.contentView),
    media: can(context, p.mediaDownload),
    export: can(context, p.export),
    settings: can(context, p.settings) || can(context, 'modules.manage'),
  };
}

/**
 * Unterseiten des Analytics-Moduls.
 *
 * Jeder Bereich haengt an seiner eigenen Berechtigung: wer die Zeitleiste
 * sehen darf, muss nicht auch die Statistik sehen duerfen - und umgekehrt.
 */
export function analyticsSections(context: AuthContext): AnalyticsSection[] {
  const p = analytics.ANALYTICS_PERMISSIONS;
  const sections: AnalyticsSection[] = [];

  if (can(context, p.view)) {
    sections.push({ href: '/analytics', label: 'Zeitleiste' });
  }
  if (can(context, p.statisticsView)) {
    sections.push({ href: '/analytics/statistik', label: 'Statistik' });
  }
  if (can(context, p.settings) || can(context, 'modules.manage')) {
    sections.push({ href: '/modules/analytics', label: 'Einstellungen' });
  }

  return sections;
}

export type { AnalyticsSection };
