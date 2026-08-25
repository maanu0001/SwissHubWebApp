import { prisma } from '@swisshub/database';
import type { TemporaryVoiceChannel } from '@swisshub/database';
import {
  BUTTON_STYLE,
  discord,
  type DiscordActionRow,
  type DiscordEmbed,
  type DiscordMessagePayload,
} from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';

const log = createLogger('voice-hub:panel');

/**
 * Das Bedienfeld eines Talks.
 *
 * Es steht im Textchat des Sprachkanals selbst - nicht in einem eigenen
 * `#voice-control`. Das ist der ganze Punkt: wer in seinem Talk sitzt, hat die
 * Bedienung schon vor sich und muss nirgendwo hinwechseln. Ein zentraler
 * Steuerkanal waere zudem eine Liste fremder Talks, in der man erst den
 * eigenen suchen muesste.
 *
 * Die Knopfkennungen tragen die Kanalkennung mit. Dadurch ueberleben sie jeden
 * Neustart: der Bot braucht keinen Zustand im Arbeitsspeicher, um zu wissen,
 * worauf ein Klick zielt - er liest es aus der Kennung und schlaegt den Rest
 * in der Datenbank nach.
 */

/** Praefix aller Voice-Hub-Knoepfe. */
export const VOICE_BUTTON_PREFIX = 'swisshub:voice:';

export type VoiceButtonAction =
  | 'rename'
  | 'limit'
  | 'lock'
  | 'hide'
  | 'access'
  | 'owner'
  | 'more'
  | 'delete'
  | 'delete-confirm'
  | 'allow'
  | 'deny'
  | 'kick'
  | 'bitrate'
  | 'game';

export function baueKnopfId(action: VoiceButtonAction, kanalId: string): string {
  return `${VOICE_BUTTON_PREFIX}${action}:${kanalId}`;
}

/**
 * Zerlegt eine Knopfkennung.
 *
 * Liefert `null`, wenn die Kennung nicht zu diesem Modul gehoert - andere
 * Module haben eigene Praefixe, und ein Klick dort geht diesen Handler nichts
 * an.
 */
export function leseKnopfId(customId: string): { action: string; kanalId: string } | null {
  if (!customId.startsWith(VOICE_BUTTON_PREFIX)) {
    return null;
  }
  const rest = customId.slice(VOICE_BUTTON_PREFIX.length);
  const trenner = rest.indexOf(':');
  if (trenner <= 0) {
    return null;
  }
  return { action: rest.slice(0, trenner), kanalId: rest.slice(trenner + 1) };
}

const SWISSHUB_ROT = 0xc4161c;

/** Der Zustand in Worten - Farbe allein traegt die Information nicht. */
function zugriffsText(kanal: TemporaryVoiceChannel): string {
  if (kanal.hidden && kanal.locked) {
    return 'Versteckt und gesperrt';
  }
  if (kanal.hidden) {
    return 'Versteckt';
  }
  if (kanal.locked) {
    return 'Gesperrt';
  }
  return 'Öffentlich';
}

export function baueEmbed(kanal: TemporaryVoiceChannel, anzahlZugriff: number): DiscordEmbed {
  const felder = [
    { name: '🔊 Name', value: kanal.name, inline: true },
    {
      name: '👥 Limit',
      value: kanal.userLimit === 0 ? 'Unbegrenzt' : String(kanal.userLimit),
      inline: true,
    },
    { name: '🔐 Zugriff', value: zugriffsText(kanal), inline: true },
  ];

  if (kanal.gameName) {
    felder.push({ name: '🎮 Spiel', value: kanal.gameName, inline: true });
  }
  if (anzahlZugriff > 0) {
    felder.push({
      name: '👤 Ausnahmen',
      value: `${anzahlZugriff} ${anzahlZugriff === 1 ? 'Eintrag' : 'Einträge'}`,
      inline: true,
    });
  }

  return {
    title: '🎙️ Dein SwissHub Talk',
    description: [
      `Willkommen in deinem eigenen Sprachkanal, <@${kanal.ownerDiscordId}>!`,
      '',
      'Du bist der Besitzer dieses Talks und kannst ihn hier verwalten.',
    ].join('\n'),
    color: SWISSHUB_ROT,
    fields: felder,
    footer: { text: 'Nur der Besitzer und die Serverleitung können diese Knöpfe benutzen.' },
  };
}

/**
 * Die Knoepfe.
 *
 * Discord erlaubt fuenf Knoepfe je Reihe und fuenf Reihen je Nachricht. Hier
 * sind es acht in zwei Reihen - mehr braeuchte niemand auf einen Blick, und
 * was selten vorkommt, liegt hinter «Mehr».
 */
