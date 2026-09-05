import { beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_music_seek');

/**
 * Springen innerhalb eines Titels.
 *
 * Die Fortschrittsleiste sah aus wie etwas, worauf man klicken kann, und war
 * doch nur eine Anzeige. Wer ein zweiminütiges Intro überspringen wollte,
 * konnte den ganzen Titel überspringen - mehr nicht.
 *
 * Gegen eine echte Datenbank, weil der Kern der Änderung eine Zeitrechnung
 * ist: die Position steht nicht als Zahl in einer Spalte, sondern ergibt sich
 * aus `trackStartedAt`, der gesammelten Pausendauer und der Uhr. Ein Sprung
 * datiert den Startzeitpunkt zurück. Eine Nachbildung von Prisma würde hier
 * vor allem sich selbst bestätigen.
 */
const { prisma } = await import('@swisshub/database');
const { music } = await import('@swisshub/modules');

const GILDE = '900000000000000901';
const KANAL = '700000000000000901';
const ACTOR = { discordUserId: '100000000000000902', username: 'bea', origin: 'web' as const };

/** Eine laufende Session mit genau einem Titel bekannter Länge. */
async function session(dauer: number | null = 300) {
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
  const titel = await prisma.musicQueueItem.create({
    data: {
      sessionId: eintrag.id,
      position: 10,
      provider: 'youtube',
      title: 'Ein langes Intro',
      webpageUrl: 'https://example.invalid/1',
      // Ausgelassen statt `null`: eine Länge, die niemand kennt, ist keine
      // Länge null - und Prisma unterscheidet die beiden Fälle.
      ...(dauer === null ? {} : { durationSeconds: dauer }),
    },
  });
  await prisma.musicSession.update({
    where: { id: eintrag.id },
    data: { currentItemId: titel.id, trackStartedAt: new Date() },
  });
  return { sessionId: eintrag.id, titelId: titel.id };
}

const position = async (sessionId: string): Promise<number> => {
  const zeile = await prisma.musicSession.findUniqueOrThrow({ where: { id: sessionId } });
  return music.berechnePosition(zeile);
};

describeWithDatabase('Musik - im Titel springen', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "MusicCommand","MusicQueueItem","MusicPlaybackHistory","MusicSession",' +
        '"MusicBotInstance" RESTART IDENTITY CASCADE',
    );
  });

  it('legt einen Befehl für die Laufzeit ab, statt selbst zu spielen', async () => {
    const { sessionId } = await session();

    const commandId = await music.sessionService.seek(sessionId, 90, ACTOR);

    const befehl = await prisma.musicCommand.findUniqueOrThrow({ where: { id: commandId } });
    expect(befehl.kind).toBe('SEEK');
    expect(befehl.status).toBe('PENDING');
    expect(befehl.payload).toMatchObject({ positionSeconds: 90 });
  });

  it('setzt die Position sofort, statt auf die Bestätigung zu warten', async () => {
    // Der Balken soll dort stehen, wo geklickt wurde. Erst zu warten fühlte
    // sich an, als hätte der Klick nicht gezählt.
    const { sessionId } = await session();

    await music.sessionService.seek(sessionId, 120, ACTOR);

    expect(await position(sessionId)).toBeGreaterThanOrEqual(119);
    expect(await position(sessionId)).toBeLessThanOrEqual(121);
  });

  it('begrenzt einen Sprung über das Ende hinaus auf den Titel', async () => {
    // Sonst wäre ein Sprung ans Ende ein umständliches Überspringen.
    const { sessionId } = await session(300);

    await music.sessionService.seek(sessionId, 100_000, ACTOR);

    expect(await position(sessionId)).toBeLessThanOrEqual(299);
    expect(await position(sessionId)).toBeGreaterThanOrEqual(298);
  });

  it('verwirft die gesammelte Pausendauer', async () => {
    // Sie bezog sich auf den alten Startzeitpunkt. Bliebe sie stehen, zöge
    // sie nach dem Sprung ein zweites Mal ab.
    const { sessionId } = await session();
    await prisma.musicSession.update({
      where: { id: sessionId },
      data: { pausedMs: 45_000 },
    });

    await music.sessionService.seek(sessionId, 60, ACTOR);

    const zeile = await prisma.musicSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(zeile.pausedMs).toBe(0);
    expect(music.berechnePosition(zeile)).toBeGreaterThanOrEqual(59);
  });

  it('lässt eine Pause eine Pause bleiben', async () => {
    const { sessionId } = await session();
    await prisma.musicSession.update({
      where: { id: sessionId },
      data: { pausedAt: new Date() },
    });

    await music.sessionService.seek(sessionId, 30, ACTOR);

    const zeile = await prisma.musicSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(zeile.pausedAt).not.toBeNull();
    expect(music.berechnePosition(zeile)).toBe(30);
  });

  it('weist einen Sprung ohne laufenden Titel ab', async () => {
    const { sessionId } = await session();
    await prisma.musicSession.update({
      where: { id: sessionId },
      data: { currentItemId: null },
    });

    await expect(music.sessionService.seek(sessionId, 30, ACTOR)).rejects.toThrow();
  });

  it('weist einen Sprung bei unbekannter Länge ab', async () => {
    // Ein Livestream hat keine Strecke, auf der sich zielen liesse.
    const { sessionId } = await session(null);

    await expect(music.sessionService.seek(sessionId, 30, ACTOR)).rejects.toThrow();
  });

  it('weist eine negative Stelle ab', async () => {
    const { sessionId } = await session();

    await expect(music.sessionService.seek(sessionId, -10, ACTOR)).rejects.toThrow();
  });

  it('schreibt nichts, wenn der Sprung abgewiesen wird', async () => {
    const { sessionId } = await session(null);
    const vorher = await prisma.musicSession.findUniqueOrThrow({ where: { id: sessionId } });

    await music.sessionService.seek(sessionId, 30, ACTOR).catch(() => undefined);

    const nachher = await prisma.musicSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(nachher.trackStartedAt?.getTime()).toBe(vorher.trackStartedAt?.getTime());
    expect(await prisma.musicCommand.count({ where: { sessionId } })).toBe(0);
  });
});

