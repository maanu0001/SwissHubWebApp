import 'server-only';
import { can, type AuthContext } from '@swisshub/auth';
import { jail } from '@swisshub/modules';
import type { JailSection } from '@/modules/jail/sections';

/**
 * Unterseiten des Jail-Moduls.
 *
 * Einmal zentral definiert, damit alle Seiten dieselbe Bereichsnavigation
 * zeigen. Jeder Bereich haengt an seiner eigenen Berechtigung: wer nur
 * Abstimmungen starten darf, sieht die Abstimmungen und nicht die Strafakte;
 * der Import erscheint nur fuer die, die ihn ausfuehren duerfen.
 */
export function jailSections(context: AuthContext): JailSection[] {
  const p = jail.JAIL_PERMISSIONS;
  const sections: JailSection[] = [];

  if (can(context, p.view)) {
    sections.push({ href: '/jail', label: 'Übersicht' });
  }
  if (can(context, p.view) || can(context, p.voteStart)) {
    sections.push({ href: '/jail/votes', label: 'Vote Jail' });
  }
  if (can(context, p.import)) {
    sections.push({ href: '/jail/import', label: 'Import' });
  }

  return sections;
}
