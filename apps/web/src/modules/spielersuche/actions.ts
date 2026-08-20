'use server';

import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { spielersuche } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = spielersuche.SPIELERSUCHE_MODULE_ID;
const PERMISSIONS = spielersuche.SPIELERSUCHE_PERMISSIONS;

/**
 * Server Actions der Spielersuche.
 *
 * Authentifizierung, Mitgliedschaft, CSRF, Rate Limit, Validierung und
 * Autorisierung erledigt `defineAction`. Die Fachlogik liegt vollständig im
 * Modul - dieselben Funktionen, die auch der Slash Command aufruft.
 */

function revalidateSpielersuche(matchId?: string): void {
  revalidatePath('/spielersuche');
  revalidatePath('/spielersuche/aktiv');
  revalidatePath('/spielersuche/verlauf');
  revalidatePath('/dashboard');
  if (matchId) {
    revalidatePath(`/spielersuche/${matchId}`);
  }
}

export const createSearchAction = defineAction(
  {
    name: 'spielersuche.create',
    module: MODULE_ID,
    permission: PERMISSIONS.create,
    schema: spielersuche.createSearchSchema,
    rateLimit: 'spielersucheCreate',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    // Die Suche entsteht immer im Namen des eingeloggten Kontos - es gibt
    // keine Möglichkeit, sie für jemand anderen zu starten.
    const result = await spielersuche.createSearch(
      { ...input, source: 'DASHBOARD' },
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        displayName: ctx.user.displayName,
        avatarHash: ctx.user.avatarHash,
      },
      { metadata },
    );

    revalidateSpielersuche(result.match.id);
    return {
      matchId: result.match.id,
      channelId: result.match.channelId,
      messageId: result.match.messageId,
      voiceChannelId: result.match.voiceChannelId,
      rolePinged: result.rolePinged,
      pingCooldownSeconds: result.pingCooldownSeconds,
      warnings: result.warnings,
      duplicate: result.duplicate,
    };
  },
);

/**
 * Suche beenden.
 *
 * Die Berechtigung hängt davon ab, wessen Suche es ist: `closeOwn` für die
 * eigene, `closeAny` für fremde. Deshalb prüft die Action zusätzlich zur
 * Grundberechtigung noch den konkreten Fall.
 */
export const closeSearchAction = defineAction(
  {
    name: 'spielersuche.close',
    module: MODULE_ID,
    permission: PERMISSIONS.closeOwn,
    schema: spielersuche.closeSearchSchema,
    rateLimit: 'spielersucheWrite',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const match = await spielersuche.getSearch(input.matchId);
    if (!match) {
      throw new AppError('NOT_FOUND', { userMessage: 'Die Suche wurde nicht gefunden.' });
    }
    // Fremde Suchen brauchen die weitergehende Berechtigung.
    if (match.creatorDiscordId !== ctx.user.discordId && !can(ctx, PERMISSIONS.closeAny)) {
      throw new AppError('FORBIDDEN', {
        userMessage: 'Du darfst nur deine eigenen Suchen beenden.',
      });
    }

    const result = await spielersuche.closeSearch(input.matchId, {
      actor: { discordId: ctx.user.discordId, username: ctx.user.username },
      reason: input.reason ?? 'DASHBOARD',
      metadata,
    });

    revalidateSpielersuche(input.matchId);
    return { matchId: result.match.id, voiceDeleted: result.voiceDeleted };
  },
);

export const createGameAction = defineAction(
  {
    name: 'spielersuche.games.create',
    module: MODULE_ID,
    permission: PERMISSIONS.gamesManage,
    schema: spielersuche.createGameSchema,
    rateLimit: 'spielersucheWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const game = await spielersuche.createGame(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/spielersuche/spiele');
    revalidatePath('/spielersuche');
    return { gameId: game.id, name: game.name };
  },
);

export const updateGameAction = defineAction(
  {
    name: 'spielersuche.games.update',
    module: MODULE_ID,
    permission: PERMISSIONS.gamesManage,
    schema: spielersuche.updateGameSchema,
    rateLimit: 'spielersucheWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const game = await spielersuche.updateGame(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/spielersuche/spiele');
    revalidatePath('/spielersuche');
    return { gameId: game.id, name: game.name, enabled: game.enabled };
  },
);

export const deleteGameAction = defineAction(
  {
    name: 'spielersuche.games.delete',
    module: MODULE_ID,
    permission: PERMISSIONS.gamesManage,
    schema: spielersuche.gameIdSchema,
    rateLimit: 'spielersucheWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await spielersuche.deleteGame(input.gameId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/spielersuche/spiele');
    return { gameId: input.gameId };
  },
);

/** Onboarding-Testnachricht - ersetzt `/testmessage` des alten Bots. */
export const sendOnboardingAction = defineAction(
  {
    name: 'spielersuche.onboarding.send',
    module: MODULE_ID,
    permission: PERMISSIONS.onboardingManage,
    schema: spielersuche.sendOnboardingSchema,
    rateLimit: 'spielersucheWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const sent = await spielersuche.sendOnboardingMessage({
      channelId: input.channelId ?? null,
      actor: { discordId: ctx.user.discordId, username: ctx.user.username },
      test: true,
    });
    revalidatePath('/spielersuche/onboarding');
    return sent;
  },
);

export const confirmSpielersucheImportAction = defineAction(
  {
    name: 'spielersuche.import.confirm',
    module: MODULE_ID,
    permission: PERMISSIONS.import,
    schema: spielersuche.confirmSpielersucheImportSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const result = await spielersuche.executeLegacyImport(
      input.importId,
      { discordId: ctx.user.discordId, username: ctx.user.username },
      { legacyBotStopped: input.legacyBotStopped, applySettings: input.applySettings },
    );

    revalidatePath('/spielersuche/import');
    revalidatePath('/spielersuche/spiele');
    revalidateSpielersuche();
    return {
      importId: result.importRecord.id,
      games: result.games,
      matches: result.matches,
      participants: result.participants,
      usages: result.usages,
      voiceSessions: result.voiceSessions,
      settingsApplied: result.settingsApplied,
    };
  },
);

export const discardSpielersucheImportAction = defineAction(
  {
    name: 'spielersuche.import.discard',
    module: MODULE_ID,
    permission: PERMISSIONS.import,
    schema: spielersuche.discardSpielersucheImportSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await spielersuche.discardLegacyImport(input.importId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/spielersuche/import');
    return { importId: input.importId };
  },
);
