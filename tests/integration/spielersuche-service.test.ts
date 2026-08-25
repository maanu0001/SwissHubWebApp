import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, TEST_DATABASE_URL, useTestSchema } from '../helpers/database';

// Eigenes Schema, damit parallel laufende Testdateien sich nicht stören.
// Muss vor dem Import des Prisma Clients passieren.
useTestSchema('test_spielersuche_service');

/**
 * Die zentrale Spielersuche-Engine.
 *
 * Geprüft wird das, was im Betrieb weh tut: dass niemand zwei Suchen
 * gleichzeitig offen hat, dass aus 4 von 5 nie 6 von 5 wird, dass die
 * Squad-Grösse hält und dass ein Rollen-Ping im Cooldown die Suche nicht
 * verhindert.
 *
 * Läuft gegen eine echte Datenbank - die Zusicherungen hängen an
 * Unique-Indizes und Transaktionen, nicht an Anwendungscode.
 */
const { prisma } = await import('@swisshub/database');
const { spielersuche } = await import('@swisshub/modules');
const { createMockGateway, setDiscordGateway } = await import('@swisshub/discord');

const SEARCH_CHANNEL = '700000000000000003';
const VOICE_CATEGORY = '700000000000000010';
const ROLE_CS2 = '900000000000000001';
const ROLE_LOL = '900000000000000002';

const ALICE = { discordId: '100000000000000001', username: 'alice' };
const BOB = { discordId: '100000000000000002', username: 'bob' };
const CARLA = { discordId: '100000000000000003', username: 'carla' };

let gateway: ReturnType<typeof createMockGateway>;

/** Setzt die Moduleinstellungen direkt - schneller als über die Service-Schicht. */
async function configure(overrides: Record<string, unknown> = {}): Promise<void> {
  const { setModuleSettings } = await import('@swisshub/modules');
  await setModuleSettings(
    spielersuche.SPIELERSUCHE_MODULE_ID,
    {
      searchChannelId: SEARCH_CHANNEL,
      voiceCategoryId: VOICE_CATEGORY,
      expiryHours: 12,
      maxActiveSearchesPerUser: 1,
      maxRequestedPlayers: 20,
      rolePingEnabled: true,
      rolePingCooldownMinutes: 5,
      voiceEnabled: true,
      voiceAutoCleanup: true,
      ...overrides,
    },
    'test',
  );
}

async function createGame(
  name: string,
  roleId: string,
  maxSquadSize: number | null = null,
  enabled = true,
): Promise<string> {
  const game = await spielersuche.createGame(
    { name, roleId, bannerUrl: null, maxSquadSize, enabled },
    { discordId: ALICE.discordId, username: ALICE.username },
  );
  return game.id;
}

const search = (gameId: string, requestedPlayers = 3, comment?: string) => ({
  gameId,
  requestedPlayers,
  comment: comment ?? null,
  idempotencyKey: crypto.randomUUID(),
});

