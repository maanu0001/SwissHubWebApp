import type {
  DiscordEvent,
  ModerationAction,
  ModerationActionType,
  ModerationSource,
} from '@swisshub/database';
import type { DiscordEmbed, DiscordEmbedField } from '@swisshub/discord';
import { EVENT_TYPES } from '../analytics/event-types';
import {
  EMBED_LIMITS,
  alsZitat,
  begrenze,
  feld,
  formatDiscordChannelReference,
  formatDiscordRoleReference,
  formatDiscordUserReference,
  kuerze,
  zeitpunkt,
} from './embed';

/**
 * Aus einem Logeintrag wird ein Embed.
 *
 * ## Die eine Regel, die hier zaehlt
 *
 * **Es wird ausschliesslich benannt, was benannt werden soll.** Kein
 * `JSON.stringify(metadata)`, kein Durchreichen ganzer Datensaetze. Jedes
 * Feld unten steht einzeln da, weil jemand entschieden hat, dass es nach
 * Discord darf.
 *
 * Der Unterschied ist nicht theoretisch: `ModerationAction.metadata` traegt
 * bei einem Jail interne Vermerke, `DiscordEvent.metadata` bei einem Bann den
 * Discord-Grund. Ein Formatter, der «einfach alles» ausgibt, traegt beim
 * naechsten neuen Feld etwas nach Discord, das niemand dorthin gestellt hat.
 * Diese Bauart kann das nicht.
 *
 * ## Was nicht erfunden wird
 *
 * Wo Discord den Handelnden nicht nennt, steht kein Name. «Unbekannt» ist
 * eine Auskunft; ein geratener Name ist eine Behauptung.
 */

/** Farben nach Schwere - eine Aufhebung sieht nicht aus wie ein Bann. */
const FARBE = {
  hart: 0xd4_3f_3f,
  warnung: 0xd8_8b_2a,
  gut: 0x3f_9d_5c,
  neutral: 0x5a_63_72,
  info: 0x3f_74_d4,
} as const;

const QUELLE_LABEL: Record<ModerationSource, string> = {
  WEBAPP: 'SwissHub WebApp',
  BOT: 'SwissHub Bot',
  DISCORD: 'Discord',
  SYSTEM: 'System',
};

interface MassnahmeDarstellung {
  titel: string;
  farbe: number;
}

const MASSNAHME: Record<ModerationActionType, MassnahmeDarstellung> = {
  BAN: { titel: '🔨 Mitglied gebannt', farbe: FARBE.hart },
  UNBAN: { titel: '🔓 Bann aufgehoben', farbe: FARBE.gut },
  KICK: { titel: '👢 Mitglied gekickt', farbe: FARBE.hart },
  TIMEOUT: { titel: '🔇 Timeout gesetzt', farbe: FARBE.warnung },
  TIMEOUT_UPDATE: { titel: '🔁 Timeout geändert', farbe: FARBE.warnung },
  TIMEOUT_REMOVE: { titel: '🔊 Timeout aufgehoben', farbe: FARBE.gut },
  JAIL_CREATE: { titel: '⛓️ Jail verhängt', farbe: FARBE.hart },
  JAIL_RELEASE: { titel: '🔓 Jail beendet', farbe: FARBE.gut },
  JAIL_EXTEND: { titel: '⛓️ Jail angepasst', farbe: FARBE.warnung },
  NOTE: { titel: '📝 Notiz zur Akte', farbe: FARBE.neutral },
};

/** Der Fuss trägt immer dasselbe - man erkennt die Herkunft auf einen Blick. */
function fuss(bereich: string): { text: string } {
  return { text: `SwissHub • ${bereich}` };
}

/**
 * Eine Person - anklickbar, ohne sie anzupingen.
 *
 * Der zentrale Helfer aus `embed.ts`. Er steht dort und nicht hier, damit ein
 * neuer Logtyp die Darstellung erbt, statt sie noch einmal zu erfinden.
 *
 * Die Erwaehnung benachrichtigt niemanden: `delivery.ts` sendet jedes Log mit
 * `allowedMentions: { parse: [] }`. Der Text macht sie klickbar, die
 * Nachrichtenoption verhindert den Ping - beides gehoert zusammen.
 */
function person(name: string | null, discordId: string | null): string | null {
  return formatDiscordUserReference(discordId, name);
}

// --- Moderation -------------------------------------------------------------

