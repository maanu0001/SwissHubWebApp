import { beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_level_spiele');

/**
 * Die Brettspiele des Level-Systems gegen eine echte Datenbank.
 *
 * Gegen eine echte, weil der Fehler, um den es hier geht, nur dort auftritt:
 * jeder Zug lief in einer Transaktion mit Zeilensperre, schrieb dann aber
 * über den *globalen* Prisma-Client. Der nimmt eine zweite Verbindung und
 * läuft damit in genau die Sperre, welche die Transaktion selbst hält - sie
 * wartet auf sich. Nach fünf Sekunden brach Prisma ab, und im Discord stand
 * «Das het nid klappet.»
 *
 * Eine Nachbildung von Prisma hätte das nie gezeigt: sie hat keine
 * Verbindungen und keine Sperren.
 */
const { prisma } = await import('@swisshub/database');
const { level } = await import('@swisshub/modules');

const A = '900000000000000801';
const B = '900000000000000802';
const FREMD = '900000000000000803';

async function partie(kind: 'XP_4GEWINNT' | 'XP_SSP' | 'XP_TTT') {
  const match = await prisma.levelGameMatch.create({
    data: {
      kind,
      status: 'RUNNING',
      challengerDiscordId: A,
      opponentDiscordId: B,
      bet: 100,
      payout: 190,
      potHeld: true,
    },
  });
  return level.startState(match.id);
}

describeWithDatabase('XP-Brettspiele', () => {
  beforeAll(() => pushSchema());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "XpTransaction","LevelGameMatch" RESTART IDENTITY CASCADE');
  });

  // --- 4 Gewinnt ----------------------------------------------------------

  it('nimmt einen Zug entgegen, statt in die eigene Sperre zu laufen', async () => {
    // Der eigentliche Fehler. Vorher endete das nach fünf Sekunden mit
    // «Transaction already closed» - für den Spieler eine generische Meldung.
    const match = await partie('XP_4GEWINNT');

    const zug = await level.playC4(match.id, A, 3);

    expect(zug.finished).toBe(false);
    expect(zug.state.turn).toBe(B);
  });

  it('lässt den Stein auf das tiefste freie Feld fallen', async () => {
    const match = await partie('XP_4GEWINNT');
    await level.playC4(match.id, A, 3);
    const zweiter = await level.playC4(match.id, B, 3);

    // Unterste Reihe zuerst, dann darüber.
    expect(zweiter.state.board[5]?.[3]).toBe(1);
    expect(zweiter.state.board[4]?.[3]).toBe(2);
  });

  it('lässt niemanden zweimal hintereinander ziehen', async () => {
    const match = await partie('XP_4GEWINNT');
    await level.playC4(match.id, A, 0);

    await expect(level.playC4(match.id, A, 1)).rejects.toThrow();
  });

  it('lässt Fremde nicht mitspielen', async () => {
    const match = await partie('XP_4GEWINNT');

    await expect(level.playC4(match.id, FREMD, 0)).rejects.toThrow();
  });

  it('weist eine volle Spalte ab - mit einem Grund, den man lesen kann', async () => {
    const match = await partie('XP_4GEWINNT');
    for (let zug = 0; zug < 6; zug += 1) {
      await level.playC4(match.id, zug % 2 === 0 ? A : B, 0);
    }

    await expect(level.playC4(match.id, A, 0)).rejects.toThrow(/voll/iu);
  });

  it('erkennt einen senkrechten Sieg', async () => {
    const match = await partie('XP_4GEWINNT');
    // A staffelt Spalte 0, B daneben.
    await level.playC4(match.id, A, 0);
    await level.playC4(match.id, B, 1);
    await level.playC4(match.id, A, 0);
    await level.playC4(match.id, B, 1);
    await level.playC4(match.id, A, 0);
    await level.playC4(match.id, B, 1);
    const sieg = await level.playC4(match.id, A, 0);

    expect(sieg.finished).toBe(true);
    expect(sieg.winnerDiscordId).toBe(A);
  });

  it('erkennt einen waagrechten Sieg', async () => {
    const match = await partie('XP_4GEWINNT');
    await level.playC4(match.id, A, 0);
    await level.playC4(match.id, B, 0);
    await level.playC4(match.id, A, 1);
    await level.playC4(match.id, B, 1);
    await level.playC4(match.id, A, 2);
    await level.playC4(match.id, B, 2);
    const sieg = await level.playC4(match.id, A, 3);

    expect(sieg.finished).toBe(true);
    expect(sieg.winnerDiscordId).toBe(A);
  });

  it('erkennt einen diagonalen Sieg', async () => {
    const match = await partie('XP_4GEWINNT');
    // Treppe nach rechts oben für A.
    await level.playC4(match.id, A, 0); // (5,0) A
    await level.playC4(match.id, B, 1); // (5,1) B
    await level.playC4(match.id, A, 1); // (4,1) A
    await level.playC4(match.id, B, 2); // (5,2) B
    await level.playC4(match.id, A, 2); // (4,2) A
    await level.playC4(match.id, B, 3); // (5,3) B
    await level.playC4(match.id, A, 2); // (3,2) A
    await level.playC4(match.id, B, 3); // (4,3) B
    await level.playC4(match.id, A, 3); // (3,3) A
    await level.playC4(match.id, B, 6); // irgendwo
    const sieg = await level.playC4(match.id, A, 3); // (2,3) A -> (5,0)(4,1)(3,2)(2,3)

    expect(sieg.finished).toBe(true);
    expect(sieg.winnerDiscordId).toBe(A);
  });

  it('lässt zwei gleichzeitige Klicks nur einen Zug werden', async () => {
    // Die Sperre ist der Punkt der ganzen Transaktion. Sie muss halten -
    // und darf sich dabei nicht selbst blockieren.
    const match = await partie('XP_4GEWINNT');

    const ergebnisse = await Promise.allSettled([level.playC4(match.id, A, 0), level.playC4(match.id, A, 1)]);

    const gelungen = ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled');
    expect(gelungen).toHaveLength(1);

    const stand = await prisma.levelGameMatch.findUniqueOrThrow({ where: { id: match.id } });
    const board = (stand.state as { board: number[][] }).board;
    expect(board.flat().filter((feld) => feld !== 0)).toHaveLength(1);
  });

  // --- Tic-Tac-Toe --------------------------------------------------------

  it('nimmt auch beim Tic-Tac-Toe einen Zug entgegen', async () => {
    // Derselbe Fehler steckte dort - nur hat ihn niemand gemeldet.
    const match = await partie('XP_TTT');

    const zug = await level.playTtt(match.id, A, 4);

    expect(zug.state.board[4]).toBe('X');
    expect(zug.state.turn).toBe(B);
  });

  // --- Schere-Stein-Papier ------------------------------------------------

  it('nimmt eine Wahl entgegen und wartet auf die zweite', async () => {
    const match = await partie('XP_SSP');

    const erste = await level.playSsp(match.id, A, 'rock');

    expect(erste.waiting).toBe(true);
    expect(erste.finished).toBe(false);
  });

  it('wertet die Runde aus, sobald beide gewählt haben', async () => {
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'rock');
    const zweite = await level.playSsp(match.id, B, 'scissors');

    expect(zweite.waiting).toBeFalsy();
    expect(zweite.state.scores[A]).toBe(1);
    expect(zweite.state.round).toBe(2);
    // Die Wahl der abgeschlossenen Runde steht im Verlauf.
    expect(zweite.state.history[0]?.winner).toBe(A);
  });

  it('lässt niemanden in derselben Runde zweimal wählen', async () => {
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'rock');

    await expect(level.playSsp(match.id, A, 'paper')).rejects.toThrow();
  });

  it('setzt die Wahl für die nächste Runde zurück', async () => {
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'rock');
    const nachRunde = await level.playSsp(match.id, B, 'scissors');

    expect(nachRunde.state.choices).toEqual({});
  });
});

