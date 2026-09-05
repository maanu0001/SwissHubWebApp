import {
  discord as defaultDiscord,
  type DiscordGateway,
  type GuildMember,
  type GuildRole,
} from '@swisshub/discord';
import {
  evaluateModerationPolicy,
  loadRoleConfiguration,
  moderationLevelOf,
  type PolicyDecision,
} from '@swisshub/permissions';
import { AppError } from '@swisshub/shared';

/**
 * Rangfolge fuer das Moderation Center.
 *
 * Hier steht **keine** eigene Regelkunde. Wen jemand moderieren darf,
 * entscheidet `evaluateModerationPolicy` aus `@swisshub/permissions` - dieselbe
 * Policy, die schon Jail und Vote Jail verwenden. Eine zweite Fassung waere
 * eine zweite Wahrheit: geschuetzte Rollen und Moderationsstufen sind dort
 * konfigurierbar, und ein Bann duerfte sie nicht anders auslegen als ein Jail.
 *
 * Diese Datei traegt nur zusammen, was die Policy braucht, und beantwortet die
 * eine Frage, die das Jail nicht kennt: **Bann und Entbannung wirken auch auf
 * jemanden, der gar nicht (mehr) auf dem Server ist.** Die Policy lehnt so ein
 * Ziel mit `TARGET_NOT_A_MEMBER` ab - richtig fuer einen Jail, der Rollen
 * setzen muss, falsch fuer einen Bann. Deshalb entscheidet der Aufrufer ueber
 * `erlaubeNichtmitglied`, und die Schutzregeln, die ohne Rollen auskommen
 * (Serverinhaber, der Bot selbst, man selbst), stehen hier trotzdem.
 */

export interface ModerationPolicyContext {
  guildRoles: GuildRole[];
  protectedRoleIds: string[];
  moderationLevels: ReadonlyMap<string, number>;
  botHighestPosition: number;
  botUserId: string | null;
  guildOwnerId: string | null;
}

/**
 * Laedt Rollen, Rollenkonfiguration und Bot-Position.
 *
 * Bewusst ohne Jail-Einstellungen: `loadJailContext` traegt Jail-Rolle,
 * Ankuendigungs-Channel und Textvorlagen mit, die ein Bann nicht braucht.
 */
export async function loadModerationPolicyContext(
  gateway: DiscordGateway = defaultDiscord,
): Promise<ModerationPolicyContext> {
  const [roleConfiguration, guildRoles, botIdentity, guild, botHighestPosition] = await Promise.all([
    loadRoleConfiguration(),
    gateway.roles.list({ force: true }),
    gateway.bot.identity().catch(() => null),
    gateway.guild.get().catch(() => null),
    // Ohne `catch`: 0 hiesse «der Bot steht ganz unten», und damit lehnte
    // die Policy jedes Ziel ab - lautlos, weil ein abgefangener Fehler keiner
    // mehr ist. Derselbe Fall wie beim Vote Jail.
    gateway.bot.highestRolePosition(),
  ]);

  return {
    guildRoles,
    protectedRoleIds: roleConfiguration.protectedRoleIds,
    moderationLevels: roleConfiguration.moderationLevels,
    botHighestPosition,
    botUserId: botIdentity?.id ?? null,
    guildOwnerId: guild?.ownerId ?? null,
  };
}

export interface PolicyActorInput {
  discordId: string;
  roleIds: readonly string[];
  isOwner: boolean;
}

export interface PolicyCheckInput {
  actor: PolicyActorInput;
  targetDiscordId: string;
  target: GuildMember | null;
  context: ModerationPolicyContext;
  /**
   * Darf die Massnahme jemanden treffen, der nicht auf dem Server ist?
   *
   * `true` fuer Bann und Entbannung, `false` fuer alles, was ein anwesendes
   * Mitglied voraussetzt (Kick, Timeout).
   */
  erlaubeNichtmitglied?: boolean;
}

/**
 * Prueft die Rangfolge - ueber die gemeinsame Policy.
 *
 * Die Moderationsstufe des Ausfuehrenden wird hier aus seinen Rollen
 * abgeleitet, nicht von aussen entgegengenommen: sie ist eine Eigenschaft
 * seiner Rollen, und wer sie behaupten duerfte, koennte sich selbst
 * hochstufen.
 */
export function pruefeRangfolge(input: PolicyCheckInput): PolicyDecision {
  const { actor, target, context } = input;

  // Diese drei Regeln brauchen keine Rollen und gelten deshalb auch dann,
  // wenn das Ziel den Server verlassen hat.
  if (input.targetDiscordId === actor.discordId) {
    return {
      allowed: false,
      code: 'SELF_TARGET',
      message: 'Du kannst diese Aktion nicht gegen dich selbst ausführen.',
    };
  }
  if (context.botUserId && input.targetDiscordId === context.botUserId) {
    return { allowed: false, code: 'TARGET_IS_BOT', message: 'Bots können nicht moderiert werden.' };
  }
  if (context.guildOwnerId && input.targetDiscordId === context.guildOwnerId) {
    return {
      allowed: false,
      code: 'TARGET_IS_OWNER',
      message: 'Der Server-Owner kann nicht moderiert werden.',
    };
  }

  if (!target) {
    return input.erlaubeNichtmitglied
      ? { allowed: true }
      : {
          allowed: false,
          code: 'TARGET_NOT_A_MEMBER',
          message: 'Das Mitglied befindet sich nicht (mehr) auf dem Server.',
        };
  }

  return evaluateModerationPolicy({
    actor: {
      discordId: actor.discordId,
      roleIds: [...actor.roleIds],
      isOwner: actor.isOwner,
      moderationLevel: moderationLevelOf(actor.roleIds, context.moderationLevels),
    },
    target,
    guildRoles: context.guildRoles,
    protectedRoleIds: context.protectedRoleIds,
    moderationLevels: context.moderationLevels,
    botHighestPosition: context.botHighestPosition,
    botUserId: context.botUserId,
    guildOwnerId: context.guildOwnerId,
  });
}

/** Wirft, wenn die Policy Nein sagt. */
export function assertRangfolge(input: PolicyCheckInput): void {
  const urteil = pruefeRangfolge(input);
  if (!urteil.allowed) {
    throw new AppError('FORBIDDEN', {
      userMessage: urteil.message ?? 'Diese Aktion ist nicht zulässig.',
      internalMessage: urteil.code,
    });
  }
}
