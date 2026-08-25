import {
  ActionRowBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { voice, voiceHub } from '@swisshub/modules';
import { buildCommandActor } from './commands/context';

const log = createLogger('bot:voice-interactions');

/**
 * Die Knoepfe des Bedienfelds.
 *
 * Jeder Klick geht denselben Weg: Kennung lesen, Talk laden, Zugriff pruefen,
 * Aktion ausfuehren. Die Pruefung liegt in `voiceHub.*` und ist dieselbe, die
 * das Dashboard benutzt - hier steht kein zweites Regelwerk.
 *
 * Wer nicht darf, bekommt eine Antwort, die nur er sieht. Eine oeffentliche
 * Fehlermeldung im Kanal waere eine kleine Blossstellung und obendrein eine
 * Auskunft darueber, wem der Talk gehoert.
 */

const MODAL_RENAME = 'swisshub:voice:modal:rename:';
const MODAL_LIMIT = 'swisshub:voice:modal:limit:';
const MODAL_BITRATE = 'swisshub:voice:modal:bitrate:';
const MODAL_GAME = 'swisshub:voice:modal:game:';
const SELECT_ALLOW = 'swisshub:voice:select:allow:';
const SELECT_DENY = 'swisshub:voice:select:deny:';
const SELECT_KICK = 'swisshub:voice:select:kick:';
const SELECT_OWNER = 'swisshub:voice:select:owner:';
const SELECT_MORE = 'swisshub:voice:select:more:';

export function registerVoiceInteractions(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isButton()) {
      if (voiceHub.leseKnopfId(interaction.customId)) {
        void behandleKnopf(interaction).catch((error: unknown) =>
          melde(interaction, error),
        );
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('swisshub:voice:modal:')) {
      void behandleModal(interaction).catch((error: unknown) => melde(interaction, error));
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('swisshub:voice:select:')) {
      void behandleMitgliedAuswahl(interaction).catch((error: unknown) =>
        melde(interaction, error),
      );
      return;
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith(SELECT_MORE)
    ) {
      void behandleMehr(interaction).catch((error: unknown) => melde(interaction, error));
    }
  });
}

/** Der Kontext einer Aktion - Rechte aus demselben System wie ueberall. */
async function kontextVon(
  interaction: ButtonInteraction | ModalSubmitInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction,
): Promise<voiceHub.AktionsKontext> {
  const actor = await buildCommandActor(interaction);
  return {
    viewer: { discordId: actor.discordId, can: (recht) => actor.can(recht) },
    actor: { discordId: actor.discordId, username: actor.username, source: 'DISCORD' },
  };
}

async function behandleKnopf(interaction: ButtonInteraction): Promise<void> {
  const gelesen = voiceHub.leseKnopfId(interaction.customId);
  if (!gelesen) {
    return;
  }
  const { action, kanalId } = gelesen;
  const kontext = await kontextVon(interaction);

  switch (action) {
    case 'rename':
      return zeigeTextModal(interaction, {
        customId: MODAL_RENAME + kanalId,
        titel: 'Talk umbenennen',
        feld: 'name',
        label: 'Neuer Name',
        max: 100,
        stil: TextInputStyle.Short,
      });

    case 'limit':
      return zeigeTextModal(interaction, {
        customId: MODAL_LIMIT + kanalId,
        titel: 'Teilnehmerlimit',
        feld: 'limit',
        label: 'Maximale Teilnehmer (0 = unbegrenzt)',
        max: 2,
        stil: TextInputStyle.Short,
      });

    case 'lock': {
      const kanal = await ladeFuerAnzeige(kontext, kanalId);
      const neu = await voiceHub.setTalkLocked(kontext, kanalId, !kanal.locked);
      return kurzeAntwort(
        interaction,
        neu.locked
          ? '🔒 Dein Talk isch gsperrt. Wer scho dinne isch, blibt dinne.'
          : '🔓 Dein Talk isch wieder offe.',
      );
    }

    case 'hide': {
      const kanal = await ladeFuerAnzeige(kontext, kanalId);
      const neu = await voiceHub.setTalkHidden(kontext, kanalId, !kanal.hidden);
      return kurzeAntwort(
        interaction,
        neu.hidden ? '👁 Dein Talk isch versteckt.' : '👁 Dein Talk isch wieder sichtbar.',
      );
    }

    case 'access':
      return zeigeZugriffsAuswahl(interaction, kanalId);

    case 'owner':
      return zeigeMitgliedAuswahl(interaction, {
        customId: SELECT_OWNER + kanalId,
        text: 'Wem söll de Talk ghöre?',
      });

    case 'more':
      return zeigeMehr(interaction, kanalId);

    case 'delete':
      return frageLoeschenNach(interaction, kanalId);

    case 'delete-confirm': {
      await voiceHub.deleteTalk(kontext, kanalId);
      return kurzeAntwort(interaction, '🗑️ Dein Talk isch gschlosse.');
    }

    case 'bitrate':
      return zeigeTextModal(interaction, {
        customId: MODAL_BITRATE + kanalId,
        titel: 'Bitrate',
        feld: 'bitrate',
        label: 'Bitrate in kbit/s',
        max: 3,
        stil: TextInputStyle.Short,
      });

    case 'game':
      return zeigeTextModal(interaction, {
        customId: MODAL_GAME + kanalId,
        titel: 'Spiel setzen',
        feld: 'game',
        label: 'Was spielt ihr? (leer = entfernen)',
        max: 60,
        stil: TextInputStyle.Short,
        pflicht: false,
      });

    default:
      return;
  }
}

