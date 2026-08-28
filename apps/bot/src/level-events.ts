import { ChannelType, Events, type Client, type GuildMember, type VoiceState } from 'discord.js';
import { createLogger } from '@swisshub/logger';
import { automation, level } from '@swisshub/modules';

const log = createLogger('bot:level');

/**
 * XP aus Nachrichten und Voice.
 *
 * Der Bot entscheidet hier nichts selbst: Ob XP fällig sind, sagt
 * `level.decideMessageXp` bzw. `level.decideVoiceXp`, und verbucht wird über
 * dieselbe Engine, die auch Dashboard und Slash Commands verwenden.
 */

const cooldowns = new level.MessageCooldownTracker();

/** Seit wann jemand stumm ist - Grundlage für den Nachlauf. */
const mutedSince = new Map<string, number>();

/** Wer gerade in einem Sprachkanal sitzt. */
const activeVoice = new Set<string>();

/** Letzter Zeitpunkt, an dem Zeit im Voice als Aktivität gewertet wurde. */
const lastVoiceTouch = new Map<string, number>();

const identityOf = (member: GuildMember) => ({
  discordId: member.id,
  username: member.user.username,
  displayName: member.displayName,
  avatarHash: member.user.avatar ?? null,
});

/**
 * Meldet einen Aufstieg im konfigurierten Channel.
 *
 * Bleibt bewusst folgenlos, wenn kein Channel gewählt ist - beim Vorgänger
 * war das ebenso, dort allerdings nur an einer festen Umgebungsvariable.
 */
async function announceLevelUp(
  client: Client,
  member: GuildMember,
  newLevel: number,
  context: Awaited<ReturnType<typeof level.loadLevelContext>>,
): Promise<void> {
  const { settings } = context;
  if (!settings.announceLevelUps || !settings.announceChannelId) {
    return;
  }
  if (context.announceLevels && !context.announceLevels.has(newLevel)) {
    return;
  }

  const channel = await client.channels.fetch(settings.announceChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    return;
  }

  const text = settings.levelUpMessage
    .replaceAll('{mention}', `<@${member.id}>`)
    .replaceAll('{user}', member.displayName)
    .replaceAll('{level}', String(newLevel));

  await channel
    .send({
      content: text,
      // Nur die betroffene Person wird gepingt, nichts sonst.
      allowedMentions: { users: [member.id], parse: [] },
    })
    .catch((error: unknown) => log.warn('Level-Up konnte nicht gemeldet werden', { error }));
}

/** Rollen und Meldung nach einer XP-Änderung nachziehen. */
async function afterXp(
  client: Client,
  member: GuildMember,
  result: level.ApplyXpResult,
  context: Awaited<ReturnType<typeof level.loadLevelContext>>,
): Promise<void> {
  await level
    .syncMilestoneRoles(member.id, result.xpAfter, {
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
      currentRoleIds: [...member.roles.cache.keys()],
      reason: `Level ${result.levelAfter}`,
    })
    .catch((error: unknown) => log.warn('Meilenstein-Rollen fehlgeschlagen', { error }));

  if (result.decayEnded) {
    await level.logDecayEnded(context, member.id).catch(() => undefined);
  }

  if (result.levelUp) {
    await announceLevelUp(client, member, result.levelAfter, context);
    // Das Ereignis fuer die Automation Engine. Es steht nach der Meldung:
    // die Nachricht im Level-Kanal ist die zugesagte Wirkung, das Ereignis
    // die Zugabe.
    await automation.meldeEreignis(
      'level.up',
      {
        discordId: member.id,
        displayName: member.displayName,
        level: result.levelAfter,
        levelVorher: result.levelBefore,
        xp: result.xpAfter,
      },
      { guildId: member.guild.id, subjectId: member.id },
    );
  }
}

