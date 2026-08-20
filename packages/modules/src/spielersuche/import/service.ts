import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import type {
  Prisma,
  SpielersucheImport,
  SpielersucheImportAction,
  SpielersucheImportItem,
  SpielersucheImportKind,
} from '@swisshub/database';
import { SPIELERSUCHE_MODULE_ID } from '../config';
import { normalizeBannerUrl } from '../schemas';
import { readLegacyDatabase, type LegacyDatabaseContents } from './reader';

const log = createLogger('spielersuche:import');

/**
 * Übernahme der alten Spielersuche-Datenbank.
 *
 * Zwei getrennte Schritte, wie beim Jail-Import:
 *
 *   1. **Analysieren** - Datei lesen, jede Zeile bewerten, Ergebnis speichern.
 *      Es entsteht kein einziger Datensatz im Modul.
 *   2. **Übernehmen** - erst nach ausdrücklicher Bestätigung, in einer
 *      Transaktion.
 *
 * Die Altdatenbank kann mehrere Server enthalten. Diese Anwendung verwaltet
 * genau einen, deshalb entscheidet eine ausgewählte Guild-ID, welche Zeilen
 * überhaupt in Frage kommen - alles andere wird sichtbar übersprungen statt
 * stillschweigend vermischt.
 *
 * Übernommen werden Konfiguration, Spiele und die vollständige Historie
 * (Suchen, Teilnahmen, Nutzung, Voice-Zeit). Laufende Suchen werden bewusst
 * **nicht** wieder geöffnet: ihre Discord-Nachricht gehört dem alten Bot,
 * dessen Buttons nach dem Stopp niemand mehr bedient. Sie kommen als
 * geschlossene Historie herein.
 */

const SNOWFLAKE = /^\d{17,20}$/u;

export interface ImportActor {
  discordId: string;
  username: string;
}

interface PlannedItem {
  kind: SpielersucheImportKind;
  legacyKey: string;
  label: string;
  action: SpielersucheImportAction;
  note: string | null;
  payload: Record<string, unknown>;
}

/** Python-Zeitstempel (`datetime.isoformat()`) einlesen. */
export function parseLegacyTimestamp(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const year = parsed.getUTCFullYear();
  return year >= 2015 && year <= 2100 ? parsed : null;
}

/** Legacy-Status auf den Zustand des neuen Modells abbilden. */
export function mapLegacyStatus(status: string | null): 'CLOSED' | 'EXPIRED' | 'COMPLETE' {
  switch ((status ?? 'closed').trim().toLowerCase()) {
    case 'expired':
      return 'EXPIRED';
    case 'complete':
      return 'COMPLETE';
    default:
      return 'CLOSED';
  }
}

export interface AnalyseResult {
  importRecord: SpielersucheImport;
  items: SpielersucheImportItem[];
  /** Guilds in der Datei - die Oberfläche zeigt sie zur Auswahl. */
  guilds: LegacyDatabaseContents['guilds'];
}

/**
 * Schritt 1: Datei lesen und bewerten.
 *
 * `sourceGuildId` bestimmt, welcher Server übernommen wird. Ohne Angabe wird
 * der Server mit den meisten Daten vorgeschlagen.
 */
export async function analyseLegacyImport(
  data: Uint8Array,
  fileName: string,
  actor: ImportActor,
  options: { sourceGuildId?: string | null } = {},
): Promise<AnalyseResult> {
  const contents = await readLegacyDatabase(data);
  const sourceGuildId =
    options.sourceGuildId && contents.guilds.some((entry) => entry.guildId === options.sourceGuildId)
      ? options.sourceGuildId
      : (contents.guilds[0]?.guildId ?? null);

  const items = await planItems(contents, sourceGuildId);
  const counts = countActions(items);

  const importRecord = await prisma.spielersucheImport.create({
    data: {
      fileName: sanitizeText(fileName, 200) || 'matchmaking.db',
      fileBytes: contents.bytes,
      fileSha256: contents.sha256,
      status: 'ANALYSED',
      sourceGuildId,
      schemaInfo: {
        tables: contents.schema,
        guilds: contents.guilds,
      } as unknown as Prisma.InputJsonValue,
      totalRows: items.length,
      ...counts,
      uploadedByDiscordId: actor.discordId,
      uploadedByUsername: actor.username,
      items: {
        create: items.map((item) => ({
          kind: item.kind,
          legacyKey: item.legacyKey,
          label: item.label,
          action: item.action,
          note: item.note,
          payload: item.payload as unknown as Prisma.InputJsonValue,
        })),
      },
    },
    include: { items: { orderBy: [{ kind: 'asc' }, { legacyKey: 'asc' }], take: 400 } },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_IMPORT_STARTED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: {
      importId: importRecord.id,
      sourceGuildId,
      totalRows: importRecord.totalRows,
      importableRows: importRecord.importableRows,
      sha256: contents.sha256,
    },
  });

  log.info('Legacy-Spielersuche analysiert', {
    importId: importRecord.id,
    total: importRecord.totalRows,
    importable: importRecord.importableRows,
  });

  return { importRecord, items: importRecord.items, guilds: contents.guilds };
}

