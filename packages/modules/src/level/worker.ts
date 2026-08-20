import { prisma } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { loadLevelContext, type LevelContext } from './context';
import { settleDecayFor } from './service';
import { syncMilestoneRoles } from './milestones';
import { releaseStaleGames } from './games';

const logger = createLogger('level.worker');

export interface DecaySweepResult {
  checked: number;
  changed: number;
  totalDecayed: number;
  /** Personen, deren Level durch den Abzug gesunken ist. */
  demoted: number;
}

/**
 * Hintergrundlauf für den Inaktivitäts-Abzug.
 *
 * Der Vorgänger lief alle Profile durch, unabhängig davon, ob überhaupt etwas
 * fällig war. Hier grenzt eine Abfrage die Kandidaten vorab ein: nur wer XP
 * hat, wer eine bekannte letzte Aktivität hat und wessen Schonfrist abgelaufen
 * ist, wird überhaupt angefasst.
 */
export async function runDecaySweep(
  options: { context?: LevelContext; limit?: number; now?: Date; syncRoles?: boolean } = {},
): Promise<DecaySweepResult> {
  const context = options.context ?? (await loadLevelContext());
  const now = options.now ?? new Date();

  if (!context.settings.decayEnabled) {
    return { checked: 0, changed: 0, totalDecayed: 0, demoted: 0 };
  }

  const graceMs = context.settings.decayGraceDays * 86_400_000;
  const candidates = await prisma.levelProfile.findMany({
    where: {
      xp: { gt: 0 },
      lastActivityAt: { not: null, lte: new Date(now.getTime() - graceMs) },
    },
    orderBy: { lastDecayAt: 'asc' },
    take: options.limit ?? 500,
    select: { discordId: true },
  });

  let changed = 0;
  let totalDecayed = 0;
  let demoted = 0;

  for (const candidate of candidates) {
    try {
      const before = await prisma.levelProfile.findUnique({
        where: { discordId: candidate.discordId },
        select: { xp: true },
      });
      const result = await settleDecayFor(candidate.discordId, {
        decayRules: context.decayRules,
        maxLevelTotalXp: context.settings.maxLevelTotalXp,
        now,
      });
      if (!result || result.decayed === 0) {
        continue;
      }
      changed += 1;
      totalDecayed += result.decayed;

      if (options.syncRoles !== false) {
        // Wer unter eine Schwelle fällt, verliert die zugehörige Rolle -
        // sonst würde eine Level-Rolle den tatsächlichen Stand überdauern.
        const sync = await syncMilestoneRoles(candidate.discordId, result.profile.xp, {
          gateway: context.gateway,
          maxLevelTotalXp: context.settings.maxLevelTotalXp,
          reason: 'Inaktivitäts-Abzug',
        }).catch(() => null);
        if (sync && sync.removed.length > 0) {
          demoted += 1;
        }
      }

      logger.debug('Inaktivitäts-Abzug verbucht', {
        discordId: candidate.discordId,
        decayed: result.decayed,
        xpBefore: before?.xp,
        xpAfter: result.profile.xp,
      });
    } catch (error) {
      logger.warn('Inaktivitäts-Abzug fehlgeschlagen', {
        discordId: candidate.discordId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: candidates.length, changed, totalDecayed, demoted };
}

/** Räumt Partien weg, die nie zu Ende gespielt wurden. */
export async function runGameCleanup(options: { now?: Date } = {}): Promise<number> {
  const released = await releaseStaleGames({ now: options.now });
  if (released > 0) {
    logger.info('Abgelaufene XP-Spiele freigegeben', { released });
  }
  return released;
}
