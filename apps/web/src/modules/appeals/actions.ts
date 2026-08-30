'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import { discord, resolveGuildId } from '@swisshub/discord';
import { appeals } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

const MODULE_ID = appeals.APPEALS_MODULE_ID;
const P = appeals.APPEALS_PERMISSIONS;

/**
 * Server Actions der Entbannungsanträge.
 *
 * Diese Datei enthält **zwei Arten** von Aktionen, und der Unterschied ist die
 * wichtigste Sicherheitsgrenze des Moduls:
 *
 * - **Staff-Aktionen** deklarieren eine `permission`. Sie durchlaufen die
 *   gewohnte Kette samt Guild-Mitgliedschaft.
 * - **Antragsteller-Aktionen** tragen `applicant: true`. Sie laufen ohne
 *   Mitgliedschaft - anders wäre ein Entbannungsantrag nicht möglich - und
 *   prüfen dafür im Rumpf über `requireEigenerAppeal`, dass der Datensatz dem
 *   Aufrufer gehört.
 *
 * Die zweite Form ist die einzige Stelle im ganzen System ohne
 * Mitgliedschaftsprüfung. `tests/unit/action-authorization.test.ts` verlangt
 * von jeder so gekennzeichneten Aktion die Eigentumsprüfung; ohne sie fällt
 * der Test.
 */

function revalidateAppeals(): void {
  revalidatePath('/appeals');
  revalidatePath('/entbannung');
  revalidatePath('/dashboard');
}

const akteurVon = (ctx: AuthContext) => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
});

/**
 * Der Handelnde, wie ihn die Moderation kennt.
 *
 * Wird für die Entbannung gebraucht: `unbanMember` prüft damit
 * `moderation.unban` und die Rangfolge. Dieses Modul kann die
 * Moderationsrechte dadurch nicht umgehen (§41).
 */
const moderationsAkteurVon = (ctx: AuthContext) => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
  roleIds: ctx.roleIds,
  isOwner: ctx.user.isOwner,
  can: (permission: string) => can(ctx, permission),
});

/** Darf dieser Mensch diesen Fall überhaupt sehen? */
function assertFallSichtbar(ctx: AuthContext, appeal: { assignedToDiscordId: string | null }): void {
  if (can(ctx, P.viewAll)) {
    return;
  }
  // Ohne `view.all` nur die eigenen zugewiesenen und die unzugewiesenen -
  // sonst könnte jeder mit `view` jeden Fall lesen.
  if (appeal.assignedToDiscordId === null || appeal.assignedToDiscordId === ctx.user.discordId) {
    return;
  }
  throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
}

// ===========================================================================
// Antragsteller
// ===========================================================================

const antwortenSchema = z.record(z.string().max(4000));

export const reicheAppealEinAction = defineAction(
  {
    name: 'appeal.submit',
    module: MODULE_ID,
    applicant: true,
    schema: z.object({
      antworten: antwortenSchema,
      bestaetigt: z.literal(true),
      /** Gegen den Doppelklick (§30, §59). */
      idempotencyKey: z.string().min(8).max(64),
    }),
    rateLimit: 'appealSubmit',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    const ergebnis = await appeals.reicheEin({
      guildId,
      applicant: {
        discordId: ctx.user.discordId,
        username: ctx.user.username,
        avatarHash: ctx.user.avatarHash,
      },
      antworten: input.antworten,
      idempotencyKey: input.idempotencyKey,
      gateway: discord,
    });

    // Der Vollständigkeit halber: `reicheEin` hat den Antrag gerade unter
    // dieser Kennung angelegt - die Eigentumsprüfung ist damit gegeben.
    await appeals.requireEigenerAppeal(guildId, ergebnis.appeal.id, ctx.user.discordId);

    revalidateAppeals();
    return { id: ergebnis.appeal.id, neu: ergebnis.neu };
  },
);

