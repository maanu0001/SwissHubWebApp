import { Events, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { JAIL_COMMAND_DEFINITIONS, handleJailCommand } from './jail-commands';

const log = createLogger('bot:commands:register');

/**
 * Registrierung der Slash Commands.
 *
 * Die Befehle werden pro Guild registriert. Guild-Befehle sind sofort
 * verfügbar, während globale Befehle bis zu einer Stunde brauchen - beim
 * Wechsel des verbundenen Servers wäre das unbrauchbar.
 *
 * Die Registrierung ist idempotent: `set()` ersetzt die Liste vollständig.
 * Ein entfernter Befehl verschwindet dadurch auch auf Discord.
 */
export async function registerJailCommands(client: Client, guildId: string): Promise<boolean> {
  if (!client.application) {
    log.warn('Slash Commands können ohne Anwendungskontext nicht registriert werden.');
    return false;
  }

  try {
    await client.application.commands.set([...JAIL_COMMAND_DEFINITIONS], guildId);
    log.info('Slash Commands registriert', {
      guildId,
      commands: JAIL_COMMAND_DEFINITIONS.map((entry) => entry.name),
    });
    return true;
  } catch (error) {
    // Fehlt dem Bot `applications.commands`, ist das ein Einladungsproblem -
    // der Bot läuft trotzdem weiter, das Dashboard bleibt voll nutzbar.
    log.error(
      'Slash Commands konnten nicht registriert werden. Wurde der Bot mit dem Scope `applications.commands` eingeladen?',
      { error, guildId },
    );
    return false;
  }
}

/** Nimmt Slash-Command-Interaktionen entgegen. */
export function registerCommandHandler(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    void handleJailCommand(interaction);
  });
}