export function baueKnoepfe(kanal: TemporaryVoiceChannel): DiscordActionRow[] {
  const id = kanal.id;
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: BUTTON_STYLE.SECONDARY,
          label: 'Umbenennen',
          emoji: { name: '✏️' },
          custom_id: baueKnopfId('rename', id),
        },
        {
          type: 2,
          style: BUTTON_STYLE.SECONDARY,
          label: 'Limit',
          emoji: { name: '👥' },
          custom_id: baueKnopfId('limit', id),
        },
        {
          type: 2,
          style: kanal.locked ? BUTTON_STYLE.SUCCESS : BUTTON_STYLE.SECONDARY,
          label: kanal.locked ? 'Entsperren' : 'Sperren',
          emoji: { name: kanal.locked ? '🔓' : '🔒' },
          custom_id: baueKnopfId('lock', id),
        },
        {
          type: 2,
          style: kanal.hidden ? BUTTON_STYLE.SUCCESS : BUTTON_STYLE.SECONDARY,
          label: kanal.hidden ? 'Zeigen' : 'Verstecken',
          emoji: { name: '👁' },
          custom_id: baueKnopfId('hide', id),
        },
      ],
    },
    {
      type: 1,
      components: [
        {
          type: 2,
          style: BUTTON_STYLE.SECONDARY,
          label: 'Zugriff',
          emoji: { name: '👤' },
          custom_id: baueKnopfId('access', id),
        },
        {
          type: 2,
          style: BUTTON_STYLE.SECONDARY,
          label: 'Übergeben',
          emoji: { name: '👑' },
          custom_id: baueKnopfId('owner', id),
        },
        {
          type: 2,
          style: BUTTON_STYLE.SECONDARY,
          label: 'Mehr',
          emoji: { name: '⚙️' },
          custom_id: baueKnopfId('more', id),
        },
        {
          type: 2,
          style: BUTTON_STYLE.DANGER,
          label: 'Löschen',
          emoji: { name: '🗑️' },
          custom_id: baueKnopfId('delete', id),
        },
      ],
    },
  ];
}

export function baueNachricht(
  kanal: TemporaryVoiceChannel,
  anzahlZugriff: number,
): DiscordMessagePayload {
  return {
    embeds: [baueEmbed(kanal, anzahlZugriff)],
    components: baueKnoepfe(kanal),
    // Der Besitzer wird im Text erwaehnt und soll die Benachrichtigung auch
    // bekommen - es ist seine Nachricht in seinem Kanal. Sonst nichts.
    allowedMentions: { parse: [], users: [kanal.ownerDiscordId] },
  };
}

/**
 * Postet das Bedienfeld in den Textchat des Sprachkanals.
 *
 * Scheitert das, ist der Talk trotzdem nutzbar - er laesst sich dann nur im
 * Dashboard verwalten. Deshalb wirft diese Funktion nicht: ein fehlendes
 * Bedienfeld ist ein Schoenheitsfehler, ein nicht entstandener Talk ist einer.
 */
export async function posteBedienfeld(kanal: TemporaryVoiceChannel): Promise<string | null> {
  if (!kanal.discordChannelId) {
    return null;
  }

  const anzahl = await prisma.temporaryVoiceAccess.count({ where: { channelId: kanal.id } });

  try {
    const nachricht = await discord.channels.send(
      kanal.discordChannelId,
      baueNachricht(kanal, anzahl),
    );
    await prisma.temporaryVoiceChannel.updateMany({
      where: { id: kanal.id, closedAt: null },
      data: { controlMessageId: nachricht.id },
    });
    return nachricht.id;
  } catch (error) {
    log.warn('Bedienfeld konnte nicht gepostet werden', {
      error: error instanceof Error ? error.message : 'unbekannt',
      channelId: kanal.discordChannelId,
    });
    return null;
  }
}

/**
 * Bringt das Bedienfeld auf den neuesten Stand.
 *
 * Wird nach jeder Aenderung aufgerufen: sperrt jemand seinen Talk, soll dort
 * «Entsperren» stehen und nicht weiter «Sperren». Ist die Nachricht
 * verschwunden - jemand hat sie geloescht -, entsteht sie neu, statt den
 * Fehler zu schlucken.
 */
export async function aktualisiereBedienfeld(kanal: TemporaryVoiceChannel): Promise<void> {
  if (!kanal.discordChannelId) {
    return;
  }
  if (!kanal.controlMessageId) {
    await posteBedienfeld(kanal);
    return;
  }

  const anzahl = await prisma.temporaryVoiceAccess.count({ where: { channelId: kanal.id } });

  try {
    await discord.channels.edit(
      kanal.discordChannelId,
      kanal.controlMessageId,
      baueNachricht(kanal, anzahl),
    );
  } catch (error) {
    log.info('Bedienfeld nicht mehr vorhanden - lege es neu an', {
      id: kanal.id,
      grund: error instanceof Error ? error.message : 'unbekannt',
    });
    await posteBedienfeld(kanal);
  }
}

/**
 * Legt das Bedienfeld neu an.
 *
 * Fuer den Fall, dass jemand die Nachricht geloescht hat. Die alte wird noch
 * einmal zu loeschen versucht - falls sie doch existiert, sollen nicht zwei
 * Bedienfelder im Kanal stehen und sich widersprechen.
 */
export async function repariereBedienfeld(kanal: TemporaryVoiceChannel): Promise<boolean> {
  if (!kanal.discordChannelId) {
    return false;
  }
  if (kanal.controlMessageId) {
    await discord.channels
      .delete(kanal.discordChannelId, kanal.controlMessageId, 'Bedienfeld wird erneuert')
      .catch(() => undefined);
  }
  const neu = await posteBedienfeld({ ...kanal, controlMessageId: null });
  return neu !== null;
}
