import { AUDIT_ACTIONS, prisma, safeRecordAudit, type LevelImport, type LevelImportItem, type Prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { AppError, conflict, notFound } from '@swisshub/shared';
import { readModuleSettings } from '../../settings/service';
import { LEVEL_MODULE_ID, type LevelSettings } from '../config';
import { levelFromXp } from '../curve';
import { setXp } from '../service';
import { updateLevelSettings, type LevelActor } from '../admin';
import { readLegacyLevelDatabase, type LegacyLevelDatabase } from './reader';
import { readLegacyEnv, type LegacyEnvContents } from './env-reader';

const log = createLogger('level:import');

/**
 * Übernahme der alten `levels.db`.
 *
 * Zweistufig wie beim Spielersuche-Import: zuerst wird die Datei gelesen und
 * jede Zeile bewertet, dann - und nur nach ausdrücklicher Bestätigung - wird
 * geschrieben. Ohne diesen Zwischenschritt liesse sich nicht erkennen, was
 * eine Übernahme anrichtet, bevor sie passiert ist.
 *
 * Zwei Zusicherungen sind dabei entscheidend:
 *
 *  - XP werden **gesetzt**, nicht addiert. Der Stand aus der Altdatenbank ist
 *    die Wahrheit; er wird nicht aus Nachrichten und Voice-Minuten neu
 *    ausgerechnet.
 *  - Dieselbe Datei kann nicht zweimal XP setzen. Jedes übernommene Profil
 *    merkt sich die Prüfsumme der Datei, aus der sein Stand stammt.
 */

/** Wer die Übernahme auslöst - dieselbe Form wie bei den übrigen Eingriffen. */
export type ImportActor = LevelActor;

export interface ImportPreviewRow {
  legacyKey: string;
  kind: 'PROFILE' | 'GAME_STATS' | 'NO_XP_CHANNEL' | 'CONFIG' | 'GUILD_CONFIG' | 'ENV_SETTING';
  label: string;
  action: 'IMPORT' | 'SKIP_DUPLICATE' | 'SKIP_INVALID' | 'SKIP_EMPTY' | 'CONFLICT';
  note: string | null;
  payload: Record<string, unknown>;
}

export interface ImportAnalysis {
  importId: string;
  fileName: string;
  fileBytes: number;
  fileSha256: string;
  schema: LegacyLevelDatabase['schema'];
  counts: {
    total: number;
    importable: number;
    duplicate: number;
    invalid: number;
    empty: number;
    conflict: number;
  };
  /** Summe der XP, die übernommen würde. */
  totalXp: number;
  /** Höchstes Level in der Datei. */
  highestLevel: number;
  rows: ImportPreviewRow[];
}

const profileKey = (userId: string): string => `profile:${userId}`;
const statsKey = (userId: string): string => `stats:${userId}`;

/**
 * Liest die Datei, bewertet jede Zeile und legt den Lauf an - ohne zu
 * schreiben, was den XP-Stand betrifft.
 */
export async function analyseLevelImport(
  actor: ImportActor,
  file: { name: string; data: Uint8Array },
): Promise<ImportAnalysis> {
  const legacy = await readLegacyLevelDatabase(file.data);

  // Wurde dieselbe Datei schon einmal vollständig übernommen? Dann ist jede
  // Zeile ein Duplikat, und das soll die Vorschau auch so zeigen.
  const previous = await prisma.levelImport.findFirst({
    where: { fileSha256: legacy.sha256, status: 'IMPORTED' },
    orderBy: { createdAt: 'desc' },
  });

  const alreadyImported = new Set(
    (
      await prisma.levelProfile.findMany({
        where: { legacyImportSha: legacy.sha256 },
        select: { discordId: true },
      })
    ).map((entry) => entry.discordId),
  );

  const rows: ImportPreviewRow[] = [];
  let totalXp = 0;
  let highestLevel = 1;

  for (const row of legacy.levels) {
    const level = levelFromXp(row.xp);
    highestLevel = Math.max(highestLevel, level);

    if (alreadyImported.has(row.userId)) {
      rows.push({
        legacyKey: profileKey(row.userId),
        kind: 'PROFILE',
        label: `${row.userId} · ${row.xp} XP`,
        action: 'SKIP_DUPLICATE',
        note: 'Aus genau dieser Datei bereits übernommen.',
        payload: { ...row },
      });
      continue;
    }

    if (row.xp === 0 && row.messages === 0 && row.voiceMinutes === 0) {
      // Eine leere Zeile anzulegen brächte nichts und würde die Mitgliederliste
      // mit Karteileichen füllen.
      rows.push({
        legacyKey: profileKey(row.userId),
        kind: 'PROFILE',
        label: `${row.userId} · 0 XP`,
        action: 'SKIP_EMPTY',
        note: 'Kein XP, keine Nachrichten, keine Voice-Zeit.',
        payload: { ...row },
      });
      continue;
    }

    totalXp += row.xp;
    rows.push({
      legacyKey: profileKey(row.userId),
      kind: 'PROFILE',
      label: `${row.userId} · ${row.xp} XP · Level ${level}`,
      action: 'IMPORT',
      note: null,
      payload: { ...row },
    });
  }

  for (const wins of legacy.gameWins) {
    const total = wins.xpBattle + wins.xpSsp + wins.xpTtt + wins.xp4Gewinnt;
    rows.push({
      legacyKey: statsKey(wins.userId),
      kind: 'GAME_STATS',
      label: `${wins.userId} · ${total} Siege`,
      action: total === 0 ? 'SKIP_EMPTY' : alreadyImported.has(wins.userId) ? 'SKIP_DUPLICATE' : 'IMPORT',
      note: total === 0 ? 'Keine Siege verzeichnet.' : null,
      payload: { ...wins },
    });
  }

  if (legacy.noXpChannelIds.length > 0) {
    // Ein Channel, den es auf Discord nicht mehr gibt, wuerde die
    // Einstellungen ungueltig machen und damit die gesamte Uebernahme der
    // Konfiguration verhindern. Deshalb wird hier aussortiert und benannt.
    const known = new Set(
      (
        await prisma.discordChannelCache.findMany({
          where: { channelId: { in: legacy.noXpChannelIds }, deletedAt: null },
          select: { channelId: true },
        })
      ).map((entry) => entry.channelId),
    );
    const existing = legacy.noXpChannelIds.filter((id) => known.has(id));
    const missing = legacy.noXpChannelIds.filter((id) => !known.has(id));

    rows.push({
      legacyKey: 'settings:no_xp_channels',
      kind: 'NO_XP_CHANNEL',
      label: `${existing.length} von ${legacy.noXpChannelIds.length} Channels ohne XP`,
      action: existing.length > 0 ? 'IMPORT' : 'SKIP_INVALID',
      note:
        missing.length > 0
          ? `${missing.length} Channel${missing.length === 1 ? '' : 's'} gibt es auf Discord nicht mehr und wird übersprungen.`
          : 'Wird zur Liste in den Einstellungen hinzugefügt.',
      payload: { channelIds: existing, missingChannelIds: missing },
    });
  }

  if (legacy.config) {
    rows.push({
      legacyKey: 'settings:config',
      kind: 'CONFIG',
      label: `XP-Boost ${legacy.config.xpBoost ?? 1}${legacy.config.announceLevels ? `, Level-Meldungen "${legacy.config.announceLevels}"` : ''}`,
      action: 'IMPORT',
      note: null,
      payload: { ...legacy.config },
    });
  }

  for (const guildConfig of legacy.guildConfigs) {
    rows.push({
      legacyKey: `settings:guild:${guildConfig.guildId}`,
      kind: 'GUILD_CONFIG',
      label: `Voice-Einstellungen (Server ${guildConfig.guildId})`,
      action: 'IMPORT',
      note: null,
      payload: { ...guildConfig },
    });
  }

  const counts = {
    total: rows.length,
    // Einstellungen zählen nicht mit: sie sind bei jedem Lauf übernehmbar und
    // würden sonst dafür sorgen, dass ein zweiter Durchgang nie bei null steht.
    importable: rows.filter(
      (row) => row.action === 'IMPORT' && (row.kind === 'PROFILE' || row.kind === 'GAME_STATS'),
    ).length,
    duplicate: rows.filter((row) => row.action === 'SKIP_DUPLICATE').length,
    invalid: rows.filter((row) => row.action === 'SKIP_INVALID').length,
    empty: rows.filter((row) => row.action === 'SKIP_EMPTY').length,
    conflict: rows.filter((row) => row.action === 'CONFLICT').length,
  };

  const created = await prisma.levelImport.create({
    data: {
      fileName: file.name.slice(0, 200),
      fileBytes: legacy.bytes,
      fileSha256: legacy.sha256,
      status: 'ANALYSED',
      schemaInfo: legacy.schema as unknown as Prisma.InputJsonValue,
      totalRows: counts.total,
      importableRows: counts.importable,
      duplicateRows: counts.duplicate,
      invalidRows: counts.invalid + counts.empty,
      conflictRows: counts.conflict,
      uploadedByDiscordId: actor.discordId,
      uploadedByUsername: actor.username,
      items: {
        create: rows.map((row) => ({
          kind: row.kind,
          legacyKey: row.legacyKey,
          label: row.label,
          action: row.action,
          note: row.note,
          payload: row.payload as Prisma.InputJsonValue,
        })),
      },
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_IMPORT_STARTED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: {
      importId: created.id,
      fileName: created.fileName,
      sha256: legacy.sha256,
      ...counts,
      previouslyImported: previous?.id ?? null,
    },
  });

  log.info('Altdaten analysiert', { importId: created.id, ...counts });

  return {
    importId: created.id,
    fileName: created.fileName,
    fileBytes: legacy.bytes,
    fileSha256: legacy.sha256,
    schema: legacy.schema,
    counts,
    totalXp,
    highestLevel,
    rows,
  };
}

export interface ExecuteResult {
  importId: string;
  imported: number;
  skipped: number;
  failed: number;
  /** Summe der übernommenen XP. */
  totalXp: number;
  settingsChanged: string[];
  /** Gesetzt, wenn die Einstellungen nicht gespeichert werden konnten. */
  settingsError: string | null;
}

const GAME_COLUMN_TO_KIND = {
  xpBattle: 'XP_BATTLE',
  xpSsp: 'XP_SSP',
  xpTtt: 'XP_TTT',
  xp4Gewinnt: 'XP_4GEWINNT',
} as const;

/**
 * Übernimmt die zuvor bewerteten Zeilen.
 *
 * Läuft nur nach ausdrücklicher Bestätigung und nur, wenn der alte Bot
 * abgeschaltet ist. Liefe er weiter, würden beide Bots XP vergeben, und die
 * übernommenen Stände wären sofort wieder falsch.
 */
export async function executeLevelImport(
  actor: ImportActor,
  importId: string,
  options: { legacyBotStopped: boolean; importSettings?: boolean },
): Promise<ExecuteResult> {
  const run = await prisma.levelImport.findUnique({ where: { id: importId } });
  if (!run) {
    throw notFound('Import nicht gefunden', 'Diese Übernahme gibt es nicht mehr.');
  }
  if (run.status === 'IMPORTED') {
    throw conflict('Diese Datei wurde bereits übernommen.');
  }
  if (!options.legacyBotStopped) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Bitte zuerst bestätigen, dass der alte Level-Bot abgeschaltet ist. Sonst vergeben zwei Bots gleichzeitig XP.',
    });
  }

  const items = await prisma.levelImportItem.findMany({
    where: { importId, action: 'IMPORT' },
    orderBy: { createdAt: 'asc' },
  });

  let imported = 0;
  let failed = 0;
  let totalXp = 0;
  const settingsChanged: string[] = [];
  const settingsPatch: Partial<LevelSettings> = {};
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);

  for (const item of items) {
    try {
      switch (item.kind) {
        case 'PROFILE': {
          const payload = item.payload as {
            userId: string;
            xp: number;
            messages: number;
            voiceMinutes: number;
            lastActivityAt: number | null;
            lastDecayAt: number | null;
            lastMessageAt: number | null;
            lastVoiceAt: number | null;
          };
          const seconds = (value: number | null): Date | null =>
            value === null ? null : new Date(value * 1000);

          await setXp(
            { discordId: payload.userId },
            payload.xp,
            {
              source: 'MIGRATION',
              reason: `Übernahme aus ${run.fileName}`,
              actorDiscordId: actor.discordId,
              importId: run.id,
              // Zweiter Riegel neben der Prüfsumme am Profil: dieselbe Zeile
              // aus demselben Lauf kann nie doppelt buchen.
              idempotencyKey: `level-import:${run.id}:${item.legacyKey}`,
              messages: payload.messages,
              voiceMinutes: payload.voiceMinutes,
              lastActivityAt: seconds(payload.lastActivityAt),
              lastDecayAt: seconds(payload.lastDecayAt),
              lastMessageAt: seconds(payload.lastMessageAt),
              lastVoiceAt: seconds(payload.lastVoiceAt),
              legacyImportSha: run.fileSha256,
            },
          );
          totalXp += payload.xp;
          imported += 1;
          break;
        }

        case 'GAME_STATS': {
          const payload = item.payload as Record<keyof typeof GAME_COLUMN_TO_KIND | 'userId', never> & {
            userId: string;
          };
          const profile = await prisma.levelProfile.findUnique({
            where: { discordId: payload.userId },
          });
          if (!profile) {
            // Ohne Profil gibt es nichts, woran die Bilanz hängen könnte.
            await markItem(item, false, null, 'Kein Profil vorhanden.');
            continue;
          }
          for (const [column, kind] of Object.entries(GAME_COLUMN_TO_KIND)) {
            const wins = Number((payload as unknown as Record<string, number>)[column] ?? 0);
            if (wins <= 0) {
              continue;
            }
            await prisma.levelGameStats.upsert({
              where: { discordId_kind: { discordId: payload.userId, kind } },
              create: { profileId: profile.id, discordId: payload.userId, kind, wins },
              update: { wins },
            });
          }
          imported += 1;
          break;
        }

        case 'NO_XP_CHANNEL': {
          if (options.importSettings === false) {
            await markItem(item, false, null, 'Einstellungen wurden nicht übernommen.');
            continue;
          }
          const payload = item.payload as { channelIds: string[] };
          const merged = [...new Set([...current.noXpChannelIds, ...payload.channelIds])];
          settingsPatch.noXpChannelIds = merged;
          settingsChanged.push('noXpChannelIds');
          imported += 1;
          break;
        }

        case 'CONFIG': {
          if (options.importSettings === false) {
            await markItem(item, false, null, 'Einstellungen wurden nicht übernommen.');
            continue;
          }
          const payload = item.payload as { xpBoost: number | null; announceLevels: string | null };
          if (payload.xpBoost !== null && payload.xpBoost >= 0) {
            settingsPatch.xpBoost = payload.xpBoost;
            settingsChanged.push('xpBoost');
          }
          if (payload.announceLevels !== null) {
            settingsPatch.announceLevels = payload.announceLevels;
            settingsChanged.push('announceLevels');
          }
          imported += 1;
          break;
        }

        case 'GUILD_CONFIG': {
          if (options.importSettings === false) {
            await markItem(item, false, null, 'Einstellungen wurden nicht übernommen.');
            continue;
          }
          const payload = item.payload as {
            voiceMuteEnabled: boolean;
            voiceMuteCooldownSeconds: number;
            muteLevels: 'sound' | 'voice' | 'beide';
            xpWhileAlone: boolean;
          };
          settingsPatch.voiceMuteBlocksXp = payload.voiceMuteEnabled;
          settingsPatch.voiceMuteCooldownSeconds = payload.voiceMuteCooldownSeconds;
          settingsPatch.voiceMuteMode = payload.muteLevels;
          settingsPatch.xpWhileAlone = payload.xpWhileAlone;
          settingsChanged.push('voiceMuteBlocksXp', 'voiceMuteCooldownSeconds', 'voiceMuteMode', 'xpWhileAlone');
          imported += 1;
          break;
        }

        default:
          break;
      }

      await markItem(item, true, null, null);
    } catch (error) {
      failed += 1;
      log.warn('Zeile konnte nicht übernommen werden', {
        importId,
        legacyKey: item.legacyKey,
        error: error instanceof Error ? error.message : String(error),
      });
      await markItem(item, false, null, error instanceof Error ? error.message : 'Unbekannter Fehler.');
    }
  }

  let settingsError: string | null = null;
  if (Object.keys(settingsPatch).length > 0) {
    try {
      await updateLevelSettings(actor, settingsPatch);
    } catch (error) {
      // Nicht verschlucken: sonst meldet die Übernahme Erfolg, während die
      // Einstellungen unverändert geblieben sind.
      settingsError = error instanceof AppError ? error.userMessage : 'Unbekannter Fehler.';
      settingsChanged.length = 0;
      failed += 1;
      log.warn('Einstellungen konnten nicht übernommen werden', { importId, error: settingsError });
    }
  }

  const finished = await prisma.levelImport.update({
    where: { id: importId },
    data: {
      status: imported === 0 && failed > 0 ? 'FAILED' : 'IMPORTED',
      importedRows: imported,
      failedRows: failed,
      legacyBotStopped: true,
      confirmedByDiscordId: actor.discordId,
      confirmedAt: new Date(),
      finishedAt: new Date(),
    },
  });

  await safeRecordAudit({
    action:
      finished.status === 'IMPORTED'
        ? AUDIT_ACTIONS.LEVEL_IMPORT_COMPLETED
        : AUDIT_ACTIONS.LEVEL_IMPORT_FAILED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: finished.status === 'IMPORTED',
    metadata: {
      importId,
      fileName: run.fileName,
      sha256: run.fileSha256,
      imported,
      failed,
      totalXp,
      settingsChanged: [...new Set(settingsChanged)],
      settingsError,
    },
  });

  log.info('Altdaten übernommen', { importId, imported, failed, totalXp });

  return {
    importId,
    imported,
    skipped: run.totalRows - items.length,
    failed,
    totalXp,
    settingsChanged: [...new Set(settingsChanged)],
    settingsError,
  };
}