beforeAll(() => {
  if (TEST_DATABASE_URL) {
    pushSchema();
  }
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describeWithDatabase('Spielersuche starten', () => {
  beforeEach(async () => {
    await resetDatabase();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
  });

  it('erstellt Suche, Teilnehmer, Sprachkanal und Nachricht', async () => {
    const gameId = await createGame('CS2', ROLE_CS2, 5);
    const result = await spielersuche.createSearch(search(gameId, 3, 'Premier'), ALICE, { gateway });

    expect(result.match.status).toBe('OPEN');
    expect(result.match.gameName).toBe('CS2');
    expect(result.match.requestedPlayers).toBe(3);
    expect(result.match.comment).toBe('Premier');
    // Snapshot der Squad-Grösse - eine spätere Änderung am Spiel darf eine
    // laufende Suche nicht umdeuten.
    expect(result.match.maxSquadSize).toBe(5);
    expect(result.match.messageId).not.toBeNull();
    expect(result.match.voiceChannelId).not.toBeNull();

    // Der Ersteller ist automatisch Teilnehmer.
    const participants = await prisma.spielersucheParticipant.findMany({
      where: { matchId: result.match.id },
    });
    expect(participants).toHaveLength(1);
    expect(participants[0]?.isCreator).toBe(true);
    expect(participants[0]?.discordId).toBe(ALICE.discordId);
  });

  it('lässt pro Person nur eine offene Suche zu', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    await spielersuche.createSearch(search(gameId), ALICE, { gateway });

    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    // Andere sind davon nicht betroffen.
    await expect(spielersuche.createSearch(search(gameId), BOB, { gateway })).resolves.toBeTruthy();
  });

  it('erlaubt nach dem Beenden sofort eine neue Suche', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const first = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    await spielersuche.closeSearch(first.match.id, { actor: ALICE, gateway });

    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).resolves.toBeTruthy();
  });

  it('erlaubt mehrere Suchen, wenn das Limit erhöht ist', async () => {
    await configure({ maxActiveSearchesPerUser: 2 });
    const gameId = await createGame('CS2', ROLE_CS2);

    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).resolves.toBeTruthy();
    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).resolves.toBeTruthy();
    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('achtet auf die Squad-Grösse des Spiels', async () => {
    // Rocket League: 3 Plätze, also höchstens 2 gesuchte Spieler.
    const gameId = await createGame('Rocket League', ROLE_CS2, 3);

    await expect(spielersuche.createSearch(search(gameId, 3), ALICE, { gateway })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(spielersuche.createSearch(search(gameId, 2), ALICE, { gateway })).resolves.toBeTruthy();
  });

  it('lehnt ein unbekanntes oder deaktiviertes Spiel ab', async () => {
    const disabled = await createGame('Deaktiviert', ROLE_LOL, null, false);

    await expect(
      spielersuche.createSearch(search('cl00000000000000000000000'), ALICE, { gateway }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(spielersuche.createSearch(search(disabled), ALICE, { gateway })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('verlangt einen konfigurierten Channel', async () => {
    // Leerer Wert = nicht konfiguriert (siehe `optionalSnowflakeSchema`).
    await configure({ searchChannelId: '' });
    const gameId = await createGame('CS2', ROLE_CS2);

    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).rejects.toMatchObject({
      code: 'CONFIGURATION_MISSING',
    });
  });

  it('erzeugt bei doppeltem Idempotency Key nur eine Suche', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const input = search(gameId);

    const first = await spielersuche.createSearch(input, ALICE, { gateway });
    const second = await spielersuche.createSearch(input, ALICE, { gateway });

    expect(second.duplicate).toBe(true);
    expect(second.match.id).toBe(first.match.id);
    expect(await prisma.spielersucheMatch.count()).toBe(1);
  });

  it('schliesst die Suche, wenn die Nachricht nicht gesendet werden kann', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const failing = {
      ...gateway,
      channels: {
        ...gateway.channels,
        send: vi.fn().mockRejectedValue(new Error('Missing Access')),
      },
    };

    await expect(
      spielersuche.createSearch(search(gameId), ALICE, { gateway: failing }),
    ).rejects.toMatchObject({ code: 'DISCORD_UNAVAILABLE' });

    // Eine unsichtbare Suche wäre wertlos - sie darf keinen Platz belegen.
    const match = await prisma.spielersucheMatch.findFirst();
    expect(match?.status).toBe('CLOSED');
    expect(match?.activeCreatorKey).toBeNull();
    await expect(spielersuche.createSearch(search(gameId), ALICE, { gateway })).resolves.toBeTruthy();
  });

  it('erstellt die Suche auch ohne Sprachkanal, meldet das aber', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    // Beide Zugaenge lahmlegen: `voice.create` ist der aeltere Name fuer
    // `managedChannels.createVoice`, und der Test soll nicht davon abhaengen,
    // welchen die Anwendung gerade verwendet.
    const verweigert = vi.fn().mockRejectedValue(new Error('Forbidden'));
    const failing = {
      ...gateway,
      voice: { ...gateway.voice, create: verweigert },
      managedChannels: { ...gateway.managedChannels, createVoice: verweigert },
    };

    const result = await spielersuche.createSearch(search(gameId), ALICE, { gateway: failing });

    expect(result.match.status).toBe('OPEN');
    expect(result.match.voiceChannelId).toBeNull();
    expect(result.warnings.join(' ')).toContain('Voice-Channel');
  });
});

describeWithDatabase('Rollen-Ping', () => {
  beforeEach(async () => {
    await resetDatabase();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
  });

  it('erwähnt die Spielrolle beim ersten Mal', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const result = await spielersuche.createSearch(search(gameId), ALICE, { gateway });

    expect(result.rolePinged).toBe(true);
    expect(result.match.rolePinged).toBe(true);
    const ping = await prisma.spielersucheRolePing.findUnique({ where: { gameId } });
    expect(ping?.roleId).toBe(ROLE_CS2);
  });

  it('unterdrückt den Ping im Cooldown - die Suche entsteht trotzdem', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const first = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    await spielersuche.closeSearch(first.match.id, { actor: ALICE, gateway });

    const second = await spielersuche.createSearch(search(gameId), ALICE, { gateway });

    expect(second.match.status).toBe('OPEN');
    expect(second.rolePinged).toBe(false);
    expect(second.pingCooldownSeconds).toBeGreaterThan(0);
  });

  it('pingt nach Ablauf der Sperrfrist wieder', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const first = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    await spielersuche.closeSearch(first.match.id, { actor: ALICE, gateway });

    // Sperrfrist künstlich altern lassen.
    await prisma.spielersucheRolePing.update({
      where: { gameId },
      data: { pingedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    const second = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    expect(second.rolePinged).toBe(true);
  });

  it('pingt gar nicht, wenn die Erwähnung deaktiviert ist', async () => {
    await configure({ rolePingEnabled: false });
    const gameId = await createGame('CS2', ROLE_CS2);

    const result = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    expect(result.rolePinged).toBe(false);
    expect(await prisma.spielersucheRolePing.findUnique({ where: { gameId } })).toBeNull();
  });

  it('hält die Sperrfrist je Spiel getrennt', async () => {
    const cs2 = await createGame('CS2', ROLE_CS2);
    const lol = await createGame('League of Legends', ROLE_LOL);

    const first = await spielersuche.createSearch(search(cs2), ALICE, { gateway });
    await spielersuche.closeSearch(first.match.id, { actor: ALICE, gateway });

    // Anderes Spiel, andere Rolle - der Cooldown von CS2 gilt hier nicht.
    const second = await spielersuche.createSearch(search(lol), ALICE, { gateway });
    expect(second.rolePinged).toBe(true);
  });
});

describeWithDatabase('Beitreten und verlassen', () => {
  let gameId: string;
  let matchId: string;

  beforeEach(async () => {
    await resetDatabase();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
    gameId = await createGame('CS2', ROLE_CS2, 5);
    const result = await spielersuche.createSearch(search(gameId, 2), ALICE, { gateway });
    matchId = result.match.id;
  });

  it('nimmt jemanden auf und aktualisiert die Gruppe', async () => {
    const outcome = await spielersuche.joinSearch(matchId, BOB, { gateway });

    expect(outcome.result).toBe('joined');
    if (outcome.result === 'joined') {
      expect(outcome.participants).toBe(2);
      expect(outcome.complete).toBe(false);
    }
  });

  it('lässt niemanden zweimal beitreten', async () => {
    await spielersuche.joinSearch(matchId, BOB, { gateway });
    const second = await spielersuche.joinSearch(matchId, BOB, { gateway });

    expect(second.result).toBe('already-in');
    expect(await prisma.spielersucheParticipant.count({ where: { matchId, leftAt: null } })).toBe(2);
  });

  it('setzt den Status auf COMPLETE, wenn die Gruppe voll ist', async () => {
    await spielersuche.joinSearch(matchId, BOB, { gateway });
    const last = await spielersuche.joinSearch(matchId, CARLA, { gateway });

    expect(last.result).toBe('joined');
    if (last.result === 'joined') {
      expect(last.complete).toBe(true);
    }
    const match = await prisma.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('COMPLETE');
  });

  it('weist weitere Beitritte ab, wenn die Gruppe voll ist', async () => {
    await spielersuche.joinSearch(matchId, BOB, { gateway });
    await spielersuche.joinSearch(matchId, CARLA, { gateway });

    const late = await spielersuche.joinSearch(
      matchId,
      { discordId: '100000000000000009', username: 'dora' },
      { gateway },
    );
    expect(late.result).toBe('full');
  });

  it('lässt bei gleichzeitigen Beitritten nie mehr Leute rein als Plätze da sind', async () => {
    // Der eigentliche Nachweis: zwei Anfragen auf den letzten Platz.
    const others = ['100000000000000011', '100000000000000012', '100000000000000013'].map((discordId) => ({
      discordId,
      username: `user-${discordId.slice(-2)}`,
    }));

    const results = await Promise.all(
      others.map((actor) => spielersuche.joinSearch(matchId, actor, { gateway })),
    );

    const joined = results.filter((result) => result.result === 'joined');
    const full = results.filter((result) => result.result === 'full');

    // Zwei freie Plätze, drei Anfragen - genau zwei dürfen gewinnen.
    expect(joined).toHaveLength(2);
    expect(full).toHaveLength(1);
    expect(await prisma.spielersucheParticipant.count({ where: { matchId, leftAt: null } })).toBe(3);
  });

  it('lässt den Ersteller nicht austreten', async () => {
    const outcome = await spielersuche.leaveSearch(matchId, ALICE, { gateway });

    expect(outcome.result).toBe('creator');
    expect(await prisma.spielersucheParticipant.count({ where: { matchId, leftAt: null } })).toBe(1);
  });

  it('öffnet eine volle Gruppe wieder, wenn jemand austritt', async () => {
    await spielersuche.joinSearch(matchId, BOB, { gateway });
    await spielersuche.joinSearch(matchId, CARLA, { gateway });
    expect((await prisma.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
      'COMPLETE',
    );

    const outcome = await spielersuche.leaveSearch(matchId, CARLA, { gateway });

    expect(outcome.result).toBe('left');
    if (outcome.result === 'left') {
      expect(outcome.reopened).toBe(true);
    }
    expect((await prisma.spielersucheMatch.findUniqueOrThrow({ where: { id: matchId } })).status).toBe(
      'OPEN',
    );
  });

  it('behält ausgetretene Teilnehmer in der Historie', async () => {
    await spielersuche.joinSearch(matchId, BOB, { gateway });
    await spielersuche.leaveSearch(matchId, BOB, { gateway });

    const participant = await prisma.spielersucheParticipant.findUniqueOrThrow({
      where: { matchId_discordId: { matchId, discordId: BOB.discordId } },
    });
    expect(participant.leftAt).not.toBeNull();
    expect(await prisma.spielersucheParticipant.count({ where: { matchId, leftAt: null } })).toBe(1);
  });

  it('lässt jemanden nach dem Austritt wieder beitreten', async () => {
    await spielersuche.joinSearch(matchId, BOB, { gateway });
    await spielersuche.leaveSearch(matchId, BOB, { gateway });
    const again = await spielersuche.joinSearch(matchId, BOB, { gateway });

    expect(again.result).toBe('joined');
    // Kein zweiter Datensatz - der Unique-Index bleibt gewahrt.
    expect(await prisma.spielersucheParticipant.count({ where: { matchId } })).toBe(2);
  });

  it('nimmt nach dem Beenden niemanden mehr auf', async () => {
    await spielersuche.closeSearch(matchId, { actor: ALICE, gateway });

    expect((await spielersuche.joinSearch(matchId, BOB, { gateway })).result).toBe('not-active');
    expect((await spielersuche.leaveSearch(matchId, BOB, { gateway })).result).toBe('not-active');
  });
});

describeWithDatabase('Beenden und Ablauf', () => {
  beforeEach(async () => {
    await resetDatabase();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
  });

  it('beendet eine Suche und gibt den Platz frei', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });

    const result = await spielersuche.closeSearch(created.match.id, { actor: ALICE, gateway });

    expect(result.match.status).toBe('CLOSED');
    expect(result.match.closedAt).not.toBeNull();
    expect(result.match.closedByDiscordId).toBe(ALICE.discordId);
    expect(result.match.activeCreatorKey).toBeNull();
  });

  it('lehnt das zweite Beenden ab', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    await spielersuche.closeSearch(created.match.id, { actor: ALICE, gateway });

    await expect(spielersuche.closeSearch(created.match.id, { actor: BOB, gateway })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('beendet abgelaufene Suchen über den Worker', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });

    // In die Vergangenheit setzen - so als wäre der Bot zwischendurch aus.
    await prisma.spielersucheMatch.update({
      where: { id: created.match.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await spielersuche.expireSearches(10, gateway);

    expect(result.expired).toBe(1);
    const match = await prisma.spielersucheMatch.findUniqueOrThrow({ where: { id: created.match.id } });
    expect(match.status).toBe('EXPIRED');
    expect(match.activeCreatorKey).toBeNull();
  });

  it('lässt noch laufende Suchen unangetastet', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    await spielersuche.createSearch(search(gameId), ALICE, { gateway });

    expect((await spielersuche.expireSearches(10, gateway)).expired).toBe(0);
  });
});

