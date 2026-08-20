import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway, type GuildMember } from '@swisshub/discord';
import { createLogger } from '@swisshub/logger';
import { AppError, sanitizeText } from '@swisshub/shared';
import type { JailImport, JailImportRow, JailImportRowAction, Prisma } from '@swisshub/database';
import { JAIL_MODULE_ID } from '../config';
import { loadJailContext } from '../context';
import { reconcileJails } from '../reconciliation';
import { readLegacyDatabase, type LegacyJailRow } from './reader';

const log = createLogger('jail:import');

/**
 * Übernahme der alten Jail-Datenbank.
 *
 * Der Assistent arbeitet in zwei getrennten Schritten:
 *
 *   1. **Analysieren** - die Datei wird gelesen, jede Zeile bewertet und das
 *      Ergebnis gespeichert. Es entsteht noch kein einziger Jail.
 *   2. **Übernehmen** - erst nach ausdrücklicher Bestätigung werden die als
 *      importierbar markierten Zeilen in einer Transaktion angelegt.
 *
 * Der Import ist wiederholbar: jede Legacy-Zeile bekommt über
 * `legacyKey` (`userId:startZeitpunkt`) eine eindeutige Kennung. Ein zweiter
 * Durchgang erkennt sie wieder und legt nichts doppelt an.
 *
 * Rollen werden beim Import **nicht** auf Discord verändert. Der alte Bot hat
 * die Jail-Rolle bereits gesetzt; was davon tatsächlich stimmt, prüft der
 * anschliessende Abgleich (Reconciliation).
 */

const SNOWFLAKE = /^\d{17,20}$/u;
const FALLBACK_REASON = 'Kein Grund angegeben (Übernahme aus dem alten Bot)';

/** Kleinste sinnvolle Dauer, wenn Start und Ende sehr nah beieinander liegen. */
const MIN_DURATION_SECONDS = 60;

export interface LegacyImportActor {
  discordId: string;
  username: string;
}

interface MappedRow {
  legacyKey: string;
  targetDiscordId: string;
  roleIds: string[];
  moderatorDiscordId: string | null;
  reason: string | null;
  startedAt: Date | null;
  endsAt: Date | null;
  permanent: boolean;
  gender: string | null;
  legacyStatus: string | null;
  action: JailImportRowAction;
  note: string | null;
}

/**
 * Wandelt einen ISO-Zeitstempel des alten Bots um.
 *
 * Die Werte stammen aus Python (`datetime.isoformat()`), enthalten also
 * Mikrosekunden und einen Zeitzonen-Offset - beides versteht `Date` direkt.
 * Ein Wert ohne Offset wird als lokale Zeit gelesen; das ist die einzige
 * mögliche Annahme und für die Anzeige unkritisch.
 */
export function parseLegacyTimestamp(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // Offensichtlich unsinnige Werte aussortieren (z.B. Jahr 1 oder 9999).
  const year = parsed.getUTCFullYear();
  if (year < 2015 || year > 2100) {
    return null;
  }
  return parsed;
}

/** Aus der kommaseparierten Rollenliste des alten Bots echte IDs machen. */
export function parseLegacyRoles(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => SNOWFLAKE.test(entry)),
    ),
  ];
}

/** Legacy-Status auf den fachlichen Zustand abbilden. */
export function mapLegacyStatus(status: string | null): 'ACTIVE' | 'PENDING_REJOIN' | 'RESTORE_FAILED' {
  switch ((status ?? 'active').trim().toLowerCase()) {
    // Zeit abgelaufen, Mitglied war beim Freilassen nicht erreichbar.
    case 'expired_pending_restore':
      return 'PENDING_REJOIN';
    // Rollen liessen sich nicht zurückgeben - der alte Bot hat den Eintrag
    // bewusst stehen gelassen, damit nichts verloren geht.
    case 'restore_failed':
      return 'RESTORE_FAILED';
    default:
      return 'ACTIVE';
  }
}

