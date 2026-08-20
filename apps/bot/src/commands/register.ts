import { Events, type Client } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { JAIL_COMMAND_DEFINITIONS, handleJailCommand } from './jail-commands';
import {
  SPIELERSUCHE_COMMAND_DEFINITIONS,
  handleSpielersucheAutocomplete,
  handleSpielersucheCommand,
} from './spielersuche-commands';
import { LEVEL_COMMAND_DEFINITIONS, LEVEL_COMMAND_NAMES, handleLevelCommand } from './level-commands';

const log = createLogger('bot:commands:register');

/** Alle Befehle der Anwendung - eine Liste, ein Registrierungsvorgang. */
const ALL_COMMANDS = [
  ...JAIL_COMMAND_DEFINITIONS,
  ...SPIELERSUCHE_COMMAND_DEFINITIONS,
  ...LEVEL_COMMAND_DEFINITIONS,
];

const SPIELERSUCHE_COMMANDS = new Set(
  SPIELERSUCHE_COMMAND_DEFINITIONS.map((definition) => definition.name as string),
);

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
export async function registerCommands(client: Client, guildId: string): Promise<boolean> {
  if (!client.application) {
    log.warn('Slash Commands können ohne Anwendungskontext nicht registriert werden.');
    return false;
  }

  try {
    await client.application.commands.set(ALL_COMMANDS, guildId);
    log.info('Slash Commands registriert', {
      guildId,
      commands: ALL_COMMANDS.map((entry) => entry.name),
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

/**
 * Nimmt Slash-Command-Interaktionen entgegen.
 *
 * Die Zuordnung erfolgt am Befehlsnamen - jedes Modul bringt seinen eigenen
 * Adapter mit, hier wird nur verteilt.
 */
export function registerCommandHandler(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (interaction.isAutocomplete()) {
      if (SPIELERSUCHE_COMMANDS.has(interaction.commandName)) {
        void handleSpielersucheAutocomplete(interaction);
      }
      return;
    }
    if (!interaction.isChatInputCommand()) {
      return;
    }
    if (SPIELERSUCHE_COMMANDS.has(interaction.commandName)) {
      void handleSpielersucheCommand(interaction);
      return;
    }
    if (LEVEL_COMMAND_NAMES.has(interaction.commandName)) {
      void handleLevelCommand(interaction);
      return;
    }
    void handleJailCommand(interaction);
  });
}
