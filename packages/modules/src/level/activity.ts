import type { LevelSettings } from './config';

/**
 * Entscheidung, ob und wie viel XP eine Aktivität einbringt.
 *
 * Die Regeln stecken in reinen Funktionen, damit sie ohne Discord prüfbar
 * sind. Beim Vorgänger lagen dieselben Bedingungen verstreut in zwei langen
 * Event-Handlern, und ob ein Fall wirklich griff, zeigte sich erst im Betrieb.
 */

export type SkipReason =
  | 'disabled'
  | 'no-xp-channel'
  | 'no-xp-role'
  | 'cooldown'
  | 'muted'
  | 'alone'
  | 'zero-amount';

export interface XpDecision {
  grant: boolean;
  amount: number;
  reason?: SkipReason;
  /** Für die Protokollierung: welcher Multiplikator gewirkt hat. */
  multiplier: number;
}

const skip = (reason: SkipReason): XpDecision => ({ grant: false, amount: 0, reason, multiplier: 0 });

export interface MessageXpInput {
  channelId: string;
  roleIds: readonly string[];
  /** Sekunden seit der letzten XP-Vergabe, `null` = noch nie. */
  secondsSinceLastXp: number | null;
}

export function decideMessageXp(input: MessageXpInput, settings: LevelSettings): XpDecision {
  if (!settings.messageXpEnabled) {
    return skip('disabled');
  }
  if (settings.noXpChannelIds.includes(input.channelId)) {
    return skip('no-xp-channel');
  }

  const hasRole = (roleId: string | undefined): boolean =>
    Boolean(roleId) && input.roleIds.includes(roleId!);

  if (hasRole(settings.noXpRoleId)) {
    return skip('no-xp-role');
  }

  const premium = hasRole(settings.premiumRoleId);
  const cooldown = premium ? settings.premiumMessageCooldownSeconds : settings.messageCooldownSeconds;
  if (input.secondsSinceLastXp !== null && input.secondsSinceLastXp < cooldown) {
    return skip('cooldown');
  }

  // Reihenfolge wie beim Vorgänger: erst Boost, abschneiden, dann der
  // Premium-Faktor - eine andere Reihenfolge ergäbe andere Beträge.
  let amount = Math.trunc(settings.xpPerMessage * settings.xpBoost);
  const multiplier = premium ? settings.premiumXpMultiplier : 1;
  if (premium) {
    amount = Math.trunc(amount * settings.premiumXpMultiplier);
  }

  if (amount <= 0) {
    return skip('zero-amount');
  }
  return { grant: true, amount, reason: undefined, multiplier };
}

export interface VoiceXpInput {
  channelId: string;
  roleIds: readonly string[];
  selfMuted: boolean;
  selfDeafened: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  /** Sekunden seit dem Stummschalten, `null` = nicht stumm. */
  secondsSinceMuted: number | null;
  /** Andere Personen im Kanal, Bots nicht mitgezählt. */
  otherHumansInChannel: number;
}

export function decideVoiceXp(input: VoiceXpInput, settings: LevelSettings): XpDecision {
  if (!settings.voiceXpEnabled) {
    return skip('disabled');
  }
  if (settings.noXpChannelIds.includes(input.channelId)) {
    return skip('no-xp-channel');
  }

  const hasRole = (roleId: string | undefined): boolean =>
    Boolean(roleId) && input.roleIds.includes(roleId!);

  if (hasRole(settings.noXpRoleId)) {
    return skip('no-xp-role');
  }

  if (settings.voiceMuteBlocksXp) {
    const soundMuted = input.selfMuted || input.selfDeafened;
    const voiceMuted = input.serverMuted || input.serverDeafened;
    const muted =
      settings.voiceMuteMode === 'sound'
        ? soundMuted
        : settings.voiceMuteMode === 'voice'
          ? voiceMuted
          : soundMuted || voiceMuted;

    if (muted) {
      const cooldown = settings.voiceMuteCooldownSeconds;
      const since = input.secondsSinceMuted ?? 0;
      // Ein Nachlauf von 0 sperrt sofort; sonst gibt es noch so lange XP.
      if (cooldown <= 0 || since >= cooldown) {
        return skip('muted');
      }
    }
  }

  if (!settings.xpWhileAlone && input.otherHumansInChannel <= 0) {
    return skip('alone');
  }

  let multiplier = 1;
  if (settings.specialVoiceChannelIds.includes(input.channelId)) {
    multiplier *= settings.specialVoiceMultiplier;
  }
  if (settings.stageVoiceChannelIds.includes(input.channelId)) {
    multiplier *= settings.stageVoiceMultiplier;
  }
  if (hasRole(settings.premiumRoleId)) {
    multiplier *= settings.premiumXpMultiplier;
  }

  const amount = Math.trunc(settings.xpPerVoiceMinute * settings.xpBoost * multiplier);
  if (amount <= 0) {
    return skip('zero-amount');
  }
  return { grant: true, amount, reason: undefined, multiplier };
}

/**
 * Sperrfrist für XP aus Nachrichten.
 *
 * Bewusst im Arbeitsspeicher: die Frist liegt bei einer Minute, und eine
 * Datenbankabfrage je Nachricht wäre auf einem lebhaften Server spürbar. Nach
 * einem Neustart darf jemand einmal früher XP bekommen - das ist verkraftbar.
 */
export class MessageCooldownTracker {
  private readonly lastGrant = new Map<string, number>();

  private lastPrune = 0;

  /** Sekunden seit der letzten Vergabe, `null` = noch keine bekannt. */
  secondsSince(discordId: string, now: number = Date.now()): number | null {
    const last = this.lastGrant.get(discordId);
    return last === undefined ? null : (now - last) / 1000;
  }

  record(discordId: string, now: number = Date.now()): void {
    this.lastGrant.set(discordId, now);
    this.prune(now);
  }

  /** Hält die Karte klein, ohne bei jeder Nachricht darüberzulaufen. */
  private prune(now: number, ttlSeconds = 3600): void {
    if (now - this.lastPrune < 600_000) {
      return;
    }
    this.lastPrune = now;
    const cutoff = now - ttlSeconds * 1000;
    for (const [discordId, timestamp] of this.lastGrant) {
      if (timestamp < cutoff) {
        this.lastGrant.delete(discordId);
      }
    }
  }

  get size(): number {
    return this.lastGrant.size;
  }
}
