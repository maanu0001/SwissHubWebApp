import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_raffle_loeschen');

/**
 * Vergangene Verlosungen entfernen.
 *
 * Die Zusagen dieser Funktion sind vor allem Zusagen darüber, was sie NICHT
 * tut: sie rührt keine XP an, sie ersetzt keinen Abbruch, und sie nimmt
 * niemandem eine Rückzahlung weg, die ihm noch zusteht. Genau das wird hier
 * geprüft - dass eine Verlosung verschwindet, ist der leichtere Teil.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');
const { raffle: R } = level;

const ADMIN = { discordId: '100000000000000010', username: 'verwaltung' };

const draftInput = (overrides: Record<string, unknown> = {}) =>
  R.raffleSchema.parse({
    title: 'Alte Verlosung',
    prizeKind: 'EXTERNAL_PRIZE',
    prizeDescription: '1 Monat Discord Nitro',
    entryModel: 'FIXED',
    fixedEntryXp: 500,
    minimumParticipants: 2,
    ...overrides,
  });

async function giveXp(discordId: string, xp: number): Promise<void> {
  await prisma.levelProfile.upsert({
    where: { discordId },
    create: { discordId, xp, username: `user-${discordId.slice(-3)}` },
    update: { xp },
  });
}

const xpOf = async (discordId: string): Promise<number> =>
  (await prisma.levelProfile.findUnique({ where: { discordId } }))?.xp ?? 0;

const TEILNEHMER = ['900000000000002001', '900000000000002002', '900000000000002003'];

/** Eine Verlosung mit drei Teilnahmen, bereit zur Ziehung. */
async function mitTeilnahmen(overrides: Record<string, unknown> = {}) {
  const created = await R.createRaffle(ADMIN, draftInput(overrides));
  const offen = await R.publishRaffle(ADMIN, created.id);
  for (const discordId of TEILNEHMER) {
    await giveXp(discordId, 5000);
    await R.enterRaffle({ discordId }, offen.id);
  }
  return offen;
}

/** Eine durchgezogene Verlosung im Zustand COMPLETED. */
async function abgeschlossen(overrides: Record<string, unknown> = {}) {
  const offen = await mitTeilnahmen(overrides);
  await R.closeEntries(ADMIN, offen.id);
  await R.startDraw(ADMIN, offen.id);
  await R.confirmWinner(ADMIN, offen.id);
  return offen;
}

