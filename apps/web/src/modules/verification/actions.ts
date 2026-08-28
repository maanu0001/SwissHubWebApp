'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verification } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';
import type { AuthContext } from '@swisshub/auth';
import { can } from '@swisshub/auth';

const MODULE_ID = verification.VERIFICATION_MODULE_ID;
const P = verification.VERIFICATION_PERMISSIONS;

/**
 * Server Actions der Verifikation.
 *
 * Eine Server Action ist ein oeffentlicher Endpunkt - dass ein Knopf im
 * Browser fehlt, ist Bequemlichkeit und keine Absicherung. Jede Aktion prueft
 * deshalb serverseitig, und der Dienst prueft die Berechtigung des
 * Handelnden ein zweites Mal.
 */

function revalidateVerification(): void {
  revalidatePath('/verifikation');
  revalidatePath('/verifikation/warteschlange');
  revalidatePath('/verifikation/verlauf');
  revalidatePath('/dashboard');
}

/**
 * Der Handelnde, wie ihn die Moderation kennt.
 *
 * `can` fragt denselben Kontext, den auch jede Seite verwendet - es gibt
 * keine zweite Rechteauskunft.
 */
const actorOf = (ctx: AuthContext) => ({
  discordId: ctx.user.discordId,
  username: ctx.user.username,
  roleIds: ctx.roleIds,
  isOwner: ctx.permissionKeys.includes('admin.full'),
  can: (permission: string) => can(ctx, permission),
});

export const approveAction = defineAction(
  {
    name: 'verification.approve',
    module: MODULE_ID,
    permission: P.approve,
    schema: z.object({ requestId: z.string().min(1) }),
    rateLimit: 'verificationReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const ergebnis = await verification.humanVerify(actorOf(ctx), input.requestId);
    const settings = await verification.verificationSettings();
    // Discord nachziehen - die Meldung dort soll den Stand zeigen.
    await verification.pushModNotice(input.requestId, settings).catch(() => undefined);
    if (ergebnis.gewonnen) {
      await verification.sendWelcome(ergebnis.request, settings).catch(() => undefined);
      await verification.writeLog(ergebnis.request, settings).catch(() => undefined);
    }
    revalidateVerification();
    return { gewonnen: ergebnis.gewonnen, hinweis: ergebnis.rollenFehler ?? null };
  },
);

export const rejectAction = defineAction(
  {
    name: 'verification.reject',
    module: MODULE_ID,
    permission: P.reject,
    schema: z.object({
      requestId: z.string().min(1),
      reason: z.string().trim().min(3).max(300),
    }),
    rateLimit: 'verificationReview',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled(MODULE_ID);
    const ergebnis = await verification.humanReject(actorOf(ctx), input.requestId, input.reason);
    const settings = await verification.verificationSettings();
    await verification.pushModNotice(input.requestId, settings).catch(() => undefined);
    if (ergebnis.gewonnen && settings.notifyOnReject) {
      await verification.writeLog(ergebnis.request, settings).catch(() => undefined);
    }
    revalidateVerification();
    return { gewonnen: ergebnis.gewonnen, hinweis: ergebnis.rollenFehler ?? null };
  },
);

export const setupCheckAction = defineAction(
  {
    name: 'verification.setupCheck',
    module: MODULE_ID,
    permission: P.settingsManage,
    schema: z.object({}),
    rateLimit: 'verificationReview',
    freshness: 'critical',
  },
  async () => {
    // Ausdruecklich ohne `assertModuleEnabled`: der Test soll gerade dann
    // laufen, wenn das Modul noch aus ist - er sagt einem ja, ob man es
    // einschalten kann.
    return verification.runSetupCheck();
  },
);

/**
 * Einen wartenden Fall erneut von der AI einordnen lassen.
 *
 * Nuetzlich, wenn die AI beim ersten Mal nicht erreichbar war. Auch hier
 * gilt: das Ergebnis kann ausschliesslich freischalten oder nichts tun.
 */
export const retryAiAction = defineAction(
  {
    name: 'verification.retryAi',
    module: MODULE_ID,
    permission: P.aiManage,
    schema: z.object({ requestId: z.string().min(1) }),
    rateLimit: 'verificationReview',
    freshness: 'critical',
  },
  async ({ input }) => {
    await assertModuleEnabled(MODULE_ID);
    const ergebnis = await verification.aiPipeline(input.requestId);
    const settings = await verification.verificationSettings();
    await verification.pushModNotice(input.requestId, settings).catch(() => undefined);
    revalidateVerification();
    return {
      freigeschaltet: ergebnis.freigeschaltet,
      eingeordnet: ergebnis.eingeordnet,
      fehler: ergebnis.ausgang.error ?? null,
    };
  },
);