describeWithDatabase('Schere-Stein-Papier: was der Kanal zeigt', () => {
  beforeAll(() => pushSchema());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "XpTransaction","LevelGameMatch" RESTART IDENTITY CASCADE');
  });

  const embed = async (state: Parameters<typeof level.buildSspStateEmbed>[1], match: { id: string }) => {
    const voll = await prisma.levelGameMatch.findUniqueOrThrow({ where: { id: match.id } });
    return level.buildSspStateEmbed(voll, state, { accentColor: 0 });
  };

  it('zeigt beide Spieler, Runde und Spielstand', async () => {
    const match = await partie('XP_SSP');
    const gezeigt = await embed({ round: 1, scores: {}, choices: {}, history: [] }, match);

    expect(gezeigt.description).toContain(A);
    expect(gezeigt.description).toContain(B);
    expect(gezeigt.description).toContain('Rundi 1');
    expect(gezeigt.description).toContain('0 : 0');
  });

  it('zeigt, DASS jemand gewählt hat - nicht WAS', async () => {
    /*
      Der Punkt, an dem eine Anzeige zum Betrugswerkzeug wird: wer die Wahl
      des anderen sieht, gewinnt jede Runde. Deshalb steht dort ein Haken und
      kein Symbol.
    */
    const match = await partie('XP_SSP');
    const zug = await level.playSsp(match.id, A, 'rock');
    const gezeigt = await embed(zug.state, match);

    expect(gezeigt.description).toContain('✅');
    expect(gezeigt.description).toContain('⏳');
    // «Stei» ist die Beschriftung der Wahl - sie darf jetzt nirgends stehen.
    expect(gezeigt.description).not.toContain(level.SSP_LABELS.rock);
  });

  it('zeigt die Wahlen erst, wenn die Runde entschieden ist', async () => {
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'rock');
    const fertig = await level.playSsp(match.id, B, 'scissors');
    const gezeigt = await embed(fertig.state, match);

    expect(gezeigt.description).toContain(level.SSP_LABELS.rock);
    expect(gezeigt.description).toContain(level.SSP_LABELS.scissors);
    expect(gezeigt.description).toContain('1 : 0');
  });

  it('nennt den Rundensieger', async () => {
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'paper');
    const fertig = await level.playSsp(match.id, B, 'rock');
    const gezeigt = await embed(fertig.state, match);

    expect(gezeigt.description).toContain('🏆');
    expect(gezeigt.description).toContain(A);
  });

  it('nennt ein Unentschieden als solches', async () => {
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'rock');
    const fertig = await level.playSsp(match.id, B, 'rock');
    const gezeigt = await embed(fertig.state, match);

    expect(gezeigt.description).toContain('Unentschide');
  });

  it('lässt zwischen den Runden nichts stehen', async () => {
    // Der Haken der vergangenen Runde darf nicht als «hat schon gewählt» in
    // die neue hineinragen.
    const match = await partie('XP_SSP');
    await level.playSsp(match.id, A, 'rock');
    const fertig = await level.playSsp(match.id, B, 'scissors');
    const gezeigt = await embed(fertig.state, match);

    expect(fertig.state.choices).toEqual({});
    expect(gezeigt.description).toContain('Rundi 2');
    expect(gezeigt.description?.match(/⏳/gu)).toHaveLength(2);
  });
});

