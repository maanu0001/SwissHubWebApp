'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { can } from '@swisshub/auth';
import { jail } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = jail.JAIL_MODULE_ID;

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

/**
 * Vote Jail starten.
 *
 * Die Abstimmung ist eine Vorstufe des regulären Jails - die eigentliche
 * Ausführung übernimmt später `createJail`. Deshalb genügt hier die
 * Berechtigung `jail.vote.start`; alle weiteren Prüfungen macht der Service.
 */
/**
 * Zielsuche fuer eine Community-Abstimmung.
 *
 * Eigene Aktion statt `members.search`: jene verlangt `members.view` und
 * oeffnet damit das Member Center. Wer eine Abstimmung starten darf, soll ein
 * Ziel waehlen koennen, ohne dafuer fremde Profile, Notizen und die
 * Moderationsakte lesen zu duerfen.
 *
 * Dieselbe Berechtigung wie das Starten selbst - und der Dienst filtert
 * serverseitig nach derselben Policy, die beim Start greift.
 */
/** Wie der Picker ein Ziel beschreibt - dieselbe Form wie die Mitgliedersuche. */
const alsPickerEintrag = (ziel: jail.VoteJailTarget) => ({
  discordId: ziel.discordId,
  username: ziel.username,
  displayName: ziel.displayName,
  avatarHash: ziel.avatarHash,
  isBot: false,
  // Gejailte Mitglieder stehen gar nicht erst in der Antwort.
  jailed: false,
});

/**
 * Nach einem Namen suchen - für das Team.
 *
 * Eine Namenssuche beantwortet die Frage «wer ist alles da?», und die Antwort
 * ist eine Mitgliederliste. Sie bleibt deshalb denen vorbehalten, die sie
 * ohnehin haben: `members.view` öffnet das Member Center mit denselben Namen.
 *
 * Ein Premium-Mitglied bekommt sie nicht. Die Befugnis, eine Abstimmung zu
 * starten, ist keine Befugnis, den Server zu durchsuchen - vorher hing beides
 * am selben Schlüssel, und damit lieferte `jail.vote.start` still eine
 * Mitgliedersuche mit. Der Weg für alle anderen steht darunter.
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

    // Die zweite Bedingung steht hier und nicht oben: `defineAction` prüft
    // einen Schlüssel, gebraucht werden aber beide - der fachliche für die
    // Handlung und dieser für die Auskunft, die sie nebenbei gäbe.
    if (!can(ctx, 'members.view')) {
      throw new AppError('FORBIDDEN', {
        userMessage:
          'Du kannst keine Mitglieder durchsuchen. Gib die Discord-ID ein oder starte die Abstimmung auf Discord mit /vote_jail.',
      });
    }

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
  },
);

/**
 * Genau eine bekannte Discord-Kennung nachschlagen.
 *
 * Der Weg für alle, die keine Mitgliedersuche haben - und das sind die
 * meisten, die eine Abstimmung starten dürfen. Wer eine Abstimmung startet,
 * kennt die Person: er sitzt mit ihr im Voice oder liest gerade ihre
 * Nachricht. Er braucht keine Liste des Servers, sondern diesen einen
 * Menschen.
 *
 * Aufgezählt wird dabei nichts. Wer keine Kennung hat, bekommt hier auch
 * keine - und die Antwort ist dieselbe für «gibt es nicht» und «gegen den
 * darfst du nicht», damit sich an ihr nicht ablesen lässt, wer geschützt ist.
 */
export const resolveVoteJailTargetAction = defineAction(
  {
    name: 'jail.vote.target.resolve',
    module: MODULE_ID,
    permission: jail.JAIL_PERMISSIONS.voteStart,
    schema: z.object({ discordId: z.string().regex(/^\d{17,20}$/u) }),
    rateLimit: 'memberSearch',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);

    const ziel = await jail.resolveVoteJailTarget(input.discordId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      avatarHash: ctx.user.avatarHash,
      roleIds: ctx.roleIds,
      isOwner: ctx.user.isOwner,
      moderationLevel: ctx.moderationLevel,
    });

    return ziel ? alsPickerEintrag(ziel) : null;
  },
);

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