/**
 * Die Laufzeit ist ein eigener Prozess in einer anderen Sprache - hier lässt
 * sich nur prüfen, dass die Absprache zwischen beiden Seiten steht: derselbe
 * Befehlsname, dasselbe Feld in der Nutzlast, und ein Sprung, der den Titel
 * neu aufsetzt statt ihn zu verlassen.
 */
const quelltext = (pfad: string): string =>
  readFileSync(fileURLToPath(new URL(`../../apps/music-runtime/swisshub_music/${pfad}`, import.meta.url)), 'utf8');

it('führt den Befehl in der Laufzeit unter demselben Namen aus', () => {
  const bot = quelltext('bot.py');

  expect(bot).toContain('elif art == "SEEK":');
  expect(bot).toContain('self.player.springe(int(nutzlast.get("positionSeconds", 0)))');
});

it('setzt beim Sprung denselben Titel neu auf, statt zum nächsten zu gehen', () => {
  // Ohne die innere Schleife im Player fiele der Ablauf nach dem Stoppen zum
  // nächsten Titel durch - und ein Sprung wäre ein Überspringen.
  const player = quelltext('player.py');

  expect(player).toContain('if self._sprungziel is None:');
  expect(player).toContain('versatz = self._sprungziel');
  expect(player).toContain('provider.ffmpeg_opts(versatz)');
});

it('macht ein Überspringen einen anstehenden Sprung hinfällig', () => {
  const player = quelltext('player.py');
  const ueberspringe = player.slice(
    player.indexOf('def ueberspringe(self)'),
    player.indexOf('def setze_lautstaerke(self'),
  );

  expect(ueberspringe).toContain('self._sprungziel = None');
});

it('spult in FFmpeg vor der Eingabe, nicht danach', () => {
  // `-ss` nach der Eingabe dekodiert alles davor und wirft es weg: bei einem
  // Sprung in die Mitte eines langen Titels sind das Sekunden Stille.
  const provider = quelltext('provider.py');

  expect(provider).toMatch(/"before_options": f"-ss \{sekunden\}/u);
  expect(provider).toContain('sekunden = max(0, min(int(versatz), 24 * 3600))');
});
