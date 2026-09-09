import {
  ApplicationCommandOptionType,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AUDIT_ACTIONS, recordAudit } from '@swisshub/database';
import { discord } from '@swisshub/discord';
import { isModuleEnabled, automation as automationModul } from '@swisshub/modules';
import { listeDiscordStartbare, starte, holeAutomation } from '@swisshub/automation';
import type { Automation } from '@swisshub/database';
import { buildCommandActor } from './context';

const log = createLogger('bot:commands:automation');

/**
 * `/automation` - eine Automation direkt aus Discord starten.
 *
 * Bisher liess sich eine Automation nur im Dashboard oder durch ein Ereignis
 * ausloesen. Das Team arbeitet aber in Discord; wer dort etwas anstossen will,
 * musste die Weboberflaeche oeffnen.
 *
 * ## Wer darf
 *
 * Nicht wer eine Dashboard-Berechtigung hat, sondern wer eine Rolle traegt,
 * die **an der Automation selbst** freigegeben ist. Das ist der Unterschied
 * zu `/jail` und den uebrigen Befehlen: dort entscheidet die Permission
 * Engine, hier die Automation. Beides waere hier falsch zusammengefasst -
 * eine Automation soll gerade einem Team ohne Dashboard-Zugang einen
 * einzelnen Knopf geben duerfen.
 *
 * ## Die Vorschlagsliste ist keine Sicherheitsgrenze
 *
 * Discord schickt den getippten Wert, auch wenn er nie vorgeschlagen wurde.
 * Die Ausfuehrung prueft die Rollen deshalb noch einmal - mit derselben
 * Funktion, die auch die Liste erzeugt. Zwei Pruefungen an zwei Stellen waeren
 * zwei Gelegenheiten, sie auseinanderlaufen zu lassen.
 */

const MODULE = automationModul.AUTOMATION_MODULE_ID;

/** Woher der Lauf kam - steht in der Pruefspur. */
export const DISCORD_QUELLE = 'DISCORD_COMMAND';

export const AUTOMATION_COMMAND_DEFINITIONS = [
  {
    name: 'automation',
    description: 'Start e freigäbeni Automation.',
    dmPermission: false,
    options: [
      {
        name: 'name',
        description: 'Weli Automation?',
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: true,
      },
      {
        name: 'probelauf',
        description: 'Nur zeige, was passiere würd - ohni öppis z tue.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
] as const;

export const AUTOMATION_COMMAND_NAMES = new Set(
  AUTOMATION_COMMAND_DEFINITIONS.map((definition) => definition.name as string),
);

/**
 * Die Vorschlagsliste.
 *
 * Discord erwartet die Antwort innerhalb von drei Sekunden - deshalb ohne
 * Umwege und mit einer harten Obergrenze. Bei einem Fehler eine leere Liste:
 * ein haengendes Autocomplete ist schlimmer als eines ohne Vorschlaege, und
 * die eigentliche Pruefung passiert ohnehin beim Ausfuehren.
 */
export async function handleAutomationAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'name' || !interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const rollen = rollenVon(interaction);
    const startbare = await listeDiscordStartbare(interaction.guildId, rollen);
    const suche = String(focused.value ?? '')
      .trim()
      .toLowerCase();

    const treffer = startbare
      .filter((eintrag: Automation) => suche === '' || eintrag.name.toLowerCase().includes(suche))
      .slice(0, 25)
      .map((eintrag: Automation) => ({
        name: beschriftung(eintrag).slice(0, 100),
        value: eintrag.id,
      }));

    await interaction.respond(treffer);
  } catch (error) {
    log.warn('Autocomplete fehlgeschlagen', { error });
    await interaction.respond([]).catch(() => undefined);
  }
}

/** Name plus Hinweis aus der Trigger-Konfiguration, wenn einer gesetzt ist. */
function beschriftung(eintrag: { name: string; triggerConfig: unknown }): string {
  const config = eintrag.triggerConfig as { hinweis?: unknown } | null;
  const hinweis = typeof config?.hinweis === 'string' ? config.hinweis.trim() : '';
  return hinweis ? `${eintrag.name} - ${hinweis}` : eintrag.name;
}

/** Die Rollen des Mitglieds aus der Interaktion - ohne zweite Discord-Anfrage. */
function rollenVon(interaction: AutocompleteInteraction | ChatInputCommandInteraction): string[] {
  const member = interaction.member;
  if (!member) {
    return [];
  }
  // Bei einer Guild-Interaktion liefert Discord die Rollen mit. Je nach
  // Cache-Zustand als Sammlung oder als reines Array - beides kommt vor.
  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) {
    return roles.filter((eintrag): eintrag is string => typeof eintrag === 'string');
  }
  const cache = (roles as { cache?: Map<string, unknown> } | undefined)?.cache;
  return cache ? [...cache.keys()] : [];
}

