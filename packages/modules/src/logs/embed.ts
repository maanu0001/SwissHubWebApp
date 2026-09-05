import type { DiscordEmbed, DiscordEmbedField } from '@swisshub/discord';

/**
 * Sichere Embeds.
 *
 * Discord weist ein zu grosses Embed mit einem Fehler ab - und der faellt
 * ausgerechnet dann an, wenn das Log am interessantesten ist: bei einer
 * ellenlangen geloeschten Nachricht. Deshalb wird hier gekuerzt, und zwar an
 * einer Stelle statt in jedem Formatter.
 *
 * ## Die Grenzen sind Discords, nicht unsere
 *
 * Sie stehen als Konstanten da, damit erkennbar ist, dass sie nicht
 * verhandelbar sind. Die Gesamtgrenze von 6000 Zeichen zaehlt Titel,
 * Beschreibung, Feldnamen, Feldwerte und Fusszeile zusammen - ein Embed kann
 * also jede Einzelgrenze einhalten und trotzdem zu gross sein.
 */

export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  fields: 25,
  gesamt: 6000,
} as const;

/** Steht dort, wo etwas weggeschnitten wurde - sichtbar, nicht heimlich. */
export const GEKUERZT = ' … (gekürzt)';

/**
 * Kuerzt einen Text auf eine Hoechstlaenge.
 *
 * Wer kuerzt, muss es sagen: ein stillschweigend abgeschnittener Satz liest
 * sich wie ein vollstaendiger, und im Protokoll ist das der Unterschied
 * zwischen einer Aussage und einer halben.
 */
export function kuerze(text: string, grenze: number): string {
  if (text.length <= grenze) {
    return text;
  }
  if (grenze <= GEKUERZT.length) {
    return text.slice(0, grenze);
  }
  return text.slice(0, grenze - GEKUERZT.length) + GEKUERZT;
}

/**
 * Nachrichteninhalt fuer ein Feld.
 *
 * Zusaetzlich in einen Zitatblock gesetzt, damit Ueberschriften und Listen
 * aus dem Originaltext die Log-Zeile nicht auseinanderreissen.
 */
export function alsZitat(text: string, grenze = EMBED_LIMITS.fieldValue): string {
  const sauber = text.trim();
  if (sauber.length === 0) {
    return '_leer_';
  }
  // Der Zitatblock kostet drei Zeichen je Zeile; grosszuegig gerechnet.
  const inhalt = kuerze(sauber, Math.max(grenze - 8, 16));
  return `>>> ${inhalt}`;
}

/**
 * Bringt ein Embed sicher unter Discords Grenzen.
 *
 * Erst jedes Stueck einzeln, dann das Ganze: reicht das nicht, fallen Felder
 * von hinten weg. Die vorderen Felder tragen die wichtigere Aussage - wer
 * gehandelt hat und gegen wen -, die hinteren den Zusatz.
 */
export function begrenze(embed: DiscordEmbed): DiscordEmbed {
  const gekuerzt: DiscordEmbed = {
    ...embed,
    ...(embed.title ? { title: kuerze(embed.title, EMBED_LIMITS.title) } : {}),
    ...(embed.description ? { description: kuerze(embed.description, EMBED_LIMITS.description) } : {}),
    ...(embed.footer ? { footer: { text: kuerze(embed.footer.text, EMBED_LIMITS.footer) } } : {}),
    ...(embed.fields
      ? {
          fields: embed.fields.slice(0, EMBED_LIMITS.fields).map((feld) => ({
            name: kuerze(feld.name, EMBED_LIMITS.fieldName),
            value: kuerze(feld.value, EMBED_LIMITS.fieldValue),
            ...(feld.inline === undefined ? {} : { inline: feld.inline }),
          })),
        }
      : {}),
  };

  // Die Gesamtgrenze: Felder von hinten fallen lassen, bis es passt.
  let felder = gekuerzt.fields ?? [];
  while (felder.length > 0 && gesamtlaenge({ ...gekuerzt, fields: felder }) > EMBED_LIMITS.gesamt) {
    felder = felder.slice(0, -1);
  }
  if (felder.length !== (gekuerzt.fields?.length ?? 0)) {
    return { ...gekuerzt, fields: felder };
  }
  return gekuerzt;
}