/** Eine Legacy-Zeile in die Form des neuen Modells bringen. */
function mapRow(row: LegacyJailRow): MappedRow {
  const targetDiscordId = (row.user_id ?? '').trim();
  const startedAt = parseLegacyTimestamp(row.jail_start);
  const endsAt = parseLegacyTimestamp(row.jail_end);
  const legacyKey = `${targetDiscordId}:${(row.jail_start ?? '').trim()}`;
  const reason = row.reason ? sanitizeText(row.reason, 500) : null;

  const base: MappedRow = {
    legacyKey,
    targetDiscordId,
    roleIds: parseLegacyRoles(row.roles),
    moderatorDiscordId: row.jailed_by && SNOWFLAKE.test(row.jailed_by.trim()) ? row.jailed_by.trim() : null,
    reason: reason && reason.length > 0 ? reason : null,
    startedAt,
    // `jail_end IS NULL` bedeutet im alten Bot "unbegrenzt". Es wird bewusst
    // kein Ersatzdatum erfunden.
    endsAt,
    permanent: row.jail_end === null || row.jail_end === '',
    gender: row.gender ? row.gender.trim().toLowerCase() : null,
    legacyStatus: row.status ? row.status.trim() : null,
    action: 'IMPORT',
    note: null,
  };

  if (!SNOWFLAKE.test(targetDiscordId)) {
    return { ...base, action: 'SKIP_INVALID', note: 'Keine gültige Discord-ID in `user_id`.' };
  }
  if (!startedAt) {
    return { ...base, action: 'SKIP_INVALID', note: '`jail_start` konnte nicht gelesen werden.' };
  }
  if (!base.permanent && !endsAt) {
    return { ...base, action: 'SKIP_INVALID', note: '`jail_end` konnte nicht gelesen werden.' };
  }

  const notes: string[] = [];
  if (base.roleIds.length === 0) {
    notes.push('Kein Rollen-Snapshot vorhanden - beim Freilassen kehren keine Rollen zurück.');
  }
  if (!base.reason) {
    notes.push('Kein Grund hinterlegt.');
  }
  if (!base.moderatorDiscordId) {
    notes.push('Kein Moderator hinterlegt.');
  }
  if (!base.permanent && endsAt && endsAt <= new Date()) {
    notes.push('Strafe ist bereits abgelaufen - sie wird nach dem Import automatisch beendet.');
  }
  if (base.legacyStatus && base.legacyStatus.toLowerCase() !== 'active') {
    notes.push(`Legacy-Status: ${base.legacyStatus}`);
  }

  return { ...base, note: notes.length > 0 ? notes.join(' ') : null };
}

/** Sperrfristen, die noch in der Zukunft liegen. */
function pendingCooldowns(
  rows: readonly { user_id: string | null; cooldown_until: string | null }[],
): Array<{ discordId: string; expiresAt: string }> {
  const now = Date.now();
  return rows
    .map((row) => ({
      discordId: (row.user_id ?? '').trim(),
      until: parseLegacyTimestamp(row.cooldown_until),
    }))
    .filter(
      (entry): entry is { discordId: string; until: Date } =>
        SNOWFLAKE.test(entry.discordId) && entry.until !== null && entry.until.getTime() > now,
    )
    .map((entry) => ({ discordId: entry.discordId, expiresAt: entry.until.toISOString() }));
}

export interface AnalyseResult {
  importRecord: JailImport;
  rows: JailImportRow[];
}

/**
 * Schritt 1: Datei lesen, bewerten und das Ergebnis festhalten.
 *
 * Verändert ausser den Analysedaten nichts. Es entsteht kein Jail.
 */
