import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_music_shuffle');

/**
 * Das Mischen der Warteschlange gegen eine echte Datenbank.
 *
 * Der Grund für eine echte Datenbank statt einer Nachbildung: die Wiedergabe
 * haengt an einer Eigenschaft der Sortierung, nicht an einem Funktionsaufruf.
 * Die Laufzeit nimmt als naechsten Titel die Zeile mit der kleinsten
 * `position` - und dass der laufende Titel diese Zeile ist, ist die
 * stillschweigende Voraussetzung. Genau die hat das Mischen gebrochen.
 */
const { prisma } = await import('@swisshub/database');
const { music } = await import('@swisshub/modules');

const GILDE = '900000000000000900';
const KANAL = '700000000000000900';

const ACTOR = { discordUserId: '100000000000000901', username: 'anna', origin: 'web' as const };

const TITEL = ['A', 'B', 'C', 'D', 'E'];

/** Eine laufende Session mit Warteschlange - der laufende Titel ist der erste. */
async function session(anzahl: number, mitLaufendem = true) {
  const bot = await prisma.musicBotInstance.create({
    data: { type: 'WORKER', key: `WORKER_${Math.random().toString(36).slice(2, 8)}` },
  });
  const eintrag = await prisma.musicSession.create({
    data: {
      guildId: GILDE,
      voiceChannelId: KANAL,
      botInstanceId: bot.id,
      status: 'ACTIVE',
      activeChannelKey: `${GILDE}:${KANAL}:${bot.id}`,
      activeBotKey: bot.id,
    },
  });

  const elemente = [];
  for (let i = 0; i < anzahl; i += 1) {
    elemente.push(
      await prisma.musicQueueItem.create({
        data: {
          sessionId: eintrag.id,
          position: (i + 1) * 10,
          provider: 'youtube',
          title: TITEL[i] ?? `Titel ${i}`,
          webpageUrl: `https://example.invalid/${i}`,
        },
      }),
    );
  }

  if (mitLaufendem && elemente.length > 0) {
    await prisma.musicSession.update({
      where: { id: eintrag.id },
      data: { currentItemId: elemente[0]!.id, trackStartedAt: new Date() },
    });
  }

  return { sessionId: eintrag.id, elemente };
}

/** Die Warteschlange, so wie die Laufzeit sie liest: nach Position. */
async function reihenfolge(sessionId: string): Promise<string[]> {
  const zeilen = await prisma.musicQueueItem.findMany({
    where: { sessionId },
    orderBy: { position: 'asc' },
    select: { title: true },
  });
  return zeilen.map((zeile) => zeile.title);
}

