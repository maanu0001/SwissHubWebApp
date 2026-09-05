import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_premium_webhook');

/**
 * Der Webhook des Zahlungsanbieters.
 *
 * Hier entscheidet sich, ob ein Abonnement bezahlt ist. Entsprechend streng
 * geprüft wird: ohne gültige Signatur passiert nichts, dasselbe Ereignis wirkt
 * genau einmal, und ein Ereignis ohne zugehöriges Abonnement verändert nichts.
 */
const { prisma } = await import('@swisshub/database');
const { premium, setModuleEnabled, syncDiscord, writeModuleSettings } = await import('@swisshub/modules');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
// Dasselbe Geheimnis, das auch `resolvePaymentProvider()` verwendet - sonst
// haengt der Test daran, was zufaellig in der lokalen .env steht, und meldet
// eine ungueltige Signatur, wo gar keine Regression vorliegt. Geprueft wird
// weiterhin die echte Signatur gegen den echt aufgeloesten Anbieter.
const GEHEIMNIS = process.env.PAYMENT_WEBHOOK_SECRET ?? 'dev-webhook-secret';

const provider = new premium.MockProvider(GEHEIMNIS);

/** Baut einen Ereigniskoerper samt gueltiger Signatur. */
function ereignis(inhalt: Record<string, unknown>): { body: string; signature: string } {
  const body = JSON.stringify(inhalt);
  return { body, signature: provider.sign(body) };
}

async function abonnementAnlegen(discordId: string, slug: string) {
  const user = await prisma.user.upsert({
    where: { discordId },
    create: { discordId, username: `nutzer-${discordId.slice(-4)}` },
    update: {},
  });
  const produkt = await premium.getProductBySlug(slug);
  const abo = await premium.startCheckout({
    userId: user.id,
    discordId,
    productId: produkt!.id,
    provider: 'mock',
  });
  return { user, abo };
}