/**
 * Laedt den Talk fuer die Anzeige.
 *
 * Auch hier ueber die Zugriffspruefung: der Zustand eines fremden Talks geht
 * niemanden etwas an, und die Umschaltknoepfe brauchen ihn.
 */
async function ladeFuerAnzeige(kontext: voiceHub.AktionsKontext, kanalId: string) {
  const { resolveGuildId } = await import('@swisshub/discord');
  const guildId = await resolveGuildId();
  const { kanal } = await voiceHub.ladeKanalMitZugriff(kontext.viewer, kanalId, guildId);
  return kanal;
}

// --- Modale ----------------------------------------------------------------

async function zeigeTextModal(
  interaction: ButtonInteraction,
  optionen: {
    customId: string;
    titel: string;
    feld: string;
    label: string;
    max: number;
    stil: TextInputStyle;
    pflicht?: boolean;
  },
): Promise<void> {
  const eingabe = new TextInputBuilder()
    .setCustomId(optionen.feld)
    .setLabel(optionen.label)
    .setStyle(optionen.stil)
    .setMaxLength(optionen.max)
    .setRequired(optionen.pflicht ?? true);

  const modal = new ModalBuilder()
    .setCustomId(optionen.customId)
    .setTitle(optionen.titel)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(eingabe));

  await interaction.showModal(modal);
}

async function behandleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const kontext = await kontextVon(interaction);
  const { customId } = interaction;

  if (customId.startsWith(MODAL_RENAME)) {
    const kanalId = customId.slice(MODAL_RENAME.length);
    const name = interaction.fields.getTextInputValue('name');
    const neu = await voiceHub.renameTalk(kontext, kanalId, name);
    return kurzeAntwort(interaction, `✏️ Dein Talk heisst jetzt **${neu.name}**.`);
  }

  if (customId.startsWith(MODAL_LIMIT)) {
    const kanalId = customId.slice(MODAL_LIMIT.length);
    const roh = interaction.fields.getTextInputValue('limit').trim();
    const limit = Number.parseInt(roh, 10);
    if (!Number.isFinite(limit)) {
      return kurzeAntwort(interaction, '❌ Bitte e Zahl vo 0 bis 99 iigäh.');
    }
    const neu = await voiceHub.setTalkLimit(kontext, kanalId, limit);
    return kurzeAntwort(
      interaction,
      neu.userLimit === 0
        ? '👥 Dein Talk het kei Limit meh.'
        : `👥 Dein Talk fasst jetzt **${neu.userLimit}** Lüt.`,
    );
  }

  if (customId.startsWith(MODAL_BITRATE)) {
    const kanalId = customId.slice(MODAL_BITRATE.length);
    const kbit = Number.parseInt(interaction.fields.getTextInputValue('bitrate').trim(), 10);
    if (!Number.isFinite(kbit)) {
      return kurzeAntwort(interaction, '❌ Bitte e Zahl iigäh.');
    }
    await voiceHub.setTalkBitrate(kontext, kanalId, kbit * 1000);
    return kurzeAntwort(interaction, `🎚️ Bitrate uf **${kbit} kbit/s** gsetzt.`);
  }

  if (customId.startsWith(MODAL_GAME)) {
    const kanalId = customId.slice(MODAL_GAME.length);
    const spiel = interaction.fields.getTextInputValue('game').trim();
    await voiceHub.setTalkGame(kontext, kanalId, spiel === '' ? null : spiel);
    return kurzeAntwort(
      interaction,
      spiel === '' ? '🎮 Spiel entfernt.' : `🎮 Spiel uf **${spiel}** gsetzt.`,
    );
  }
}