/**
 * Eine Massnahme aus der Akte.
 *
 * Der Grund steht ausdruecklich als «Kein Grund angegeben» da, wenn keiner
 * hinterlegt ist: bei einer Massnahme aus dem Dashboard ist er Pflicht, bei
 * einer aus Discord gab Discord ihn manchmal nicht her. Das Feld wegzulassen
 * liesse offen, ob niemand einen angab oder ob wir ihn verschweigen.
 */
export function formatiereMassnahme(massnahme: ModerationAction): DiscordEmbed {
  const darstellung = MASSNAHME[massnahme.type];
  const felder: DiscordEmbedField[] = [
    ...feld('Mitglied', person(massnahme.targetUsername, massnahme.targetDiscordId)),
    ...feld(
      'Moderator',
      massnahme.actorType === 'UNKNOWN'
        ? 'Unbekannt'
        : person(
            massnahme.actorType === 'BOT' ? `${massnahme.actorUsername} (Bot)` : massnahme.actorUsername,
            massnahme.actorDiscordId === 'unknown' ? null : massnahme.actorDiscordId,
          ),
    ),
    ...feld('Grund', massnahme.reason ?? 'Kein Grund angegeben', false),
    ...feld('Quelle', QUELLE_LABEL[massnahme.source]),
    ...(massnahme.expiresAt ? feld('Läuft ab', zeitpunkt(massnahme.expiresAt)) : []),
    ...feld('Zeit', zeitpunkt(massnahme.createdAt), false),
  ];

  return begrenze({
    title: darstellung.titel,
    color: darstellung.farbe,
    fields: felder,
    footer: fuss('Moderation'),
    timestamp: massnahme.createdAt.toISOString(),
  });
}

// --- Statistikereignisse ----------------------------------------------------

interface EreignisDarstellung {
  titel: string;
  farbe: number;
  bereich: string;
}

const EREIGNIS: Record<string, EreignisDarstellung> = {
  [EVENT_TYPES.MESSAGE_DELETE]: {
    titel: '🗑️ Nachricht gelöscht',
    farbe: FARBE.warnung,
    bereich: 'Nachrichten',
  },
  [EVENT_TYPES.MESSAGE_EDIT]: {
    titel: '✏️ Nachricht bearbeitet',
    farbe: FARBE.info,
    bereich: 'Nachrichten',
  },
  [EVENT_TYPES.MESSAGE_BULK_DELETE]: {
    titel: '🗑️ Mehrere Nachrichten gelöscht',
    farbe: FARBE.warnung,
    bereich: 'Nachrichten',
  },
  [EVENT_TYPES.VOICE_JOIN]: {
    titel: '🔊 Sprachkanal betreten',
    farbe: FARBE.info,
    bereich: 'Sprachkanäle',
  },
  [EVENT_TYPES.VOICE_LEAVE]: {
    titel: '🔇 Sprachkanal verlassen',
    farbe: FARBE.neutral,
    bereich: 'Sprachkanäle',
  },
  [EVENT_TYPES.VOICE_MOVE]: {
    titel: '↔️ Sprachkanal gewechselt',
    farbe: FARBE.info,
    bereich: 'Sprachkanäle',
  },
  [EVENT_TYPES.MEMBER_JOIN]: {
    titel: '👋 Mitglied beigetreten',
    farbe: FARBE.gut,
    bereich: 'Mitglieder',
  },
  [EVENT_TYPES.MEMBER_LEAVE]: {
    titel: '🚪 Mitglied hat den Server verlassen',
    farbe: FARBE.neutral,
    bereich: 'Mitglieder',
  },
  [EVENT_TYPES.MEMBER_ROLE_ADD]: {
    titel: '➕ Rolle vergeben',
    farbe: FARBE.info,
    bereich: 'Mitglieder',
  },
  [EVENT_TYPES.MEMBER_ROLE_REMOVE]: {
    titel: '➖ Rolle entzogen',
    farbe: FARBE.neutral,
    bereich: 'Mitglieder',
  },
  [EVENT_TYPES.MEMBER_NICKNAME]: {
    titel: '👤 Spitzname geändert',
    farbe: FARBE.info,
    bereich: 'Mitglieder',
  },
  [EVENT_TYPES.ROLE_CREATE]: {
    titel: '⚙️ Rolle erstellt',
    farbe: FARBE.info,
    bereich: 'Verwaltung',
  },
  [EVENT_TYPES.ROLE_UPDATE]: {
    titel: '⚙️ Rolle bearbeitet',
    farbe: FARBE.info,
    bereich: 'Verwaltung',
  },
  [EVENT_TYPES.ROLE_DELETE]: {
    titel: '⚙️ Rolle gelöscht',
    farbe: FARBE.warnung,
    bereich: 'Verwaltung',
  },
  [EVENT_TYPES.CHANNEL_CREATE]: {
    titel: '⚙️ Kanal erstellt',
    farbe: FARBE.info,
    bereich: 'Verwaltung',
  },
  [EVENT_TYPES.CHANNEL_UPDATE]: {
    titel: '⚙️ Kanal bearbeitet',
    farbe: FARBE.info,
    bereich: 'Verwaltung',
  },
  [EVENT_TYPES.CHANNEL_DELETE]: {
    titel: '⚙️ Kanal gelöscht',
    farbe: FARBE.warnung,
    bereich: 'Verwaltung',
  },
};

