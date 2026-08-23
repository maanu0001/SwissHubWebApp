'use server';

import { z } from 'zod';
import { AUDIT_ACTIONS, prisma, safeRecordAudit } from '@swisshub/database';
import { appUrl } from '@swisshub/config';
import { premium } from '@swisshub/modules';
import { AppError } from '@swisshub/shared';
import { defineAction } from '@/server/action';

/**
 * Server Actions des Premium-Moduls.
 *
 * Sämtliche Zustandswechsel laufen hier durch - der Browser meldet niemals
 * selbst einen Zahlungserfolg. Der Checkout liefert lediglich die Adresse des
 * Zahlungsanbieters zurück; freigeschaltet wird ausschliesslich über den
 * signierten Webhook.
 */

export const startCheckoutAction = defineAction(
  {
    name: 'premium.checkout.start',
    module: 'premium',
    // Wirkt nur auf das eigene Abonnement - Mitgliedschaft genuegt.
    selfService: true,
    schema: z.object({ slug: z.string().min(1).max(64) }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const produkt = await premium.getProductBySlug(input.slug);
    if (!produkt || !produkt.active) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Angebot steht nicht zur Verfügung.' });
    }

    const provider = premium.resolvePaymentProvider();

    // Legt das Abonnement als PENDING an - noch ohne einen einzigen Anspruch.
    const subscription = await premium.startCheckout({
      userId: ctx.user.id,
      discordId: ctx.user.discordId,
      productId: produkt.id,
      provider: provider.name,
    });

    const session = await provider.createCheckout({
      subscriptionId: subscription.id,
      product: produkt,
      userId: ctx.user.id,
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      providerCustomerId: subscription.providerCustomerId,
      successUrl: appUrl('/premium/erfolg'),
      cancelUrl: appUrl('/premium/abgebrochen'),
    });

    if (session.providerCustomerId) {
      await prisma.premiumSubscription.update({
        where: { id: subscription.id },
        data: { providerCustomerId: session.providerCustomerId },
      });
    }

    await safeRecordAudit({
      action: AUDIT_ACTIONS.PREMIUM_CHECKOUT_STARTED,
      module: 'premium',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: produkt.name,
      success: true,
      metadata: { subscriptionId: subscription.id, provider: provider.name },
    });

    return { url: session.url };
  },
);

export const cancelSubscriptionAction = defineAction(
  {
    name: 'premium.subscription.cancel',
    module: 'premium',
    // Wirkt nur auf das eigene Abonnement - Mitgliedschaft genuegt.
    selfService: true,
    schema: z.object({ subscriptionId: z.string().cuid() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const subscription = await prisma.premiumSubscription.findUnique({
      where: { id: input.subscriptionId },
    });
    // Ein Mitglied darf ausschliesslich sein eigenes Abonnement kündigen.
    if (!subscription || subscription.userId !== ctx.user.id) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Abonnement gibt es nicht.' });
    }

    const beendet = await premium.cancelAtPeriodEnd(input.subscriptionId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });

    // Auch beim Anbieter kündigen - sonst zieht er weiter ein.
    if (beendet.providerSubscriptionId) {
      const provider = premium.resolvePaymentProvider();
      await provider.cancelSubscription(beendet.providerSubscriptionId, true).catch(() => undefined);
    }

    return { status: beendet.status, periodEnd: beendet.currentPeriodEnd?.toISOString() ?? null };
  },
);