describeWithDatabase('Voice und Statistik', () => {
  beforeEach(async () => {
    await resetDatabase();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
  });

  it('misst die Zeit in einem Spielersuche-Kanal', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    const channelId = created.match.voiceChannelId as string;

    const joinedAt = new Date(Date.now() - 90 * 1000);
    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
      joinedAt,
    });
    const ended = await spielersuche.endVoiceSession({
      discordId: BOB.discordId,
      voiceChannelId: channelId,
    });

    expect(ended?.durationSeconds).toBeGreaterThanOrEqual(89);
    expect(ended?.durationSeconds).toBeLessThanOrEqual(92);
  });

  it('legt für dieselbe Person im selben Kanal keine zweite offene Session an', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    const channelId = created.match.voiceChannelId as string;

    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
    });
    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
    });

    expect(await prisma.spielersucheVoiceSession.count({ where: { voiceChannelId: channelId } })).toBe(1);
  });

  it('deckelt eine hängengebliebene Session bei 12 Stunden', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    const channelId = created.match.voiceChannelId as string;

    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
      // Drei Tage - so als wäre der Bot beim Verlassen offline gewesen.
      joinedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const ended = await spielersuche.endVoiceSession({
      discordId: BOB.discordId,
      voiceChannelId: channelId,
    });

    expect(ended?.durationSeconds).toBe(12 * 60 * 60);
  });

  it('schliesst nach einem Neustart offene Sessions', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);
    const created = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    const channelId = created.match.voiceChannelId as string;

    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
    });
    await spielersuche.startVoiceSession({
      discordId: CARLA.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
    });

    // Nur Carla sitzt noch im Kanal.
    const closed = await spielersuche.recoverStaleVoiceSessions(new Set([`${channelId}:${CARLA.discordId}`]));

    expect(closed).toBe(1);
    expect(await prisma.spielersucheVoiceSession.count({ where: { leftAt: null } })).toBe(1);
  });

  it('zählt Nutzung, Teilnahmen und Voice-Zeit je Person', async () => {
    const gameId = await createGame('CS2', ROLE_CS2, 5);
    const created = await spielersuche.createSearch(search(gameId, 3), ALICE, { gateway });
    await spielersuche.joinSearch(created.match.id, BOB, { gateway });

    const channelId = created.match.voiceChannelId as string;
    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: created.match.id,
      voiceChannelId: channelId,
      joinedAt: new Date(Date.now() - 600 * 1000),
    });
    await spielersuche.endVoiceSession({ discordId: BOB.discordId, voiceChannelId: channelId });

    const alice = await spielersuche.getUserStats(ALICE.discordId);
    const bob = await spielersuche.getUserStats(BOB.discordId);

    expect(alice.usageCount).toBe(1);
    expect(alice.createdSearches).toBe(1);
    // Der Ersteller zählt nicht als "Teilnahme bei anderen".
    expect(alice.joinedSearches).toBe(0);
    expect(bob.joinedSearches).toBe(1);
    expect(bob.voiceSeconds).toBeGreaterThanOrEqual(599);
  });

  it('sortiert die Rangliste nach Suchen, dann nach Voice-Zeit', async () => {
    const gameId = await createGame('CS2', ROLE_CS2);

    // Alice: zwei Suchen. Bob: eine Suche, dafür Voice-Zeit.
    const first = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    await spielersuche.closeSearch(first.match.id, { actor: ALICE, gateway });
    const second = await spielersuche.createSearch(search(gameId), ALICE, { gateway });
    await spielersuche.closeSearch(second.match.id, { actor: ALICE, gateway });

    const bobSearch = await spielersuche.createSearch(search(gameId), BOB, { gateway });
    const channelId = bobSearch.match.voiceChannelId as string;
    await spielersuche.startVoiceSession({
      discordId: BOB.discordId,
      matchId: bobSearch.match.id,
      voiceChannelId: channelId,
      joinedAt: new Date(Date.now() - 3600 * 1000),
    });
    await spielersuche.endVoiceSession({ discordId: BOB.discordId, voiceChannelId: channelId });

    const board = await spielersuche.getLeaderboard({ limit: 5 });

    expect(board[0]?.discordId).toBe(ALICE.discordId);
    expect(board[0]?.usageCount).toBe(2);
    expect(board[1]?.discordId).toBe(BOB.discordId);
    expect(board[1]?.voiceSeconds).toBeGreaterThanOrEqual(3599);
  });

  it('liefert Kennzahlen für die Übersicht', async () => {
    const gameId = await createGame('CS2', ROLE_CS2, 5);
    const created = await spielersuche.createSearch(search(gameId, 1), ALICE, { gateway });
    await spielersuche.joinSearch(created.match.id, BOB, { gateway });

    const overview = await spielersuche.getOverview();

    expect(overview.activeSearches).toBe(1);
    expect(overview.completeSearches).toBe(1);
    expect(overview.searchesToday).toBe(1);
    expect(overview.activeParticipants).toBe(2);
    expect(overview.configuredGames).toBe(1);
  });
});