/** Fuer einen Typ ohne eigene Darstellung - besser als gar nichts zu senden. */
function ersatzDarstellung(type: string): EreignisDarstellung {
  return { titel: `📋 ${type}`, farbe: FARBE.neutral, bereich: 'Protokoll' };
}

/**
 * Der Verursacher - nur, wenn er belegt ist.
 *
 * `actorSource` steht auf `UNKNOWN`, wenn Discord ihn nicht hergab. Dann
 * steht hier nichts: «Gelöscht von X» ohne Beleg waere eine Behauptung ueber
 * einen Menschen, und sie stuende in einem Kanal, den der halbe Server liest.
 */
function verursacher(ereignis: DiscordEvent): DiscordEmbedField[] {
  if (ereignis.actorSource === 'UNKNOWN' || !ereignis.actorDiscordId) {
    return [];
  }
  return feld('Ausgeführt von', person(ereignis.actorUsername, ereignis.actorDiscordId));
}

/** Der Kanal als Erwaehnung - ein Klick, und man ist dort. */
function kanal(ereignis: DiscordEvent): DiscordEmbedField[] {
  // Beim Kanalwechsel sagen «Von» und «Nach» dasselbe genauer.
  if (ereignis.type === EVENT_TYPES.VOICE_MOVE) {
    return [];
  }
  return feld('Kanal', formatDiscordChannelReference(ereignis.channelId, ereignis.channelName));
}

/**
 * Ein Statistikereignis als Embed.
 *
 * Die Felder sind je Typ ausgewaehlt, nicht generisch aus dem Datensatz
 * geschuettet. `metadata` wird an genau zwei Stellen gelesen und dort mit
 * benanntem Schluessel - siehe `voiceZiel` und `rollenNamen`.
 */
export function formatiereEreignis(
  ereignis: DiscordEvent,
  optionen: { guildId?: string | null } = {},
): DiscordEmbed {
  const darstellung = EREIGNIS[ereignis.type] ?? ersatzDarstellung(ereignis.type);
  const felder: DiscordEmbedField[] = [
    ...feld('Mitglied', person(ereignis.subjectUsername, ereignis.subjectDiscordId)),
    ...kanal(ereignis),
    ...inhaltsFelder(ereignis),
    ...zusatzFelder(ereignis),
    ...verursacher(ereignis),
    ...feld('Zeit', zeitpunkt(ereignis.occurredAt), false),
  ];

  const link = nachrichtenLink(ereignis, optionen.guildId ?? ereignis.guildId);

  return begrenze({
    title: darstellung.titel,
    color: darstellung.farbe,
    fields: felder,
    footer: fuss(darstellung.bereich),
    timestamp: ereignis.occurredAt.toISOString(),
    ...(link ? { description: link } : {}),
  });
}

/**
 * Nachrichteninhalt - vorher und nachher.
 *
 * Beide sind nullbar, und das hat Bedeutung: ohne Message-Content-Intent gibt
 * es gar keinen Inhalt, und «leer» ist etwas anderes als «unbekannt». Deshalb
 * erscheint das Feld nur, wenn tatsaechlich Text vorliegt.
 */
function inhaltsFelder(ereignis: DiscordEvent): DiscordEmbedField[] {
  if (ereignis.type === EVENT_TYPES.MESSAGE_EDIT) {
    return [
      ...(ereignis.contentBefore ? feld('Vorher', alsZitat(ereignis.contentBefore), false) : []),
      ...(ereignis.contentAfter ? feld('Nachher', alsZitat(ereignis.contentAfter), false) : []),
    ];
  }
  if (ereignis.type === EVENT_TYPES.MESSAGE_DELETE && ereignis.contentBefore) {
    return feld('Inhalt', alsZitat(ereignis.contentBefore), false);
  }
  return [];
}