export const resumeSubscriptionAction = defineAction(
  {
    name: 'premium.subscription.resume',
    module: 'premium',
    // Wirkt nur auf das eigene Abonnement - Mitgliedschaft genuegt.
    selfService: true,
    schema: z.object({ subscriptionId: z.string().cuid() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const subscription = await prisma.premiumSubscription.findUnique({
      where: { id: input.subscriptionId },
    });
    if (!subscription || subscription.userId !== ctx.user.id) {
      throw new AppError('NOT_FOUND', { userMessage: 'Dieses Abonnement gibt es nicht.' });
    }

    const fortgesetzt = await premium.resumeSubscription(input.subscriptionId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    if (fortgesetzt.providerSubscriptionId) {
      const provider = premium.resolvePaymentProvider();
      await provider.resumeSubscription(fortgesetzt.providerSubscriptionId).catch(() => undefined);
    }
    return { status: fortgesetzt.status };
  },
);

export const syncOwnEntitlementsAction = defineAction(
  {
    name: 'premium.self.sync',
    module: 'premium',
    // Wirkt nur auf das eigene Abonnement - Mitgliedschaft genuegt.
    selfService: true,
    schema: z.object({}),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx }) => {
    const ergebnis = await premium.syncDiscordEntitlements(ctx.user.id);
    return { ok: ergebnis.ok, error: ergebnis.error };
  },
);

/**
 * Verwaltungsaktionen.
 *
 * Alle prüfen serverseitig die Berechtigung - `defineAction` erledigt das über
 * `permission`, bevor der Rumpf überhaupt läuft.
 */
export const adminSyncMemberAction = defineAction(
  {
    name: 'premium.admin.sync',
    module: 'premium',
    permission: premium.PREMIUM_PERMISSIONS.discordSync,
    schema: z.object({ userId: z.string().cuid() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const ergebnis = await premium.manualSync(input.userId, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
    });
    return {
      ok: ergebnis.ok,
      error: ergebnis.error,
      rollenGesetzt: ergebnis.rolesAdded.length,
      rollenEntfernt: ergebnis.rolesRemoved.length,
      kanalAngelegt: ergebnis.channelCreated !== null,
      kanalRepariert: ergebnis.channelRepaired,
    };
  },
);

export const adminEndSubscriptionAction = defineAction(
  {
    name: 'premium.admin.end',
    module: 'premium',
    permission: premium.PREMIUM_PERMISSIONS.subscriptionsManage,
    schema: z.object({
      subscriptionId: z.string().cuid(),
      reason: z.string().min(3).max(300),
    }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const beendet = await premium.endSubscriptionAdministratively(
      input.subscriptionId,
      { discordId: ctx.user.discordId, username: ctx.user.username },
      input.reason,
    );
    // Nach dem Beenden entfallen die Ansprüche - Discord nachziehen.
    await premium.syncDiscordEntitlements(beendet.userId).catch(() => undefined);
    return { status: beendet.status };
  },
);

export const updateProductAction = defineAction(
  {
    name: 'premium.product.update',
    module: 'premium',
    permission: premium.PREMIUM_PERMISSIONS.productsManage,
    schema: z.object({
      productId: z.string().cuid(),
      name: z.string().min(2).max(80),
      description: z.string().min(3).max(300),
      priceMinor: z.number().int().min(0).max(100_000),
      features: z.array(z.string().min(1).max(120)).max(12),
      // Ausschliesslich bekannte Ansprüche. Freie Eingabe von
      // Discord-Berechtigungen gibt es hier bewusst nicht - sonst liesse sich
      // über die Produktverwaltung eine Rechteausweitung bauen.
      entitlements: z.array(z.enum(['PREMIUM_ROLE', 'PREMIUM_STUEBLI_ROLE', 'PRIVATE_VOICE'])).max(3),
      active: z.boolean(),
      sortOrder: z.number().int().min(0).max(999),
      providerPriceId: z.string().max(120).optional(),
    }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    const aktualisiert = await prisma.premiumProduct.update({
      where: { id: input.productId },
      data: {
        name: input.name,
        description: input.description,
        priceMinor: input.priceMinor,
        features: input.features,
        entitlements: input.entitlements,
        active: input.active,
        sortOrder: input.sortOrder,
        providerPriceId: input.providerPriceId?.trim() || null,
      },
    });

    await safeRecordAudit({
      action: AUDIT_ACTIONS.PREMIUM_PLAN_UPDATED,
      module: 'premium',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetLabel: aktualisiert.name,
      success: true,
      metadata: { productId: aktualisiert.id, priceMinor: aktualisiert.priceMinor },
    });
    return { saved: true };
  },
);

export const repairStuebliAction = defineAction(
  {
    name: 'premium.stuebli.repair',
    module: 'premium',
    permission: premium.PREMIUM_PERMISSIONS.stuebliManage,
    schema: z.object({ userId: z.string().cuid() }),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    // Der Abgleich ist die Reparatur: er stellt fest, was fehlt, und legt es an.
    const ergebnis = await premium.syncDiscordEntitlements(input.userId);
    await safeRecordAudit({
      action: AUDIT_ACTIONS.PREMIUM_STUEBLI_REPAIR,
      module: 'premium',
      actorDiscordId: ctx.user.discordId,
      actorUsername: ctx.user.username,
      targetDiscordId: ergebnis.discordId,
      success: ergebnis.ok,
      metadata: {
        kanalAngelegt: ergebnis.channelCreated !== null,
        kanalRepariert: ergebnis.channelRepaired,
      },
    });
    return {
      ok: ergebnis.ok,
      error: ergebnis.error,
      kanalAngelegt: ergebnis.channelCreated !== null,
      kanalRepariert: ergebnis.channelRepaired,
    };
  },
);