/**
 * Bewertet jede Zeile der Altdatenbank.
 *
 * Die Reihenfolge ist bewusst: Einstellungen, Spiele, Suchen, Teilnahmen,
 * Nutzung, Voice-Zeit - so, wie sie später auch übernommen werden.
 */
async function planItems(
  contents: LegacyDatabaseContents,
  sourceGuildId: string | null,
): Promise<PlannedItem[]> {
  const items: PlannedItem[] = [];
  const belongsToGuild = (guildId: string): boolean => sourceGuildId !== null && guildId === sourceGuildId;

  // Bereits übernommene Zeilen erkennen - der Import ist wiederholbar.
  const [knownGames, knownMatches, knownUsages, knownVoice, existingGames] = await Promise.all([
    prisma.spielersucheGame.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true } }),
    prisma.spielersucheMatch.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true } }),
    prisma.spielersucheUsage.findMany({ where: { legacyId: { not: null } }, select: { legacyId: true } }),
    prisma.spielersucheVoiceSession.findMany({
      where: { legacyId: { not: null } },
      select: { legacyId: true },
    }),
    prisma.spielersucheGame.findMany({ select: { nameKey: true, legacyId: true } }),
  ]);

  const knownGameIds = new Set(knownGames.map((row) => row.legacyId));
  const knownMatchIds = new Set(knownMatches.map((row) => row.legacyId));
  const knownUsageIds = new Set(knownUsages.map((row) => row.legacyId));
  const knownVoiceIds = new Set(knownVoice.map((row) => row.legacyId));
  const nameToLegacyId = new Map(existingGames.map((row) => [row.nameKey, row.legacyId]));

  // --- Einstellungen -------------------------------------------------------
  for (const entry of contents.settings) {
    const relevant = belongsToGuild(entry.guildId);
    items.push({
      kind: 'SETTINGS',
      legacyKey: `settings:${entry.guildId}`,
      label: `Konfiguration von Server ${entry.guildId}`,
      action: relevant ? 'IMPORT' : 'SKIP_OTHER_GUILD',
      note: relevant
        ? 'Wird als Startwert übernommen; danach bleibt das Dashboard massgeblich.'
        : 'Gehört zu einem anderen Server.',
      payload: {
        searchChannelId: entry.searchChannelId,
        voiceCategoryId: entry.voiceCategoryId,
        expiryHours: entry.expiryHours,
        accentColor: entry.accentColor,
      },
    });
  }

  // --- Spiele --------------------------------------------------------------
  const importedGameIds = new Set<number>();
  for (const game of contents.games) {
    const key = `game:${game.id}`;
    const nameKey = game.name.trim().toLowerCase();
    const base: PlannedItem = {
      kind: 'GAME',
      legacyKey: key,
      label: game.name || `Spiel #${game.id}`,
      action: 'IMPORT',
      note: null,
      payload: {
        legacyId: game.id,
        name: game.name,
        roleId: game.roleId,
        bannerUrl: normalizeBannerUrl(game.imageUrl),
        maxSquadSize: game.userLimit,
      },
    };

    if (!belongsToGuild(game.guildId)) {
      items.push({ ...base, action: 'SKIP_OTHER_GUILD', note: 'Gehört zu einem anderen Server.' });
      continue;
    }
    if (knownGameIds.has(game.id)) {
      items.push({ ...base, action: 'SKIP_DUPLICATE', note: 'Wurde bereits importiert.' });
      importedGameIds.add(game.id);
      continue;
    }
    if (game.name.trim().length < 2 || !game.roleId) {
      items.push({
        ...base,
        action: 'SKIP_INVALID',
        note: !game.roleId ? 'Keine gültige Rollen-ID.' : 'Kein brauchbarer Name.',
      });
      continue;
    }
    // Gleicher Name, aber ein anderer Ursprung: der bestehende Eintrag bleibt.
    const existingLegacyId = nameToLegacyId.get(nameKey);
    if (existingLegacyId !== undefined) {
      items.push({
        ...base,
        action: 'CONFLICT',
        note: `Es gibt bereits ein Spiel "${game.name}". Der bestehende Eintrag bleibt unverändert.`,
      });
      continue;
    }

    const notes: string[] = [];
    if (!normalizeBannerUrl(game.imageUrl)) {
      notes.push(
        game.imageUrl ? 'Banner ist keine gültige https-Adresse und wird weggelassen.' : 'Kein Banner.',
      );
    }
    if (game.userLimit === null) {
      notes.push('Squad-Grösse unbegrenzt.');
    }
    items.push({ ...base, note: notes.length > 0 ? notes.join(' ') : null });
    importedGameIds.add(game.id);
  }

  // --- Suchen --------------------------------------------------------------
  // Zwei getrennte Mengen: `newMatchIds` sind die Suchen, die in diesem
  // Durchgang tatsächlich entstehen. Nur deren Teilnehmer dürfen angelegt
  // werden - bei einer bereits importierten Suche gibt es sie schon, und ein
  // zweiter Versuch würde am Unique-Index scheitern.
  const newMatchIds = new Set<number>();
  const importedMatchIds = new Set<number>();
  for (const match of contents.matches) {
    const key = `match:${match.id}`;
    const createdAt = parseLegacyTimestamp(match.createdAt);
    const base: PlannedItem = {
      kind: 'MATCH',
      legacyKey: key,
      label: `#${match.id} · ${match.game}`,
      action: 'IMPORT',
      note: null,
      payload: {
        legacyId: match.id,
        legacyGameId: match.gameId,
        game: match.game,
        creatorId: match.creatorId,
        pingRoleId: match.pingRoleId,
        bannerUrl: normalizeBannerUrl(match.imageUrl),
        requestedPlayers: match.requestedPlayers,
        details: match.details,
        status: mapLegacyStatus(match.status),
        channelId: match.channelId,
        messageId: match.messageId,
        createdAt: createdAt?.toISOString() ?? null,
        expiresAt: parseLegacyTimestamp(match.expiresAt)?.toISOString() ?? null,
        closedAt: parseLegacyTimestamp(match.closedAt)?.toISOString() ?? null,
      },
    };

    if (!belongsToGuild(match.guildId)) {
      items.push({ ...base, action: 'SKIP_OTHER_GUILD', note: 'Gehört zu einem anderen Server.' });
      continue;
    }
    if (knownMatchIds.has(match.id)) {
      items.push({ ...base, action: 'SKIP_DUPLICATE', note: 'Wurde bereits importiert.' });
      importedMatchIds.add(match.id);
      continue;
    }
    if (!match.creatorId || !SNOWFLAKE.test(match.creatorId) || !createdAt) {
      items.push({
        ...base,
        action: 'SKIP_INVALID',
        note: !createdAt ? 'Zeitpunkt konnte nicht gelesen werden.' : 'Keine gültige Discord-ID.',
      });
      continue;
    }

    const wasActive = ['open', 'complete'].includes((match.status ?? '').toLowerCase());
    items.push({
      ...base,
      note: wasActive
        ? 'War beim Export noch offen. Wird als beendete Historie übernommen - die Discord-Nachricht gehört dem alten Bot.'
        : null,
    });
    importedMatchIds.add(match.id);
    newMatchIds.add(match.id);
  }

  // --- Teilnahmen ----------------------------------------------------------
  for (const participant of contents.participants) {
    const key = `participant:${participant.matchId}:${participant.userId}`;
    const base: PlannedItem = {
      kind: 'PARTICIPANT',
      legacyKey: key,
      label: `Teilnahme an #${participant.matchId}`,
      action: 'IMPORT',
      note: null,
      payload: {
        legacyMatchId: participant.matchId,
        discordId: participant.userId,
        joinedAt: parseLegacyTimestamp(participant.joinedAt)?.toISOString() ?? null,
      },
    };

    if (!participant.userId || !SNOWFLAKE.test(participant.userId)) {
      items.push({ ...base, action: 'SKIP_INVALID', note: 'Keine gültige Discord-ID.' });
      continue;
    }
    if (importedMatchIds.has(participant.matchId) && !newMatchIds.has(participant.matchId)) {
      items.push({
        ...base,
        action: 'SKIP_DUPLICATE',
        note: 'Die zugehörige Suche wurde bereits importiert.',
      });
      continue;
    }
    if (!newMatchIds.has(participant.matchId)) {
      items.push({
        ...base,
        action: 'SKIP_OTHER_GUILD',
        note: 'Die zugehörige Suche wird nicht übernommen.',
      });
      continue;
    }
    items.push(base);
  }

  // --- Nutzung -------------------------------------------------------------
  for (const usage of contents.usages) {
    const key = `usage:${usage.id}`;
    const usedAt = parseLegacyTimestamp(usage.usedAt);
    const base: PlannedItem = {
      kind: 'USAGE',
      legacyKey: key,
      label: `Nutzung ${usage.commandName ?? 'spielersuche'}`,
      action: 'IMPORT',
      note: null,
      payload: {
        legacyId: usage.id,
        discordId: usage.userId,
        command: usage.commandName,
        usedAt: usedAt?.toISOString() ?? null,
      },
    };

    if (!belongsToGuild(usage.guildId)) {
      items.push({ ...base, action: 'SKIP_OTHER_GUILD', note: 'Gehört zu einem anderen Server.' });
      continue;
    }
    if (knownUsageIds.has(usage.id)) {
      items.push({ ...base, action: 'SKIP_DUPLICATE', note: 'Wurde bereits importiert.' });
      continue;
    }
    if (!usage.userId || !SNOWFLAKE.test(usage.userId) || !usedAt) {
      items.push({ ...base, action: 'SKIP_INVALID', note: 'Unvollständige Zeile.' });
      continue;
    }
    items.push(base);
  }

  // --- Voice-Zeit ----------------------------------------------------------
  for (const session of contents.voiceSessions) {
    const key = `voice:${session.id}`;
    const joinedAt = parseLegacyTimestamp(session.joinedAt);
    const leftAt = parseLegacyTimestamp(session.leftAt);
    const base: PlannedItem = {
      kind: 'VOICE_SESSION',
      legacyKey: key,
      label: `Voice-Session #${session.id}`,
      action: 'IMPORT',
      note: null,
      payload: {
        legacyId: session.id,
        legacyMatchId: session.matchId,
        discordId: session.userId,
        voiceChannelId: session.voiceChannelId,
        joinedAt: joinedAt?.toISOString() ?? null,
        leftAt: leftAt?.toISOString() ?? null,
        durationSeconds: session.durationSeconds,
      },
    };

    if (!belongsToGuild(session.guildId)) {
      items.push({ ...base, action: 'SKIP_OTHER_GUILD', note: 'Gehört zu einem anderen Server.' });
      continue;
    }
    if (knownVoiceIds.has(session.id)) {
      items.push({ ...base, action: 'SKIP_DUPLICATE', note: 'Wurde bereits importiert.' });
      continue;
    }
    if (!session.userId || !SNOWFLAKE.test(session.userId) || !joinedAt || !session.voiceChannelId) {
      items.push({ ...base, action: 'SKIP_INVALID', note: 'Unvollständige Zeile.' });
      continue;
    }
    if (!leftAt) {
      // Eine Session ohne Ende ist beim alten Bot hängengeblieben. Sie wird
      // mit der gespeicherten Dauer übernommen, aber nie als "läuft noch".
      items.push({
        ...base,
        note: 'Ohne Endzeitpunkt - wird mit der gespeicherten Dauer als abgeschlossen übernommen.',
      });
      continue;
    }
    items.push(base);
  }

  // --- Rollen-Ping ---------------------------------------------------------
  // Ein alter Ping darf nach der Umstellung niemanden blockieren; nur noch
  // aktuelle Einträge werden übernommen.
  const cooldownHorizon = Date.now() - 60 * 60 * 1000;
  for (const ping of contents.rolePings) {
    const key = `ping:${ping.gameId}`;
    const pingedAt = parseLegacyTimestamp(ping.pingedAt);
    const base: PlannedItem = {
      kind: 'ROLE_PING',
      legacyKey: key,
      label: `Letzter Ping für Spiel #${ping.gameId}`,
      action: 'IMPORT',
      note: null,
      payload: {
        legacyGameId: ping.gameId,
        roleId: ping.roleId,
        pingedAt: pingedAt?.toISOString() ?? null,
      },
    };

    if (!belongsToGuild(ping.guildId)) {
      items.push({ ...base, action: 'SKIP_OTHER_GUILD', note: 'Gehört zu einem anderen Server.' });
      continue;
    }
    if (!pingedAt || pingedAt.getTime() < cooldownHorizon) {
      items.push({
        ...base,
        action: 'SKIP_INVALID',
        note: 'Zu alt, um noch eine Sperrfrist auszulösen.',
      });
      continue;
    }
    items.push(base);
  }

  return items;
}