/**
 * Die wenigen Stellen, an denen Metadaten gelesen werden.
 *
 * Mit benanntem Schluessel und Typpruefung. Kein Durchreichen des ganzen
 * Objekts - genau darum geht es in dieser Datei.
 */
function zusatzFelder(ereignis: DiscordEvent): DiscordEmbedField[] {
  const daten = (ereignis.metadata ?? {}) as Record<string, unknown>;

  if (ereignis.type === EVENT_TYPES.VOICE_MOVE) {
    // Der Bot legt den vorherigen Kanal unter `vonName` ab, die Kennung unter
    // `von`. Der Zielkanal steht am Ereignis selbst.
    const vonName = typeof daten.vonName === 'string' ? daten.vonName : null;
    const vonId = typeof daten.von === 'string' ? daten.von : null;
    return [
      ...feld('Von', formatDiscordChannelReference(vonId, vonName)),
      ...feld('Nach', formatDiscordChannelReference(ereignis.channelId, ereignis.channelName)),
    ];
  }

  if (ereignis.type === EVENT_TYPES.MEMBER_ROLE_ADD || ereignis.type === EVENT_TYPES.MEMBER_ROLE_REMOVE) {
    // Rollen als Erwaehnung: sie sind im Log dieselbe Sache wie ein Kanal -
    // man will sehen, welche gemeint ist, und Discord faerbt sie ein.
    // Benachrichtigt wird auch hier niemand.
    const rollen = Array.isArray(daten.rollen) ? daten.rollen : [];
    const verweise = rollen.flatMap((eintrag) => {
      if (typeof eintrag !== 'object' || eintrag === null) {
        return [];
      }
      const datensatz = eintrag as { id?: unknown; name?: unknown };
      const verweis = formatDiscordRoleReference(
        typeof datensatz.id === 'string' ? datensatz.id : null,
        typeof datensatz.name === 'string' ? datensatz.name : null,
      );
      return verweis ? [verweis] : [];
    });
    return feld('Rollen', verweise.length > 0 ? verweise.join(', ') : null, false);
  }

  if (ereignis.type === EVENT_TYPES.MEMBER_NICKNAME) {
    return [
      ...feld('Vorher', ereignis.contentBefore ?? '_kein Spitzname_'),
      ...feld('Nachher', ereignis.contentAfter ?? '_kein Spitzname_'),
    ];
  }

  return [];
}

/**
 * Ein Link zur Nachricht - nur, wenn er tatsaechlich irgendwohin fuehrt.
 *
 * Bei einer geloeschten Nachricht gibt es kein Ziel mehr; ein Link darauf
 * waere eine Einladung ins Leere. Deshalb nur beim Bearbeiten.
 */
function nachrichtenLink(ereignis: DiscordEvent, guildId: string | null): string | null {
  if (ereignis.type !== EVENT_TYPES.MESSAGE_EDIT) {
    return null;
  }
  if (!guildId || !ereignis.channelId || !ereignis.messageId) {
    return null;
  }
  return `[Zur Nachricht](https://discord.com/channels/${guildId}/${ereignis.channelId}/${ereignis.messageId})`;
}

// --- Testnachricht ----------------------------------------------------------

/**
 * Die Probe aufs Exempel.
 *
 * Ausdruecklich kein Logeintrag: sie entsteht nur auf Knopfdruck, wird
 * nirgends gezaehlt und traegt deshalb auch einen anderen Titel. Wer sie im
 * Kanal sieht, soll sie nicht fuer ein Ereignis halten.
 */
export function formatiereTest(kategorieLabel: string): DiscordEmbed {
  const jetzt = new Date();
  return begrenze({
    title: '🧪 SwissHub Log-Test',
    color: FARBE.info,
    fields: [
      ...feld('Kategorie', kategorieLabel),
      ...feld('Status', 'Verbindung funktioniert.'),
      ...feld('Zeit', zeitpunkt(jetzt), false),
    ],
    description: 'Dies ist **kein** Logeintrag - nur eine Prüfung dieses Kanals.',
    footer: fuss('Log-Test'),
    timestamp: jetzt.toISOString(),
  });
}

export { EMBED_LIMITS, kuerze };
