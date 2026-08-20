import { randomUUID } from 'node:crypto';
import { ApplicationCommandOptionType, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { AppError, formatDuration } from '@swisshub/shared';
import { isModuleEnabled, jail } from '@swisshub/modules';
import { buildCommandActor, toJailActor, NO_PERMISSION, type CommandActor } from './context';

const log = createLogger('bot:commands');

/**
 * Slash Commands des Jail-Moduls.
 *
 * Diese Datei enthält **keine** Jail-Logik. Jeder Befehl ist ein Adapter:
 *
 *   Interaktion -> Berechtigung -> Eingabe prüfen -> Service -> Antwort
 *
 * Gejailt, freigelassen und abgestimmt wird ausschliesslich über
 * `@swisshub/modules` - dieselben Funktionen, die auch das Dashboard aufruft.
 * Dadurch gelten überall dieselbe Moderation Policy, derselbe Rollen-Snapshot,
 * dasselbe Audit Log und dieselbe Konfiguration aus dem Dashboard.
 */

/** Beschreibung der Befehle für die Registrierung bei Discord. */
export const JAIL_COMMAND_DEFINITIONS = [
  {
    name: 'jail',
    description: 'Steckt en User in Jail (optional mit Duur).',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'De zu jailende User',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'duration',
        description: "Optional: z.B. '10m', '2h', '3d' oder 'permanent'",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'reason',
        description: 'Grund für de Jail',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: 'silent_jail',
    description: 'Jailt de User, ohni e Nachricht im Mainchat z poste.',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'De zu jailende User',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'duration',
        description: "Optional: z.B. '10m', '2h', '3d' oder 'permanent'",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
      {
        name: 'reason',
        description: 'Grund für de Jail',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: 'jail_free',
    description: 'Befreit en User us em Jail.',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'De zu befreiende User',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
    ],
  },
  {
    name: 'jail_list',
    description: 'Zeigt alli User, wo momentan im Jail sind.',
    dmPermission: false,
    options: [],
  },
  {
    name: 'vote_jail',
    description: 'Starte es Voting, um en User in Jail z stecke.',
    dmPermission: false,
    options: [
      {
        name: 'user',
        description: 'De zu jailende User',
        type: ApplicationCommandOptionType.User,
        required: true,
      },
      {
        name: 'reason',
        description: 'Optional: Grund fürs Voting',
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
] as const;

export const JAIL_COMMAND_NAMES = JAIL_COMMAND_DEFINITIONS.map((definition) => definition.name);

/** Fehler einheitlich in eine verständliche Antwort übersetzen. */
function toUserMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.userMessage;
  }
  log.error('Slash Command fehlgeschlagen', { error });
  return 'Das het grad nöd funktioniert. Bitte spöter nomol probiere.';
}

async function ensureModuleEnabled(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (await isModuleEnabled(jail.JAIL_MODULE_ID)) {
    return true;
  }
  await interaction.editReply({ content: 'S Jail-Modul isch im Dashboard deaktiviert.' });
  return false;
}

/**
 * `/jail` und `/silent_jail`.
 *
 * Ohne Dauerangabe entsteht ein permanenter Jail - genau wie im alten Bot,
 * wo ein fehlendes `jail_end` "unbegrenzt" bedeutete.
 */
async function handleJail(
  interaction: ChatInputCommandInteraction,
  actor: CommandActor,
  silent: boolean,
): Promise<void> {
  if (!actor.can(jail.JAIL_PERMISSIONS.create)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }
  if (!(await ensureModuleEnabled(interaction))) {
    return;
  }

  const user = interaction.options.getUser('user', true);
  const durationInput = interaction.options.getString('duration');
  const reasonInput = interaction.options.getString('reason');

  const duration = durationInput ? jail.parseDurationInput(durationInput) : { type: 'PERMANENT' as const };
  if (!duration) {
    await interaction.editReply({ content: jail.DURATION_HINT });
    return;
  }

  const parsed = jail.createJailSchema.safeParse({
    targetDiscordId: user.id,
    type: duration.type,
    durationSeconds: duration.type === 'TEMPORARY' ? duration.seconds : undefined,
    reason: reasonInput?.trim() || 'Kein Grund angegeben',
    idempotencyKey: randomUUID(),
  });
  if (!parsed.success) {
    await interaction.editReply({
      content: parsed.error.issues[0]?.message ?? 'Die Iigab isch nöd gültig.',
    });
    return;
  }

  try {
    const result = await jail.createJail(
      { ...parsed.data, source: 'SLASH_COMMAND', silent },
      toJailActor(actor),
    );
    const until =
      result.jail.endsAt === null
        ? 'permanent'
        : `für ${formatDuration((result.jail.durationSeconds ?? 0) * 1000)}`;
    const warnings = result.warnings.length > 0 ? `\n${result.warnings.join('\n')}` : '';
    await interaction.editReply({
      content: `${user} isch ${until} im Jail.${silent ? ' (still - kei öffentlichi Meldig)' : ''}${warnings}`,
    });
  } catch (error) {
    await interaction.editReply({ content: toUserMessage(error) });
  }
}

/** `/jail_free` - dieselbe Freilassung wie der Knopf im Dashboard. */
async function handleJailFree(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(jail.JAIL_PERMISSIONS.release)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }
  if (!(await ensureModuleEnabled(interaction))) {
    return;
  }

  const user = interaction.options.getUser('user', true);
  const active = await jail.getActiveJail(user.id);
  if (!active) {
    await interaction.editReply({ content: `${user} isch gar nöd im Jail.` });
    return;
  }

  try {
    const result = await jail.releaseJail(active.id, {
      releaseType: 'MANUAL',
      idempotencyKey: randomUUID(),
      actor: toJailActor(actor),
    });
    const detail =
      result.failedRoleIds.length > 0
        ? ` ${result.restoredRoleIds.length} Rolle zrugg, ${result.failedRoleIds.length} hend nöd chöne wiederhergstellt werde.`
        : ` ${result.restoredRoleIds.length} Rolle zrugg.`;
    await interaction.editReply({ content: `${user} isch usem Jail entlah worde.${detail}` });
  } catch (error) {
    await interaction.editReply({ content: toUserMessage(error) });
  }
}

/** `/jail_list` - liest dieselbe Übersicht wie das Dashboard. */
async function handleJailList(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(jail.JAIL_PERMISSIONS.view)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }

  const active = await jail.listActiveJails(50);
  if (active.length === 0) {
    await interaction.editReply({ content: 'Es isch momentan niemert im Jail.' });
    return;
  }

  const lines = active.map((entry) => {
    const until = entry.endsAt === null ? 'Unbegrenzt' : `<t:${Math.floor(entry.endsAt.getTime() / 1000)}:R>`;
    const moderator =
      entry.moderatorDiscordId === 'unbekannt' ? 'Unbekannt' : `<@${entry.moderatorDiscordId}>`;
    return `<@${entry.targetDiscordId}> — bis: ${until}\nVo: ${moderator} · Grund: ${entry.reason.slice(0, 200)}`;
  });

  // Discord begrenzt eine Embed-Beschreibung auf 4096 Zeichen.
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current.length + line.length + 2 > 3800) {
      chunks.push(current);
      current = '';
    }
    current += `${line}\n\n`;
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  await interaction.editReply({
    embeds: chunks.slice(0, 10).map((description, index) => ({
      title: `Jail-Liste (${index + 1}/${Math.min(chunks.length, 10)}) · ${active.length} Iiträg`,
      description,
      color: 0x83060a,
    })),
  });
}