/** XP für eine Nachricht. */
export function registerLevelMessageXp(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void (async () => {
      if (message.author.bot || !message.guild || !message.member) {
        return;
      }

      const context = await level.loadLevelContext();
      if (!context.enabled) {
        return;
      }
      const member = message.member;
      const identity = identityOf(member);

      const decision = level.decideMessageXp(
        {
          channelId: message.channelId,
          roleIds: [...member.roles.cache.keys()],
          secondsSinceLastXp: cooldowns.secondsSince(member.id),
        },
        context.settings,
      );

      if (!decision.grant) {
        // Auch ohne XP zählt die Nachricht als Lebenszeichen. Sonst würde
        // jemand, der nur in Channels ohne XP schreibt, dem Abzug verfallen.
        const touched = await level.touchActivity(identity, {
          markMessage: true,
          decayRules: context.decayRules,
        });
        if (touched.decayEnded) {
          await level.logDecayEnded(context, member.id).catch(() => undefined);
        }
        return;
      }

      cooldowns.record(member.id);

      const result = await level.applyXp(
        {
          ...identity,
          delta: decision.amount,
          source: 'MESSAGE',
          channelId: message.channelId,
          touchActivity: true,
          markMessage: true,
          countMessage: true,
        },
        {
          applyDecayFirst: context.settings.decayEnabled,
          decayRules: context.decayRules,
          maxLevelTotalXp: context.settings.maxLevelTotalXp,
        },
      );

      await afterXp(client, member, result, context);
    })().catch((error: unknown) => log.error('XP für Nachricht fehlgeschlagen', { error }));
  });
}

const voiceKey = (state: VoiceState): string => `${state.guild.id}:${state.id}`;

/** Merkt sich, wer im Voice ist und seit wann stumm. */
export function registerLevelVoiceTracking(client: Client): void {
  client.on(Events.VoiceStateUpdate, (before, after) => {
    void (async () => {
      const member = after.member ?? before.member;
      if (!member || member.user.bot) {
        return;
      }

      const key = voiceKey(after);
      if (after.channelId) {
        activeVoice.add(member.id);
        const muted = Boolean(after.selfMute || after.selfDeaf || after.mute || after.deaf);
        if (muted) {
          if (!mutedSince.has(key)) {
            mutedSince.set(key, Date.now());
          }
        } else {
          mutedSince.delete(key);
        }

        // Beitritt oder Wechsel gilt als Aktivität.
        if (!before.channelId || before.channelId !== after.channelId) {
          const context = await level.loadLevelContext();
          if (context.enabled) {
            const touched = await level.touchActivity(identityOf(member), {
              markVoice: true,
              decayRules: context.decayRules,
            });
            if (touched.decayEnded) {
              await level.logDecayEnded(context, member.id).catch(() => undefined);
            }
          }
        }
      } else {
        activeVoice.delete(member.id);
        mutedSince.delete(key);
        lastVoiceTouch.delete(member.id);
      }
    })().catch((error: unknown) => log.warn('Voice-Status konnte nicht verarbeitet werden', { error }));
  });
}

export interface VoiceSweepResult {
  checked: number;
  granted: number;
  xp: number;
}

/**
 * Ein Durchgang XP für Zeit im Sprachkanal.
 *
 * Wird im Minutentakt aufgerufen. Wie beim Vorgänger zählt jeder Durchgang
 * als eine Minute; ausgefallene Durchgänge werden nicht nachgeholt.
 */
