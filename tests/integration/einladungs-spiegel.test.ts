import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import { DiscordApiError } from '@swisshub/discord';
import type { DiscordGateway, GuildInvite } from '@swisshub/discord';

useTestSchema('test_einladungen');

/**
 * Der Einladungsspiegel gegen eine echte Datenbank.
 *
 * Der Spiegel ist der einzige Grund, warum eine Zuordnung ueberhaupt moeglich
 * ist: Discord nennt die benutzte Einladung nie, es gibt nur Zaehler, und die
 * muss man vorher gesehen haben. Ob er einen Neustart ueberlebt, ist deshalb
 * keine Feinheit - ohne das waere der erste Beitritt nach jedem Neustart
 * grundsaetzlich unzuordenbar.
 *
 * Gegen echtes Postgres, weil genau das hier Datenbankeigenschaften sind: die
 * Eindeutigkeit von `(guildId, code)`, das Verhalten des Upsert und die Frage,
 * ob eine zurueckgezogene Einladung stehen bleibt.
 */
const { prisma } = await import('@swisshub/database');
const { invites } = await import('@swisshub/modules');

const GUILD = '900000000000006001';

const einladung = (code: string, uses: number, extra: Partial<GuildInvite> = {}): GuildInvite => ({
  code,
  channelId: '900000000000006010',
  channelName: 'willkommen',
  inviterDiscordId: '900000000000006099',
  inviterUsername: 'gastgeber',
  uses,
  maxUses: 0,
  expiresAt: null,
  createdAt: null,
  ...extra,
});

/** Ein Gateway, das genau die angegebenen Einladungen liefert. */
function gatewayMit(...antworten: GuildInvite[][]): DiscordGateway {
  let aufruf = 0;
  return {
    guild: {
      async invites() {
        const antwort = antworten[Math.min(aufruf, antworten.length - 1)] ?? [];
        aufruf += 1;
        return antwort;
      },
    },
  } as unknown as DiscordGateway;
}

/** Ein Gateway, dem `MANAGE_GUILD` fehlt. */
const gatewayOhneRecht = (): DiscordGateway =>
  ({
    guild: {
      async invites(): Promise<GuildInvite[]> {
        throw new DiscordApiError(403, 50013, '/guilds/1/invites', 'Missing Permissions');
      },
    },
  }) as unknown as DiscordGateway;

/** Ein Gateway, bei dem Discord ausfällt. */
const gatewayKaputt = (): DiscordGateway =>
  ({
    guild: {
      async invites(): Promise<GuildInvite[]> {
        throw new DiscordApiError(500, undefined, '/guilds/1/invites', 'Internal Server Error');
      },
    },
  }) as unknown as DiscordGateway;