describeWithDatabase('Premium-Webhook', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "PremiumDiscordResource","PremiumPayment","PremiumPaymentEvent","PremiumSubscription","PremiumProduct","User","ModuleState" RESTART IDENTITY CASCADE',
    );
    await syncDiscord({ trigger: 'manual' });
    await premium.seedProducts();
    await setModuleEnabled(premium.PREMIUM_MODULE_ID, true, ADMIN.discordId);
    await writeModuleSettings(
      premium.PREMIUM_MODULE_ID,
      {
        premiumRoleId: '900000000000000004',
        stuebliRoleId: '900000000000000006',
        stuebliCategoryId: '700000000000000010',
        bundleRoleId: null,
        gracePeriodSeconds: 3 * 86_400,
        stuebliNameTemplate: '🔊・stübli-{user}',
        stuebliUserLimit: 0,
        stuebliOwnerManagePermissions: false,
      },
      ADMIN,
    );
  });

  it('weist eine falsche Signatur ab und speichert nichts', async () => {
    const { body } = ereignis({ id: 'evt_1', kind: 'payment.succeeded' });
    await expect(premium.handleWebhook(body, 'offensichtlich-falsch')).rejects.toThrow(/Signatur/u);
    // Entscheidend: kein Eintrag. Sonst liesse sich die Tabelle von aussen
    // vollschreiben, ohne je eine gültige Signatur zu besitzen.
    expect(await prisma.premiumPaymentEvent.count()).toBe(0);
  });

  it('schaltet ein Abonnement erst durch das Ereignis frei', async () => {
    const { user, abo } = await abonnementAnlegen('900000000000002001', 'premium-bundle');
    expect(abo.status).toBe('PENDING');

    const { body, signature } = ereignis({
      id: 'evt_aktiv_1',
      type: 'payment.succeeded',
      kind: 'payment.succeeded',
      subscriptionId: abo.id,
      providerPaymentId: 'mock_pi_1',
      amountMinor: 1000,
      currency: 'CHF',
    });
    const ergebnis = await premium.handleWebhook(body, signature);
    expect(ergebnis.status).toBe('processed');

    const nachher = await prisma.premiumSubscription.findUniqueOrThrow({ where: { id: abo.id } });
    expect(nachher.status).toBe('ACTIVE');

    // Und die Discord-Vorteile stehen.
    const stuebli = await premium.getStuebli(user.id);
    expect(stuebli?.state).toBe('ACTIVE');
  });

  it('verarbeitet dasselbe Ereignis nur einmal', async () => {
    const { abo } = await abonnementAnlegen('900000000000002002', 'premium');
    const nachricht = ereignis({
      id: 'evt_doppelt',
      type: 'payment.succeeded',
      kind: 'payment.succeeded',
      subscriptionId: abo.id,
      providerPaymentId: 'mock_pi_2',
      amountMinor: 500,
    });

    const erst = await premium.handleWebhook(nachricht.body, nachricht.signature);
    const zweit = await premium.handleWebhook(nachricht.body, nachricht.signature);
    const dritt = await premium.handleWebhook(nachricht.body, nachricht.signature);

    expect(erst.status).toBe('processed');
    expect(zweit.status).toBe('duplicate');
    expect(dritt.status).toBe('duplicate');

    // Genau eine Zahlung - kein doppelter Umsatz in der Auswertung.
    expect(await prisma.premiumPayment.count()).toBe(1);
    expect(await prisma.premiumPaymentEvent.count()).toBe(1);
  });

  it('hält auch gleichzeitige Zustellungen desselben Ereignisses auseinander', async () => {
    const { abo } = await abonnementAnlegen('900000000000002003', 'premium');
    const nachricht = ereignis({
      id: 'evt_parallel',
      type: 'payment.succeeded',
      kind: 'payment.succeeded',
      subscriptionId: abo.id,
      providerPaymentId: 'mock_pi_3',
      amountMinor: 500,
    });

    const ergebnisse = await Promise.all(
      Array.from({ length: 5 }, () => premium.handleWebhook(nachricht.body, nachricht.signature)),
    );
    expect(ergebnisse.filter((e) => e.status === 'processed')).toHaveLength(1);
    expect(await prisma.premiumPayment.count()).toBe(1);
  });

  it('setzt bei fehlgeschlagener Zahlung die Schonfrist, ohne etwas zu entziehen', async () => {
    const { user, abo } = await abonnementAnlegen('900000000000002004', 'premium-stuebli');
    const erfolg = ereignis({
      id: 'evt_ok',
      type: 'payment.succeeded',
      kind: 'payment.succeeded',
      subscriptionId: abo.id,
      providerPaymentId: 'mock_pi_4',
      amountMinor: 800,
    });
    await premium.handleWebhook(erfolg.body, erfolg.signature);

    const fehler = ereignis({
      id: 'evt_fehler',
      type: 'payment.failed',
      kind: 'payment.failed',
      subscriptionId: abo.id,
      providerPaymentId: 'mock_pi_5',
      amountMinor: 800,
      failureReason: 'Zahlung abgelehnt',
    });
    await premium.handleWebhook(fehler.body, fehler.signature);

    const nachher = await prisma.premiumSubscription.findUniqueOrThrow({ where: { id: abo.id } });
    expect(nachher.status).toBe('PAYMENT_FAILED');
    expect(nachher.graceUntil).not.toBeNull();

    // Der Sprachkanal bleibt - die Schonfrist läuft ja noch.
    const stuebli = await premium.getStuebli(user.id);
    expect(stuebli?.state).toBe('ACTIVE');
  });

  it('räumt bei endgültiger Kündigung durch den Anbieter ab', async () => {
    const { user, abo } = await abonnementAnlegen('900000000000002005', 'premium-bundle');
    const erfolg = ereignis({
      id: 'evt_ok2',
      type: 'payment.succeeded',
      kind: 'payment.succeeded',
      subscriptionId: abo.id,
      providerPaymentId: 'mock_pi_6',
      amountMinor: 1000,
    });
    await premium.handleWebhook(erfolg.body, erfolg.signature);
    expect((await premium.getStuebli(user.id))?.state).toBe('ACTIVE');

    const ende = ereignis({
      id: 'evt_ende',
      type: 'subscription.cancelled',
      kind: 'subscription.cancelled',
      subscriptionId: abo.id,
    });
    await premium.handleWebhook(ende.body, ende.signature);

    const nachher = await prisma.premiumSubscription.findUniqueOrThrow({ where: { id: abo.id } });
    expect(nachher.status).toBe('EXPIRED');
    expect((await premium.getStuebli(user.id))?.state).toBe('REMOVED');
  });

  it('verändert nichts bei einem Ereignis ohne zugehöriges Abonnement', async () => {
    const nachricht = ereignis({
      id: 'evt_fremd',
      type: 'payment.succeeded',
      kind: 'payment.succeeded',
      subscriptionId: 'gibt-es-nicht',
      providerPaymentId: 'mock_pi_7',
    });
    const ergebnis = await premium.handleWebhook(nachricht.body, nachricht.signature);
    expect(ergebnis.status).toBe('ignored');
    expect(await prisma.premiumPayment.count()).toBe(0);
  });

  it('merkt sich auch ein nicht verstandenes Ereignis, damit es nicht erneut anläuft', async () => {
    const nachricht = ereignis({ id: 'evt_unbekannt', type: 'irgendwas', kind: 'unknown' });
    expect((await premium.handleWebhook(nachricht.body, nachricht.signature)).status).toBe('ignored');
    expect((await premium.handleWebhook(nachricht.body, nachricht.signature)).status).toBe('duplicate');
  });
});