async function markItem(
  item: LevelImportItem,
  imported: boolean,
  targetId: string | null,
  note: string | null,
): Promise<void> {
  await prisma.levelImportItem.update({
    where: { id: item.id },
    data: { imported, targetId, ...(note ? { note } : {}) },
  });
}

/** Verwirft einen analysierten Lauf, ohne etwas zu übernehmen. */
export async function discardLevelImport(actor: ImportActor, importId: string): Promise<void> {
  const run = await prisma.levelImport.findUnique({ where: { id: importId } });
  if (!run) {
    return;
  }
  if (run.status === 'IMPORTED') {
    throw conflict('Eine bereits übernommene Datei lässt sich nicht mehr verwerfen.');
  }
  await prisma.levelImport.delete({ where: { id: importId } });
  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_IMPORT_DISCARDED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId, fileName: run.fileName },
  });
}

export async function listLevelImports(limit = 20): Promise<LevelImport[]> {
  return prisma.levelImport.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}

export async function getLevelImport(
  importId: string,
): Promise<(LevelImport & { items: LevelImportItem[] }) | null> {
  return prisma.levelImport.findUnique({
    where: { id: importId },
    include: { items: { orderBy: { createdAt: 'asc' }, take: 500 } },
  });
}

// --- Übernahme aus der alten `.env` -----------------------------------------