export const antworteAlsAntragstellerAction = defineAction(
  {
    name: 'appeal.applicant.reply',
    module: MODULE_ID,
    applicant: true,
    schema: z.object({
      appealId: z.string().min(1),
      inhalt: z.string().trim().min(2).max(4000),
    }),
    rateLimit: 'appealMessage',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();
    // Die Eigentumsprüfung steckt in `schreibeAntragstellerNachricht`; hier
    // steht sie zusätzlich ausdrücklich, damit sie im Rumpf sichtbar ist.
    await appeals.requireEigenerAppeal(guildId, input.appealId, ctx.user.discordId);

    await appeals.schreibeAntragstellerNachricht(guildId, input.appealId, input.inhalt, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    revalidateAppeals();
    return { ok: true };
  },
);

export const ziehAppealZurueckAction = defineAction(
  {
    name: 'appeal.withdraw',
    module: MODULE_ID,
    applicant: true,
    schema: z.object({ appealId: z.string().min(1) }),
    rateLimit: 'appealMessage',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();
    await appeals.requireEigenerAppeal(guildId, input.appealId, ctx.user.discordId);

    await appeals.ziehZurueck(guildId, input.appealId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    revalidateAppeals();
    return { ok: true };
  },
);

// ===========================================================================
// Team
// ===========================================================================

export const uebernimmAppealAction = defineAction(
  {
    name: 'appeal.claim',
    module: MODULE_ID,
    permission: P.review,
    schema: z.object({ appealId: z.string().min(1), freigeben: z.boolean().default(false) }),
    rateLimit: 'appealStaff',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();
    const appeal = await appeals.holeAppeal(guildId, input.appealId);
    if (!appeal) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
    }
    assertFallSichtbar(ctx, appeal);

    await appeals.weiseZu(
      guildId,
      input.appealId,
      input.freigeben ? null : akteurVon(ctx),
      akteurVon(ctx),
    );
    revalidateAppeals();
    return { ok: true };
  },
);

export const weiseAppealZuAction = defineAction(
  {
    name: 'appeal.assign',
    module: MODULE_ID,
    permission: P.assign,
    schema: z.object({
      appealId: z.string().min(1),
      zielDiscordId: z.string().regex(/^\d{17,20}$/u).nullable(),
      zielUsername: z.string().max(64).nullable(),
    }),
    rateLimit: 'appealStaff',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    await appeals.weiseZu(
      guildId,
      input.appealId,
      input.zielDiscordId
        ? { discordId: input.zielDiscordId, username: input.zielUsername ?? 'Unbekannt' }
        : null,
      akteurVon(ctx),
    );
    revalidateAppeals();
    return { ok: true };
  },
);

export const setzeAppealPrioritaetAction = defineAction(
  {
    name: 'appeal.priority',
    module: MODULE_ID,
    permission: P.priority,
    schema: z.object({
      appealId: z.string().min(1),
      prioritaet: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
    }),
    rateLimit: 'appealStaff',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    // `URGENT` ist keine gewöhnliche Einstufung: sie zieht einen Fall an allen
    // anderen vorbei. Wer entscheiden darf, darf auch das setzen - wer nur
    // Prioritäten pflegt, nicht.
    if (input.prioritaet === 'URGENT' && !can(ctx, P.decide) && !can(ctx, P.approve)) {
      throw new AppError('FORBIDDEN', {
        userMessage: '«Dringend» darf nur setzen, wer auch entscheiden darf.',
      });
    }

    await appeals.setzePrioritaet(guildId, input.appealId, input.prioritaet, akteurVon(ctx));
    revalidateAppeals();
    return { ok: true };
  },
);

export const schreibeInternenKommentarAction = defineAction(
  {
    name: 'appeal.comment.internal',
    module: MODULE_ID,
    permission: P.commentInternal,
    schema: z.object({
      appealId: z.string().min(1),
      inhalt: z.string().trim().min(2).max(4000),
    }),
    rateLimit: 'appealStaff',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    await appeals.schreibeInternenKommentar(guildId, input.appealId, input.inhalt, akteurVon(ctx));
    revalidateAppeals();
    return { ok: true };
  },
);

export const schreibeAppealNachrichtAction = defineAction(
  {
    name: 'appeal.message',
    module: MODULE_ID,
    permission: P.message,
    schema: z.object({
      appealId: z.string().min(1),
      inhalt: z.string().trim().min(2).max(4000),
    }),
    rateLimit: 'appealStaff',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    await appeals.schreibeStaffNachricht(guildId, input.appealId, input.inhalt, akteurVon(ctx));
    revalidateAppeals();
    return { ok: true };
  },
);

export const setzeAppealStatusAction = defineAction(
  {
    name: 'appeal.status',
    module: MODULE_ID,
    permission: P.review,
    schema: z.object({
      appealId: z.string().min(1),
      nach: z.enum(['UNDER_REVIEW', 'ESCALATED', 'CLOSED']),
    }),
    rateLimit: 'appealStaff',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    await appeals.setzeStatus({
      guildId,
      appealId: input.appealId,
      nach: input.nach,
      actor: akteurVon(ctx),
      // «Wird geprüft» darf der Antragsteller sehen; eine Eskalation ist eine
      // interne Einordnung (§39).
      oeffentlich: input.nach === 'UNDER_REVIEW',
      ...(input.nach === 'UNDER_REVIEW' ? { publicLabel: 'Prüfung begonnen' } : {}),
    });

    revalidateAppeals();
    return { ok: true };
  },
);

// --- Entscheidung -----------------------------------------------------------

const entscheidungsBasis = {
  appealId: z.string().min(1),
  publicDecision: z.string().trim().min(10).max(4000),
  internalDecision: z.string().trim().max(4000).optional(),
};

export const genehmigeAppealAction = defineAction(
  {
    name: 'appeal.approve',
    module: MODULE_ID,
    permission: P.approve,
    schema: z.object({ ...entscheidungsBasis, entbannen: z.boolean().default(true) }),
    rateLimit: 'appealDecision',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    // Liegt ein Vorschlag vor, ist dies die Bestätigung durch die zweite
    // Person - `genehmige` prüft, dass es nicht dieselbe ist.
    const vierAugen = await appeals.brauchtVierAugen('APPROVE');
    const appeal = await appeals.holeAppeal(guildId, input.appealId);
    if (!appeal) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
    }

    if (vierAugen && appeal.status !== 'DECISION_PENDING') {
      await appeals.schlageVor({
        guildId,
        appealId: input.appealId,
        actor: akteurVon(ctx),
        art: 'APPROVE',
        publicDecision: input.publicDecision,
        internalDecision: input.internalDecision ?? null,
      });
      revalidateAppeals();
      return { vorgeschlagen: true, entbannung: null, hinweis: null };
    }

    // Entbannen darf nur, wer es darf - und `unbanMember` prüft zusätzlich
    // `moderation.unban`. Ohne das Recht wird die Entscheidung gespeichert,
    // die Entbannung aber nicht versucht.
    const darfEntbannen = input.entbannen && can(ctx, P.unban);

    const ergebnis = await appeals.genehmige({
      guildId,
      appealId: input.appealId,
      actor: akteurVon(ctx),
      publicDecision: input.publicDecision,
      internalDecision: input.internalDecision ?? null,
      entbannen: darfEntbannen,
      gateway: discord,
      ...(darfEntbannen ? { moderationActor: moderationsAkteurVon(ctx) } : {}),
    });

    revalidateAppeals();
    return {
      vorgeschlagen: false,
      entbannung: ergebnis.entbannung ?? null,
      hinweis:
        ergebnis.hinweis ??
        (input.entbannen && !darfEntbannen
          ? 'Die Entscheidung ist gespeichert. Für die Entbannung fehlt dir die Berechtigung.'
          : null),
    };
  },
);

