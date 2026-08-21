import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  MessageFlags,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError, formatSwissNumber } from '@swisshub/shared';
import { level } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './commands/context';

const log = createLogger('bot:raffle-buttons');

const R = level.raffle;

/** Zwischenschritt: bestätigen, was die Teilnahme gerade kostet. */
const CONFIRM_PREFIX = 'swisshub:xp-raffle:confirm';

/**
 * Der Mitmache-Knopf unter der Verlosungs-Ankündigung.
 *
 * Die Kennung enthält nur die Verlosungs-ID; alles Weitere wird beim Klick
 * frisch aus der Datenbank gelesen. Ein Embed, das seit Tagen im Kanal steht,
 * sagt nichts darüber aus, ob die Teilnahme noch offen ist - deshalb wird ihm
 * nichts geglaubt. Dadurch überstehen die Knöpfe auch jeden Neustart.
 *
 * Der Klick führt in dieselbe `enterRaffle`-Funktion, die auch die Webseite
 * aufruft. Es gibt keinen zweiten Preis und keine zweite Fairness-Regel je
 * nach Weg.
 */
export function registerRaffleButtons(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    if (interaction.customId.startsWith(`${CONFIRM_PREFIX}:`)) {
      void handleConfirm(interaction, interaction.customId.slice(CONFIRM_PREFIX.length + 1));
      return;
    }
    const raffleId = R.parseRaffleButtonId(interaction.customId);
    if (raffleId) {
      void handlePrompt(interaction, raffleId);
    }
  });
}

/** Zeigt die Kosten und fragt nach - abgebucht wird erst nach der Bestätigung. */
async function handlePrompt(interaction: ButtonInteraction, raffleId: string): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const actor = await buildCommandActor(interaction);
    if (!actor.can(level.LEVEL_PERMISSIONS.raffleParticipate)) {
      await interaction.editReply({ content: NO_PERMISSION });
      return;
    }

    const preview = await R.previewEntry(actor.discordId, raffleId);
    const raffle = await R.requireRaffle(raffleId);

    // Der Zustand wird hier geprüft, nicht dem Embed entnommen.
    try {
      R.assertEntryOpen(raffle);
    } catch (error) {
      await interaction.editReply({
        content: error instanceof AppError ? error.userMessage : 'D Teilnahm isch grad nid offe.',
      });
      return;
    }

    if (preview.existingEntry) {
      await interaction.editReply({
        content: `Du bisch scho debii - mit **${formatSwissNumber(preview.existingEntry.entryXp)} XP**.\n${R.raffleUrl()}`,
      });
      return;
    }

    if (!preview.affordable) {
      await interaction.editReply({
        content: `Du hesch nid gnueg XP. D Teilnahm choschtet **${formatSwissNumber(preview.cost.entryXp)} XP**, du hesch **${formatSwissNumber(preview.currentXp)} XP**.`,
      });
      return;
    }

    await interaction.editReply({
      content: R.buildEntryPrompt(raffle, preview.currentXp),
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CONFIRM_PREFIX}:${raffleId}`)
            .setStyle(ButtonStyle.Success)
            .setLabel('Teilnahme bestätige')
            .setEmoji('🎟️'),
        ),
      ],
    });
  } catch (error) {
    log.error('Teilnahme-Abfrage fehlgeschlagen', { raffleId, error });
    await reportError(interaction, error);
  }
}

/** Bucht ab und legt die Teilnahme an - über denselben Weg wie die Webseite. */
async function handleConfirm(interaction: ButtonInteraction, raffleId: string): Promise<void> {
  try {
    await interaction.deferUpdate();

    const actor = await buildCommandActor(interaction);
    if (!actor.can(level.LEVEL_PERMISSIONS.raffleParticipate)) {
      await interaction.editReply({ content: NO_PERMISSION, components: [] });
      return;
    }

    const result = await R.enterRaffle(
      {
        discordId: actor.discordId,
        username: actor.username,
        displayName:
          interaction.member && 'displayName' in interaction.member
            ? (interaction.member.displayName as string)
            : null,
        avatarHash: actor.avatarHash,
      },
      raffleId,
    );

    if (result.alreadyEntered) {
      await interaction.editReply({
        content: `Du bisch scho debii - mit **${formatSwissNumber(result.entry.entryXp)} XP**.`,
        components: [],
      });
      return;
    }

    // Die Teilnehmerzahl im Kanal nachführen - gesammelt, damit ein Ansturm
    // nicht die Discord-Grenzen reisst.
    await R.scheduleAnnouncementRefresh(raffleId);

    await interaction.editReply({
      content: [
        `🎟️ **Du bisch debii!**`,
        '',
        `Isatz: **${formatSwissNumber(result.entry.entryXp)} XP**`,
        `Dini XP: **${formatSwissNumber(result.xpAfter)} XP**`,
        `Dini Chance: **${(result.chance * 100).toFixed(2)} %**`,
        '',
        `Dini Chance cha sich no ändere, solang no Lüt derzue chömed.`,
        R.raffleUrl(),
      ].join('\n'),
      components: [],
    });
  } catch (error) {
    log.error('Teilnahme fehlgeschlagen', { raffleId, error });
    await reportError(interaction, error);
  }
}

async function reportError(interaction: ButtonInteraction, error: unknown): Promise<void> {
  const message =
    error instanceof AppError ? error.userMessage : 'Da isch öppis schief gloffe. Probier s nomal.';
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, components: [] });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Die Interaktion ist abgelaufen - dagegen lässt sich nichts mehr tun.
  }
}