describeWithDatabase('Vergangene Verlosungen löschen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "XpRaffleRefund","XpRaffleDraw","XpRaffleEntry","XpRaffle","XpTransaction","LevelProfile","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  // --- Was gelöscht werden darf ----------------------------------------

  it('entfernt eine abgeschlossene Verlosung samt Teilnahmen und Ziehungen', async () => {
    const raffle = await abgeschlossen();

    const summary = await R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen nach der Saison');

    expect(summary.title).toBe('Alte Verlosung');
    expect(summary.status).toBe('COMPLETED');
    expect(summary.entries).toBe(3);
    expect(summary.draws).toBe(1);

    expect(await prisma.xpRaffle.findUnique({ where: { id: raffle.id } })).toBeNull();
    expect(await prisma.xpRaffleEntry.count({ where: { raffleId: raffle.id } })).toBe(0);
    expect(await prisma.xpRaffleDraw.count({ where: { raffleId: raffle.id } })).toBe(0);
    expect(await prisma.xpRaffleRefund.count({ where: { raffleId: raffle.id } })).toBe(0);
  });

  it('entfernt eine abgebrochene Verlosung samt Rückzahlungen', async () => {
    const raffle = await mitTeilnahmen();
    await R.cancelRaffle(ADMIN, raffle.id, 'Preis nicht mehr verfügbar');
    expect(await prisma.xpRaffleRefund.count({ where: { raffleId: raffle.id } })).toBe(3);

    const summary = await R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen');

    expect(summary.status).toBe('CANCELLED');
    expect(summary.refunds).toBe(3);
    expect(await prisma.xpRaffle.findUnique({ where: { id: raffle.id } })).toBeNull();
    expect(await prisma.xpRaffleRefund.count()).toBe(0);
  });

  it('lässt andere Verlosungen unberührt', async () => {
    const eine = await abgeschlossen({ title: 'Wird gelöscht' });
    const andere = await abgeschlossen({ title: 'Bleibt' });

    await R.deleteRaffle(ADMIN, eine.id, 'Aufräumen');

    expect(await prisma.xpRaffle.findUnique({ where: { id: andere.id } })).not.toBeNull();
    expect(await prisma.xpRaffleEntry.count({ where: { raffleId: andere.id } })).toBe(3);
    expect(await prisma.xpRaffleDraw.count({ where: { raffleId: andere.id } })).toBe(1);
  });

  // --- Was die XP angeht ------------------------------------------------

  it('lässt jeden XP-Stand exakt so, wie er war', async () => {
    const raffle = await abgeschlossen();
    const vorher = Object.fromEntries(
      await Promise.all(TEILNEHMER.map(async (id) => [id, await xpOf(id)] as const)),
    );

    await R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen');

    for (const discordId of TEILNEHMER) {
      expect(await xpOf(discordId), `XP von ${discordId} verändert`).toBe(vorher[discordId]);
    }
  });

  it('lässt das XP-Journal vollständig stehen', async () => {
    // Die Buchungen sind die Wahrheit über den Punktestand und gehören nicht
    // der Verlosung. Verschwänden sie mit ihr, liesse sich ein Punktestand
    // nicht mehr erklären - und ein Abzug von 500 XP stünde ohne Grund da.
    const raffle = await abgeschlossen();
    const vorher = await prisma.xpTransaction.count({ where: { source: 'RAFFLE_ENTRY' } });
    expect(vorher).toBe(3);

    await R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen');

    expect(await prisma.xpTransaction.count({ where: { source: 'RAFFLE_ENTRY' } })).toBe(3);
  });

  // --- Was nicht gelöscht werden darf -----------------------------------

  it.each([
    ['DRAFT', async () => (await R.createRaffle(ADMIN, draftInput())).id],
    [
      'SCHEDULED',
      async () =>
        (
          await R.publishRaffle(
            ADMIN,
            (await R.createRaffle(ADMIN, draftInput({ entryStartsAt: new Date(Date.now() + 3600_000) }))).id,
          )
        ).id,
    ],
    ['ENTRY_OPEN', async () => (await mitTeilnahmen()).id],
  ])('verweigert das Löschen im Zustand %s', async (zustand, anlegen) => {
    const id = await anlegen();

    // Sonst prüfte der Fall womöglich einen ganz anderen Zustand als den, den
    // sein Name behauptet - und bliebe grün, ohne die Absicht zu prüfen.
    const angelegt = await prisma.xpRaffle.findUnique({ where: { id } });
    expect(angelegt!.status).toBe(zustand);

    await expect(R.deleteRaffle(ADMIN, id, 'Aufräumen')).rejects.toThrow(/abgeschlossene oder abgebrochene/u);
    expect(await prisma.xpRaffle.findUnique({ where: { id } })).not.toBeNull();
  });

  it('verweigert das Löschen, solange eine Teilnahme noch nicht zurückgezahlt ist', async () => {
    // Ein Abbruch, der auf halbem Weg steckengeblieben ist. Die offene
    // Teilnahme ist der einzige Beleg dafür, dass jemandem noch 500 XP
    // zustehen - sie zu löschen hiesse, den Anspruch zu löschen.
    const raffle = await mitTeilnahmen();
    await R.cancelRaffle(ADMIN, raffle.id, 'Preis nicht mehr verfügbar');
    const eine = await prisma.xpRaffleEntry.findFirst({ where: { raffleId: raffle.id } });
    await prisma.xpRaffleEntry.update({ where: { id: eine!.id }, data: { status: 'ACTIVE' } });

    await expect(R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen')).rejects.toThrow(/nicht zurückgezahlte/u);
    expect(await prisma.xpRaffle.findUnique({ where: { id: raffle.id } })).not.toBeNull();
  });

  it('stört sich bei einer abgeschlossenen Verlosung nicht an offenen Teilnahmen', async () => {
    // Dort ist ACTIVE der Normalfall: die Einsätze der nicht gezogenen
    // Teilnahmen sind verbraucht, genau darauf beruht das Spiel.
    const raffle = await abgeschlossen();
    expect(
      await prisma.xpRaffleEntry.count({ where: { raffleId: raffle.id, status: 'ACTIVE' } }),
    ).toBeGreaterThan(0);

    await expect(R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen')).resolves.toBeDefined();
  });

  it('meldet eine unbekannte Verlosung, statt still nichts zu tun', async () => {
    await expect(R.deleteRaffle(ADMIN, 'gibtesnicht', 'Aufräumen')).rejects.toThrow();
  });

  // --- Was danach noch nachweisbar ist ----------------------------------

  it('hält im Audit Log fest, was verschwunden ist', async () => {
    const raffle = await abgeschlossen();
    const gewinner = await prisma.xpRaffleEntry.findFirst({
      where: { raffleId: raffle.id, status: 'WINNER' },
    });

    await R.deleteRaffle(ADMIN, raffle.id, 'Aufräumen nach der Saison');

    const eintrag = await prisma.auditLog.findFirst({
      where: { action: 'XP_RAFFLE_DELETED' },
      orderBy: { sequence: 'desc' },
    });
    expect(eintrag).not.toBeNull();
    expect(eintrag!.actorDiscordId).toBe(ADMIN.discordId);
    // Der Titel steht als eigenes Feld da: nach dem Löschen liesse sich die
    // Kennung allein nicht mehr auflösen.
    expect(eintrag!.targetLabel).toBe('Alte Verlosung');

    const metadata = eintrag!.metadata as Record<string, unknown>;
    expect(metadata.raffleId).toBe(raffle.id);
    expect(metadata.reason).toBe('Aufräumen nach der Saison');
    expect(metadata.status).toBe('COMPLETED');
    expect(metadata.entryCount).toBe(3);
    expect(metadata.drawCount).toBe(1);
    expect(metadata.winnerDiscordId).toBe(gewinner!.discordId);
  });
});