function countActions(items: readonly PlannedItem[]): {
  importableRows: number;
  duplicateRows: number;
  invalidRows: number;
  otherGuildRows: number;
  conflictRows: number;
} {
  const by = (action: SpielersucheImportAction): number =>
    items.filter((item) => item.action === action).length;
  return {
    // Die Konfiguration zählt nicht mit: sie wird nur auf ausdrücklichen
    // Wunsch übernommen und liesse sich beliebig oft erneut anwenden. Würde
    // sie mitzählen, käme ein wiederholter Import nie auf "nichts zu tun".
    importableRows: items.filter((item) => item.action === 'IMPORT' && item.kind !== 'SETTINGS').length,
    duplicateRows: by('SKIP_DUPLICATE'),
    invalidRows: by('SKIP_INVALID'),
    otherGuildRows: by('SKIP_OTHER_GUILD'),
    conflictRows: by('CONFLICT'),
  };
}

export interface ExecuteImportResult {
  importRecord: SpielersucheImport;
  games: number;
  matches: number;
  participants: number;
  usages: number;
  voiceSessions: number;
  rolePings: number;
  settingsApplied: boolean;
}

/**
 * Schritt 2: übernehmen.
 *
 * Alle Einfügungen laufen in einer Transaktion - entweder alle oder keine.
 * Discord wird dabei nicht angefasst.
 */