export async function runVoiceXpSweep(client: Client, guildId: string | null): Promise<VoiceSweepResult> {
  if (!guildId) {
    return { checked: 0, granted: 0, xp: 0 };
  }

  const context = await level.loadLevelContext();
  const guild = client.guilds.cache.get(guildId);
  if (!context.enabled || !guild) {
    return { checked: 0, granted: 0, xp: 0 };
  }

  const now = Date.now();
  let checked = 0;
  let granted = 0;
  let xp = 0;

  for (const memberId of [...activeVoice]) {
    const member = guild.members.cache.get(memberId);
    const voice = member?.voice;
    if (!member || member.user.bot || !voice?.channelId) {
      activeVoice.delete(memberId);
      continue;
    }
    checked += 1;

    const channel = voice.channel;
    const others =
      channel && channel.type === ChannelType.GuildVoice
        ? channel.members.filter((entry) => !entry.user.bot && entry.id !== member.id).size
        : 0;

    const key = `${guild.id}:${member.id}`;
    const since = mutedSince.get(key);

    const identity = identityOf(member);

    // Zeit im Voice zählt immer als Aktivität - auch dann, wenn es dafür
    // gerade kein XP gibt.
    const interval = context.settings.voiceActivityTouchIntervalSeconds * 1000;
    if (now - (lastVoiceTouch.get(member.id) ?? 0) >= interval) {
      lastVoiceTouch.set(member.id, now);
      await level.touchActivity(identity, { markVoice: true }).catch(() => undefined);
    }

    const decision = level.decideVoiceXp(
      {
        channelId: voice.channelId,
        roleIds: [...member.roles.cache.keys()],
        selfMuted: Boolean(voice.selfMute),
        selfDeafened: Boolean(voice.selfDeaf),
        serverMuted: Boolean(voice.mute),
        serverDeafened: Boolean(voice.deaf),
        secondsSinceMuted: since === undefined ? null : (now - since) / 1000,
        otherHumansInChannel: others,
      },
      context.settings,
    );

    if (!decision.grant) {
      continue;
    }

    const result = await level
      .applyXp(
        {
          ...identity,
          delta: decision.amount,
          source: 'VOICE',
          channelId: voice.channelId,
          touchActivity: true,
          markVoice: true,
          countVoiceMinutes: 1,
        },
        {
          applyDecayFirst: false,
          decayRules: context.decayRules,
          maxLevelTotalXp: context.settings.maxLevelTotalXp,
        },
      )
      .catch((error: unknown) => {
        log.warn('Voice-XP fehlgeschlagen', { error, member: member.id });
        return null;
      });

    if (result) {
      granted += 1;
      xp += result.delta;
      await afterXp(client, member, result, context);
    }
  }

  return { checked, granted, xp };
}

export interface MutedWithoutXp {
  discordId: string;
  displayName: string;
  channelId: string;
}

/**
 * Wer gerade im Voice sitzt und wegen Stummschaltung kein XP bekommt.
 *
 * Grundlage für `/xp_voicemute_status`. Die Entscheidung trifft dieselbe
 * Funktion wie der Voice-Durchgang - eine zweite Regelauslegung gäbe es sonst
 * genau dort, wo jemand nachfragt, warum er kein XP bekommt.
 */
export async function listMutedWithoutXp(client: Client, guildId: string | null): Promise<MutedWithoutXp[]> {
  if (!guildId) {
    return [];
  }
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return [];
  }

  const context = await level.loadLevelContext();
  const now = Date.now();
  const result: MutedWithoutXp[] = [];

  for (const memberId of [...activeVoice]) {
    const member = guild.members.cache.get(memberId);
    const voice = member?.voice;
    if (!member || member.user.bot || !voice?.channelId) {
      continue;
    }

    const channel = voice.channel;
    const others =
      channel && channel.type === ChannelType.GuildVoice
        ? channel.members.filter((entry) => !entry.user.bot && entry.id !== member.id).size
        : 0;
    const since = mutedSince.get(`${guild.id}:${member.id}`);

    const decision = level.decideVoiceXp(
      {
        channelId: voice.channelId,
        roleIds: [...member.roles.cache.keys()],
        selfMuted: Boolean(voice.selfMute),
        selfDeafened: Boolean(voice.selfDeaf),
        serverMuted: Boolean(voice.mute),
        serverDeafened: Boolean(voice.deaf),
        secondsSinceMuted: since === undefined ? null : (now - since) / 1000,
        otherHumansInChannel: others,
      },
      context.settings,
    );

    if (!decision.grant && decision.reason === 'muted') {
      result.push({
        discordId: member.id,
        displayName: member.displayName,
        channelId: voice.channelId,
      });
    }
  }

  return result;
}

/**
 * Baut die Liste der Anwesenden nach einem Neustart neu auf.
 *
 * Ohne diesen Schritt bekäme niemand Voice-XP, bis er den Kanal einmal
 * verlässt und wieder betritt.
 */
export function recoverVoiceMembers(client: Client, guildId: string): number {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    return 0;
  }
  let found = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      continue;
    }
    for (const member of channel.members.values()) {
      if (member.user.bot) {
        continue;
      }
      activeVoice.add(member.id);
      found += 1;
    }
  }
  return found;
}