export async function analyseLegacyImport(
  data: Uint8Array,
  fileName: string,
  actor: LegacyImportActor,
): Promise<AnalyseResult> {
  const contents = await readLegacyDatabase(data);
  const mapped = contents.jails.map(mapRow);

  // Wiederholter Import: bereits übernommene Zeilen erkennen.
  const candidateKeys = mapped.map((row) => row.legacyKey);
  const [known, activeJails] = await Promise.all([
    prisma.jailEntry.findMany({
      where: { legacyKey: { in: candidateKeys } },
      select: { legacyKey: true },
    }),
    prisma.jailEntry.findMany({
      where: { activeKey: { in: mapped.map((row) => row.targetDiscordId) } },
      select: { activeKey: true, legacyKey: true, source: true },
    }),
  ]);

  const knownKeys = new Set(known.map((entry) => entry.legacyKey));
  const activeByUser = new Map(activeJails.map((entry) => [entry.activeKey as string, entry]));
  const seenKeys = new Set<string>();

  const decided = mapped.map((row) => {
    if (row.action === 'SKIP_INVALID') {
      return row;
    }
    if (knownKeys.has(row.legacyKey)) {
      return { ...row, action: 'SKIP_DUPLICATE' as const, note: 'Wurde bereits importiert.' };
    }
    // Dieselbe Kennung zweimal in einer Datei - bei `user_id` als Primary Key
    // eigentlich unmöglich, aber eine beschädigte Datei soll den Import nicht
    // an einem Unique-Fehler scheitern lassen.
    if (seenKeys.has(row.legacyKey)) {
      return { ...row, action: 'SKIP_DUPLICATE' as const, note: 'Doppelte Zeile in der Datei.' };
    }
    seenKeys.add(row.legacyKey);

    const active = activeByUser.get(row.targetDiscordId);
    if (active) {
      return {
        ...row,
        action: 'CONFLICT' as const,
        note: 'Für dieses Mitglied läuft im Dashboard bereits ein Jail. Die Zeile wird übersprungen.',
      };
    }
    return row;
  });

  const counts = countActions(decided);

  const importRecord = await prisma.jailImport.create({
    data: {
      // Nur zur Anzeige - dieser Name wird nie als Pfad verwendet.
      fileName: sanitizeText(fileName, 200) || 'jail_data.db',
      fileBytes: contents.bytes,
      fileSha256: contents.sha256,
      status: 'ANALYSED',
      schemaInfo: {
        tables: contents.schema,
        // Nur noch laufende Sperrfristen. Abgelaufene hätten keine Wirkung
        // mehr und werden gar nicht erst mitgeschleppt.
        cooldowns: pendingCooldowns(contents.cooldowns),
        // Laufende Abstimmungen des alten Bots werden nicht übernommen: die
        // zugehörige Discord-Nachricht mit dem Button gehört dem alten Bot
        // und wäre nach dessen Stopp ohnehin wirkungslos.
        activeVotes: contents.activeVotes,
      } as unknown as Prisma.InputJsonValue,
      totalRows: decided.length,
      ...counts,
      uploadedByDiscordId: actor.discordId,
      uploadedByUsername: actor.username,
      rows: {
        create: decided.map((row) => ({
          legacyKey: row.legacyKey,
          targetDiscordId: row.targetDiscordId,
          roleIds: row.roleIds,
          moderatorDiscordId: row.moderatorDiscordId,
          reason: row.reason,
          startedAt: row.startedAt,
          endsAt: row.endsAt,
          permanent: row.permanent,
          gender: row.gender,
          legacyStatus: row.legacyStatus,
          action: row.action,
          note: row.note,
        })),
      },
    },
    include: { rows: { orderBy: { startedAt: 'asc' } } },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.JAIL_IMPORT_UPLOADED,
    module: JAIL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: {
      importId: importRecord.id,
      totalRows: importRecord.totalRows,
      importableRows: importRecord.importableRows,
      // Bewusst ohne Dateiinhalt und ohne Prüfsumme der Zugangsdaten.
      sha256: contents.sha256,
    },
  });

  log.info('Legacy-Import analysiert', {
    importId: importRecord.id,
    total: importRecord.totalRows,
    importable: importRecord.importableRows,
  });

  return { importRecord, rows: importRecord.rows };
}

