import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { analytics } from '@swisshub/modules';
import { resolveGuildId } from '@swisshub/discord';

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
    content: can(context, p.contentView),
    media: can(context, p.mediaDownload),
    export: can(context, p.export),
    settings: can(context, p.settings) || can(context, 'modules.manage'),
  };
}