export const lehneAppealAbAction = defineAction(
  {
    name: 'appeal.reject',
    module: MODULE_ID,
    permission: P.reject,
    schema: z.object({
      ...entscheidungsBasis,
      erneutErlaubt: z.boolean().default(true),
      naechsteMoeglichkeitAm: z.string().datetime().nullable().optional(),
    }),
    rateLimit: 'appealDecision',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    const vierAugen = await appeals.brauchtVierAugen('REJECT');
    const appeal = await appeals.holeAppeal(guildId, input.appealId);
    if (!appeal) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
    }

    if (vierAugen && appeal.status !== 'DECISION_PENDING') {
      await appeals.schlageVor({
        guildId,
        appealId: input.appealId,
        actor: akteurVon(ctx),
        art: 'REJECT',
        publicDecision: input.publicDecision,
        internalDecision: input.internalDecision ?? null,
      });
      revalidateAppeals();
      return { vorgeschlagen: true };
    }

    await appeals.lehneAb({
      guildId,
      appealId: input.appealId,
      actor: akteurVon(ctx),
      publicDecision: input.publicDecision,
      internalDecision: input.internalDecision ?? null,
      erneutErlaubt: input.erneutErlaubt,
      naechsteMoeglichkeitAm: input.naechsteMoeglichkeitAm
        ? new Date(input.naechsteMoeglichkeitAm)
        : null,
    });

    revalidateAppeals();
    return { vorgeschlagen: false };
  },
);

export const wiederholeEntbannungAction = defineAction(
  {
    name: 'appeal.unban.retry',
    module: MODULE_ID,
    permission: P.unban,
    schema: z.object({ appealId: z.string().min(1) }),
    rateLimit: 'appealDecision',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();

    const ergebnis = await appeals.wiederholeEntbannung(guildId, input.appealId, {
      actor: akteurVon(ctx),
      moderationActor: moderationsAkteurVon(ctx),
      gateway: discord,
    });

    revalidateAppeals();
    return { entbannung: ergebnis.entbannung ?? null, hinweis: ergebnis.hinweis ?? null };
  },
);

// --- Assistenz durch die AI (§37) -------------------------------------------

export const fasseAppealZusammenAction = defineAction(
  {
    name: 'appeal.ai.summary',
    module: MODULE_ID,
    permission: P.review,
    schema: z.object({ appealId: z.string().min(1) }),
    rateLimit: 'appealAi',
    freshness: 'cached',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const guildId = await resolveGuildId();
    const appeal = await appeals.holeAppeal(guildId, input.appealId);
    if (!appeal) {
      throw new AppError('NOT_FOUND', { userMessage: 'Diesen Antrag gibt es nicht.' });
    }
    assertFallSichtbar(ctx, appeal);

    const { fasseZusammen } = await import('@/server/appeals-ai');
    return fasseZusammen(appeal);
  },
);