export async function handleAutomationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!AUTOMATION_COMMAND_NAMES.has(interaction.commandName)) {
    return;
  }

  // Ephemer: eine Automation zu starten ist eine Handlung des Teams, keine
  // Ankuendigung an den Kanal. Was sie bewirkt, sagt sie selbst.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.guildId) {
      await interaction.editReply({ content: 'Das gaht nur uf em Server.' });
      return;
    }
    if (!(await isModuleEnabled(MODULE))) {
      await interaction.editReply({ content: 'S Automations-Modul isch abgschaltet.' });
      return;
    }

    const id = interaction.options.getString('name', true);
    const probelauf = interaction.options.getBoolean('probelauf') ?? false;
    const rollen = rollenVon(interaction);

    /*
     * Erneut prüfen, nicht der Auswahl vertrauen.
     *
     * Discord schickt den getippten Wert - auch eine ID, die nie
     * vorgeschlagen wurde. Wer die Kennung einer fremden Automation kennt,
     * dürfte sie sonst starten.
     */
    const erlaubte = await listeDiscordStartbare(interaction.guildId, rollen);
    const automation = erlaubte.find((eintrag: Automation) => eintrag.id === id);

    if (!automation) {
      // Bewusst dieselbe Antwort, ob es sie nicht gibt oder ob sie gesperrt
      // ist: die Unterscheidung verriete die Existenz einer Automation, die
      // diese Person nichts angeht.
      const existiert = await holeAutomation(interaction.guildId, id);
      log.info('Start abgelehnt', {
        automationId: id,
        existiert: Boolean(existiert),
        discordId: interaction.user.id,
      });
      await interaction.editReply({
        content: 'Die Automation gits nid oder du hesch si nid freigäh übercho.',
      });
      return;
    }

    const actor = await buildCommandActor(interaction);
    const ergebnis = await starte({
      automation,
      trigger: 'discord',
      guildId: interaction.guildId,
      gateway: discord,
      dryRun: probelauf,
      actorId: interaction.user.id,
    });

    if (!probelauf) {
      await recordAudit({
        action: AUDIT_ACTIONS.AUTOMATION_EXECUTED,
        module: MODULE,
        actorDiscordId: actor.discordId,
        actorUsername: actor.username,
        targetLabel: automation.name,
        metadata: {
          automationId: automation.id,
          runId: ergebnis.runId,
          status: ergebnis.status,
          quelle: DISCORD_QUELLE,
        },
      }).catch((error: unknown) => log.warn('Prüfspur nicht geschrieben', { error }));
    }

    await interaction.editReply({ content: antwortAuf(automation.name, probelauf, ergebnis) });
  } catch (error) {
    log.error('Automation konnte nicht gestartet werden', { error });
    await interaction
      .editReply({ content: 'Da isch öppis schief gange. Probier s nomal.' })
      .catch(() => undefined);
  }
}

/**
 * Die Antwort an die Person.
 *
 * Ein uebersprungener Lauf ist kein Fehler, sieht aber wie einer aus, wenn
 * man nur «nichts passiert» liest. Deshalb steht der Grund dabei - er kommt
 * aus der Engine und nicht aus einer Vermutung hier.
 */
function antwortAuf(
  name: string,
  probelauf: boolean,
  ergebnis: { runId: string | null; status: string; fehler?: string },
): string {
  if (ergebnis.status === 'SKIPPED') {
    return `«${name}» isch nid gloffe: ${ergebnis.fehler ?? 'Si isch übersprunge worde.'}`;
  }
  if (probelauf) {
    return `Probelauf vo «${name}» dure. Es isch nüt passiert - s Ergebnis staht im Dashboard im Verlauf.`;
  }
  if (ergebnis.status === 'FAILED' || ergebnis.status === 'DEAD_LETTER') {
    return `«${name}» isch gstartet, aber gscheitert. Details im Dashboard im Verlauf.`;
  }
  if (ergebnis.status === 'WAITING' || ergebnis.status === 'AWAITING_APPROVAL') {
    return `«${name}» lauft und wartet grad - Details im Dashboard im Verlauf.`;
  }
  return `«${name}» isch gstartet.`;
}
