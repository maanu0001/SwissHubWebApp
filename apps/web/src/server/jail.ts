import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { jail } from '@swisshub/modules';
import type { JailSection } from '@/modules/jail/sections';

/**
 * Wo der Jail-Bereich hingehört.
 *
 * Ein Jail ist eine Moderationsmassnahme wie Bann, Kick und Timeout - er
 * stand nur historisch als eigenes Hauptmodul daneben, weil er zuerst da war.
 * Für das Team hiess das: dieselbe Person, zwei Bereiche, und die Frage
 * «welchen mache ich jetzt auf?» bei jedem Vorgang.
 *
 * Fachlich ändert sich dadurch nichts. Es ist derselbe Jail Service, dieselben
 * Berechtigungen und dieselben Seiten - sie stehen nur an einer anderen
 * Stelle. Was jemand darf, entscheiden weiterhin die Jail-Berechtigungen und
 * nicht die Navigation.
 *
 * Der Vote Jail ist die Ausnahme und bleibt für sich: er ist keine Massnahme
 * des Teams, sondern eine Abstimmung der Gemeinschaft. Wer daran teilnimmt,
 * soll dafür nicht den Moderationsbereich öffnen müssen - und sieht ihn in
 * aller Regel gar nicht.
 */
export function jailSections(context: AuthContext): JailSection[] {
  const p = jail.JAIL_PERMISSIONS;
  const sections: JailSection[] = [];

  if (can(context, p.view)) {
    sections.push({ href: '/moderation/jail', label: 'Jails' });
  }
  if (can(context, p.import)) {
    sections.push({ href: '/moderation/jail/import', label: 'Import' });
  }

  return sections;
}

/**
 * Ob dieser Betrachter Jail-Funktionen im Moderationsbereich sieht.
 *
 * Getrennt von `jailSections`, weil die Moderationsnavigation sie zwischen
 * ihre eigenen Einträge mischt statt sie als Block anzuhängen.
 */
export function darfJailSehen(context: AuthContext): boolean {
  return can(context, jail.JAIL_PERMISSIONS.view);
}