export async function executeLegacyImport(
  importId: string,
  actor: ImportActor,
  options: {
    legacyBotStopped: boolean;
    applySettings?: boolean;
    gateway?: DiscordGateway;
  } = { legacyBotStopped: false },
): Promise<ExecuteImportResult> {
  const gateway = options.gateway ?? defaultDiscord;

  if (!options.legacyBotStopped) {
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Bitte zuerst bestätigen, dass der alte Spielersuche-Bot gestoppt ist. Zwei laufende Bots würden doppelte Suchen, doppelte Pings und doppelte Sprachkanäle erzeugen.',
    });
  }

  const record = await prisma.spielersucheImport.findUnique({
    where: { id: importId },
    include: { items: { where: { action: 'IMPORT' }, orderBy: { legacyKey: 'asc' } } },
  });
  if (!record) {
    throw new AppError('NOT_FOUND', { userMessage: 'Der Import wurde nicht gefunden.' });
  }
  if (record.status === 'COMPLETED') {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Import wurde bereits durchgeführt.' });
  }

  const claimed = await prisma.spielersucheImport.updateMany({
    where: { id: importId, status: { in: ['ANALYSED', 'CONFIRMED', 'FAILED'] } },
    data: {
      status: 'IMPORTING',
      legacyBotStopped: true,
      confirmedByDiscordId: actor.discordId,
      confirmedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Import wird bereits ausgeführt.' });
  }

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_IMPORT_CONFIRMED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId, rows: record.items.length, applySettings: options.applySettings ?? false },
  });

  const counters = {
    games: 0,
    matches: 0,
    participants: 0,
    usages: 0,
    voiceSessions: 0,
    rolePings: 0,
  };
  let settingsApplied = false;

  try {
    await prisma.$transaction(async (tx) => {
      // Legacy-Spiel-ID -> neue ID; wird für Suchen und Pings gebraucht.
      const gameIdByLegacy = new Map<number, string>();
      const existingGames = await tx.spielersucheGame.findMany({
        where: { legacyId: { not: null } },
        select: { id: true, legacyId: true },
      });
      for (const game of existingGames) {
        if (game.legacyId !== null) {
          gameIdByLegacy.set(game.legacyId, game.id);
        }
      }

      const byKind = (kind: SpielersucheImportKind): SpielersucheImportItem[] =>
        record.items.filter((item) => item.kind === kind);

      // --- Spiele ----------------------------------------------------------
      for (const item of byKind('GAME')) {
        const payload = item.payload as {
          legacyId: number;
          name: string;
          roleId: string;
          bannerUrl: string | null;
          maxSquadSize: number | null;
        };
        const created = await tx.spielersucheGame.create({
          data: {
            name: payload.name,
            nameKey: payload.name.trim().toLowerCase(),
            roleId: payload.roleId,
            bannerUrl: payload.bannerUrl,
            maxSquadSize: payload.maxSquadSize,
            enabled: true,
            legacyId: payload.legacyId,
            createdByDiscordId: actor.discordId,
          },
        });
        gameIdByLegacy.set(payload.legacyId, created.id);
        await tx.spielersucheImportItem.update({
          where: { id: item.id },
          data: { imported: true, targetId: created.id },
        });
        counters.games += 1;
      }

      // --- Suchen ----------------------------------------------------------
      const matchIdByLegacy = new Map<number, string>();
      const existingMatches = await tx.spielersucheMatch.findMany({
        where: { legacyId: { not: null } },
        select: { id: true, legacyId: true },
      });
      for (const match of existingMatches) {
        if (match.legacyId !== null) {
          matchIdByLegacy.set(match.legacyId, match.id);
        }
      }

      for (const item of byKind('MATCH')) {
        const payload = item.payload as {
          legacyId: number;
          legacyGameId: number | null;
          game: string;
          creatorId: string;
          pingRoleId: string | null;
          bannerUrl: string | null;
          requestedPlayers: number | null;
          details: string | null;
          status: 'CLOSED' | 'EXPIRED' | 'COMPLETE';
          channelId: string | null;
          messageId: string | null;
          createdAt: string | null;
          expiresAt: string | null;
          closedAt: string | null;
        };

        const createdAt = payload.createdAt ? new Date(payload.createdAt) : new Date();
        const created = await tx.spielersucheMatch.create({
          data: {
            creatorDiscordId: payload.creatorId,
            // Namen kennt die Altdatenbank nicht - die ID bleibt eindeutig und
            // ehrlicher als ein erfundener Name.
            creatorUsername: payload.creatorId,
            gameId: payload.legacyGameId ? (gameIdByLegacy.get(payload.legacyGameId) ?? null) : null,
            gameName: payload.game || 'Unbekannt',
            pingRoleId: payload.pingRoleId,
            bannerUrl: payload.bannerUrl,
            requestedPlayers: Math.max(1, payload.requestedPlayers ?? 1),
            comment: payload.details,
            // Beendet: eine alte Suche wird nie wieder aktiv.
            status: payload.status === 'COMPLETE' ? 'CLOSED' : payload.status,
            source: 'LEGACY_IMPORT',
            channelId: payload.channelId,
            messageId: payload.messageId,
            createdAt,
            expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : createdAt,
            closedAt: payload.closedAt ? new Date(payload.closedAt) : createdAt,
            closeReason: 'LEGACY_IMPORT',
            legacyId: payload.legacyId,
            importId,
          },
        });
        matchIdByLegacy.set(payload.legacyId, created.id);
        await tx.spielersucheImportItem.update({
          where: { id: item.id },
          data: { imported: true, targetId: created.id },
        });
        counters.matches += 1;
      }

      // --- Teilnahmen ------------------------------------------------------
      for (const item of byKind('PARTICIPANT')) {
        const payload = item.payload as {
          legacyMatchId: number;
          discordId: string;
          joinedAt: string | null;
        };
        const matchId = matchIdByLegacy.get(payload.legacyMatchId);
        if (!matchId) {
          continue;
        }
        // Doppelte Zeilen in der Altdatenbank oder ein wiederholter Durchgang
        // dürfen den Import nicht scheitern lassen.
        const already = await tx.spielersucheParticipant.findUnique({
          where: { matchId_discordId: { matchId, discordId: payload.discordId } },
        });
        if (already) {
          continue;
        }
        const match = await tx.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } });
        const created = await tx.spielersucheParticipant.create({
          data: {
            matchId,
            discordId: payload.discordId,
            isCreator: match.creatorDiscordId === payload.discordId,
            joinedAt: payload.joinedAt ? new Date(payload.joinedAt) : match.createdAt,
            // Historisch: die Teilnahme ist längst beendet.
            leftAt: match.closedAt ?? match.createdAt,
          },
        });
        await tx.spielersucheImportItem.update({
          where: { id: item.id },
          data: { imported: true, targetId: created.id },
        });
        counters.participants += 1;
      }

      // --- Nutzung ---------------------------------------------------------
      for (const item of byKind('USAGE')) {
        const payload = item.payload as { legacyId: number; discordId: string; usedAt: string };
        const created = await tx.spielersucheUsage.create({
          data: {
            discordId: payload.discordId,
            // Der alte Bot schrieb je nach Version `spielersuche` oder
            // `spielersuechi`. Beides wird vereinheitlicht - sonst zählte die
            // Statistik einen Teil der Nutzung nicht mit.
            command: 'spielersuche',
            source: 'LEGACY_IMPORT',
            usedAt: new Date(payload.usedAt),
            legacyId: payload.legacyId,
          },
        });
        await tx.spielersucheImportItem.update({
          where: { id: item.id },
          data: { imported: true, targetId: created.id },
        });
        counters.usages += 1;
      }

      // --- Voice-Zeit ------------------------------------------------------
      for (const item of byKind('VOICE_SESSION')) {
        const payload = item.payload as {
          legacyId: number;
          legacyMatchId: number | null;
          discordId: string;
          voiceChannelId: string;
          joinedAt: string;
          leftAt: string | null;
          durationSeconds: number | null;
        };
        const joinedAt = new Date(payload.joinedAt);
        const leftAt = payload.leftAt ? new Date(payload.leftAt) : null;
        // Ohne Endzeitpunkt zählt die gespeicherte Dauer; sonst entstünde aus
        // einer hängengebliebenen Session eine unendliche Voice-Zeit.
        const duration =
          payload.durationSeconds ??
          (leftAt ? Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 1000)) : 0);

        const created = await tx.spielersucheVoiceSession.create({
          data: {
            discordId: payload.discordId,
            matchId: payload.legacyMatchId ? (matchIdByLegacy.get(payload.legacyMatchId) ?? null) : null,
            voiceChannelId: payload.voiceChannelId,
            joinedAt,
            leftAt: leftAt ?? new Date(joinedAt.getTime() + duration * 1000),
            durationSeconds: Math.max(0, duration),
            legacyId: payload.legacyId,
          },
        });
        await tx.spielersucheImportItem.update({
          where: { id: item.id },
          data: { imported: true, targetId: created.id },
        });
        counters.voiceSessions += 1;
      }

      // --- Rollen-Ping -----------------------------------------------------
      for (const item of byKind('ROLE_PING')) {
        const payload = item.payload as {
          legacyGameId: number;
          roleId: string | null;
          pingedAt: string;
        };
        const gameId = gameIdByLegacy.get(payload.legacyGameId);
        if (!gameId || !payload.roleId) {
          continue;
        }
        await tx.spielersucheRolePing.upsert({
          where: { gameId },
          create: { gameId, roleId: payload.roleId, pingedAt: new Date(payload.pingedAt) },
          update: { roleId: payload.roleId, pingedAt: new Date(payload.pingedAt) },
        });
        await tx.spielersucheImportItem.update({
          where: { id: item.id },
          data: { imported: true, targetId: gameId },
        });
        counters.rolePings += 1;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    await prisma.spielersucheImport.update({
      where: { id: importId },
      data: { status: 'FAILED', errorMessage: message.slice(0, 500), finishedAt: new Date() },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.SPIELERSUCHE_IMPORT_FAILED,
      module: SPIELERSUCHE_MODULE_ID,
      actorDiscordId: actor.discordId,
      actorUsername: actor.username,
      success: false,
      errorMessage: message.slice(0, 500),
      metadata: { importId },
    });
    log.error('Legacy-Import fehlgeschlagen', { error, importId });
    throw new AppError('INTERNAL', {
      userMessage:
        'Der Import wurde abgebrochen. Es wurde nichts übernommen - die bestehenden Daten sind unverändert.',
      internalMessage: message,
    });
  }

  // --- Einstellungen -------------------------------------------------------
  // Bewusst ausserhalb der Transaktion und nur auf Wunsch: die Werte des alten
  // Bots sind Startwerte, danach bleibt das Dashboard massgeblich.
  if (options.applySettings) {
    settingsApplied = await applyLegacySettings(record, gateway).catch((error: unknown) => {
      log.warn('Legacy-Einstellungen konnten nicht übernommen werden', { error, importId });
      return false;
    });
  }

  const finished = await prisma.spielersucheImport.update({
    where: { id: importId },
    data: {
      status: 'COMPLETED',
      importedRows:
        counters.games +
        counters.matches +
        counters.participants +
        counters.usages +
        counters.voiceSessions +
        counters.rolePings,
      finishedAt: new Date(),
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_IMPORT_COMPLETED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId, ...counters, settingsApplied },
  });

  log.info('Legacy-Spielersuche übernommen', { importId, ...counters });
  return { importRecord: finished, ...counters, settingsApplied };
}