// --- Auswahl von Mitgliedern -----------------------------------------------

async function zeigeMitgliedAuswahl(
  interaction: ButtonInteraction,
  optionen: { customId: string; text: string },
): Promise<void> {
  const auswahl = new UserSelectMenuBuilder()
    .setCustomId(optionen.customId)
    .setPlaceholder('Mitglied wähle')
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.reply({
    content: optionen.text,
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(auswahl)],
    flags: MessageFlags.Ephemeral,
  });
}

async function zeigeZugriffsAuswahl(
  interaction: ButtonInteraction,
  kanalId: string,
): Promise<void> {
  const auswahl = new StringSelectMenuBuilder()
    .setCustomId(SELECT_MORE + kanalId)
    .setPlaceholder('Was möchtsch mache?')
    .addOptions(
      { label: 'Mitglied zuelah', value: 'allow', emoji: { name: '✅' } },
      { label: 'Mitglied sperre', value: 'deny', emoji: { name: '⛔' } },
      { label: 'Mitglied usem Talk näh', value: 'kick', emoji: { name: '👋' } },
    );

  await interaction.reply({
    content: '👤 Zuegriff verwalte:',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(auswahl)],
    flags: MessageFlags.Ephemeral,
  });
}

async function zeigeMehr(interaction: ButtonInteraction, kanalId: string): Promise<void> {
  const auswahl = new StringSelectMenuBuilder()
    .setCustomId(SELECT_MORE + kanalId)
    .setPlaceholder('Wyteri Iistellige')
    .addOptions(
      { label: 'Bitrate ändere', value: 'bitrate', emoji: { name: '🎚️' } },
      { label: 'Spiel setze', value: 'game', emoji: { name: '🎮' } },
      { label: 'Bedienfeld erneuere', value: 'repair', emoji: { name: '🔄' } },
    );

  await interaction.reply({
    content: '⚙️ Wyteri Iistellige:',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(auswahl)],
    flags: MessageFlags.Ephemeral,
  });
}

async function behandleMehr(interaction: StringSelectMenuInteraction): Promise<void> {
  const kanalId = interaction.customId.slice(SELECT_MORE.length);
  const wahl = interaction.values[0];
  const kontext = await kontextVon(interaction);

  switch (wahl) {
    case 'allow':
      return zeigeAuswahlNachWahl(interaction, SELECT_ALLOW + kanalId, 'Wär söll dörfe iine?');
    case 'deny':
      return zeigeAuswahlNachWahl(interaction, SELECT_DENY + kanalId, 'Wär söll gsperrt werde?');
    case 'kick':
      return zeigeAuswahlNachWahl(interaction, SELECT_KICK + kanalId, 'Wär söll use?');
    case 'bitrate':
      // Ein Modal laesst sich aus einer Auswahl heraus oeffnen - anders als
      // aus einer bereits beantworteten Interaktion.
      return zeigeTextModalAusAuswahl(interaction, {
        customId: MODAL_BITRATE + kanalId,
        titel: 'Bitrate',
        feld: 'bitrate',
        label: 'Bitrate in kbit/s',
        max: 3,
      });
    case 'game':
      return zeigeTextModalAusAuswahl(interaction, {
        customId: MODAL_GAME + kanalId,
        titel: 'Spiel setzen',
        feld: 'game',
        label: 'Was spielt ihr? (leer = entfernen)',
        max: 60,
        pflicht: false,
      });
    case 'repair': {
      const ok = await voiceHub.repairTalkPanel(kontext, kanalId);
      return kurzeAntwort(
        interaction,
        ok ? '🔄 Bedienfeld isch erneueret.' : '❌ Bedienfeld het nöd chöne erstellt werde.',
      );
    }
    default:
      return;
  }
}

async function zeigeAuswahlNachWahl(
  interaction: StringSelectMenuInteraction,
  customId: string,
  text: string,
): Promise<void> {
  const auswahl = new UserSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Mitglied wähle')
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.update({
    content: text,
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(auswahl)],
  });
}

