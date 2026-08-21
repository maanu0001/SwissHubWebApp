import { randomUUID } from 'node:crypto';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { communication, isModuleEnabled } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './context';

const log = createLogger('bot:commands:communication');

/**
 * `/post` - der Nachfolger des alten Kommunikationsbots.
 *
 * Der Ablauf bleibt derselbe: Befehl mit Channel, Erwähnung, Person und
 * Banner, danach ein Modal mit Titel, Nachricht, Treffpunkt, Datum und
 * "Ahmäldig via".
 *
 * Was sich geändert hat, liegt darunter: Diese Datei enthält keine
 * Embed-Logik mehr. Sie ruft denselben `sendEvent`-Service auf wie das
 * Dashboard, prüft über die zentrale Berechtigungsengine statt gegen eine
 * fest eingetragene Rollen-ID, und der Ticket-Channel sowie das
 * Standardbanner kommen aus den Einstellungen - nicht mehr aus dem Quelltext.
 */

const MODULE = communication.COMMUNICATION_MODULE_ID;

/** Feste Kennung, damit das Modal einen Neustart des Bots übersteht. */
const MODAL_PREFIX = 'swisshub:communication:post';

export const COMMUNICATION_COMMAND_DEFINITIONS = [
  {
    name: 'post',
    description: 'Erstellt es Event-Embed im gwünschte Kanal.',
    dmPermission: false,
    options: [
      {
        name: 'kanal',
        description: 'Kanal i dem das Embed posted werde sött',
        type: ApplicationCommandOptionType.Channel,
        required: true,
        channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      },
      {
        name: 'mention',
        description: 'Wer söll benachrichtigt werde?',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'Niemer', value: 'none' },
          { name: '@everyone', value: 'everyone' },
          { name: '@here', value: 'here' },
        ],
      },
      {
        name: 'rolle',
        description: 'Rolle wo benachrichtigt wird (statt @everyone/@here)',
        type: ApplicationCommandOptionType.Role,
        required: false,
      },
      {
        name: 'person',
        description: 'Optionali verantwortlichi Person',
        type: ApplicationCommandOptionType.User,
        required: false,
      },
      {
        name: 'img_url',
        description: 'Optionali URL vomene Banner-Bild',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
] as const;

export const COMMUNICATION_COMMAND_NAMES = new Set(
  COMMUNICATION_COMMAND_DEFINITIONS.map((definition) => definition.name as string),
);

export const isCommunicationModal = (customId: string): boolean => customId.startsWith(`${MODAL_PREFIX}:`);

/**
 * Was der Befehl mitbekommen hat, wandert durch die Modal-Kennung.
 *
 * Discord gibt beim Absenden des Modals nur diese Zeichenkette zurück. Die
 * Auswahl aus dem Befehl muss deshalb entweder hier hineinpassen oder erneut
 * abgefragt werden - und alle Werte sind ohnehin nur IDs.
 */
interface PostContext {
  channelId: string;
  mention: 'none' | 'everyone' | 'here' | 'role';
  mentionTarget: string;
  responsibleId: string;
  bannerUrl: string;
}

const encodeContext = (context: PostContext): string =>
  [
    MODAL_PREFIX,
    context.channelId,
    context.mention,
    context.mentionTarget || '-',
    context.responsibleId || '-',
    // Die Adresse kann Doppelpunkte enthalten und wird deshalb kodiert.
    context.bannerUrl ? encodeURIComponent(context.bannerUrl) : '-',
  ].join(':');

function decodeContext(customId: string): PostContext | null {
  const parts = customId.split(':');
  // `swisshub`, `communication`, `post`, dann fünf Werte.
  if (parts.length !== 8) {
    return null;
  }
  const [, , , channelId, mention, mentionTarget, responsibleId, banner] = parts;
  if (!channelId || !mention) {
    return null;
  }
  return {
    channelId,
    mention: mention as PostContext['mention'],
    mentionTarget: mentionTarget === '-' ? '' : (mentionTarget ?? ''),
    responsibleId: responsibleId === '-' ? '' : (responsibleId ?? ''),
    bannerUrl: banner && banner !== '-' ? decodeURIComponent(banner) : '',
  };
}

/** Öffnet das Modal - wie beim Vorgänger. */
export async function handleCommunicationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!(await isModuleEnabled(MODULE))) {
      await interaction.reply({
        content: 'S Kommunikationsmodul isch grad deaktiviert.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const actor = await buildCommandActor(interaction);
    // Keine fest eingetragene Rollen-ID mehr - dieselbe Berechtigung wie im
    // Dashboard entscheidet.
    if (!actor.can(communication.COMMUNICATION_PERMISSIONS.event)) {
      await interaction.reply({ content: NO_PERMISSION, flags: MessageFlags.Ephemeral });
      return;
    }

    const channel = interaction.options.getChannel('kanal', true);
    const role = interaction.options.getRole('rolle');
    const chosen = interaction.options.getString('mention') ?? 'none';
    const person = interaction.options.getUser('person');
    const banner = interaction.options.getString('img_url') ?? '';

    if (banner) {
      const issue = communication.validateBannerUrl(banner);
      if (issue) {
        await interaction.reply({ content: `Banner: ${issue}`, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    const context: PostContext = {
      channelId: channel.id,
      mention: role ? 'role' : (chosen as PostContext['mention']),
      mentionTarget: role?.id ?? '',
      // Wie beim Vorgänger: ohne Auswahl gilt, wer den Befehl ausgeführt hat.
      responsibleId: person?.id ?? interaction.user.id,
      bannerUrl: banner,
    };

    const modal = new ModalBuilder()
      .setCustomId(encodeContext(context))
      .setTitle('Event-Details')
      .addComponents(
        row('titel', 'Titel', TextInputStyle.Short, true, 'Titel vom Event'),
        row('nachricht', 'Nachricht', TextInputStyle.Paragraph, true, 'Beschriibig / Info-Text'),
        row('treffpunkt', 'Treffpunkt', TextInputStyle.Short, true, 'Wo findet das Ganze statt?'),
        row('datum', 'Datum/Uhrziit', TextInputStyle.Short, true, 'z.B. 01.01.2026 18:00 Uhr'),
        row('anmeldung', 'Ahmäldig via', TextInputStyle.Short, false, 'ticket / leer / oder Freitext'),
      );

    await interaction.showModal(modal);
  } catch (error) {
    log.error('/post konnte nicht geöffnet werden', { error });
    await reply(interaction, 'Da isch öppis schief gloffe.');
  }
}

const row = (
  id: string,
  label: string,
  style: TextInputStyle,
  required: boolean,
  placeholder: string,
): ActionRowBuilder<TextInputBuilder> =>
  new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(style)
      .setRequired(required)
      .setPlaceholder(placeholder)
      .setMaxLength(style === TextInputStyle.Paragraph ? 3000 : 200),
  );

/**
 * Nimmt das ausgefüllte Modal entgegen und sendet über den zentralen Service.
 *
 * Ab hier unterscheidet sich `/post` in nichts mehr vom Dashboard: dieselbe
 * Validierung, derselbe Embed-Bauplan, derselbe Verlauf, dasselbe Audit.
 */
export async function handleCommunicationModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const context = decodeContext(interaction.customId);
    if (!context) {
      await interaction.editReply({ content: 'Die Eingab isch nüme gültig. Probier `/post` nomal.' });
      return;
    }

    const actor = await buildCommandActor(interaction);
    if (!actor.can(communication.COMMUNICATION_PERMISSIONS.event)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    const anmeldung = interaction.fields.getTextInputValue('anmeldung').trim();
    const datum = interaction.fields.getTextInputValue('datum').trim();

    const parsed = communication.sendEventSchema.safeParse({
      channelId: context.channelId,
      title: interaction.fields.getTextInputValue('titel'),
      content: interaction.fields.getTextInputValue('nachricht'),
      location: interaction.fields.getTextInputValue('treffpunkt'),
      // Das Modal kennt keinen Datumsauswähler. Was sich als Datum lesen
      // lässt, wird zum Zeitstempel - alles andere bleibt Text, genau wie
      // beim Vorgänger.
      ...datumFelder(datum),
      responsibleDiscordId: context.responsibleId || undefined,
      bannerUrl: context.bannerUrl || undefined,
      mention: context.mention,
      mentionTarget: context.mentionTarget || undefined,
      ...anmeldungFelder(anmeldung),
      idempotencyKey: randomUUID(),
      correlationId: `post:${interaction.id}`,
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      await interaction.editReply({
        content: `Das het nöd klappt: ${first?.message ?? 'Ungültigi Iigab.'}`,
      });
      return;
    }

    const result = await communication.sendEvent(
      parsed.data,
      {
        discordId: actor.discordId,
        username: actor.username,
        avatarHash: actor.avatarHash,
        permissionKeys: actor.permissionKeys,
        isOwner: actor.isOwner,
      },
      { source: 'SLASH_COMMAND', correlationId: `post:${interaction.id}` },
    );

    const lines = [`Dis Event isch erfolgriich in <#${context.channelId}> posted worde!`];
    for (const warning of result.warnings) {
      lines.push(`⚠️ ${warning}`);
    }
    await interaction.editReply({ content: lines.join('\n') });
  } catch (error) {
    log.error('/post konnte nicht gesendet werden', { error });
    await interaction.editReply({
      content: error instanceof AppError ? error.userMessage : 'Das Event het nöd chönne gsendet werde.',
    });
  }
}

/**
 * Das Sonderwort `ticket` aus dem alten Bot.
 *
 * Dort zeigte es auf eine fest im Quelltext eingetragene Channel-ID. Hier
 * wählt es die Anmeldungsart "Ticket"; welcher Channel gemeint ist, steht in
 * den Einstellungen.
 */
function anmeldungFelder(value: string): {
  registrationType: 'NONE' | 'TEXT' | 'TICKET';
  registrationValue?: string;
} {
  if (!value) {
    return { registrationType: 'NONE' };
  }
  if (value.toLowerCase() === 'ticket') {
    return { registrationType: 'TICKET' };
  }
  return { registrationType: 'TEXT', registrationValue: value };
}

/**
 * Versucht, aus dem Text ein echtes Datum zu lesen.
 *
 * Gelingt das, sieht jedes Mitglied auf Discord seine eigene lokale Zeit.
 * Gelingt es nicht, wird der Text unverändert übernommen - lieber die Angabe
 * der Person als eine falsch geratene Zeit.
 */
export function datumFelder(value: string): { startsAt?: string; startsAtText?: string } {
  const parsed = parseSwissDate(value);
  return parsed ? { startsAt: parsed.toISOString() } : { startsAtText: value };
}

/** Erkennt `TT.MM.JJJJ HH:MM` - die Schreibweise aus dem Platzhalter des Vorgängers. */
function parseSwissDate(value: string): Date | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:um\s*)?(\d{1,2})[:.](\d{2})/u.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, day, month, year, hour, minute] = match;
  const naive = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)),
  );
  if (Number.isNaN(naive.getTime())) {
    return null;
  }

  // `Date.UTC` rollt unmögliche Angaben still weiter: aus dem 32. Januar wird
  // der 1. Februar, aus dem 31. April der 1. Mai. Wer so etwas eintippt, hat
  // sich vertan - dann bleibt der Text lieber stehen, als dass ein falsches
  // Datum im Kanal landet.
  if (
    naive.getUTCDate() !== Number(day) ||
    naive.getUTCMonth() !== Number(month) - 1 ||
    naive.getUTCHours() !== Number(hour)
  ) {
    return null;
  }

  // Europe/Zurich: im Sommer UTC+2, im Winter UTC+1. Der Versatz wird über
  // die Zeitzonenangabe ermittelt, statt ihn zu raten.
  const offsetMinutes = zurichOffsetMinutes(naive);
  const utc = new Date(naive.getTime() - offsetMinutes * 60_000);
  return Number.isNaN(utc.getTime()) ? null : utc;
}

/** Versatz von Europe/Zurich gegenüber UTC, in Minuten, zum gegebenen Zeitpunkt. */
function zurichOffsetMinutes(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    timeZoneName: 'longOffset',
  });
  const part = formatter.formatToParts(date).find((entry) => entry.type === 'timeZoneName');
  const match = /GMT([+-])(\d{2}):(\d{2})/u.exec(part?.value ?? '');
  if (!match) {
    return 60;
  }
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

async function reply(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Die Interaktion ist abgelaufen - dagegen lässt sich nichts mehr tun.
  }
}