describeWithDatabase('Musik - Warteschlange mischen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "MusicCommand","MusicQueueItem","MusicPlaybackHistory","MusicSession",' +
        '"MusicBotInstance" RESTART IDENTITY CASCADE',
    );
  });

  it('lässt den laufenden Titel an der Spitze', async () => {
    const { sessionId } = await session(5);

    for (let versuch = 0; versuch < 20; versuch += 1) {
      await music.sessionService.shuffle(sessionId, ACTOR);
      const nachher = await reihenfolge(sessionId);
      expect(nachher[0], 'Der laufende Titel ist nicht mehr der erste').toBe('A');
    }
  });

  it('lässt den laufenden Titel in der Warteschlange stehen', async () => {
    // Er wird erst geloescht, wenn er zu Ende gespielt ist. Verschwaende er
    // beim Mischen, brauchte die Laufzeit ihn genau dann, wenn er weg ist.
    const { sessionId, elemente } = await session(4);
    await music.sessionService.shuffle(sessionId, ACTOR);

    const laufend = await prisma.musicQueueItem.findUnique({ where: { id: elemente[0]!.id } });
    expect(laufend).not.toBeNull();

    const sitzung = await prisma.musicSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(sitzung.currentItemId).toBe(elemente[0]!.id);
  });

  it('ordnet die wartenden Titel neu an', async () => {
    const { sessionId } = await session(5);

    // Zufall: irgendwann muss eine andere Reihenfolge herauskommen. Bei
    // vier wartenden Titeln liegt die Wahrscheinlichkeit, dass 20 Versuche
    // alle die Ausgangsreihenfolge treffen, bei (1/24)^20.
    const gesehen = new Set<string>();
    for (let versuch = 0; versuch < 20; versuch += 1) {
      await music.sessionService.shuffle(sessionId, ACTOR);
      gesehen.add((await reihenfolge(sessionId)).join(','));
    }
    expect(gesehen.size).toBeGreaterThan(1);
  });

  it('verliert und dupliziert keinen Titel', async () => {
    const { sessionId } = await session(5);

    for (let versuch = 0; versuch < 10; versuch += 1) {
      await music.sessionService.shuffle(sessionId, ACTOR);
      const nachher = await reihenfolge(sessionId);
      expect(nachher).toHaveLength(5);
      expect([...nachher].sort()).toEqual([...TITEL].sort());
    }
  });

  it('vergibt streng aufsteigende Positionen', async () => {
    // Sonst waere die Reihenfolge, die die Laufzeit liest, nicht eindeutig.
    const { sessionId } = await session(5);
    await music.sessionService.shuffle(sessionId, ACTOR);

    const positionen = (
      await prisma.musicQueueItem.findMany({
        where: { sessionId },
        orderBy: { position: 'asc' },
        select: { position: true },
      })
    ).map((zeile) => zeile.position);

    expect(new Set(positionen).size).toBe(positionen.length);
    expect([...positionen].sort((a, b) => a - b)).toEqual(positionen);
  });

  it('ist bei leerer Warteschlange ein sauberer No-op', async () => {
    const { sessionId } = await session(0, false);
    await expect(music.sessionService.shuffle(sessionId, ACTOR)).resolves.toBeUndefined();
    expect(await prisma.musicCommand.count({ where: { sessionId } })).toBe(0);
  });

  it('ist bei nur einem laufenden Titel ein sauberer No-op', async () => {
    const { sessionId } = await session(1);
    await music.sessionService.shuffle(sessionId, ACTOR);
    expect(await reihenfolge(sessionId)).toEqual(['A']);
    expect(await prisma.musicCommand.count({ where: { sessionId } })).toBe(0);
  });

  it('ist bei laufendem Titel plus einem weiteren ein sauberer No-op', async () => {
    const { sessionId } = await session(2);
    await music.sessionService.shuffle(sessionId, ACTOR);
    expect(await reihenfolge(sessionId)).toEqual(['A', 'B']);
    expect(await prisma.musicCommand.count({ where: { sessionId } })).toBe(0);
  });

  it('mischt auch ohne laufenden Titel', async () => {
    // Zwischen zwei Titeln steht `currentItemId` kurz auf `null`. Ein Klick
    // in diesem Moment soll die Warteschlange trotzdem mischen.
    const { sessionId } = await session(4, false);
    await music.sessionService.shuffle(sessionId, ACTOR);
    expect((await reihenfolge(sessionId)).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('meldet die neue Reihenfolge an die Laufzeit', async () => {
    // Kein zweiter Zustand: die Laufzeit liest die Warteschlange aus der
    // Datenbank, der Befehl weckt sie nur.
    const { sessionId } = await session(5);
    await music.sessionService.shuffle(sessionId, ACTOR);

    const befehle = await prisma.musicCommand.findMany({ where: { sessionId } });
    expect(befehle).toHaveLength(1);
    expect(befehle[0]?.kind).toBe('QUEUE_SHUFFLE');
    expect(befehle[0]?.requestedByDiscordUserId).toBe(ACTOR.discordUserId);
  });

  it('zeigt der WebApp dieselbe Reihenfolge wie der Laufzeit', async () => {
    const { sessionId } = await session(5);
    await music.sessionService.shuffle(sessionId, ACTOR);

    const zustand = await music.getPlayerState(sessionId);
    expect(zustand?.currentItem?.title).toBe('A');
    // Die Anzeige lässt den laufenden Titel weg - der Rest steht in genau der
    // Reihenfolge, in der er gespielt wird.
    const gespielt = (await reihenfolge(sessionId)).slice(1);
    expect(zustand?.queue.map((eintrag) => eintrag.title)).toEqual(gespielt);
  });
});
