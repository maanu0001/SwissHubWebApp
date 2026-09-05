import { permanentRedirect } from 'next/navigation';

/**
 * Vote Jail ist kein Unterpunkt des Jail-Bereichs mehr.
 *
 * Er ist etwas anderes als eine Moderationsmassnahme: eine Abstimmung, die
 * die Gemeinschaft fuehrt. Deshalb steht er jetzt fuer sich - und ist damit
 * auch fuer alle erreichbar, die den Moderationsbereich gar nicht sehen.
 */
export default function VoteJailUmleitung(): never {
  permanentRedirect('/vote-jail');
}
