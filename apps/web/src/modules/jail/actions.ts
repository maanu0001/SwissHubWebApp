'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { jail } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = jail.JAIL_MODULE_ID;

const logger = createLogger('jail:actions');

/**
 * Server Actions des Jail-Moduls.
 *
 * Authentifizierung, Mitgliedschaft, CSRF, Rate Limit, Validierung und
 * Autorisierung erledigt `defineAction`; die Moderation Policy prüft der
 * Service selbst nochmals gegen die aktuellen Discord-Rollen.
 */
export const createJailAction = defineAction(
  {
    name: 'jail.create',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.create,
    schema: jail.createJailSchema,
    rateLimit: 'jailCreate',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await jail.createJail(
      // Herkunft ist fest: dieselbe Aktion aus dem Dashboard.
      { ...input, source: 'DASHBOARD' },
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
        roleIds: ctx.roleIds,
        isOwner: ctx.user.isOwner,
        moderationLevel: ctx.moderationLevel,
      },
      { metadata },
    );

    revalidatePath('/moderation/jail');
    revalidatePath('/dashboard');
    revalidatePath(`/members/${input.targetDiscordId}`);

    return {
      jailId: result.jail.id,
      endsAt: result.jail.endsAt?.toISOString() ?? null,
      permanent: result.jail.type === 'PERMANENT',
      silent: result.jail.silent,
      warnings: result.warnings,
      duplicate: result.duplicate,
    };
  },
);

export const releaseJailAction = defineAction(
  {
    name: 'jail.release',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.release,
    schema: jail.releaseJailSchema,
    rateLimit: 'jailRelease',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await jail.releaseJail(input.jailId, {
      releaseType: 'MANUAL',
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      metadata,
      actor: {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
        roleIds: ctx.roleIds,
        isOwner: ctx.user.isOwner,
        moderationLevel: ctx.moderationLevel,
      },
    });

    revalidatePath('/moderation/jail');
    revalidatePath('/dashboard');
    revalidatePath(`/members/${result.jail.targetDiscordId}`);

    return {
      jailId: result.jail.id,
      restoredRoles: result.restoredRoleIds.length,
      failedRoles: result.failedRoleIds.length,
      warnings: result.warnings,
      memberLeftGuild: result.memberLeftGuild,
    };
  },
);

/** Wie der Picker ein Ziel beschreibt - dieselbe Form wie die Mitgliedersuche. */
const alsPickerEintrag = (ziel: jail.VoteJailTarget) => ({
  discordId: ziel.discordId,
  username: ziel.username,
  displayName: ziel.displayName,
  avatarHash: ziel.avatarHash,
  isBot: false,
  jailed: ziel.grund === 'Bereits gejailt',
  waehlbar: ziel.waehlbar,
  grund: ziel.grund,
});

/**
 * Das Ziel einer Abstimmung suchen.
 *
 * Dieselbe Bedienung wie bei «Bannen» - derselbe Picker, dasselbe Tippen,
 * dieselben Vorschläge -, aber ausdrücklich nicht dieselbe Auskunft. Die
 * allgemeine Mitgliedersuche verlangt `members.view` und öffnet das Member
 * Center: Profile, Notizen, Moderationsakte. Diese hier verlangt nur, was die
 * Handlung selbst verlangt, und gibt nur her, was die Handlung braucht.
 *
 * Der Unterschied steckt in der Antwort, nicht im Formular. Zurück kommen
 * ausschliesslich Mitglieder, gegen die dieser Handelnde tatsächlich eine
 * Abstimmung starten könnte - dieselbe Policy, die `startVoteJail` anwendet -,
 * und von ihnen nur Name, Anzeigename und Avatar. Keine Rollen, kein
 * Beitrittsdatum, keine Akte. Wer geschützt ist, taucht gar nicht erst auf;
 * eine Liste mit Zielen, die beim Klick abgelehnt würden, wäre selbst schon
 * die Auskunft darüber, wer geschützt ist.
 *
 * Und ohne Suchbegriff kommt nichts: eine leere Eingabe ist keine Anfrage
 * nach der Mitgliederliste des Servers.
 */
