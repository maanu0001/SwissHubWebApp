import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_premium');

/**
 * SwissHub Premium gegen eine echte Datenbank.
 *
 * Geprüft wird, was sich nur hier prüfen lässt: dass ein Mitglied nie zwei
 * Abonnements bekommt, dass ein Ereignis des Zahlungsanbieters genau einmal
 * wirkt, dass eine Kündigung nichts sofort entzieht - und vor allem, dass
 * niemand zwei Stübli erhält, egal wie oft und wie parallel der Abgleich läuft.
 */
const { prisma } = await import('@swisshub/database');
const { getModuleDefinition, premium, setModuleEnabled, syncDiscord, writeModuleSettings } =
  await import('@swisshub/modules');
const { discord } = await import('@swisshub/discord');

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };
const PREMIUM_ROLE = '900000000000000004'; // @Supporter im Mock
const STUEBLI_ROLE = '900000000000000006'; // @Jail im Mock
const KATEGORIE = '700000000000000010'; // Kategorie "Moderation" im Mock

async function mitglied(discordId: string, username: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { discordId },
    create: { discordId, username },
    update: { username },
  });
  return user.id;
}

/** Ein bezahltes Abonnement, wie es nach einem Webhook dasteht. */
async function abonniere(userId: string, discordId: string, slug: string) {
  const produkt = await premium.getProductBySlug(slug);
  const angelegt = await premium.startCheckout({
    userId,
    discordId,
    productId: produkt!.id,
    provider: 'mock',
  });
  return premium.activateSubscription({
    subscriptionId: angelegt.id,
    periodStart: new Date(),
    periodEnd: new Date(Date.now() + 30 * 86_400_000),
    providerSubscriptionId: `mock_sub_${angelegt.id}`,
  });
}