/** Leert alle Tabellen des Moduls zwischen den Tests. */
async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SpielersucheImportItem", "SpielersucheImport", "SpielersucheVoiceSession",
      "SpielersucheParticipant", "SpielersucheRolePing", "SpielersucheUsage",
      "SpielersucheMatch", "SpielersucheGame",
      "TemporaryVoiceAccess", "TemporaryVoiceChannel", "VoiceHubEvent", "AuditLog", "IdempotencyRecord", "ModuleState"
    RESTART IDENTITY CASCADE
  `);
}

describeWithDatabase('Sprachkanal-Verhalten des Vorgängers', () => {
  beforeEach(async () => {
    await resetDatabase();
    gateway = createMockGateway();
    setDiscordGateway(gateway);
    await configure();
  });

  it('begrenzt den Kanal auf die Squad-Grösse des Spiels', () => {
    expect(spielersuche.voiceUserLimit({ maxSquadSize: 5, requestedPlayers: 2 })).toBe(5);
    expect(spielersuche.voiceUserLimit({ maxSquadSize: 3, requestedPlayers: 2 })).toBe(3);
  });

  it('begrenzt ohne Squad-Grösse auf die gesuchte Gruppe', () => {
    // Verhalten des alten Bots: Limit = gesuchte Spieler + Ersteller.
    expect(spielersuche.voiceUserLimit({ maxSquadSize: null, requestedPlayers: 4 })).toBe(5);
    expect(spielersuche.voiceUserLimit({ maxSquadSize: null, requestedPlayers: 1 })).toBe(2);
    // Discord erlaubt höchstens 99.
    expect(spielersuche.voiceUserLimit({ maxSquadSize: null, requestedPlayers: 150 })).toBe(99);
  });

  it('legt den Kanal mit diesem Limit an', async () => {
    // Auf `managedChannels.createVoice` gespaeht: `voice.create` ist derselbe
    // Aufruf unter dem aelteren Namen, und die gemeinsame Engine verwendet
    // den neueren.
    const created = vi.spyOn(gateway.managedChannels, 'createVoice');
    const gameId = await createGame('Minecraft', ROLE_LOL, null);

    await spielersuche.createSearch(search(gameId, 3), ALICE, { gateway });

    // Ohne Squad-Grösse: 3 gesuchte + Ersteller.
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ userLimit: 4 }));
  });

  it('schliesst den Sprachkanal, sobald die Gruppe vollständig ist', async () => {
    const overwrite = vi.spyOn(gateway.voice, 'setOverwrite');
    const gameId = await createGame('CS2', ROLE_CS2, 5);
    const created = await spielersuche.createSearch(search(gameId, 1), ALICE, { gateway });

    overwrite.mockClear();
    await spielersuche.joinSearch(created.match.id, BOB, { gateway });

    // Die Sperre gilt der Rolle @everyone (Typ 0 = Rolle).
    const lock = overwrite.mock.calls.find((call) => call[1].type === 0);
    expect(lock).toBeDefined();
    expect(lock?.[1].deny).toBeGreaterThan(0n);
  });

  it('öffnet den Sprachkanal wieder, wenn ein Platz frei wird', async () => {
    const overwrite = vi.spyOn(gateway.voice, 'setOverwrite');
    const gameId = await createGame('CS2', ROLE_CS2, 5);
    const created = await spielersuche.createSearch(search(gameId, 1), ALICE, { gateway });
    await spielersuche.joinSearch(created.match.id, BOB, { gateway });

    overwrite.mockClear();
    await spielersuche.leaveSearch(created.match.id, BOB, { gateway });

    const unlock = overwrite.mock.calls.find((call) => call[1].type === 0);
    expect(unlock).toBeDefined();
    expect(unlock?.[1].deny).toBe(0n);
  });
});