function countActions(rows: readonly { action: JailImportRowAction }[]): {
  importableRows: number;
  duplicateRows: number;
  releasedRows: number;
  invalidRows: number;
  conflictRows: number;
} {
  const by = (action: JailImportRowAction): number => rows.filter((row) => row.action === action).length;
  return {
    importableRows: by('IMPORT'),
    duplicateRows: by('SKIP_DUPLICATE'),
    releasedRows: by('SKIP_RELEASED'),
    invalidRows: by('SKIP_INVALID'),
    conflictRows: by('CONFLICT'),
  };
}

export interface ExecuteImportResult {
  importRecord: JailImport;
  imported: number;
  failed: number;
  cooldowns: number;
  reconciliation: { checked: number; drift: number; repaired: number } | null;
}

/**
 * Schritt 2: die als importierbar markierten Zeilen übernehmen.
 *
 * Die eigentlichen Einfügungen laufen in einer Transaktion - entweder alle
 * oder keine. Discord wird dabei nicht angefasst; der Abgleich danach ist ein
 * eigener, wiederholbarer Schritt.
 */
export async function executeLegacyImport(
  importId: string,
  actor: LegacyImportActor,
  options: { legacyBotStopped: boolean; gateway?: DiscordGateway; reconcile?: boolean } = {
    legacyBotStopped: false,
  },
): Promise<ExecuteImportResult> {
  const gateway = options.gateway ?? defaultDiscord;

  if (!options.legacyBotStopped) {
    // Zwei Bots, die gleichzeitig Jails verwalten, würden sich gegenseitig
    // überschreiben. Deshalb ist die Bestätigung Pflicht.
    throw new AppError('VALIDATION_FAILED', {
      userMessage:
        'Bitte zuerst bestätigen, dass der alte Jail-Bot gestoppt ist. Zwei laufende Bots würden sich gegenseitig überschreiben.',
    });
  }

  const record = await prisma.jailImport.findUnique({
    where: { id: importId },
    include: { rows: { where: { action: 'IMPORT' }, orderBy: { startedAt: 'asc' } } },
  });
  if (!record) {
    throw new AppError('NOT_FOUND', { userMessage: 'Der Import wurde nicht gefunden.' });
  }
  if (record.status === 'COMPLETED') {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Import wurde bereits durchgeführt.' });
  }
  if (record.status === 'IMPORTING') {
    throw new AppError('CONFLICT', { userMessage: 'Dieser Import läuft bereits.' });
  }

  // Anspruch anmelden: ein zweiter gleichzeitiger Klick findet den Import
  // nicht mehr im Zustand ANALYSED und läuft ins Leere.
  const claimed = await prisma.jailImport.updateMany({
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
    action: AUDIT_ACTIONS.JAIL_IMPORT_CONFIRMED,
    module: JAIL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId, rows: record.rows.length },
  });

  // Namen und Rollenbezeichnungen vor der Transaktion beschaffen - innerhalb
  // einer Transaktion hat ein Netzwerkaufruf nichts verloren.
  const context = await loadJailContext(gateway).catch(() => null);
  const roleNames = new Map(
    (context?.guildRoles ?? []).map((role) => [
      role.id,
      { name: role.name, position: role.position, managed: role.managed },
    ]),
  );
  const members = await resolveMembers(
    gateway,
    record.rows.flatMap((row) => [row.targetDiscordId, row.moderatorDiscordId ?? '']),
  );

  const label = (
    discordId: string,
  ): { username: string; displayName: string | null; avatar: string | null } => {
    const member = members.get(discordId);
    return {
      // Ohne Discord-Treffer bleibt die ID stehen - das ist ehrlicher als ein
      // erfundener Name und bleibt eindeutig.
      username: member?.username ?? discordId,
      displayName: member?.displayName ?? null,
      avatar: member?.avatarHash ?? null,
    };
  };

  let imported = 0;
  let failed = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of record.rows) {
        const lifecycle = mapLegacyStatus(row.legacyStatus);
        const target = label(row.targetDiscordId);
        const moderator = row.moderatorDiscordId ? label(row.moderatorDiscordId) : null;
        const durationSeconds =
          row.permanent || !row.endsAt || !row.startedAt
            ? null
            : Math.max(
                MIN_DURATION_SECONDS,
                Math.round((row.endsAt.getTime() - row.startedAt.getTime()) / 1000),
              );

        const created = await tx.jailEntry.create({
          data: {
            targetDiscordId: row.targetDiscordId,
            targetUsername: target.username,
            targetDisplayName: target.displayName,
            targetAvatarHash: target.avatar,
            moderatorDiscordId: moderator ? row.moderatorDiscordId! : 'unbekannt',
            moderatorUsername: moderator?.username ?? 'Unbekannt (Altbestand)',
            moderatorAvatarHash: moderator?.avatar ?? null,
            reason: row.reason ?? FALLBACK_REASON,
            type: row.permanent ? 'PERMANENT' : 'TEMPORARY',
            durationSeconds,
            startedAt: row.startedAt ?? new Date(),
            endsAt: row.permanent ? null : row.endsAt,
            roleSnapshot: row.roleIds,
            // Der alte Bot hat die Rollen bereits auf Discord gesetzt; der
            // Datensatz bildet den bestehenden Zustand ab.
            status: 'COMPLETED',
            lifecycle,
            source: 'IMPORT',
            // Nicht still: der Import selbst kündigt ohnehin nichts an (er
            // erzeugt nur Datensätze). Eine spätere Freilassung soll aber
            // ganz normal im Ankündigungs-Channel erscheinen.
            silent: false,
            activeKey: row.targetDiscordId,
            legacyKey: row.legacyKey,
            importId,
            leftGuildAt: lifecycle === 'PENDING_REJOIN' ? (row.endsAt ?? row.startedAt) : null,
            roleSnapshotEntries: {
              create: row.roleIds.map((roleId) => {
                const role = roleNames.get(roleId);
                return {
                  roleId,
                  // Für Altdaten ist der Name nur bekannt, wenn die Rolle
                  // heute noch existiert.
                  roleNameAtTime: role?.name ?? null,
                  rolePositionAtTime: role?.position ?? null,
                  managedAtTime: role?.managed ?? false,
                };
              }),
            },
          },
        });

        await tx.jailImportRow.update({
          where: { id: row.id },
          data: { imported: true, jailId: created.id },
        });
        imported += 1;
      }
    });
  } catch (error) {
    failed = record.rows.length - imported;
    const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
    await prisma.jailImport.update({
      where: { id: importId },
      data: { status: 'FAILED', errorMessage: message.slice(0, 500), finishedAt: new Date() },
    });
    await safeRecordAudit({
      action: AUDIT_ACTIONS.JAIL_IMPORT_FAILED,
      module: JAIL_MODULE_ID,
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

  const cooldowns = await importCooldowns(record);

  // Abgleich mit Discord: was der alte Bot hinterlassen hat, wird jetzt
  // geprüft (fehlende Jail-Rollen, Mitglieder ohne aktiven Jail).
  let reconciliation: ExecuteImportResult['reconciliation'] = null;
  if (options.reconcile !== false) {
    try {
      const summary = await reconcileJails({
        mode: 'MANUAL',
        triggeredBy: actor.discordId,
        repair: true,
        gateway,
      });
      reconciliation = {
        checked: summary.checked,
        drift: summary.drift.length,
        repaired: summary.repaired,
      };
    } catch (error) {
      log.warn('Abgleich nach dem Import fehlgeschlagen', { error, importId });
    }
  }

  const finished = await prisma.jailImport.update({
    where: { id: importId },
    data: {
      status: 'COMPLETED',
      importedRows: imported,
      failedRows: failed,
      finishedAt: new Date(),
      reconciledAt: reconciliation ? new Date() : null,
      reconcileSummary: (reconciliation ?? undefined) as unknown as Prisma.InputJsonValue,
    },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.JAIL_IMPORT_COMPLETED,
    module: JAIL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId, imported, cooldowns, reconciliation },
  });

  log.info('Legacy-Import abgeschlossen', { importId, imported, cooldowns });
  return { importRecord: finished, imported, failed, cooldowns, reconciliation };
}

/**
 * Übernimmt die noch laufenden Sperrfristen aus `vote_cooldowns`.
 *
 * Sie wurden bereits bei der Analyse herausgefiltert und mitgespeichert - die
 * hochgeladene Datei existiert zu diesem Zeitpunkt längst nicht mehr.
 */
async function importCooldowns(record: JailImport): Promise<number> {
  const info = record.schemaInfo as { cooldowns?: Array<{ discordId: string; expiresAt: string }> } | null;
  const entries = Array.isArray(info?.cooldowns) ? info.cooldowns : [];
  const now = Date.now();
  let applied = 0;

  for (const entry of entries) {
    const expiresAt = new Date(entry.expiresAt);
    if (!SNOWFLAKE.test(entry.discordId) || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now) {
      continue;
    }
    await prisma.voteJailCooldown.upsert({
      where: { discordId: entry.discordId },
      create: { discordId: entry.discordId, expiresAt },
      // Eine bereits bestehende, längere Sperre wird nicht verkürzt.
      update: { expiresAt: { set: expiresAt } },
    });
    applied += 1;
  }

  return applied;
}

/** Mitglieder einmalig auflösen - fehlende bleiben schlicht unbekannt. */
async function resolveMembers(
  gateway: DiscordGateway,
  discordIds: readonly string[],
): Promise<Map<string, GuildMember>> {
  const unique = [...new Set(discordIds.filter((id) => SNOWFLAKE.test(id)))];
  const result = new Map<string, GuildMember>();

  for (const discordId of unique) {
    const member = await gateway.members.get(discordId).catch(() => null);
    if (member) {
      result.set(discordId, member);
    }
  }
  return result;
}

/** Verwirft eine Analyse, die nicht übernommen werden soll. */
export async function discardLegacyImport(importId: string, actor: LegacyImportActor): Promise<void> {
  const record = await prisma.jailImport.findUnique({ where: { id: importId } });
  if (!record) {
    throw new AppError('NOT_FOUND', { userMessage: 'Der Import wurde nicht gefunden.' });
  }
  if (record.status === 'COMPLETED') {
    throw new AppError('CONFLICT', {
      userMessage: 'Ein abgeschlossener Import lässt sich nicht mehr verwerfen.',
    });
  }

  await prisma.jailImport.update({
    where: { id: importId },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });

  await safeRecordAudit({
    action: AUDIT_ACTIONS.JAIL_IMPORT_DISCARDED,
    module: JAIL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    success: true,
    metadata: { importId },
  });
}

/** Eingaben des Import-Assistenten. */
export const confirmJailImportSchema = z.object({
  importId: z.string().cuid('Ungültige Import-ID'),
  /**
   * Ohne diese Bestätigung wird nichts übernommen. Zwei Bots, die gleichzeitig
   * Jails verwalten, überschreiben sich gegenseitig.
   */
  legacyBotStopped: z.literal(true, {
    errorMap: () => ({ message: 'Bitte bestätigen, dass der alte Jail-Bot gestoppt ist.' }),
  }),
});

export const discardJailImportSchema = z.object({
  importId: z.string().cuid('Ungültige Import-ID'),
});
