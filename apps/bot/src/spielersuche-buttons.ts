import { Events, MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError } from '@swisshub/shared';
import { spielersuche } from '@swisshub/modules';
import { buildCommandActor, NO_PERMISSION } from './commands/context';

const log = createLogger('bot:spielersuche-buttons');

/**
 * Die vier Knöpfe unter jeder Spielersuche.
 *
 * Die Knöpfe sind persistent: Discord schickt beim Klick nur die Custom ID
 * zurück, die zugehörige Suche wird über die Nachrichten-ID aus der Datenbank
 * geladen. Dadurch funktionieren sie auch nach einem Neustart des Bots und für
 * Nachrichten, die der alte Bot hinterlassen hat (dessen Custom IDs werden
 * ebenfalls erkannt).
 */
export function registerSpielersucheButtons(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const action = spielersuche.parseButtonId(interaction.customId);
    if (!action) {
      return;
    }
    void handleButton(interaction, action);
  });
}

async function handleButton(
  interaction: ButtonInteraction,
  action: spielersuche.SpielersucheButtonAction,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (action === 'help') {
      const context = await spielersuche.loadSpielersucheContext();
      await interaction.editReply(
        spielersuche.buildHelpMessage({
          footerText: context.settings.footerText,
          accentColor: context.accentColor,
          cooldownMinutes: context.settings.rolePingCooldownMinutes,
          maxActiveSearches: context.settings.maxActiveSearchesPerUser,
        }) as never,
      );
      return;
    }

    if (!interaction.message) {
      await interaction.editReply({ content: 'Die Suechi existiert nüme.' });
      return;
    }

    const match = await spielersuche.getSearchByMessage(interaction.message.id);
    if (!match) {
      // Kommt vor, wenn die Nachricht vom alten Bot stammt und die zugehörige
      // Suche nicht importiert wurde.
      await interaction.editReply({
        content: 'Die Suechi isch nöd (meh) i de Datebank. Bitte starte e neui mit `/spielersuche`.',
      });
      return;
    }

    const actor = await buildCommandActor(interaction);
    const searchActor = {
      discordId: actor.discordId,
      username: actor.username,
      avatarHash: actor.avatarHash,
    };

    if (action === 'join') {
      if (!actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.join)) {
        await interaction.editReply({ content: NO_PERMISSION });
        return;
      }
      const outcome = await spielersuche.joinSearch(match.id, searchActor);
      await interaction.editReply({ content: joinMessage(outcome, match.gameName) });
      return;
    }

    if (action === 'leave') {
      const outcome = await spielersuche.leaveSearch(match.id, searchActor);
      await interaction.editReply({ content: leaveMessage(outcome) });
      return;
    }

    // --- Beenden -----------------------------------------------------------
    const isCreator = match.creatorDiscordId === actor.discordId;
    const mayClose = isCreator
      ? actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.closeOwn)
      : actor.can(spielersuche.SPIELERSUCHE_PERMISSIONS.closeAny);

    if (!mayClose) {
      await interaction.editReply({
        content: isCreator
          ? NO_PERMISSION
          : 'Nur de Ersteller oder öpper mit de entsprechende Berächtigung chan die Suechi beende.',
      });
      return;
    }

    await spielersuche.closeSearch(match.id, {
      actor: { discordId: actor.discordId, username: actor.username },
      reason: 'BUTTON',
    });
    await interaction.editReply({ content: 'Spielersuechi beendet.' });
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.userMessage
        : 'Das het grad nöd funktioniert. Bitte spöter nomol probiere.';
    if (!(error instanceof AppError)) {
      log.error('Button konnte nicht verarbeitet werden', { error, action });
    }
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => undefined);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}

function joinMessage(outcome: spielersuche.JoinOutcome, gameName: string): string {
  switch (outcome.result) {
    case 'joined':
      return outcome.complete
        ? `Du bisch debii! D Gruppe für **${gameName}** isch jetzt komplett. 🎉`
        : `Du bisch debii! Du bisch zu **${gameName}** hinzuegfüegt worde. 🎮`;
    case 'already-in':
      return 'Du bisch bereits Teil vo dere Gruppe.';
    case 'full':
      return 'D Gruppe isch scho voll - aktuell isch kei Platz meh frei.';
    default:
      return 'Die Suechi isch bereits beendet.';
  }
}

function leaveMessage(outcome: spielersuche.LeaveOutcome): string {
  switch (outcome.result) {
    case 'left':
      return 'Du bisch us dere Suechi entfernt worde.';
    case 'creator':
      return 'Ersteller chan nöd ustrette. Beend die Suechi stattdesse über **Suechi beende**.';
    case 'not-in':
      return 'Du bisch gar nöd Teil vo dere Gruppe.';
    default:
      return 'Die Suechi isch bereits beendet.';
  }
}