describeWithDatabase('Einladungsspiegel', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "DiscordInvite" RESTART IDENTITY CASCADE');
  });

  it('legt beim ersten Abgleich jede Einladung an', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4), einladung('bbb', 0)]);

    const zeilen = await prisma.discordInvite.findMany({ orderBy: { code: 'asc' } });
    expect(zeilen.map((zeile) => zeile.code)).toEqual(['aaa', 'bbb']);
    expect(zeilen[0]?.uses).toBe(4);
  });

  it('schreibt den Zählerstand beim nächsten Abgleich fort', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4)]);
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 6)]);

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'aaa' } });
    expect(zeile.uses).toBe(6);
    expect(await prisma.discordInvite.count()).toBe(1);
  });

  it('löscht eine verschwundene Einladung nicht, sondern zieht sie zurück', async () => {
    // Ein Beitritt über eine inzwischen aufgebrauchte Einladung soll
    // weiterhin sagen können, wer sie erstellt hatte.
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4), einladung('weg', 1)]);
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4)]);

    const zurueckgezogen = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'weg' } });
    expect(zurueckgezogen.revokedAt).not.toBeNull();
    expect(zurueckgezogen.inviterUsername).toBe('gastgeber');
  });

  it('nimmt eine wieder aufgetauchte Einladung zurück in Betrieb', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 1)]);
    await invites.spiegleEinladungen(GUILD, []);
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 2)]);

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'aaa' } });
    expect(zeile.revokedAt).toBeNull();
    expect(zeile.uses).toBe(2);
  });

  it('überschreibt einen bekannten Ersteller nicht mit nichts', async () => {
    // Discord liefert den Ersteller nicht bei jeder Abfrage mit. Ein `null`
    // von dort darf einen bekannten Namen nicht löschen - sonst hiesse der
    // Beitritt später «von unbekannt», obwohl es einmal bekannt war.
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 1)]);
    await invites.spiegleEinladungen(GUILD, [
      einladung('aaa', 2, { inviterDiscordId: null, inviterUsername: null }),
    ]);

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'aaa' } });
    expect(zeile.inviterUsername).toBe('gastgeber');
  });

  it('ordnet einen Beitritt zu und zählt ihn an der Einladung mit', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4), einladung('bbb', 2)]);

    const zuordnung = await invites.ordneBeitrittZu(
      GUILD,
      gatewayMit([einladung('aaa', 5), einladung('bbb', 2)]),
    );

    expect(zuordnung.art).toBe('EINDEUTIG');
    expect(zuordnung.code).toBe('aaa');

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'aaa' } });
    expect(zeile.uses).toBe(5);
    expect(zeile.attributedJoins).toBe(1);
  });

  it('zählt an keiner Einladung mit, wenn die Zuordnung unbekannt bleibt', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4), einladung('bbb', 2)]);

    const zuordnung = await invites.ordneBeitrittZu(
      GUILD,
      gatewayMit([einladung('aaa', 5), einladung('bbb', 3)]),
    );

    expect(zuordnung.art).toBe('MEHRDEUTIG');
    const zeilen = await prisma.discordInvite.findMany();
    expect(zeilen.every((zeile) => zeile.attributedJoins === 0)).toBe(true);
  });

  it('ordnet zwei gleichzeitige Beitritte nacheinander zu, nicht beide gleich', async () => {
    /*
     * Der Fall, der ohne Serialisierung falsch ausgeht.
     *
     * Zwei Beitritte im selben Moment sind auf einem Server, in dem gerade
     * jemand einen Link geteilt hat, der Alltag. Liefen beide Zuordnungen
     * gleichzeitig, läsen beide denselben alten Stand - und der zweite
     * Beitritt bekäme die Einladung des ersten zugeschrieben.
     */
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4)]);

    const gateway = gatewayMit([einladung('aaa', 5)], [einladung('aaa', 5)]);
    const [erste, zweite] = await Promise.all([
      invites.ordneBeitrittZu(GUILD, gateway),
      invites.ordneBeitrittZu(GUILD, gateway),
    ]);

    const belegt = [erste, zweite].filter((zuordnung) => invites.istBelegt(zuordnung));
    expect(belegt).toHaveLength(1);

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'aaa' } });
    expect(zeile.attributedJoins).toBe(1);
  });

  it('überlebt einen Neustart und ordnet den ersten Beitritt danach zu', async () => {
    // Der Spiegel liegt in der Datenbank und nicht im Arbeitsspeicher. Genau
    // deshalb hat der erste Beitritt nach einem Neustart einen Vorher-Wert.
    await invites.synchronisiereEinladungen(GUILD, gatewayMit([einladung('aaa', 4)]));

    // «Neustart»: kein Zustand im Prozess, nur die Datenbank.
    const zuordnung = await invites.ordneBeitrittZu(GUILD, gatewayMit([einladung('aaa', 5)]));

    expect(zuordnung.art).toBe('EINDEUTIG');
    expect(zuordnung.code).toBe('aaa');
  });

  it('meldet ein fehlendes Recht als solches und wirft nicht', async () => {
    const ergebnis = await invites.synchronisiereEinladungen(GUILD, gatewayOhneRecht());

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.grund).toBe('KEIN_ZUGRIFF');
  });

  it('liefert beim Beitritt ohne Recht eine Zuordnung statt eines Fehlers', async () => {
    // Der Beitritt selbst muss protokolliert werden. Ein fehlendes Log sähe
    // aus wie ein Beitritt, der nicht stattgefunden hat.
    const zuordnung = await invites.ordneBeitrittZu(GUILD, gatewayOhneRecht());

    expect(zuordnung.art).toBe('KEIN_ZUGRIFF');
    expect(invites.istBelegt(zuordnung)).toBe(false);
  });

  it('unterscheidet einen Discord-Ausfall von einem fehlenden Recht', async () => {
    // Ein fehlendes Recht behebt sich nicht von selbst, ein Ausfall schon.
    const zuordnung = await invites.ordneBeitrittZu(GUILD, gatewayKaputt());

    expect(zuordnung.art).toBe('DISCORD_FEHLER');
  });

  it('lässt den Spiegel bei einem Ausfall unverändert stehen', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4)]);
    await invites.ordneBeitrittZu(GUILD, gatewayKaputt());

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'aaa' } });
    expect(zeile.uses).toBe(4);
    expect(zeile.revokedAt).toBeNull();
  });

  it('nimmt eine neu erstellte Einladung sofort auf', async () => {
    await invites.merkeEinladung(GUILD, einladung('frisch', 0));

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'frisch' } });
    expect(zeile.uses).toBe(0);
    expect(zeile.revokedAt).toBeNull();
  });

  it('ordnet einen Beitritt über eine frisch erstellte Einladung zu', async () => {
    // Ohne `inviteCreate` wäre der Code beim Beitritt unbekannt und der
    // Beitritt damit grundsätzlich nicht zuzuordnen.
    await invites.merkeEinladung(GUILD, einladung('frisch', 0));

    const zuordnung = await invites.ordneBeitrittZu(GUILD, gatewayMit([einladung('frisch', 1)]));

    expect(zuordnung.art).toBe('EINDEUTIG');
    expect(zuordnung.code).toBe('frisch');
  });

  it('meldet eine gelöschte Einladung ab, behält sie aber', async () => {
    await invites.spiegleEinladungen(GUILD, [einladung('weg', 3)]);
    await invites.vergissEinladung(GUILD, 'weg');

    const zeile = await prisma.discordInvite.findFirstOrThrow({ where: { code: 'weg' } });
    expect(zeile.revokedAt).not.toBeNull();
    expect(zeile.uses).toBe(3);
  });

  it('trennt die Einladungen zweier Server', async () => {
    const zweite = '900000000000006002';
    await invites.spiegleEinladungen(GUILD, [einladung('aaa', 4)]);
    await invites.spiegleEinladungen(zweite, [einladung('aaa', 99)]);

    const eigene = await prisma.discordInvite.findFirstOrThrow({
      where: { guildId: GUILD, code: 'aaa' },
    });
    expect(eigene.uses).toBe(4);
    expect(await prisma.discordInvite.count()).toBe(2);
  });
});