/**
 * Übernimmt Channel, Kategorie, Ablaufzeit und Farbe als Startwerte.
 *
 * Nur Werte, die auf Discord tatsächlich existieren - eine tote Channel-ID
 * wäre schlechter als gar keine.
 */
async function applyLegacySettings(record: SpielersucheImport, gateway: DiscordGateway): Promise<boolean> {
  const item = await prisma.spielersucheImportItem.findFirst({
    where: { importId: record.id, kind: 'SETTINGS', action: 'IMPORT' },
  });
  if (!item) {
    return false;
  }

  const payload = item.payload as {
    searchChannelId: string | null;
    voiceCategoryId: string | null;
    expiryHours: number | null;
    accentColor: number | null;
  };

  const channels = await gateway.channels.list({ force: true }).catch(() => []);
  const exists = (id: string | null): boolean => id !== null && channels.some((entry) => entry.id === id);

  const { getModuleSettings, setModuleSettings } = await import('../../module-state');
  const current = await getModuleSettings<Record<string, unknown>>(SPIELERSUCHE_MODULE_ID);

  const next: Record<string, unknown> = { ...current };
  if (exists(payload.searchChannelId)) {
    next.searchChannelId = payload.searchChannelId;
  }
  if (exists(payload.voiceCategoryId)) {
    next.voiceCategoryId = payload.voiceCategoryId;
  }
  if (payload.expiryHours && payload.expiryHours >= 1 && payload.expiryHours <= 168) {
    next.expiryHours = payload.expiryHours;
  }
  if (payload.accentColor !== null && payload.accentColor >= 0 && payload.accentColor <= 0xffffff) {
    next.accentColor = `#${payload.accentColor.toString(16).padStart(6, '0').toUpperCase()}`;
  }

  await setModuleSettings(SPIELERSUCHE_MODULE_ID, next, record.uploadedByDiscordId);
  await prisma.spielersucheImportItem.update({ where: { id: item.id }, data: { imported: true } });
  return true;
}