describeWithDatabase('XP-Battle: erst kämpfen, dann das Ergebnis', () => {
  beforeAll(() => pushSchema());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "XpTransaction","LevelGameMatch" RESTART IDENTITY CASCADE');
  });

  it('zeigt im Kampfbild noch keinen Gewinner', async () => {
    /*
      Der ganze Zweck der fünf Sekunden. Steht der Gewinner schon im
      Kampfbild, hat niemand ein Spiel gesehen, sondern eine Auszahlung.
    */
    const match = await prisma.levelGameMatch.create({
      data: {
        kind: 'XP_BATTLE',
        status: 'RUNNING',
        challengerDiscordId: A,
        opponentDiscordId: B,
        bet: 100,
        payout: 190,
        potHeld: true,
        winnerDiscordId: A,
      },
    });

    for (let bild = 0; bild < level.BATTLE_FRAMES.length; bild += 1) {
      const kampf = level.buildBattleFightEmbed(match, bild, { accentColor: 0 });
      expect(kampf.description).toContain(A);
      expect(kampf.description).toContain(B);
      expect(kampf.description, `Bild ${bild}`).not.toContain('gwünnt');
      expect(kampf.description, `Bild ${bild}`).not.toContain('🏆');
    }
  });

  it('bewegt sich zwischen den Bildern', async () => {
    const match = await prisma.levelGameMatch.findFirst().then(
      async (vorhanden) =>
        vorhanden ??
        prisma.levelGameMatch.create({
          data: {
            kind: 'XP_BATTLE',
            status: 'RUNNING',
            challengerDiscordId: A,
            opponentDiscordId: B,
            bet: 100,
            payout: 190,
          },
        }),
    );

    const bilder = level.BATTLE_FRAMES.map(
      (_unused, index) => level.buildBattleFightEmbed(match, index, { accentColor: 0 }).description,
    );
    expect(new Set(bilder).size).toBe(level.BATTLE_FRAMES.length);
  });

  it('hält die Bilder kurz genug für ein Discord-Ratenlimit', () => {
    // Drei Bearbeitungen auf rund fünf Sekunden - nicht eine pro Sekunde.
    expect(level.BATTLE_FRAMES.length).toBeLessThanOrEqual(3);
  });

  it('rechnet vor der Vorführung ab, nicht danach', () => {
    // Stirbt der Bot während der fünf Sekunden, steht das Ergebnis trotzdem
    // richtig da. Andersherum hinge der Topf fest.
    const quelle = readFileSync(join(process.cwd(), 'apps/bot/src/level-games.ts'), 'utf8');
    const abschnitt = quelle.slice(
      quelle.indexOf('async function resolveBattle'),
      quelle.indexOf('async function zeigeKampf'),
    );
    expect(abschnitt.indexOf('level.finishGame')).toBeLessThan(abschnitt.indexOf('zeigeKampf('));
  });
});