export interface EnvImportPreview extends LegacyEnvContents {
  /** Werte, die tatsächlich übernommen würden. */
  applicable: number;
}

/** Liest die erlaubten Werte aus einer hochgeladenen `.env`, ohne zu speichern. */
export function analyseLegacyEnv(data: Uint8Array): EnvImportPreview {
  const contents = readLegacyEnv(data);
  return {
    ...contents,
    applicable: contents.settings.filter((entry) => entry.valid).length,
  };
}

export interface EnvImportResult {
  applied: string[];
  milestones: number;
}

/**
 * Übernimmt ausgewählte Werte aus der alten `.env`.
 *
 * Übernommen wird ausschliesslich, was auf der Positivliste steht **und** in
 * `keys` ausdrücklich ausgewählt wurde. Zugangsdaten sind auf beiden Wegen
 * ausgeschlossen.
 */
export async function applyLegacyEnv(
  actor: ImportActor,
  data: Uint8Array,
  keys: readonly string[],
): Promise<EnvImportResult> {
  const contents = readLegacyEnv(data);
  const selected = new Set(keys);
  const patch: Partial<LevelSettings> = {};
  const applied: string[] = [];

  for (const entry of contents.settings) {
    if (!entry.valid || !selected.has(entry.key) || entry.target === null) {
      continue;
    }
    (patch as Record<string, unknown>)[entry.target] = entry.value;
    applied.push(entry.key);
  }

  if (Object.keys(patch).length > 0) {
    await updateLevelSettings(actor, patch);
  }

  let milestones = 0;
  if (selected.has('MILESTONE_ROLES')) {
    for (const entry of contents.milestones) {
      await prisma.levelMilestoneRole.upsert({
        where: { level: entry.level },
        create: { level: entry.level, roleId: entry.roleId },
        update: { roleId: entry.roleId },
      });
      milestones += 1;
    }
    if (milestones > 0) {
      applied.push('MILESTONE_ROLES');
    }
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.LEVEL_IMPORT_CONFIRMED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    // Nur die Namen der übernommenen Einstellungen, keine Werte - und
    // ausschliesslich Namen von der Positivliste.
    metadata: { source: 'legacy-env', applied, milestones },
  });

  return { applied, milestones };
}