describeWithDatabase('SwissHub Premium', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "PremiumDiscordResource","PremiumPayment","PremiumPaymentEvent","PremiumSubscription","PremiumProduct","User","ModuleState" RESTART IDENTITY CASCADE',
    );
    // Rollen und Channels in den Cache holen: die Einstellungsprüfung lässt
    // zu Recht nur zu, was es auf Discord wirklich gibt.
    await syncDiscord({ trigger: 'manual' });
    await premium.seedProducts();
    await setModuleEnabled(premium.PREMIUM_MODULE_ID, true, ADMIN.discordId);
    await writeModuleSettings(
      premium.PREMIUM_MODULE_ID,
      {
        premiumRoleId: PREMIUM_ROLE,
        stuebliRoleId: STUEBLI_ROLE,
        stuebliCategoryId: KATEGORIE,
        gracePeriodSeconds: 3 * 86_400,
        stuebliNameTemplate: '🔊・stübli-{user}',
        stuebliUserLimit: 0,
        stuebliOwnerManagePermissions: false,
        bundleRoleId: null,
      },
      ADMIN,
    );
  });

  it('legt die drei Standardangebote mit korrekten Preisen an', async () => {
    const produkte = await premium.listActiveProducts();
    expect(produkte.map((p) => [p.slug, p.priceMinor])).toEqual([
      ['premium', 500],
      ['premium-stuebli', 800],
      ['premium-bundle', 1000],
    ]);
    // Geld niemals als Gleitkomma.
    expect(produkte.every((p) => Number.isInteger(p.priceMinor))).toBe(true);
  });

  it('führt Ansprüche über das Produkt, nicht über dessen Namen', async () => {
    const bundle = await premium.getProductBySlug('premium-bundle');
    expect(bundle!.entitlements.sort()).toEqual(['PREMIUM_ROLE', 'PREMIUM_STUEBLI_ROLE', 'PRIVATE_VOICE']);
  });

  it('lässt kein zweites Abonnement zu', async () => {
    const userId = await mitglied('900000000000001001', 'manuel');
    await abonniere(userId, '900000000000001001', 'premium');

    const produkt = await premium.getProductBySlug('premium-bundle');
    await expect(
      premium.startCheckout({
        userId,
        discordId: '900000000000001001',
        productId: produkt!.id,
        provider: 'mock',
      }),
    ).rejects.toThrow(/bereits ein laufendes Abonnement/u);
  });

  it('gibt einen abgebrochenen Checkout wieder frei', async () => {
    const userId = await mitglied('900000000000001002', 'nina');
    const premiumProdukt = await premium.getProductBySlug('premium');
    const bundle = await premium.getProductBySlug('premium-bundle');

    const erster = await premium.startCheckout({
      userId,
      discordId: '900000000000001002',
      productId: premiumProdukt!.id,
      provider: 'mock',
    });
    // Nie bezahlt - ein neuer Anlauf darf nicht blockieren.
    const zweiter = await premium.startCheckout({
      userId,
      discordId: '900000000000001002',
      productId: bundle!.id,
      provider: 'mock',
    });
    expect(zweiter.id).toBe(erster.id);
    expect(zweiter.productId).toBe(bundle!.id);
    expect(await prisma.premiumSubscription.count({ where: { userId } })).toBe(1);
  });

  it('vergibt Rolle und Stübli erst nach der Zahlung', async () => {
    const userId = await mitglied('900000000000001003', 'lena');
    const produkt = await premium.getProductBySlug('premium-bundle');
    const offen = await premium.startCheckout({
      userId,
      discordId: '900000000000001003',
      productId: produkt!.id,
      provider: 'mock',
    });

    // Noch nicht bezahlt: kein einziger Anspruch.
    const vorher = await premium.syncDiscordEntitlements(userId);
    expect(vorher.entitlements).toEqual([]);
    expect(vorher.channelCreated).toBeNull();

    await premium.activateSubscription({
      subscriptionId: offen.id,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86_400_000),
    });

    const nachher = await premium.syncDiscordEntitlements(userId);
    expect(nachher.entitlements.sort()).toEqual(['PREMIUM_ROLE', 'PREMIUM_STUEBLI_ROLE', 'PRIVATE_VOICE']);
    expect(nachher.channelCreated).not.toBeNull();
  });

  it('legt auch bei zehn gleichzeitigen Abgleichen genau ein Stübli an', async () => {
    const userId = await mitglied('900000000000001004', 'finn');
    await abonniere(userId, '900000000000001004', 'premium-stuebli');

    await Promise.all(Array.from({ length: 10 }, () => premium.syncDiscordEntitlements(userId)));

    const kanaele = await prisma.premiumDiscordResource.findMany({
      where: { userId, resourceType: 'PREMIUM_STUEBLI_VOICE' },
    });
    expect(kanaele).toHaveLength(1);
    expect(kanaele[0]!.state).toBe('ACTIVE');
  });

  it('legt kein zweites Stübli an, wenn der Abgleich erneut läuft', async () => {
    const userId = await mitglied('900000000000001005', 'mia');
    await abonniere(userId, '900000000000001005', 'premium-bundle');

    const erster = await premium.syncDiscordEntitlements(userId);
    const zweiter = await premium.syncDiscordEntitlements(userId);
    const dritter = await premium.syncDiscordEntitlements(userId);

    expect(erster.channelCreated).not.toBeNull();
    expect(zweiter.channelCreated).toBeNull();
    expect(dritter.channelCreated).toBeNull();
    expect(await prisma.premiumDiscordResource.count({ where: { userId } })).toBe(1);
  });

  it('legt das Stübli neu an, wenn es auf Discord gelöscht wurde', async () => {
    const userId = await mitglied('900000000000001006', 'jonas');
    await abonniere(userId, '900000000000001006', 'premium-stuebli');
    const erster = await premium.syncDiscordEntitlements(userId);

    // Jemand hat den Kanal von Hand entfernt.
    await discord.voice.remove(erster.channelCreated!);

    const zweiter = await premium.syncDiscordEntitlements(userId);
    expect(zweiter.channelCreated).not.toBeNull();
    expect(zweiter.channelCreated).not.toBe(erster.channelCreated);
    expect(await prisma.premiumDiscordResource.count({ where: { userId } })).toBe(1);
  });

  it('entzieht bei einer Kündigung nichts sofort', async () => {
    const userId = await mitglied('900000000000001007', 'sara');
    const abo = await abonniere(userId, '900000000000001007', 'premium-bundle');
    await premium.syncDiscordEntitlements(userId);

    const gekuendigt = await premium.cancelAtPeriodEnd(abo.id, ADMIN);
    expect(gekuendigt.status).toBe('CANCEL_AT_PERIOD_END');

    const nachKuendigung = await premium.syncDiscordEntitlements(userId);
    // Bezahlt ist bezahlt: die Vorteile bleiben bis zum Periodenende.
    expect(nachKuendigung.entitlements).toContain('PRIVATE_VOICE');
    expect(nachKuendigung.channelRemoved).toBeNull();

    const kanal = await premium.getStuebli(userId);
    expect(kanal!.state).toBe('ACTIVE');
  });

  it('entfernt Rolle und Stübli erst beim Ablauf', async () => {
    const userId = await mitglied('900000000000001008', 'timo');
    const abo = await abonniere(userId, '900000000000001008', 'premium-bundle');
    await premium.syncDiscordEntitlements(userId);

    await premium.expireSubscription(abo.id);
    const nachher = await premium.syncDiscordEntitlements(userId);

    expect(nachher.entitlements).toEqual([]);
    expect(nachher.channelRemoved).not.toBeNull();
    const kanal = await premium.getStuebli(userId);
    expect(kanal!.state).toBe('REMOVED');
  });

  it('behält die Vorteile während der Schonfrist', async () => {
    const userId = await mitglied('900000000000001009', 'alina');
    const abo = await abonniere(userId, '900000000000001009', 'premium-stuebli');
    await premium.syncDiscordEntitlements(userId);

    await premium.markPaymentFailed(abo.id, 'Karte abgelehnt');
    const waehrendSchonfrist = await premium.syncDiscordEntitlements(userId);
    expect(waehrendSchonfrist.entitlements).toContain('PRIVATE_VOICE');

    const aktualisiert = await prisma.premiumSubscription.findUniqueOrThrow({ where: { id: abo.id } });
    expect(aktualisiert.status).toBe('PAYMENT_FAILED');
    expect(aktualisiert.graceUntil).not.toBeNull();
  });

  it('verlängert die Schonfrist nicht bei jedem Fehlversuch', async () => {
    const userId = await mitglied('900000000000001010', 'noah');
    const abo = await abonniere(userId, '900000000000001010', 'premium');

    const ersterVersuch = await premium.markPaymentFailed(abo.id, 'Abgelehnt', new Date());
    const spaeter = new Date(Date.now() + 2 * 86_400_000);
    const zweiterVersuch = await premium.markPaymentFailed(abo.id, 'Erneut abgelehnt', spaeter);

    expect(zweiterVersuch.graceUntil?.getTime()).toBe(ersterVersuch.graceUntil?.getTime());
  });

  it('gibt den Platz nach dem Ablauf für ein neues Abonnement frei', async () => {
    const userId = await mitglied('900000000000001011', 'elias');
    const abo = await abonniere(userId, '900000000000001011', 'premium');
    await premium.expireSubscription(abo.id);

    const bundle = await premium.getProductBySlug('premium-bundle');
    const neu = await premium.startCheckout({
      userId,
      discordId: '900000000000001011',
      productId: bundle!.id,
      provider: 'mock',
    });
    expect(neu.id).not.toBe(abo.id);
  });

  it('entzieht beim administrativen Beenden Rolle und Stübli sofort', async () => {
    const userId = await mitglied('900000000000001012', 'yara');
    const abo = await abonniere(userId, '900000000000001012', 'premium-bundle');
    await premium.syncDiscordEntitlements(userId);

    const vorher = await prisma.premiumDiscordResource.findFirstOrThrow({
      where: { userId, resourceType: 'PREMIUM_STUEBLI_VOICE' },
    });
    expect(vorher.state).toBe('ACTIVE');

    const beendet = await premium.endSubscriptionAdministratively(abo.id, ADMIN, 'Rückbuchung');
    expect(beendet.status).toBe('CANCELLED');
    // Der Platz ist sofort frei - anders als bei einer Kündigung auf Periodenende.
    expect(beendet.activeUserKey).toBeNull();
    expect(premium.grantsEntitlements(beendet.status)).toBe(false);

    await premium.syncDiscordEntitlements(userId);
    const nachher = await prisma.premiumDiscordResource.findFirstOrThrow({
      where: { userId, resourceType: 'PREMIUM_STUEBLI_VOICE' },
    });
    expect(nachher.state).not.toBe('ACTIVE');
  });

  it('meldet den Premium-Stand eines Mitglieds für die Mitgliederseite', async () => {
    const userId = await mitglied('900000000000001013', 'timo');
    await abonniere(userId, '900000000000001013', 'premium-stuebli');
    await premium.syncDiscordEntitlements(userId);

    const stand = await premium.getMemberPremium('900000000000001013');
    expect(stand?.current?.product.slug).toBe('premium-stuebli');
    expect(stand?.stuebli?.state).toBe('ACTIVE');

    // Ohne Benutzerkonto gibt es nichts zu zeigen - und keinen Fehler.
    expect(await premium.getMemberPremium('900000000000009999')).toBeNull();
  });

  it('legt die Standardangebote beim Einschalten des Moduls an', async () => {
    // Ausgangslage wie nach einem frischen Deployment: Modul aus, keine Angebote.
    await prisma.premiumProduct.deleteMany({});
    await setModuleEnabled(premium.PREMIUM_MODULE_ID, false, ADMIN.discordId);
    expect(await premium.listActiveProducts()).toHaveLength(0);

    const definition = getModuleDefinition(premium.PREMIUM_MODULE_ID);
    await setModuleEnabled(premium.PREMIUM_MODULE_ID, true, ADMIN.discordId);
    await definition!.onEnable!();

    expect((await premium.listActiveProducts()).map((p) => p.slug)).toEqual([
      'premium',
      'premium-stuebli',
      'premium-bundle',
    ]);
  });

  it('überschreibt beim erneuten Seed kein gepflegtes Angebot', async () => {
    const vorher = await premium.getProductBySlug('premium');
    await prisma.premiumProduct.update({
      where: { id: vorher!.id },
      data: { name: 'Premium (angepasst)', priceMinor: 700 },
    });

    // Der Abgleich läuft alle fünf Minuten - er darf nichts zurücksetzen.
    expect(await premium.seedProducts()).toBe(0);

    const nachher = await premium.getProductBySlug('premium');
    expect(nachher!.name).toBe('Premium (angepasst)');
    expect(nachher!.priceMinor).toBe(700);
  });

  it('legt bei parallelem Abgleich keine doppelten Angebote an', async () => {
    await prisma.premiumProduct.deleteMany({});
    // Mehrere Bot-Instanzen gleichzeitig - der Slug muss eindeutig bleiben.
    await Promise.all([premium.seedProducts(), premium.seedProducts(), premium.seedProducts()]);
    expect(await prisma.premiumProduct.count()).toBe(3);
  });
});