async function zeigeTextModalAusAuswahl(
  interaction: StringSelectMenuInteraction,
  optionen: { customId: string; titel: string; feld: string; label: string; max: number; pflicht?: boolean },
): Promise<void> {
  const eingabe = new TextInputBuilder()
    .setCustomId(optionen.feld)
    .setLabel(optionen.label)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(optionen.max)
    .setRequired(optionen.pflicht ?? true);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(optionen.customId)
      .setTitle(optionen.titel)
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(eingabe)),
  );
}

async function behandleMitgliedAuswahl(interaction: UserSelectMenuInteraction): Promise<void> {
  const kontext = await kontextVon(interaction);
  const zielId = interaction.values[0];
  if (!zielId) {
    return;
  }
  const ziel = interaction.users.get(zielId);
  const zielName = ziel?.username ?? null;
  const { customId } = interaction;

  if (customId.startsWith(SELECT_ALLOW)) {
    const kanalId = customId.slice(SELECT_ALLOW.length);
    await voiceHub.allowInTalk(kontext, kanalId, { discordId: zielId, username: zielName });
    return aktualisiere(interaction, `✅ <@${zielId}> darf jetzt iine.`);
  }

  if (customId.startsWith(SELECT_DENY)) {
    const kanalId = customId.slice(SELECT_DENY.length);
    // Sperren wirft niemanden hinaus. Wer schon drin ist, bleibt - dass er
    // beim naechsten Mal nicht mehr hereinkommt, ist die Wirkung.
    const { entfernt } = await voiceHub.denyInTalk(
      kontext,
      kanalId,
      { discordId: zielId, username: zielName },
      { auchEntfernen: true },
    );
    return aktualisiere(
      interaction,
      entfernt
        ? `⛔ <@${zielId}> isch gsperrt und usem Talk gnoh.`
        : `⛔ <@${zielId}> isch gsperrt.`,
    );
  }

  if (customId.startsWith(SELECT_KICK)) {
    const kanalId = customId.slice(SELECT_KICK.length);
    const entfernt = await voiceHub.kickFromTalk(kontext, kanalId, zielId);
    return aktualisiere(
      interaction,
      entfernt ? `👋 <@${zielId}> isch usem Talk gnoh.` : '❌ Die Person isch gar nöd im Talk.',
    );
  }

  if (customId.startsWith(SELECT_OWNER)) {
    const kanalId = customId.slice(SELECT_OWNER.length);
    await voiceHub.transferTalk(kontext, kanalId, {
      discordId: zielId,
      username: zielName ?? 'Unbekannt',
    });
    return aktualisiere(interaction, `👑 De Talk ghört jetzt <@${zielId}>.`);
  }
}

// --- Loeschen --------------------------------------------------------------

async function frageLoeschenNach(interaction: ButtonInteraction, kanalId: string): Promise<void> {
  const kontext = await kontextVon(interaction);
  const kanal = await ladeFuerAnzeige(kontext, kanalId);

  const drin = kanal.discordChannelId ? await voice.menschenImKanal(kanal.discordChannelId) : 0;

  await interaction.reply({
    content:
      drin > 1
        ? `⚠️ Es sind no **${drin}** Lüt im Talk. Wirklich lösche?`
        : 'Wirklich dein Talk lösche?',
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: 'Ja, lösche',
            custom_id: voiceHub.baueKnopfId('delete-confirm', kanalId),
          },
        ],
      },
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// --- Antworten -------------------------------------------------------------

async function kurzeAntwort(
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  text: string,
): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}

async function aktualisiere(interaction: UserSelectMenuInteraction, text: string): Promise<void> {
  await interaction.update({ content: text, components: [] });
}

/**
 * Meldet einen Fehler - nur dem Klickenden.
 *
 * Erwartete Fehler tragen eine Nachricht in der Sprache des Mitglieds; alles
 * andere bekommt eine allgemeine Antwort, damit keine internen Angaben nach
 * aussen gelangen.
 */
async function melde(
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | UserSelectMenuInteraction
    | StringSelectMenuInteraction,
  error: unknown,
): Promise<void> {
  const text =
    error instanceof AppError
      ? `❌ ${error.userMessage}`
      : '❌ Das het leider nöd klappt. Bitte spöter nomol probiere.';

  if (!(error instanceof AppError)) {
    log.error('Voice-Interaktion fehlgeschlagen', {
      error: error instanceof Error ? error.message : 'unbekannt',
      customId: interaction.customId,
    });
  }

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Die Interaktion ist abgelaufen - dann bleibt nichts zu tun.
  }
}
