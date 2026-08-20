import { AUDIT_ACTIONS, safeRecordAudit } from '@swisshub/database';
import { conflict } from '@swisshub/shared';
import { readModuleSettings, writeModuleSettings } from '../settings/service';
import { LEVEL_MODULE_ID, type LevelSettings } from './config';
import { loadLevelContext } from './context';
import { applyXp, type ApplyXpResult } from './service';
import { syncMilestoneRoles } from './milestones';
import { logXpChange } from './notifications';

/**
 * Verwaltende Eingriffe ins Level-System.
 *
 * Dashboard und Slash Commands rufen dieselben Funktionen auf. Dadurch gibt
 * es eine Protokollierung, eine Prüfung und einen Weg, auf dem sich XP ändern
 * kann - beim Vorgänger existierte das nur als Discord-Nachricht in einem
 * Log-Channel.
 */

export interface LevelActor {
  discordId: string;
  username: string;
}

export interface AdjustXpInput {
  target: { discordId: string; username?: string | null; displayName?: string | null };
  /** Positiv = vergeben, negativ = entziehen. */
  amount: number;
  reason?: string | null;
}

export interface AdjustXpResult extends ApplyXpResult {
  /** Rollen, die durch die Änderung dazukamen bzw. wegfielen. */
  rolesAdded: string[];
  rolesRemoved: string[];
}

/** Vergibt oder entzieht XP von Hand. */
export async function adjustXp(
  actor: LevelActor,
  input: AdjustXpInput,
  options: { syncRoles?: boolean } = {},
): Promise<AdjustXpResult> {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw conflict('Bitte eine Anzahl XP ungleich null angeben.');
  }

  const context = await loadLevelContext();

  const result = await applyXp(
    {
      discordId: input.target.discordId,
      username: input.target.username ?? null,
      displayName: input.target.displayName ?? null,
      delta: amount,
      source: 'ADMIN',
      reason: input.reason ?? (amount > 0 ? 'XP vergeben' : 'XP entzogen'),
      actorDiscordId: actor.discordId,
    },
    {
      // Vor einer Handbuchung den fälligen Abzug nachholen, damit der
      // angezeigte Ausgangswert stimmt.
      applyDecayFirst: context.settings.decayEnabled,
      decayRules: context.decayRules,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
    },
  );

  let rolesAdded: string[] = [];
  let rolesRemoved: string[] = [];
  if (options.syncRoles !== false) {
    const sync = await syncMilestoneRoles(input.target.discordId, result.xpAfter, {
      gateway: context.gateway,
      maxLevelTotalXp: context.settings.maxLevelTotalXp,
      reason: `Level ${result.levelAfter}`,
    }).catch(() => null);
    rolesAdded = sync?.added ?? [];
    rolesRemoved = sync?.removed ?? [];
  }

  // Zusätzlich zum Audit-Log ins Discord-Protokoll - das Team sieht die
  // Änderung dort, ohne das Dashboard zu öffnen.
  await logXpChange(context, {
    discordId: input.target.discordId,
    delta: result.delta,
    xpAfter: result.xpAfter,
    levelAfter: result.levelAfter,
    source: 'ADMIN',
    reason: input.reason ?? null,
    actorDiscordId: actor.discordId,
  });

  await safeRecordAudit({
    action: amount > 0 ? AUDIT_ACTIONS.LEVEL_XP_GRANTED : AUDIT_ACTIONS.LEVEL_XP_REVOKED,
    module: LEVEL_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: input.target.discordId,
    success: true,
    metadata: {
      amount,
      applied: result.delta,
      xpBefore: result.xpBefore,
      xpAfter: result.xpAfter,
      levelBefore: result.levelBefore,
      levelAfter: result.levelAfter,
      decayed: result.decayed,
      reason: input.reason ?? null,
    },
  });

  return { ...result, rolesAdded, rolesRemoved };
}

/**
 * Ändert einzelne Einstellungen, ohne die übrigen anzufassen.
 *
 * Die Admin-Befehle des alten Bots setzten je einen Wert. Damit sie das
 * weiterhin können, ohne die restliche Konfiguration zu überschreiben, wird
 * hier gelesen, zusammengeführt und wieder validiert geschrieben.
 */
export async function updateLevelSettings(
  actor: LevelActor,
  patch: Partial<LevelSettings>,
): Promise<LevelSettings> {
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  const result = await writeModuleSettings<LevelSettings>(LEVEL_MODULE_ID, { ...current, ...patch }, actor);
  return result.settings;
}

/** Fügt einen Channel zur Liste ohne XP hinzu. Gibt `false` zurück, wenn er schon drin war. */
export async function addNoXpChannel(actor: LevelActor, channelId: string): Promise<boolean> {
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  if (current.noXpChannelIds.includes(channelId)) {
    return false;
  }
  await updateLevelSettings(actor, { noXpChannelIds: [...current.noXpChannelIds, channelId] });
  return true;
}

/** Entfernt einen Channel aus der Liste ohne XP. */
export async function removeNoXpChannel(actor: LevelActor, channelId: string): Promise<boolean> {
  const current = await readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
  if (!current.noXpChannelIds.includes(channelId)) {
    return false;
  }
  await updateLevelSettings(actor, {
    noXpChannelIds: current.noXpChannelIds.filter((entry) => entry !== channelId),
  });
  return true;
}

/** Aktuelle Einstellungen des Level-Systems. */
export async function readLevelSettings(): Promise<LevelSettings> {
  return readModuleSettings<LevelSettings>(LEVEL_MODULE_ID);
}
