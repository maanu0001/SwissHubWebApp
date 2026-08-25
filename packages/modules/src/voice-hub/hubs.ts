import { prisma } from '@swisshub/database';
import type { VoiceHub, VoicePreset } from '@swisshub/database';
import { CHANNEL_TYPES, discord, resolveGuildId } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';

/**
 * Hub-Channels: die Sprachkanäle, deren Betreten einen Talk erzeugt.
 *
 * Der Hub ist kein Aufenthaltsort. Wer ihn betritt, ist Sekundenbruchteile
 * spaeter woanders - deshalb heisst er «➕ Eigenen Talk erstellen» und nicht
 * «Lobby».
 */

export interface HubInput {
  name: string;
  discordChannelId: string;
  targetCategoryId: string;
  overflowCategoryId: string | null;
  presetId: string;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  enabled: boolean;
  sortOrder?: number;
}

export type HubMitPreset = VoiceHub & { preset: VoicePreset };

export async function listHubs(): Promise<HubMitPreset[]> {
  const guildId = await resolveGuildId();
  return prisma.voiceHub.findMany({
    where: { guildId },
    include: { preset: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getHub(id: string): Promise<HubMitPreset | null> {
  const guildId = await resolveGuildId();
  return prisma.voiceHub.findFirst({ where: { id, guildId }, include: { preset: true } });
}

/** Der Hub zu einem betretenen Sprachkanal - `null`, wenn es keiner ist. */
export async function findeHubZuKanal(discordChannelId: string): Promise<HubMitPreset | null> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return null;
  }
  return prisma.voiceHub.findFirst({
    where: { guildId, discordChannelId, enabled: true },
    include: { preset: true },
  });
}

export async function createHub(input: HubInput): Promise<VoiceHub> {
  const guildId = await resolveGuildId();
  await pruefe(guildId, input);
  try {
    return await prisma.voiceHub.create({ data: { guildId, ...normalisiere(input) } });
  } catch (error) {
    throw alsBenannterFehler(error, input);
  }
}

export async function updateHub(id: string, input: HubInput): Promise<VoiceHub> {
  const guildId = await resolveGuildId();
  const vorhanden = await prisma.voiceHub.findFirst({ where: { id, guildId } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Hub gibt es nicht.' });
  }
  await pruefe(guildId, input, id);
  try {
    return await prisma.voiceHub.update({ where: { id }, data: normalisiere(input) });
  } catch (error) {
    throw alsBenannterFehler(error, input);
  }
}

/**
 * Loescht einen Hub.
 *
 * Laufende Talks bleiben: sie gehoeren den Leuten, die gerade darin reden, und
 * verschwinden von selbst, sobald sie leer sind. Der Verweis faellt weg
 * (`onDelete: SetNull`), der Lebenszyklus laeuft weiter.
 */
export async function deleteHub(id: string): Promise<void> {
  const guildId = await resolveGuildId();
  const hub = await prisma.voiceHub.findFirst({ where: { id, guildId } });
  if (!hub) {
    throw new AppError('NOT_FOUND', { userMessage: 'Diesen Hub gibt es nicht.' });
  }
  await prisma.voiceHub.delete({ where: { id } });
}

async function pruefe(guildId: string, input: HubInput, eigeneId?: string): Promise<void> {
  const preset = await prisma.voicePreset.findFirst({
    where: { id: input.presetId, guildId },
    select: { id: true },
  });
  if (!preset) {
    throw new AppError('VALIDATION_FAILED', { userMessage: 'Dieses Preset gibt es nicht.' });
  }

  // Der Hub muss ein Sprachkanal sein und die Zielkategorie eine Kategorie -
  // sonst scheitert erst der erste Beitritt, und niemand weiss, warum.
  const kanaele = await discord.channels.list().catch(() => []);
  const hubKanal = kanaele.find((eintrag) => eintrag.id === input.discordChannelId);
  if (!hubKanal) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Diesen Channel gibt es auf Discord nicht.',
    });
  }
  if (hubKanal.type !== CHANNEL_TYPES.voice) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Ein Hub muss ein Sprachkanal sein.',
    });
  }

  for (const [kennung, bezeichnung] of [
    [input.targetCategoryId, 'Zielkategorie'],
    [input.overflowCategoryId, 'Ausweichkategorie'],
  ] as const) {
    if (!kennung) {
      continue;
    }
    const kategorie = kanaele.find((eintrag) => eintrag.id === kennung);
    if (!kategorie || kategorie.type !== CHANNEL_TYPES.category) {
      throw new AppError('VALIDATION_FAILED', {
        userMessage: `Die ${bezeichnung} ist keine Discord-Kategorie.`,
      });
    }
  }

  // Ein Kanal, in dem schon Talks entstehen, kann nicht zugleich Ziel sein -
  // sonst erzeugte das Betreten des eigenen Talks den naechsten.
  const belegt = await prisma.voiceHub.findFirst({
    where: { discordChannelId: input.discordChannelId, ...(eigeneId ? { id: { not: eigeneId } } : {}) },
    select: { id: true, name: true },
  });
  if (belegt) {
    throw new AppError('CONFLICT', {
      userMessage: `Dieser Channel ist bereits der Hub «${belegt.name}».`,
    });
  }
}

function normalisiere(input: HubInput) {
  return {
    name: input.name.trim(),
    discordChannelId: input.discordChannelId,
    targetCategoryId: input.targetCategoryId,
    overflowCategoryId: input.overflowCategoryId,
    presetId: input.presetId,
    allowedRoleIds: input.allowedRoleIds,
    blockedRoleIds: input.blockedRoleIds,
    enabled: input.enabled,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  };
}

function alsBenannterFehler(error: unknown, input: HubInput): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    return new AppError('CONFLICT', {
      userMessage: `Es gibt bereits einen Hub namens «${input.name}» oder für diesen Channel.`,
    });
  }
  return error;
}

/**
 * Darf diese Person diesen Hub benutzen?
 *
 * Zwei Filter, beide serverseitig: die Rollen des Hubs und die des Presets.
 * Ein Verbot sticht immer - wer auf beiden Listen steht, darf nicht.
 */
export function darfHubNutzen(
  hub: HubMitPreset,
  roleIds: readonly string[],
): { erlaubt: boolean; grund?: string } {
  const rollen = new Set(roleIds);

  for (const [gesperrt, quelle] of [
    [hub.blockedRoleIds, 'Hub'],
    [hub.preset.blockedRoleIds, 'Preset'],
  ] as const) {
    if (gesperrt.some((rolle) => rollen.has(rolle))) {
      return { erlaubt: false, grund: `Eine deiner Rollen ist für diesen Talk gesperrt (${quelle}).` };
    }
  }

  for (const [erlaubt, quelle] of [
    [hub.allowedRoleIds, 'Hub'],
    [hub.preset.allowedRoleIds, 'Preset'],
  ] as const) {
    if (erlaubt.length > 0 && !erlaubt.some((rolle) => rollen.has(rolle))) {
      return { erlaubt: false, grund: `Für diesen Talk braucht es eine bestimmte Rolle (${quelle}).` };
    }
  }

  return { erlaubt: true };
}
