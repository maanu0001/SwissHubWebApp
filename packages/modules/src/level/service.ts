import type { Prisma } from '@swisshub/database';
import { prisma, type LevelProfile, type XpSource } from '@swisshub/database';
import { createLogger } from '@swisshub/logger';
import { conflict } from '@swisshub/shared';
import { DEFAULT_MAX_LEVEL_TOTAL_XP, levelFromXp } from './curve';
import { computeDecay, type DecayRules } from './decay';
import { DEFAULT_DECAY_RULES } from './decay';

const logger = createLogger('level.service');

export interface LevelIdentity {
  discordId: string;
  username?: string | null;
  displayName?: string | null;
  avatarHash?: string | null;
}

export interface ApplyXpInput extends LevelIdentity {
  /** Positiv = Gutschrift, negativ = Abzug. */
  delta: number;
  source: XpSource;
  reason?: string | null;
  actorDiscordId?: string | null;
  channelId?: string | null;
  gameMatchId?: string | null;
  importId?: string | null;
  /**
   * Verhindert Doppelbuchungen bei Wiederholungen. Eine zweite Buchung mit
   * demselben Schlüssel wird stillschweigend übersprungen.
   */
  idempotencyKey?: string | null;
  /** Setzt zusätzlich die Zeitstempel für Aktivität. */
  touchActivity?: boolean;
  markMessage?: boolean;
  markVoice?: boolean;
  /** Zähler mitführen. */
  countMessage?: boolean;
  countVoiceMinutes?: number;
}

export interface ApplyXpResult {
  profile: LevelProfile;
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  /** Tatsächlich verbuchte Änderung nach der Klemmung auf >= 0 XP. */
  delta: number;
  /** Buchung wurde wegen `idempotencyKey` übersprungen. */
  skipped: boolean;
  /** Vorher zusätzlich verrechneter Inaktivitäts-Abzug. */
  decayed: number;
  levelUp: boolean;
}

export interface XpEngineOptions {
  maxLevelTotalXp?: number;
  decayRules?: DecayRules;
  /** Abzug vor der Buchung nachholen. */
  applyDecayFirst?: boolean;
  now?: Date;
}

/**
 * Sperrt das Profil einer Person und legt es bei Bedarf an.
 *
 * Die Zeilensperre ist der Grund, weshalb zwei gleichzeitige Buchungen -
 * etwa eine Nachricht und ein gewonnenes Spiel - sich nicht gegenseitig
 * überschreiben können. Der Vorgänger schrieb ohne Sperre und konnte dabei
 * XP verlieren.
 */
async function lockProfile(tx: Prisma.TransactionClient, identity: LevelIdentity): Promise<LevelProfile> {
  await tx.levelProfile.upsert({
    where: { discordId: identity.discordId },
    create: {
      discordId: identity.discordId,
      username: identity.username ?? null,
      displayName: identity.displayName ?? null,
      avatarHash: identity.avatarHash ?? null,
    },
    update: {},
  });

  await tx.$queryRaw`SELECT "id" FROM "LevelProfile" WHERE "discordId" = ${identity.discordId} FOR UPDATE`;

  return tx.levelProfile.findUniqueOrThrow({ where: { discordId: identity.discordId } });
}

/** Übernimmt Namen und Avatar, sobald sie bekannt sind. */
function identityUpdate(identity: LevelIdentity, profile: LevelProfile): Prisma.LevelProfileUpdateInput {
  const update: Prisma.LevelProfileUpdateInput = {};
  if (identity.username && identity.username !== profile.username) {
    update.username = identity.username;
  }
  if (identity.displayName !== undefined && identity.displayName !== profile.displayName) {
    update.displayName = identity.displayName;
  }
  if (identity.avatarHash !== undefined && identity.avatarHash !== profile.avatarHash) {
    update.avatarHash = identity.avatarHash;
  }
  return update;
}

/**
 * Verrechnet fälligen Inaktivitäts-Abzug innerhalb einer laufenden Transaktion.
 *
 * Gibt die abgezogenen XP zurück und schreibt sie als eigene Zeile ins
 * Journal. Beim Vorgänger verschwand der Abzug ohne Spur im Punktestand.
 */