/** Discords Zaehlweise: Titel, Beschreibung, Feldnamen, Feldwerte, Fusszeile. */
export function gesamtlaenge(embed: DiscordEmbed): number {
  const felder = (embed.fields ?? []).reduce(
    (summe, feld) => summe + feld.name.length + feld.value.length,
    0,
  );
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.author?.name.length ?? 0) +
    felder
  );
}

/**
 * Ein Feld - oder keines.
 *
 * Ein leeres Feld ist bei Discord ein Fehler, und «unbekannt» ist oft die
 * ehrlichere Auskunft als eine erfundene. Wo nichts bekannt ist, gibt diese
 * Funktion nichts zurueck, und der Formatter entscheidet, ob er stattdessen
 * ausdruecklich «Kein Grund angegeben» schreibt.
 */
export function feld(name: string, wert: string | null | undefined, inline = true): DiscordEmbedField[] {
  if (wert === null || wert === undefined) {
    return [];
  }
  const sauber = wert.trim();
  if (sauber.length === 0) {
    return [];
  }
  return [{ name, value: sauber, inline }];
}

/**
 * Ein Zeitpunkt in Discords eigener Schreibweise.
 *
 * `<t:…:F>` zeigt jedem Betrachter seine eigene Zone. Eine fest
 * eingebrannte Schweizer Zeit waere fuer alle anderen falsch - und im
 * Protokoll ist ein falscher Zeitstempel schlimmer als keiner.
 */
export function zeitpunkt(datum: Date): string {
  const sekunden = Math.floor(datum.getTime() / 1000);
  return `<t:${sekunden}:F> (<t:${sekunden}:R>)`;
}

/**
 * Verweise auf Discord-Objekte.
 *
 * Ein Log soll anklickbar sein: `<@123>` oeffnet das Profil, `<#456>` springt
 * in den Kanal. Ein Name als blosser Text tut beides nicht, und die blosse
 * Kennung ist eine Zahl, mit der man von Hand suchen muss.
 *
 * Anklickbar heisst dabei ausdruecklich **nicht** benachrichtigt. Ob eine
 * Erwaehnung jemanden erreicht, entscheidet nicht der Text, sondern
 * `allowedMentions` der Nachricht - und die steht bei jedem Log auf
 * `{ parse: [] }`. Damit bleibt `<@123>` ein Link und wird nie ein Ping.
 * Genau deshalb koennen diese Helfer ueberhaupt Erwaehnungen erzeugen, und
 * genau deshalb darf `allowedMentions` bei Logs nie gelockert werden.
 *
 * Die Kennung steht bei Personen zusaetzlich da. Sie ist die einzige Angabe,
 * die haelt: wer den Server verlassen hat, ist als Erwaehnung nur noch eine
 * graue Zahl, und ein Anzeigename kann sich jederzeit aendern.
 */

/**
 * Eine Person - anklickbar, mit kopierbarer Kennung.
 *
 * Bewusst ohne Mitgliedschaftspruefung: ein gebanntes oder ausgetretenes
 * Mitglied soll genauso dargestellt werden. Die Kennung genuegt.
 */
export function formatDiscordUserReference(
  discordId: string | null | undefined,
  fallbackName?: string | null,
): string | null {
  const id = discordId?.trim();
  const name = fallbackName?.trim();

  // «unknown» steht in der Akte fuer «Discord hat den Handelnden nicht
  // genannt». Daraus eine Erwaehnung zu bauen ergaebe einen Link auf nichts.
  if (!id || id === 'unknown' || !/^\d{15,25}$/u.test(id)) {
    return name && name.length > 0 ? name : null;
  }

  return name && name.length > 0 ? `<@${id}>\n${name} · \`${id}\`` : `<@${id}>\n\`${id}\``;
}

/** Ein Kanal - anklickbar, sonst sein Name. */
export function formatDiscordChannelReference(
  channelId: string | null | undefined,
  fallbackName?: string | null,
): string | null {
  const id = channelId?.trim();
  const name = fallbackName?.trim();

  if (id && /^\d{15,25}$/u.test(id)) {
    return `<#${id}>`;
  }
  return name && name.length > 0 ? `#${name}` : null;
}

/** Eine Rolle - anklickbar, sonst ihr Name. */
export function formatDiscordRoleReference(
  roleId: string | null | undefined,
  fallbackName?: string | null,
): string | null {
  const id = roleId?.trim();
  const name = fallbackName?.trim();

  if (id && /^\d{15,25}$/u.test(id)) {
    return `<@&${id}>`;
  }
  return name && name.length > 0 ? `@${name}` : null;
}
