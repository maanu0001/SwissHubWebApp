import { DISCORD_PERMISSIONS, type ChannelOverwrite } from '@swisshub/discord';

/**
 * Rechte in einem temporaeren Sprachkanal.
 *
 * Der Grundsatz: dieses Modul fasst ausschliesslich die Bits an, die es selbst
 * vergibt. Alles andere - was die Kategorie setzt, was eine Moderationsrolle
 * mitbringt, was ein Administrator von Hand eingetragen hat - bleibt
 * unberuehrt. Eine Verwaltung, die bei jeder Aenderung alle Ausnahmen neu
 * schreibt, loescht irgendwann etwas, das ihr nicht gehoert.
 *
 * Und der Besitzer bekommt Rechte in *seinem Kanal*, nie auf dem Server. Es
 * entsteht keine Rolle, es wird keine Rolle vergeben - nur Kanalausnahmen.
 */

/** Was jeder darf, der den Talk betreten kann. */
export const TEILNEHMER_ERLAUBT =
  DISCORD_PERMISSIONS.VIEW_CHANNEL |
  DISCORD_PERMISSIONS.CONNECT |
  DISCORD_PERMISSIONS.SPEAK |
  DISCORD_PERMISSIONS.STREAM |
  DISCORD_PERMISSIONS.USE_VAD;

/**
 * Zusaetzliche Rechte des Besitzers.
 *
 * Bewusst ohne `MANAGE_CHANNELS`: damit liesse sich der Kanal verschieben,
 * dauerhaft umkonfigurieren oder in eine andere Kategorie hieven - und der
 * Besitzer koennte an der Anwendung vorbei Dinge tun, die sie hinterher nicht
 * mehr versteht. Umbenennen und Limit setzen laeuft ueber das Bedienfeld, wo
 * die Anwendung mitzaehlt.
 */
export const BESITZER_MODERATION =
  DISCORD_PERMISSIONS.PRIORITY_SPEAKER |
  DISCORD_PERMISSIONS.MUTE_MEMBERS |
  DISCORD_PERMISSIONS.DEAFEN_MEMBERS |
  DISCORD_PERMISSIONS.MOVE_MEMBERS;

/**
 * Rechte des Bots im eigenen Kanal.
 *
 * Ohne sie koennte er den Kanal spaeter weder aufraeumen noch das Bedienfeld
 * hineinschreiben - auch dann nicht, wenn die Kategorie ihm die Rechte
 * eigentlich gibt: eine Ausnahme auf Kanalebene sticht die Kategorie.
 */
export const BOT_ERLAUBT =
  TEILNEHMER_ERLAUBT |
  DISCORD_PERMISSIONS.MANAGE_CHANNELS |
  DISCORD_PERMISSIONS.MOVE_MEMBERS |
  DISCORD_PERMISSIONS.SEND_MESSAGES |
  DISCORD_PERMISSIONS.EMBED_LINKS |
  DISCORD_PERMISSIONS.READ_MESSAGE_HISTORY;

/** Die Bits, die dieses Modul an `@everyone` vergibt oder entzieht. */
const EVERYONE_VERWALTET = DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.CONNECT;

export function besitzerRechte(moderation: boolean): bigint {
  return moderation ? TEILNEHMER_ERLAUBT | BESITZER_MODERATION : TEILNEHMER_ERLAUBT;
}

/**
 * Die Ausnahme fuer `@everyone` aus Sperre und Sichtbarkeit.
 *
 * Zwei getrennte Schalter mit zwei getrennten Wirkungen:
 *
 *   gesperrt  - der Kanal ist zu sehen, aber nicht zu betreten. Wer drin ist,
 *               bleibt drin; Discord wirft niemanden hinaus, wenn `CONNECT`
 *               entzogen wird.
 *   versteckt - der Kanal ist nicht zu sehen und damit auch nicht zu betreten.
 *
 * Ist beides aus, wird die Ausnahme *entfernt* statt auf «erlaubt» gesetzt.
 * Der Kanal erbt dann wieder von seiner Kategorie - und genau das ist gemeint:
 * ein oeffentlicher Talk in einer geschlossenen Kategorie soll geschlossen
 * bleiben.
 */
export function everyoneAusnahme(
  guildId: string,
  zustand: { locked: boolean; hidden: boolean },
): ChannelOverwrite | null {
  if (!zustand.locked && !zustand.hidden) {
    return null;
  }

  let deny = 0n;
  if (zustand.hidden) {
    deny |= DISCORD_PERMISSIONS.VIEW_CHANNEL | DISCORD_PERMISSIONS.CONNECT;
  } else if (zustand.locked) {
    deny |= DISCORD_PERMISSIONS.CONNECT;
  }

  return { id: guildId, type: 0, allow: 0n, deny };
}

/**
 * Fuehrt eine neue Ausnahme mit der bestehenden zusammen.
 *
 * Fremde Bits derselben Ausnahme bleiben erhalten: hat ein Administrator dem
 * `@everyone` in diesem Kanal etwas anderes verboten, soll das Entsperren
 * nicht auch das aufheben.
 */
export function verschmelze(
  vorhanden: { allow: bigint; deny: bigint } | null,
  neu: { allow: bigint; deny: bigint },
  verwaltet: bigint,
): { allow: bigint; deny: bigint } {
  const fremdAllow = (vorhanden?.allow ?? 0n) & ~verwaltet;
  const fremdDeny = (vorhanden?.deny ?? 0n) & ~verwaltet;
  return {
    allow: fremdAllow | (neu.allow & verwaltet),
    deny: fremdDeny | (neu.deny & verwaltet),
  };
}

export { EVERYONE_VERWALTET };