async function settleDecay(
  tx: Prisma.TransactionClient,
  profile: LevelProfile,
  rules: DecayRules,
  now: Date,
  maxLevelTotalXp: number,
): Promise<{ profile: LevelProfile; decayed: number }> {
  const result = computeDecay(
    {
      xp: profile.xp,
      lastActivityAt: profile.lastActivityAt,
      lastDecayAt: profile.lastDecayAt,
      now,
    },
    rules,
  );

  if (result.decayed === 0) {
    if (result.newLastDecayAt) {
      const updated = await tx.levelProfile.update({
        where: { id: profile.id },
        data: { lastDecayAt: result.newLastDecayAt },
      });
      return { profile: updated, decayed: 0 };
    }
    return { profile, decayed: 0 };
  }

  const updated = await tx.levelProfile.update({
    where: { id: profile.id },
    data: { xp: result.newXp, lastDecayAt: result.newLastDecayAt ?? undefined },
  });

  await tx.xpTransaction.create({
    data: {
      profileId: profile.id,
      discordId: profile.discordId,
      source: 'DECAY',
      delta: -result.decayed,
      requestedDelta: -result.requestedDecay,
      xpBefore: profile.xp,
      xpAfter: result.newXp,
      levelBefore: levelFromXp(profile.xp, maxLevelTotalXp),
      levelAfter: levelFromXp(result.newXp, maxLevelTotalXp),
      reason: `Inaktivität, ${result.days} ${result.days === 1 ? 'Tag' : 'Tage'}`,
    },
  });

  return { profile: updated, decayed: result.decayed };
}

/**
 * Die einzige Stelle, an der sich ein XP-Stand ändert.
 *
 * Dashboard, Slash Commands, Nachrichten, Voice, Spiele und der Import gehen
 * alle hier durch. Dadurch gibt es genau ein Journal, genau eine Klemmung auf
 * nicht-negative Werte und genau eine Level-Berechnung.
 */
export async function applyXp(input: ApplyXpInput, options: XpEngineOptions = {}): Promise<ApplyXpResult> {
  const maxLevelTotalXp = options.maxLevelTotalXp ?? DEFAULT_MAX_LEVEL_TOTAL_XP;
  const decayRules = options.decayRules ?? DEFAULT_DECAY_RULES;
  const now = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.xpTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const profile = await tx.levelProfile.findUniqueOrThrow({
          where: { discordId: input.discordId },
        });
        return {
          profile,
          xpBefore: existing.xpBefore,
          xpAfter: existing.xpAfter,
          levelBefore: existing.levelBefore,
          levelAfter: existing.levelAfter,
          delta: existing.delta,
          skipped: true,
          decayed: 0,
          levelUp: false,
        } satisfies ApplyXpResult;
      }
    }

    let profile = await lockProfile(tx, input);

    let decayed = 0;
    if (options.applyDecayFirst) {
      const settled = await settleDecay(tx, profile, decayRules, now, maxLevelTotalXp);
      profile = settled.profile;
      decayed = settled.decayed;
    }

    const requestedDelta = Math.trunc(input.delta);
    const xpBefore = profile.xp;
    // Klemmung wie beim Vorgänger: `xp = MAX(0, xp + delta)`.
    const xpAfter = Math.max(0, xpBefore + requestedDelta);
    const delta = xpAfter - xpBefore;
    const levelBefore = levelFromXp(xpBefore, maxLevelTotalXp);
    const levelAfter = levelFromXp(xpAfter, maxLevelTotalXp);

    const data: Prisma.LevelProfileUpdateInput = {
      ...identityUpdate(input, profile),
      xp: xpAfter,
    };
    if (input.touchActivity) {
      data.lastActivityAt = now;
      // Der Abzug beginnt nach einer Aktivität wieder von vorne.
      data.lastDecayAt = now;
    }
    if (input.markMessage) {
      data.lastMessageAt = now;
    }
    if (input.markVoice) {
      data.lastVoiceAt = now;
    }
    if (input.countMessage) {
      data.messages = { increment: 1 };
    }
    if (input.countVoiceMinutes) {
      data.voiceMinutes = { increment: input.countVoiceMinutes };
    }

    const updated = await tx.levelProfile.update({ where: { id: profile.id }, data });

    // Eine Buchung ohne Wirkung wird nicht ins Journal geschrieben - sonst
    // wäre der Verlauf voller Nullzeilen aus abgewiesenen Abzügen.
    if (delta !== 0 || requestedDelta !== 0) {
      await tx.xpTransaction.create({
        data: {
          profileId: profile.id,
          discordId: profile.discordId,
          source: input.source,
          delta,
          requestedDelta,
          xpBefore,
          xpAfter,
          levelBefore,
          levelAfter,
          reason: input.reason ?? null,
          actorDiscordId: input.actorDiscordId ?? null,
          channelId: input.channelId ?? null,
          gameMatchId: input.gameMatchId ?? null,
          importId: input.importId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    }

    return {
      profile: updated,
      xpBefore,
      xpAfter,
      levelBefore,
      levelAfter,
      delta,
      skipped: false,
      decayed,
      levelUp: levelAfter > levelBefore,
    } satisfies ApplyXpResult;
  });
}