/** `/vote_jail` - startet dieselbe Abstimmung wie das Dashboard. */
async function handleVoteJail(interaction: ChatInputCommandInteraction, actor: CommandActor): Promise<void> {
  if (!actor.can(jail.JAIL_PERMISSIONS.voteStart)) {
    await interaction.editReply({ content: NO_PERMISSION });
    return;
  }
  if (!(await ensureModuleEnabled(interaction))) {
    return;
  }

  const user = interaction.options.getUser('user', true);
  const parsed = jail.startVoteJailSchema.safeParse({
    targetDiscordId: user.id,
    reason: interaction.options.getString('reason') ?? undefined,
  });
  if (!parsed.success) {
    await interaction.editReply({
      content: parsed.error.issues[0]?.message ?? 'Die Iigab isch nöd gültig.',
    });
    return;
  }

  try {
    const vote = await jail.startVoteJail(parsed.data, {
      ...toJailActor(actor),
      // Die Sperrfrist-Ausnahme ist eine gewöhnliche Berechtigung - im alten
      // Bot war das an eine feste Admin-Rolle gebunden.
      bypassCooldown: actor.can(jail.JAIL_PERMISSIONS.voteBypassCooldown),
    });
    await interaction.editReply({
      content: `S Voting isch gstartet: ${vote.requiredVotes} Stimme bis <t:${Math.floor(
        vote.expiresAt.getTime() / 1000,
      )}:R>.`,
    });
  } catch (error) {
    await interaction.editReply({ content: toUserMessage(error) });
  }
}

/**
 * Verteilt eine Interaktion an den passenden Adapter.
 *
 * Die Antwort wird sofort aufgeschoben (`deferReply`), weil die Services
 * Discord und die Datenbank ansprechen und Discord nur drei Sekunden wartet.
 */
export async function handleJailCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: 'De Befehl funktioniert nur uf eme Server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const actor = await buildCommandActor(interaction);
    switch (interaction.commandName) {
      case 'jail':
        await handleJail(interaction, actor, false);
        return;
      case 'silent_jail':
        await handleJail(interaction, actor, true);
        return;
      case 'jail_free':
        await handleJailFree(interaction, actor);
        return;
      case 'jail_list':
        await handleJailList(interaction, actor);
        return;
      case 'vote_jail':
        await handleVoteJail(interaction, actor);
        return;
      default:
        return;
    }
  } catch (error) {
    log.error('Slash Command konnte nicht verarbeitet werden', {
      error,
      command: interaction.commandName,
    });
    await interaction.editReply({ content: toUserMessage(error) }).catch(() => undefined);
  }
}
