import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_live_sync');

/**
 * Discord-Änderungen wirken zeitnah, ohne erneute Anmeldung.
 *
 * Die Kette ist kurz und hängt an einer Stelle: der Bot entwertet bei einer
 * Rollenänderung den Identity-Cache, und die nächste Anfrage der WebApp holt
 * die Rollen deshalb frisch. Bricht dieses Glied, merkt es niemand - die
 * Oberfläche sieht weiter richtig aus, sie arbeitet nur mit den Rollen von
 * vorhin. Genau das prüfen die folgenden Fälle.
 */
const { prisma } = await import('@swisshub/database');
const { invalidateIdentity, getIdentity } = await import('@swisshub/auth');
const { setDiscordGateway, createMockGateway } = await import('@swisshub/discord');

const ANNA = '100000000000000001';

describeWithDatabase('Live-Sync', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordIdentityCache","Session","User" RESTART IDENTITY CASCADE',
    );
    setDiscordGateway(createMockGateway());
  });

  it('entwertet den Identity-Cache, sodass Rollen neu geholt werden', async () => {
    // Ein Stand von eben - er gilt normalerweise fuer die Dauer der TTL.
    await prisma.discordIdentityCache.create({
      data: { discordId: ANNA, isMember: true, roleIds: ['alte-rolle'], fetchedAt: new Date() },
    });

    const vorher = await getIdentity(ANNA);
    expect(vorher.roleIds).toEqual(['alte-rolle']);

    // Das tut der Bot bei `guildMemberUpdate`.
    await invalidateIdentity(ANNA);

    const zeile = await prisma.discordIdentityCache.findUniqueOrThrow({
      where: { discordId: ANNA },
    });
    // Auf den Anfang der Zeitrechnung gesetzt: damit ist jeder TTL-Vergleich
    // abgelaufen, und die naechste Anfrage fragt Discord.
    expect(zeile.fetchedAt.getTime()).toBe(0);

    const nachher = await getIdentity(ANNA);
    // Frisch vom Gateway - nicht mehr der alte Stand.
    expect(nachher.roleIds).not.toEqual(['alte-rolle']);
    expect(nachher.fetchedAt.getTime()).toBeGreaterThan(0);
  });

  it('hält einen frischen Stand ohne Entwertung', async () => {
    // Gegenprobe: ohne Ereignis wird nicht bei jeder Anfrage nachgefragt -
    // sonst waere der Cache sinnlos und Discord bekaeme unsere Last.
    await prisma.discordIdentityCache.create({
      data: { discordId: ANNA, isMember: true, roleIds: ['bleibt'], fetchedAt: new Date() },
    });

    const gelesen = await getIdentity(ANNA);
    expect(gelesen.roleIds).toEqual(['bleibt']);
  });
});