/**
 * Setzt einen XP-Stand auf einen festen Wert.
 *
 * Nur für die Übernahme der Altdaten gedacht: dort gilt der Stand aus der
 * `levels.db` als Wahrheit und darf nicht durch Aufaddieren entstehen.
 */
export async function setXp(
  identity: LevelIdentity,
  xp: number,
  input: {
    source: XpSource;
    reason?: string | null;
    actorDiscordId?: string | null;
    importId?: string | null;
    idempotencyKey?: string | null;
    messages?: number;
    voiceMinutes?: number;
    lastActivityAt?: Date | null;
    lastDecayAt?: Date | null;
    lastMessageAt?: Date | null;
    lastVoiceAt?: Date | null;
    legacyImportSha?: string | null;
  },
  options: XpEngineOptions = {},
): Promise<ApplyXpResult> {
  const maxLevelTotalXp = options.maxLevelTotalXp ?? DEFAULT_MAX_LEVEL_TOTAL_XP;
  const now = options.now ?? new Date();
  const target = Math.max(0, Math.trunc(xp));

  return prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.xpTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        const profile = await tx.levelProfile.findUniqueOrThrow({
          where: { discordId: identity.discordId },
        });
        return {
          profile,
          xpBefore: existing.xpBefore,
          xpAfter: existing.xpAfter,
          levelBefore: existing.levelBefore,
          levelAfter: existing.levelAfter,
          delta: existing.delta,
          skipped: true,
          decayed: 0,
          levelUp: false,
        } satisfies ApplyXpResult;
      }
    }

    const profile = await lockProfile(tx, identity);
    const xpBefore = profile.xp;
    const delta = target - xpBefore;
    const levelBefore = levelFromXp(xpBefore, maxLevelTotalXp);
    const levelAfter = levelFromXp(target, maxLevelTotalXp);

    const updated = await tx.levelProfile.update({
      where: { id: profile.id },
      data: {
        ...identityUpdate(identity, profile),
        xp: target,
        ...(input.messages !== undefined ? { messages: input.messages } : {}),
        ...(input.voiceMinutes !== undefined ? { voiceMinutes: input.voiceMinutes } : {}),
        ...(input.lastActivityAt !== undefined ? { lastActivityAt: input.lastActivityAt } : {}),
        ...(input.lastDecayAt !== undefined ? { lastDecayAt: input.lastDecayAt } : {}),
        ...(input.lastMessageAt !== undefined ? { lastMessageAt: input.lastMessageAt } : {}),
        ...(input.lastVoiceAt !== undefined ? { lastVoiceAt: input.lastVoiceAt } : {}),
        ...(input.legacyImportSha !== undefined
          ? { legacyImportSha: input.legacyImportSha, legacyImportedAt: now }
          : {}),
      },
    });

    if (delta !== 0) {
      await tx.xpTransaction.create({
        data: {
          profileId: profile.id,
          discordId: profile.discordId,
          source: input.source,
          delta,
          requestedDelta: delta,
          xpBefore,
          xpAfter: target,
          levelBefore,
          levelAfter,
          reason: input.reason ?? null,
          actorDiscordId: input.actorDiscordId ?? null,
          importId: input.importId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    }

    return {
      profile: updated,
      xpBefore,
      xpAfter: target,
      levelBefore,
      levelAfter,
      delta,
      skipped: false,
      decayed: 0,
      levelUp: levelAfter > levelBefore,
    } satisfies ApplyXpResult;
  });
}

/**
 * Merkt eine Aktivität vor, ohne XP zu vergeben.
 *
 * Nötig, weil auch eine Nachricht in einem Channel ohne XP als Lebenszeichen
 * zählt - sonst würde jemand trotz Anwesenheit dem Abzug verfallen.
 */
