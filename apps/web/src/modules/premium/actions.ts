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
    schema: z.object({}),
    rateLimit: 'settingsWrite',
    freshness: 'critical',
  },
  async ({ ctx }) => {
    const ergebnis = await premium.syncDiscordEntitlements(ctx.user.id);
    return { ok: ergebnis.ok, error: ergebnis.error };
  },
);