export const searchVoteJailTargetsAction = defineAction(
  {
    name: 'jail.vote.targets',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.voteStart,
    schema: z.object({
      query: z.string().max(100),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    rateLimit: 'memberSearch',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);

    try {
      const ziele = await jail.searchVoteJailTargets(
        input.query,
        {
          discordId: ctx.user.discordId,
          username: ctx.user.username,
          avatarHash: ctx.user.avatarHash,
          roleIds: ctx.roleIds,
          isOwner: ctx.user.isOwner,
          moderationLevel: ctx.moderationLevel,
        },
        { limit: input.limit ?? 20 },
      );

      return ziele.map(alsPickerEintrag);
    } catch (fehler) {
      // Ein Fehler von Discord darf nicht als leeres Ergebnis durchgehen.
      //
      // Genau das ist hier passiert: die Suche fing jeden Fehler ab und gab
      // eine leere Liste zurueck. Im Browser blieb davon ein Ladekringel, der
      // verschwindet, und ein leeres Feld - ohne jeden Hinweis darauf, dass
      // ueberhaupt etwas schiefging.
      //
      // Der technische Grund gehoert ins Log, nicht in den Browser.
      logger.error('Zielsuche für den Vote Jail fehlgeschlagen', {
        actorId: ctx.user.discordId,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
      throw new AppError('DISCORD_UNAVAILABLE', {
        userMessage:
          'Die Mitgliedersuche ist gerade nicht erreichbar. Bitte in einem Moment erneut versuchen.',
      });
    }
  },
);

/**
 * Vote Jail starten.
 *
 * Die Abstimmung ist eine Vorstufe des regulären Jails - die eigentliche
 * Ausführung übernimmt später `createJail`. Deshalb genügt hier die
 * Berechtigung `jail.vote.start`; alle weiteren Prüfungen macht der Service.
 */
export const startVoteJailAction = defineAction(
  {
    name: 'jail.vote.start',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.voteStart,
    schema: jail.startVoteJailSchema,
    rateLimit: 'voteJailStart',
    freshness: 'critical',
  },
  async ({ ctx, input, metadata }) => {
    await assertModuleEnabled(MODULE_ID);

    const vote = await jail.startVoteJail(
      input,
      {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
        roleIds: ctx.roleIds,
        isOwner: ctx.user.isOwner,
        moderationLevel: ctx.moderationLevel,
        // Sperrfrist ist eine gewöhnliche Berechtigung, keine feste Rolle.
        bypassCooldown: can(ctx, jail.JAIL_PERMISSIONS.voteBypassCooldown),
      },
      { metadata },
    );

    revalidatePath('/vote-jail');
    revalidatePath('/moderation/jail');
    return {
      voteJailId: vote.id,
      requiredVotes: vote.requiredVotes,
      expiresAt: vote.expiresAt.toISOString(),
    };
  },
);

/**
 * Übernahme des analysierten Imports.
 *
 * Getrennt vom Upload: die Analyse allein verändert nichts, erst hier
 * entstehen Jail-Einträge. Die Bestätigung, dass der alte Bot gestoppt ist,
 * ist Pflicht - zwei gleichzeitig laufende Bots würden sich gegenseitig
 * überschreiben.
 */
export const confirmJailImportAction = defineAction(
  {
    name: 'jail.import.confirm',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.import,
    schema: jail.confirmJailImportSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);

    const result = await jail.executeLegacyImport(
      input.importId,
      { discordId: ctx.user.discordId, username: ctx.user.username },
      { legacyBotStopped: input.legacyBotStopped },
    );

    revalidatePath('/moderation/jail');
    revalidatePath('/moderation/jail/import');
    revalidatePath('/dashboard');

    return {
      importId: result.importRecord.id,
      imported: result.imported,
      cooldowns: result.cooldowns,
      reconciliation: result.reconciliation,
    };
  },
);

/** Verwirft eine Analyse, ohne etwas zu übernehmen. */
export const discardJailImportAction = defineAction(
  {
    name: 'jail.import.discard',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.import,
    schema: jail.discardJailImportSchema,
    rateLimit: 'jailImport',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await jail.discardLegacyImport(input.importId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    revalidatePath('/moderation/jail/import');
    return { importId: input.importId };
  },
);