export async function touchActivity(
  identity: LevelIdentity,
  options: { now?: Date; markMessage?: boolean; markVoice?: boolean } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await prisma.levelProfile.upsert({
    where: { discordId: identity.discordId },
    create: {
      discordId: identity.discordId,
      username: identity.username ?? null,
      displayName: identity.displayName ?? null,
      avatarHash: identity.avatarHash ?? null,
      lastActivityAt: now,
      lastDecayAt: now,
      ...(options.markMessage ? { lastMessageAt: now } : {}),
      ...(options.markVoice ? { lastVoiceAt: now } : {}),
    },
    update: {
      lastActivityAt: now,
      lastDecayAt: now,
      ...(options.markMessage ? { lastMessageAt: now } : {}),
      ...(options.markVoice ? { lastVoiceAt: now } : {}),
      ...(identity.username ? { username: identity.username } : {}),
      ...(identity.displayName !== undefined ? { displayName: identity.displayName } : {}),
      ...(identity.avatarHash !== undefined ? { avatarHash: identity.avatarHash } : {}),
    },
  });
}

export async function getProfile(discordId: string): Promise<LevelProfile | null> {
  return prisma.levelProfile.findUnique({ where: { discordId } });
}

/** Platz in der Rangliste. Bei Gleichstand zählt der frühere Eintrag. */
export async function getRank(discordId: string): Promise<number | null> {
  const profile = await prisma.levelProfile.findUnique({ where: { discordId } });
  if (!profile) {
    return null;
  }
  const better = await prisma.levelProfile.count({ where: { xp: { gt: profile.xp } } });
  return better + 1;
}

/**
 * Holt fälligen Inaktivitäts-Abzug für eine Person nach.
 *
 * Wird sowohl vom Hintergrundlauf als auch vor jeder Anzeige aufgerufen -
 * damit stimmt der angezeigte Stand auch dann, wenn der Lauf gerade pausiert.
 */
export async function settleDecayFor(
  discordId: string,
  options: XpEngineOptions = {},
): Promise<{ decayed: number; profile: LevelProfile } | null> {
  const maxLevelTotalXp = options.maxLevelTotalXp ?? DEFAULT_MAX_LEVEL_TOTAL_XP;
  const rules = options.decayRules ?? DEFAULT_DECAY_RULES;
  const now = options.now ?? new Date();

  const current = await prisma.levelProfile.findUnique({ where: { discordId } });
  if (!current) {
    return null;
  }

  const preview = computeDecay(
    { xp: current.xp, lastActivityAt: current.lastActivityAt, lastDecayAt: current.lastDecayAt, now },
    rules,
  );
  // Ohne fällige Änderung sparen wir uns die Transaktion samt Zeilensperre.
  if (preview.decayed === 0 && preview.newLastDecayAt === null) {
    return { decayed: 0, profile: current };
  }

  return prisma.$transaction(async (tx) => {
    const profile = await lockProfile(tx, { discordId });
    const settled = await settleDecay(tx, profile, rules, now, maxLevelTotalXp);
    return { decayed: settled.decayed, profile: settled.profile };
  });
}

/**
 * Reserviert einen Einsatz für ein Spiel.
 *
 * Der Vorgänger prüfte den Punktestand nur und buchte erst am Ende ab. Wer
 * zwei Spiele gleichzeitig startete, konnte deshalb mehr setzen, als er
 * besass. Hier wird sofort abgebucht; bei Abbruch fliesst der Einsatz zurück.
 */
export async function reserveStake(
  identity: LevelIdentity,
  amount: number,
  input: { gameMatchId: string; reason: string; idempotencyKey: string },
  options: XpEngineOptions = {},
): Promise<ApplyXpResult> {
  const stake = Math.max(0, Math.trunc(amount));
  const profile = await prisma.levelProfile.findUnique({ where: { discordId: identity.discordId } });
  if ((profile?.xp ?? 0) < stake) {
    throw conflict('Du hesch nid gnueg XP für de Isatz.');
  }

  const result = await applyXp(
    {
      ...identity,
      delta: -stake,
      source: 'GAME_STAKE',
      reason: input.reason,
      gameMatchId: input.gameMatchId,
      idempotencyKey: input.idempotencyKey,
    },
    options,
  );

  // Zwischen Prüfung und Buchung kann der Stand gefallen sein. Die Klemmung
  // hätte dann stillschweigend weniger abgebucht - das wäre ein Einsatz auf
  // Kredit, also machen wir die Buchung rückgängig.
  if (-result.delta < stake) {
    await applyXp(
      {
        ...identity,
        delta: -result.delta,
        source: 'GAME_REFUND',
        reason: 'Einsatz nicht gedeckt',
        gameMatchId: input.gameMatchId,
        idempotencyKey: `${input.idempotencyKey}:rollback`,
      },
      options,
    );
    logger.warn('Einsatz war nicht gedeckt und wurde zurückgebucht', {
      discordId: identity.discordId,
      stake,
      booked: -result.delta,
    });
    throw conflict('Du hesch nid gnueg XP für de Isatz.');
  }

  return result;
}
