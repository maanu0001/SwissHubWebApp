import { prisma } from '@swisshub/database';
import type { VoicePreset } from '@swisshub/database';
import { resolveGuildId } from '@swisshub/discord';
import { AppError } from '@swisshub/shared';

/**
 * Vorlagen fuer neue Talks.
 *
 * Ein Preset beantwortet die Fragen, die sonst bei jedem Talk neu zu stellen
 * waeren: wie heisst er, wie viele passen hinein, ist er offen, wie lange
 * bleibt er leer stehen. Mehrere Hubs koennen dasselbe Preset verwenden -
 * «Duo» und «Duo für Premium» unterscheiden sich sonst nur darin, wer sie
 * betreten darf.
 */

export interface PresetInput {
  name: string;
  nameTemplate: string;
  userLimit: number;
  maxUserLimit: number;
  bitrate: number | null;
  lockedDefault: boolean;
  hiddenDefault: boolean;
  targetCategoryId: string | null;
  allowedRoleIds: string[];
  blockedRoleIds: string[];
  deleteGraceSeconds: number;
  renameCooldownSeconds: number;
  ownerModeration: boolean;
  sortOrder?: number;
}

export async function listPresets(): Promise<VoicePreset[]> {
  const guildId = await resolveGuildId();
  return prisma.voicePreset.findMany({
    where: { guildId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getPreset(id: string): Promise<VoicePreset | null> {
  const guildId = await resolveGuildId();
  return prisma.voicePreset.findFirst({ where: { id, guildId } });
}

export async function createPreset(input: PresetInput): Promise<VoicePreset> {
  const guildId = await resolveGuildId();
  pruefe(input);
  try {
    return await prisma.voicePreset.create({
      data: { guildId, ...normalisiere(input) },
    });
  } catch (error) {
    throw alsBenannterFehler(error, input.name);
  }
}

export async function updatePreset(id: string, input: PresetInput): Promise<VoicePreset> {
  const guildId = await resolveGuildId();
  pruefe(input);

  // Auf die Guild geprueft: eine Kennung aus dem Browser sagt nichts darueber
  // aus, zu welchem Server sie gehoert.
  const vorhanden = await prisma.voicePreset.findFirst({ where: { id, guildId } });
  if (!vorhanden) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Preset existiert nicht.' });
  }

  try {
    return await prisma.voicePreset.update({ where: { id }, data: normalisiere(input) });
  } catch (error) {
    throw alsBenannterFehler(error, input.name);
  }
}

/**
 * Loescht ein Preset.
 *
 * Nicht, solange ein Hub es verwendet: der Hub verlöre damit seine Vorlage
 * und wüsste beim naechsten Beitritt nicht, was er anlegen soll. Laufende
 * Talks behalten ihre Zeile, verlieren aber den Verweis - sie sind ohnehin
 * schon eingerichtet.
 */
export async function deletePreset(id: string): Promise<void> {
  const guildId = await resolveGuildId();
  const preset = await prisma.voicePreset.findFirst({
    where: { id, guildId },
    include: { _count: { select: { hubs: true } } },
  });
  if (!preset) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Preset existiert nicht.' });
  }
  if (preset._count.hubs > 0) {
    throw new AppError('CONFLICT', {
      userMessage: `${preset._count.hubs} Hub${preset._count.hubs === 1 ? ' verwendet' : 's verwenden'} dieses Preset noch.`,
    });
  }
  await prisma.voicePreset.delete({ where: { id } });
}

function pruefe(input: PresetInput): void {
  if (input.userLimit > input.maxUserLimit) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage: 'Das Standardlimit ist grösser als das erlaubte Höchstlimit.',
    });
  }
  if (!input.nameTemplate.includes('{')) {
    // Ohne Platzhalter hiessen alle Talks gleich - Discord erlaubt das, aber
    // in der Kanalliste liesse sich danach keiner mehr auseinanderhalten.
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Die Namensvorlage braucht mindestens einen Platzhalter, z.B. {username} - sonst heissen alle Talks gleich.',
    });
  }
}

function normalisiere(input: PresetInput) {
  return {
    name: input.name.trim(),
    nameTemplate: input.nameTemplate.trim(),
    userLimit: input.userLimit,
    maxUserLimit: input.maxUserLimit,
    bitrate: input.bitrate,
    lockedDefault: input.lockedDefault,
    hiddenDefault: input.hiddenDefault,
    targetCategoryId: input.targetCategoryId,
    allowedRoleIds: input.allowedRoleIds,
    blockedRoleIds: input.blockedRoleIds,
    deleteGraceSeconds: input.deleteGraceSeconds,
    renameCooldownSeconds: input.renameCooldownSeconds,
    ownerModeration: input.ownerModeration,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
  };
}

function alsBenannterFehler(error: unknown, name: string): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  ) {
    return new AppError('CONFLICT', {
      userMessage: `Es gibt bereits ein Preset namens «${name}».`,
    });
  }
  return error;
}

/**
 * Legt die Startvorlagen an.
 *
 * Laeuft beim Einschalten des Moduls. Ohne sie stuende der Verwalter vor einer
 * leeren Seite und muesste raten, was ein Preset ueberhaupt ist. Idempotent:
 * das Modul laesst sich beliebig oft aus- und wieder einschalten.
 */
export async function seedPresets(): Promise<void> {
  const guildId = await resolveGuildId().catch(() => null);
  if (!guildId) {
    return;
  }

  const vorlagen: Array<PresetInput & { name: string }> = [
    {
      name: 'Standard Talk',
      nameTemplate: '🔊 {username} Stübli',
      userLimit: 0,
      maxUserLimit: 99,
      bitrate: null,
      lockedDefault: false,
      hiddenDefault: false,
      targetCategoryId: null,
      allowedRoleIds: [],
      blockedRoleIds: [],
      deleteGraceSeconds: 30,
      renameCooldownSeconds: 300,
      ownerModeration: true,
      sortOrder: 0,
    },
    {
      name: 'Duo',
      nameTemplate: '👥 {username} Duo-Stübli',
      userLimit: 2,
      maxUserLimit: 4,
      bitrate: null,
      lockedDefault: false,
      hiddenDefault: false,
      targetCategoryId: null,
      allowedRoleIds: [],
      blockedRoleIds: [],
      deleteGraceSeconds: 30,
      renameCooldownSeconds: 300,
      ownerModeration: true,
      sortOrder: 10,
    },
    {
      name: 'Privat',
      nameTemplate: '🔒 {username} Stübli',
      userLimit: 0,
      maxUserLimit: 99,
      bitrate: null,
      lockedDefault: true,
      hiddenDefault: true,
      targetCategoryId: null,
      allowedRoleIds: [],
      blockedRoleIds: [],
      deleteGraceSeconds: 60,
      renameCooldownSeconds: 300,
      ownerModeration: true,
      sortOrder: 20,
    },
  ];

  for (const vorlage of vorlagen) {
    await prisma.voicePreset
      .upsert({
        where: { guildId_name: { guildId, name: vorlage.name } },
        create: { guildId, ...normalisiere(vorlage) },
        update: {},
      })
      .catch(() => undefined);
  }
}