/** Verwirft eine Analyse, ohne etwas zu übernehmen. */
export async function discardLegacyImport(importId: string, actor: ImportActor): Promise<void> {
  const record = await prisma.spielersucheImport.findUnique({ where: { id: importId } });
  if (!record) {
    throw new AppError('NOT_FOUND', { userMessage: 'Der Import wurde nicht gefunden.' });
  }
  if (record.status === 'COMPLETED') {
    throw new AppError('CONFLICT', {
      userMessage: 'Ein abgeschlossener Import lässt sich nicht mehr verwerfen.',
    });
  }

  await prisma.spielersucheImport.update({
    where: { id: importId },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.SPIELERSUCHE_IMPORT_DISCARDED,
    module: SPIELERSUCHE_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId },
  });
}

export const confirmSpielersucheImportSchema = z.object({
  importId: z.string().cuid('Ungültige Import-ID'),
  legacyBotStopped: z.literal(true, {
    errorMap: () => ({ message: 'Bitte bestätigen, dass der alte Spielersuche-Bot gestoppt ist.' }),
  }),
  /** Channel, Kategorie, Ablaufzeit und Farbe als Startwerte übernehmen. */
  applySettings: z.boolean().default(false),
});

export const discardSpielersucheImportSchema = z.object({
  importId: z.string().cuid('Ungültige Import-ID'),
});
