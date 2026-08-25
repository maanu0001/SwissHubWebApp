import { prisma } from '@swisshub/database';
import type { VoiceTrustedMember, VoiceUserPreference } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';
import { getModuleSettings } from '../module-state';
import { VOICE_HUB_MODULE_ID, type VoiceHubSettings } from './config';

/**
 * Was jemand fuer seine eigenen Talks bevorzugt.
 *
 * Ausdruecklich freiwillig. `applyPreferences` ist voreingestellt aus, und
 * ohne den Schalter wird nichts uebernommen - auch dann nicht, wenn etwas
 * gespeichert ist. Eine Anwendung, die sich merkt, wie jemand seinen Kanal
 * nennt und wen er hereinlaesst, soll das tun, weil er es will, nicht weil es
 * technisch geht.
 *
 * Dasselbe gilt fuer die Vertrauenspersonen: ohne `autoAllowTrusted` liegt die
 * Liste da und tut nichts.
 */

export async function getPreferences(discordId: string): Promise<VoiceUserPreference | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.voiceUserPreference.findUnique({
    where: { guildId_discordId: { guildId, discordId } },
  });
}

export interface PreferenceInput {
  preferredName: string | null;
  preferredLimit: number | null;
  preferredBitrate: number | null;
  applyPreferences: boolean;
  autoAllowTrusted: boolean;
}

export async function savePreferences(
  discordId: string,
  input: PreferenceInput,
): Promise<VoiceUserPreference> {
  const settings = await getModuleSettings<VoiceHubSettings>(VOICE_HUB_MODULE_ID);
  if (!settings.userPreferencesEnabled) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Persönliche Voreinstellungen sind auf diesem Server abgeschaltet.',
    });
  }
  if (input.preferredLimit !== null && (input.preferredLimit < 0 || input.preferredLimit > 99)) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das Limit muss zwischen 0 und 99 liegen.',
    });
  }

  const guildId = await resolveGuildId();
  const daten = {
    preferredName: input.preferredName?.slice(0, 100) ?? null,
    preferredLimit: input.preferredLimit,
    preferredBitrate:
      input.preferredBitrate === null
        ? null
        : Math.min(input.preferredBitrate, settings.maxBitrate),
    applyPreferences: input.applyPreferences,
    autoAllowTrusted: settings.trustedMembersEnabled ? input.autoAllowTrusted : false,
  };

  return prisma.voiceUserPreference.upsert({
    where: { guildId_discordId: { guildId, discordId } },
    create: { guildId, discordId, ...daten },
    update: daten,
  });
}

export async function listTrusted(ownerDiscordId: string): Promise<VoiceTrustedMember[]> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return [];
  }
  return prisma.voiceTrustedMember.findMany({
    where: { guildId, ownerDiscordId },
    orderBy: { createdAt: 'asc' },
  });
}

/** Hoechstzahl der Vertrauenspersonen - Discord erlaubt 500 Ausnahmen je Kanal. */
const MAX_VERTRAUTE = 25;

export async function addTrusted(
  ownerDiscordId: string,
  ziel: { discordId: string; username?: string | null },
): Promise<void> {
  const settings = await getModuleSettings<VoiceHubSettings>(VOICE_HUB_MODULE_ID);
  if (!settings.trustedMembersEnabled) {
    throw new AppError('FORBIDDEN', {
      userMessage: 'Vertrauenspersonen sind auf diesem Server abgeschaltet.',
    });
  }
  if (ziel.discordId === ownerDiscordId) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Du bist in deinen eigenen Talks ohnehin dabei.',
    });
  }

  const guildId = await resolveGuildId();
  const anzahl = await prisma.voiceTrustedMember.count({ where: { guildId, ownerDiscordId } });
  if (anzahl >= MAX_VERTRAUTE) {
    throw new AppError('CONFLICT', {
      userMessage: `Mehr als ${MAX_VERTRAUTE} Vertrauenspersonen sind nicht möglich.`,
    });
  }

  await prisma.voiceTrustedMember.upsert({
    where: {
      guildId_ownerDiscordId_discordId: { guildId, ownerDiscordId, discordId: ziel.discordId },
    },
    create: {
      guildId,
      ownerDiscordId,
      discordId: ziel.discordId,
      username: ziel.username ?? null,
    },
    update: { username: ziel.username ?? null },
  });
}

export async function removeTrusted(ownerDiscordId: string, discordId: string): Promise<void> {
  const guildId = await resolveGuildId();
  await prisma.voiceTrustedMember
    .delete({
      where: { guildId_ownerDiscordId_discordId: { guildId, ownerDiscordId, discordId } },
    })
    .catch(() => undefined);
}
