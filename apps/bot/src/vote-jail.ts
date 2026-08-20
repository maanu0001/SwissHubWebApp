import { Events, MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { loadRoleConfiguration, resolvePermissions, hasPermission } from '@swisshub/permissions';
import { bootstrapConfig } from '@swisshub/config';
import { jail } from '@swisshub/modules';

const log = createLogger('bot:vote-jail');

/**
 * Button-Klicks der Vote-Jail-Abstimmungen.
 *
 * Die Stimmzählung selbst liegt im Modul (`castVote`) und ist dort
 * transaktional abgesichert. Hier geht es nur um die Discord-Seite:
 * Interaktion entgegennehmen, Berechtigung des Klickenden bestimmen, Ergebnis
 * zurückmelden und das Embed aktualisieren.
 */
export function registerVoteJailHandler(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const voteJailId = jail.parseVoteButtonId(interaction.customId);
    if (!voteJailId) {
      return;
    }
    void handleVote(interaction, voteJailId);
  });
}

async function handleVote(interaction: ButtonInteraction, voteJailId: string): Promise<void> {
  try {
    // Sofort bestätigen: Discord erwartet innerhalb von 3 Sekunden eine
    // Antwort, die Verarbeitung kann länger dauern.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const canMultivote = await mayVoteMultipleTimes(interaction);
    const outcome = await jail.castVote(voteJailId, {
      discordId: interaction.user.id,
      username: interaction.user.username,
      canMultivote,
    });

    switch (outcome.result) {
      case 'not-active':
        await interaction.editReply({ content: 'Die Abstimmung ist bereits beendet.' });
        return;

      case 'self-vote':
        await interaction.editReply({ content: 'Du chasch nöd über dich selber abstimme.' });
        return;

      case 'already-voted':
        await interaction.editReply({
          content: 'Du hesch für das Voting bereits abgstimmt.',
        });
        return;

      case 'counted': {
        await interaction.editReply({
          content: canMultivote
            ? `Stimm gezählt - aktuell ${outcome.votes} / ${outcome.vote.requiredVotes}.`
            : `Danke, dini Stimm isch zählt: ${outcome.votes} / ${outcome.vote.requiredVotes}.`,
        });

        if (outcome.reachedThreshold) {
          // Schwelle erreicht: Jail ausführen und Embed final aktualisieren.
          // `castVote` hat den Status bereits in derselben Transaktion
          // umgestellt, deshalb kann das hier nur einmal passieren.
          await jail.completeSuccessfulVote(voteJailId);
        } else {
          await jail.updateVoteMessage(outcome.vote);
        }
        return;
      }

      default:
        return;
    }
  } catch (error) {
    log.error('Vote-Klick konnte nicht verarbeitet werden', { error, voteJailId });
    const message = 'Dini Stimm chonnt grad nöd verarbeitet werde. Bitte spöter nomol.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => undefined);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  }
}

/**
 * Darf dieses Mitglied mehrfach stimmen?
 *
 * Massgeblich ist ausschliesslich das bestehende Permission-System
 * (`jail.vote.multivote`, `admin.full` oder die Owner-ID) - es gibt keine
 * hart codierte Adminliste.
 */
async function mayVoteMultipleTimes(interaction: ButtonInteraction): Promise<boolean> {
  const roleIds =
    interaction.member && 'roles' in interaction.member && 'cache' in interaction.member.roles
      ? [...interaction.member.roles.cache.keys()]
      : [];

  const configuration = await loadRoleConfiguration();
  const resolution = resolvePermissions(
    {
      discordId: interaction.user.id,
      roleIds,
      isOwner: bootstrapConfig.ownerDiscordId === interaction.user.id,
    },
    configuration.mappings,
  );

  return hasPermission(resolution, jail.JAIL_PERMISSIONS.voteMultivote);
}
