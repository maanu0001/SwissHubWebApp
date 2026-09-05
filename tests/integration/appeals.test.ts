import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_appeals');

/**
 * Entbannungsanträge gegen eine echte PostgreSQL-Datenbank.
 *
 * Die entscheidenden Zusagen hängen an Datenbankeigenschaften: der Zuschlag
 * für eine Entscheidung, die Fallnummer unter gleichzeitigen Einreichungen,
 * die getrennten Abfragen für Antragsteller und Team. Eine Nachbildung von
 * Prisma hätte genau die Eindeutigkeit, die man ihr einbaut - und bestätigte
 * damit nichts.
 */
const { prisma } = await import('@swisshub/database');
const { appeals, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GILDE = '900000000000000700';
const GEBANNT = '100000000000000701';
const ANDERER = '100000000000000702';
const MODERATOR = '200000000000000703';
const ZWEITER_MODERATOR = '200000000000000704';

/** Ein Discord-Zugang, der mitschreibt statt zu handeln. */
function attrappe(optionen: { gebannt?: string[] } = {}) {
  const gebannt = new Set(optionen.gebannt ?? [GEBANNT]);
  const entbannt: string[] = [];
  const gesendet: Array<{ channelId: string }> = [];

  const gateway = {
    bans: {
      get: vi.fn(async (discordId: string) =>
        gebannt.has(discordId) ? { discordId, reason: 'Spam im Allgemein-Kanal' } : null,
      ),
      remove: vi.fn(async (discordId: string) => {
        gebannt.delete(discordId);
        entbannt.push(discordId);
      }),
      add: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    },
    members: {
      get: vi.fn(async () => null),
    },
    roles: { list: vi.fn(async () => []) },
    channels: {
      list: vi.fn(async () => []),
      send: vi.fn(async (channelId: string) => {
        gesendet.push({ channelId });
        return { id: '800000000000000001', channelId };
      }),
      sendDirect: vi.fn(async () => true),
    },
  };
  return { gateway: gateway as never, gebannt, entbannt, gesendet };
}

/** Ein Moderationshandelnder mit genau den angegebenen Berechtigungen. */
function moderator(permissions: string[], discordId = MODERATOR) {
  return {
    discordId,
    username: 'moderatorin',
    roleIds: [] as string[],
    isOwner: false,
    can: (permission: string) => permissions.includes(permission),
  };
}

/**
 * Ein Antrag, wie er heute eingereicht wird: ein Feld.
 *
 * Vorher waren es fünf Fragen. Die alten Schlüssel gibt es weiterhin - in
 * Anträgen, die damals eingereicht wurden -, sie werden nur nicht mehr
 * ausgefüllt. Dass die weiterhin lesbar sind, prüft `appeal-ein-feld`.
 */
const VOLLE_ANTWORTEN = {
  antrag:
    'Ich möchte gerne zurück auf den Server, weil mir die Community wichtig ist. Ich habe im Allgemein-Kanal mehrfach denselben Link geschickt und damals nicht verstanden, dass das als Spam gilt. Heute würde ich erst fragen.',
};

async function reicheEin(
  gateway: never,
  discordId = GEBANNT,
  schluessel = `key-${Math.random().toString(36).slice(2)}`,
) {
  return appeals.reicheEin({
    guildId: GILDE,
    applicant: { discordId, username: 'antragsteller' },
    antworten: VOLLE_ANTWORTEN,
    idempotencyKey: schluessel,
    gateway,
  });
}

describeWithDatabase('Entbannungsanträge', () => {
  beforeAll(async () => {
    pushSchema();
    await setModuleEnabled('appeals', true, 'test');
    await setModuleSettings(
      'appeals',
      {
        wartefristTage: 0,
        cooldownTage: 30,
        cooldownZweiteAblehnungTage: 90,
        maxAktiveProPerson: 1,
        ablaufTageOhneAntwort: 14,
        vierAugen: 'NIE',
        meldeKanalId: null,
        meldeRolleId: null,
      },
      'test',
    );
  });

  beforeEach(async () => {
    await prisma.appealEvent.deleteMany({});
    await prisma.appealAttachment.deleteMany({});
    await prisma.appealInternalComment.deleteMany({});
    await prisma.appealMessage.deleteMany({});
    await prisma.appeal.deleteMany({});
    await prisma.appealCounter.deleteMany({});
    await prisma.moderationAction.deleteMany({});
  });

  // --- Zulässigkeit ---------------------------------------------------------

  it('lässt einen gebannten Antragsteller einreichen', async () => {
    const { gateway } = attrappe();
    const befund = await appeals.pruefeZulaessigkeit(GEBANNT, { gateway, guildId: GILDE });
    expect(befund.erlaubt).toBe(true);
  });

  /**
   * Ohne Bann kein Antrag (§6).
   *
   * Und die Auskunft ist klar: kein Bann. Nicht «du darfst nicht» - das wäre
   * eine Behauptung, die nach einem Sperrgrund klingt.
   */
  it('weist einen Antrag ohne Bann ab', async () => {
    const { gateway } = attrappe();
    const befund = await appeals.pruefeZulaessigkeit(ANDERER, { gateway, guildId: GILDE });
    expect(befund.erlaubt).toBe(false);
    expect(befund.code).toBe('KEIN_BANN');
    expect(befund.grund).toContain('kein aktiver SwissHub-Ban');
  });

  it('erzeugt für jemanden ohne Bann keinen Antrag', async () => {
    const { gateway } = attrappe();
    await expect(reicheEin(gateway, ANDERER)).rejects.toThrow();
    expect(await prisma.appeal.count()).toBe(0);
  });

  /**
   * Discord antwortet nicht.
   *
   * Kein «du darfst nicht» - das wäre eine Behauptung, die niemand geprüft
   * hat. Stattdessen: bitte später.
   */
  it('behauptet nichts, wenn Discord nicht antwortet', async () => {
    const gateway = {
      bans: {
        get: vi.fn(async () => {
          throw new Error('Discord unerreichbar');
        }),
      },
    } as never;
    const befund = await appeals.pruefeZulaessigkeit(GEBANNT, { gateway, guildId: GILDE });
    expect(befund.erlaubt).toBe(false);
    expect(befund.code).toBe('NICHT_PRUEFBAR');
  });

  it('lässt nur einen aktiven Antrag zu', async () => {
    const { gateway } = attrappe();
    await reicheEin(gateway);

    const befund = await appeals.pruefeZulaessigkeit(GEBANNT, { gateway, guildId: GILDE });
    expect(befund.erlaubt).toBe(false);
    expect(befund.code).toBe('BEREITS_OFFEN');
  });

  // --- Einreichung ----------------------------------------------------------

  it('reicht einen Antrag mit Fallnummer und Momentaufnahme ein', async () => {
    const { gateway } = attrappe();
    const { appeal, neu } = await reicheEin(gateway);

    expect(neu).toBe(true);
    expect(appeal.status).toBe('SUBMITTED');
    expect(appeal.caseNumber).toBe(1);
    expect(appeal.caseYear).toBe(new Date().getUTCFullYear());

    const snapshot = appeal.banSnapshot as Record<string, unknown>;
    expect(snapshot.discordGrund).toBe('Spam im Allgemein-Kanal');
    expect(snapshot.quelle).toBe('discord');
  });

  /**
   * Der Doppelklick erzeugt einen Antrag, nicht zwei (§30, §59).
   */
  it('erzeugt bei gleichem Schlüssel nur einen Antrag', async () => {
    const { gateway } = attrappe();
    const erster = await reicheEin(gateway, GEBANNT, 'derselbe-schluessel');
    const zweiter = await reicheEin(gateway, GEBANNT, 'derselbe-schluessel');

    expect(erster.neu).toBe(true);
    expect(zweiter.neu).toBe(false);
    expect(zweiter.appeal.id).toBe(erster.appeal.id);
    expect(await prisma.appeal.count()).toBe(1);
  });

  /**
   * Die Fallnummer unter gleichzeitigen Einreichungen.
   *
   * `MAX(n) + 1` gäbe beiden dieselbe Zahl. Der eigene Zähler nicht.
   */
  it('vergibt bei gleichzeitigen Einreichungen verschiedene Nummern', async () => {
    const jahr = 2026;
    const nummern = await Promise.all(
      Array.from({ length: 8 }, () => appeals.naechsteFallnummer(GILDE, jahr)),
    );
    expect(new Set(nummern).size).toBe(8);
  });

  it('beginnt in einem neuen Jahr wieder bei eins', async () => {
    expect(await appeals.naechsteFallnummer(GILDE, 2026)).toBe(1);
    expect(await appeals.naechsteFallnummer(GILDE, 2027)).toBe(1);
    expect(await appeals.naechsteFallnummer(GILDE, 2026)).toBe(2);
  });

  it('weist einen unvollständigen Antrag ab', async () => {
    const { gateway } = attrappe();
    await expect(
      appeals.reicheEin({
        guildId: GILDE,
        applicant: { discordId: GEBANNT, username: 'antragsteller' },
        antworten: { antrag: 'zu kurz' },
        idempotencyKey: 'unvollstaendig',
        gateway,
      }),
    ).rejects.toThrow();
    expect(await prisma.appeal.count()).toBe(0);
  });

  // --- Eigentum (§4) --------------------------------------------------------

  /**
   * Der wichtigste Test dieser Datei.
   *
   * Ein fremder Antrag wird nicht gefunden - nicht gefunden und dann
   * verworfen, sondern gar nicht erst gelesen. Und die Antwort ist
   * `NOT_FOUND`: ein anderer Ausgang verriete, dass es ihn gibt (IDOR).
   */
  it('lässt niemanden an einen fremden Antrag', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await expect(appeals.requireEigenerAppeal(GILDE, appeal.id, ANDERER)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(await appeals.holeAntragstellerSicht(GILDE, appeal.id, ANDERER)).toBeNull();
    expect(await appeals.holeAntragstellerSicht(GILDE, appeal.id, GEBANNT)).not.toBeNull();
  });

  it('findet einen Antrag einer fremden Gilde nicht', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    expect(await appeals.holeAppeal('900000000000000999', appeal.id)).toBeNull();
  });

  // --- Sichtbarkeit (§13, §20, §39) ----------------------------------------

  /**
   * Interne Kommentare erreichen den Antragsteller nicht.
   *
   * Und zwar nicht, weil die Anzeige sie weglässt: die Abfrage des
   * Antragstellers lädt sie gar nicht erst.
   */
  it('hält interne Kommentare vom Antragsteller fern', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await appeals.schreibeInternenKommentar(GILDE, appeal.id, 'Wiederholungstäter, siehe Fall von 2025.', {
      discordId: MODERATOR,
      username: 'moderatorin',
    });

    const sicht = await appeals.holeAntragstellerSicht(GILDE, appeal.id, GEBANNT);
    const alsText = JSON.stringify(sicht);
    expect(alsText).not.toContain('Wiederholungstäter');
    expect(alsText).not.toContain('moderatorin');

    // Das Team sieht sie sehr wohl.
    const staff = await appeals.holeStaffSicht(GILDE, appeal.id);
    expect(JSON.stringify(staff)).toContain('Wiederholungstäter');
  });

  /**
   * Interne Zeitleisteneinträge ebenso.
   *
   * «Priorität geändert» und «Bearbeiter gewechselt» gehen den Antragsteller
   * nichts an - sie zeigen, wie intern gearbeitet wird.
   */
  it('zeigt dem Antragsteller nur öffentliche Zeitleisteneinträge', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await appeals.setzePrioritaet(GILDE, appeal.id, 'HIGH', {
      discordId: MODERATOR,
      username: 'moderatorin',
    });
    await appeals.weiseZu(
      GILDE,
      appeal.id,
      { discordId: MODERATOR, username: 'moderatorin' },
      { discordId: MODERATOR, username: 'moderatorin' },
    );

    const sicht = await appeals.holeAntragstellerSicht(GILDE, appeal.id, GEBANNT);
    expect(sicht?.zeitleiste.map((eintrag) => eintrag.label)).toEqual(['Antrag eingereicht']);
    expect(JSON.stringify(sicht)).not.toContain('moderatorin');

    const alle = await prisma.appealEvent.count({ where: { appealId: appeal.id } });
    expect(alle).toBeGreaterThan(1);
  });

  /**
   * Aus dem Moderator wird «SwissHub Team» (§22).
   */
  it('nennt dem Antragsteller keinen Moderatornamen', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await appeals.schreibeStaffNachricht(GILDE, appeal.id, 'Bitte erläutere Punkt zwei genauer.', {
      discordId: MODERATOR,
      username: 'moderatorin',
    });

    const sicht = await appeals.holeAntragstellerSicht(GILDE, appeal.id, GEBANNT);
    expect(sicht?.nachrichten).toHaveLength(1);
    expect(sicht?.nachrichten[0]?.von).toBe('TEAM');
    expect(JSON.stringify(sicht)).not.toContain('moderatorin');

    // In der Datenbank steht sie - für die Prüfspur.
    const nachricht = await prisma.appealMessage.findFirstOrThrow();
    expect(nachricht.authorUsername).toBe('moderatorin');
  });

  it('hält die interne Entscheidungsbegründung zurück', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    await appeals.lehneAb({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir bleiben bei der Entscheidung.',
      internalDecision: 'Dritter Verstoss, kein Einsehen erkennbar.',
      erneutErlaubt: true,
    });

    const sicht = await appeals.holeAntragstellerSicht(GILDE, appeal.id, GEBANNT);
    expect(sicht?.entscheidung).toBe('Wir bleiben bei der Entscheidung.');
    expect(JSON.stringify(sicht)).not.toContain('kein Einsehen erkennbar');
  });

  // --- Gespräch -------------------------------------------------------------

  it('führt Rückfrage und Antwort durch die Zustände', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    const nachFrage = await appeals.schreibeStaffNachricht(
      GILDE,
      appeal.id,
      'Bitte erläutere Punkt zwei genauer.',
      { discordId: MODERATOR, username: 'moderatorin' },
    );
    expect(nachFrage.status).toBe('WAITING_FOR_APPLICANT');

    const nachAntwort = await appeals.schreibeAntragstellerNachricht(
      GILDE,
      appeal.id,
      'Ich meinte damit, dass ich den Link für hilfreich hielt.',
      { discordId: GEBANNT, username: 'antragsteller' },
    );
    expect(nachAntwort.status).toBe('WAITING_FOR_STAFF');
  });

  it('lässt niemanden im fremden Antrag antworten', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await expect(
      appeals.schreibeAntragstellerNachricht(GILDE, appeal.id, 'Hallo', {
        discordId: ANDERER,
        username: 'fremder',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await prisma.appealMessage.count()).toBe(0);
  });

  // --- Entscheidung ---------------------------------------------------------

  it('genehmigt und entbannt über das Moderation Center', async () => {
    const { gateway, gebannt, entbannt } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    const ergebnis = await appeals.genehmige({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir geben dir eine zweite Chance.',
      entbannen: true,
      moderationActor: moderator(['moderation.unban']),
      gateway,
    });

    expect(ergebnis.entbannung).toBe('COMPLETED');
    expect(entbannt).toEqual([GEBANNT]);
    expect(gebannt.has(GEBANNT)).toBe(false);
    expect(ergebnis.appeal.status).toBe('APPROVED');
    expect(ergebnis.appeal.unbanStatus).toBe('COMPLETED');
  });

  /**
   * Ohne `moderation.unban` keine Entbannung.
   *
   * Dieses Modul kann die Moderationsrechte nicht umgehen (§41). Die
   * Entscheidung steht trotzdem - sie ist gefallen.
   */
  it('entbannt nicht ohne Moderationsberechtigung', async () => {
    const { gateway, gebannt } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    const ergebnis = await appeals.genehmige({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir geben dir eine zweite Chance.',
      entbannen: true,
      // Kann alles - ausser entbannen.
      moderationActor: moderator(['moderation.ban', 'moderation.kick']),
      gateway,
    });

    expect(ergebnis.entbannung).toBe('PARTIAL');
    expect(gebannt.has(GEBANNT)).toBe(true);
    expect(ergebnis.appeal.status).toBe('APPROVED');
    expect(ergebnis.appeal.unbanStatus).toBe('PARTIAL');
  });

  /**
   * Entschieden ist nicht ausgeführt (§26).
   *
   * Scheitert Discord, steht die Entscheidung trotzdem - und der Antrag sagt
   * es, statt so zu tun, als sei alles gut.
   */
  it('hält die Entscheidung, wenn Discord scheitert', async () => {
    const gateway = {
      bans: {
        get: vi.fn(async (discordId: string) => ({ discordId, reason: 'Spam' })),
        remove: vi.fn(async () => {
          throw Object.assign(new Error('Discord kaputt'), {
            code: 'DISCORD_UNAVAILABLE',
            userMessage: 'Discord ist nicht erreichbar.',
          });
        }),
        add: vi.fn(async () => undefined),
        list: vi.fn(async () => []),
      },
      members: { get: vi.fn(async () => null) },
      roles: { list: vi.fn(async () => []) },
      channels: { list: vi.fn(async () => []), send: vi.fn(async () => ({ id: '1', channelId: '1' })) },
    } as never;

    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    const ergebnis = await appeals.genehmige({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir geben dir eine zweite Chance.',
      entbannen: true,
      moderationActor: moderator(['moderation.unban']),
      gateway,
    });

    expect(ergebnis.entbannung).toBe('PARTIAL');
    expect(ergebnis.appeal.status).toBe('APPROVED');
    expect(ergebnis.hinweis).toContain('konnte noch nicht');
  });

  /**
   * Die Entbannung ist idempotent (§25, §59).
   *
   * Besteht kein Bann mehr, ist das der gewünschte Zustand - kein Fehler.
   */
  it('behandelt eine bereits erfolgte Entbannung als Erfolg', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    const erste = await appeals.genehmige({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir geben dir eine zweite Chance.',
      entbannen: true,
      moderationActor: moderator(['moderation.unban']),
      gateway,
    });
    expect(erste.entbannung).toBe('COMPLETED');

    // Zweiter Versuch auf einem bereits entbannten Konto.
    const zweite = await appeals.wiederholeEntbannung(GILDE, appeal.id, {
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      moderationActor: moderator(['moderation.unban']),
      gateway,
    });
    expect(zweite.entbannung).toBe('NO_OP');
  });

  /**
   * Genau eine Entscheidung gewinnt (§58).
   *
   * Zwei Moderatoren, gleichzeitig, gegensätzlich. Der zweite bekommt eine
   * Meldung statt einer zweiten Entscheidung.
   */
  it('lässt bei gleichzeitigen Entscheidungen nur eine durch', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    const ergebnisse = await Promise.allSettled([
      appeals.genehmige({
        guildId: GILDE,
        appealId: appeal.id,
        actor: { discordId: MODERATOR, username: 'moderatorin' },
        publicDecision: 'Wir geben dir eine zweite Chance.',
        entbannen: false,
        gateway,
      }),
      appeals.lehneAb({
        guildId: GILDE,
        appealId: appeal.id,
        actor: { discordId: ZWEITER_MODERATOR, username: 'zweiter' },
        publicDecision: 'Wir bleiben bei der Entscheidung.',
        erneutErlaubt: true,
      }),
    ]);

    const erfolgreich = ergebnisse.filter((eintrag) => eintrag.status === 'fulfilled');
    expect(erfolgreich).toHaveLength(1);

    const danach = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(['APPROVED', 'REJECTED']).toContain(danach.status);
    expect(danach.decidedAt).not.toBeNull();
  });

  it('weist eine zweite Entscheidung ab', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    await appeals.lehneAb({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir bleiben bei der Entscheidung.',
      erneutErlaubt: true,
    });

    await expect(
      appeals.genehmige({
        guildId: GILDE,
        appealId: appeal.id,
        actor: { discordId: ZWEITER_MODERATOR, username: 'zweiter' },
        publicDecision: 'Doch eine Chance.',
        entbannen: false,
        gateway,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // --- Vier-Augen (§24) -----------------------------------------------------

  it('verlangt bei eingeschaltetem Vier-Augen-Prinzip eine zweite Person', async () => {
    await setModuleSettings('appeals', { vierAugen: 'GENEHMIGUNG' }, 'test');
    try {
      const { gateway } = attrappe();
      const { appeal } = await reicheEin(gateway);
      await appeals.setzeStatus({
        guildId: GILDE,
        appealId: appeal.id,
        nach: 'UNDER_REVIEW',
        actor: { discordId: MODERATOR, username: 'moderatorin' },
      });

      expect(await appeals.brauchtVierAugen('APPROVE')).toBe(true);
      expect(await appeals.brauchtVierAugen('REJECT')).toBe(false);

      const vorgeschlagen = await appeals.schlageVor({
        guildId: GILDE,
        appealId: appeal.id,
        actor: { discordId: MODERATOR, username: 'moderatorin' },
        art: 'APPROVE',
        publicDecision: 'Wir geben dir eine zweite Chance.',
      });
      expect(vorgeschlagen.status).toBe('DECISION_PENDING');

      // Der eigene Vorschlag lässt sich nicht selbst bestätigen.
      await expect(
        appeals.genehmige({
          guildId: GILDE,
          appealId: appeal.id,
          actor: { discordId: MODERATOR, username: 'moderatorin' },
          publicDecision: 'Wir geben dir eine zweite Chance.',
          entbannen: false,
          gateway,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // Eine andere Person schon.
      const bestaetigt = await appeals.genehmige({
        guildId: GILDE,
        appealId: appeal.id,
        actor: { discordId: ZWEITER_MODERATOR, username: 'zweiter' },
        publicDecision: 'Wir geben dir eine zweite Chance.',
        entbannen: false,
        gateway,
      });
      expect(bestaetigt.appeal.status).toBe('APPROVED');
    } finally {
      await setModuleSettings('appeals', { vierAugen: 'NIE' }, 'test');
    }
  });

  // --- Sperrfrist (§31) -----------------------------------------------------

  it('setzt nach einer Ablehnung eine Sperrfrist', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    await appeals.lehneAb({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Wir bleiben bei der Entscheidung.',
      erneutErlaubt: true,
    });

    const danach = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(danach.nextEligibleAt).not.toBeNull();
    expect(danach.finalRejection).toBe(false);

    const befund = await appeals.pruefeZulaessigkeit(GEBANNT, { gateway, guildId: GILDE });
    expect(befund.erlaubt).toBe(false);
    expect(befund.code).toBe('COOLDOWN');
    expect(befund.naechsteMoeglichkeitAm).not.toBeUndefined();
  });

  it('sperrt eine endgültige Ablehnung dauerhaft', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);
    await appeals.setzeStatus({
      guildId: GILDE,
      appealId: appeal.id,
      nach: 'UNDER_REVIEW',
      actor: { discordId: MODERATOR, username: 'moderatorin' },
    });

    await appeals.lehneAb({
      guildId: GILDE,
      appealId: appeal.id,
      actor: { discordId: MODERATOR, username: 'moderatorin' },
      publicDecision: 'Über deinen Fall wurde abschliessend entschieden.',
      erneutErlaubt: false,
    });

    const befund = await appeals.pruefeZulaessigkeit(GEBANNT, { gateway, guildId: GILDE });
    expect(befund.code).toBe('ENDGUELTIG_ABGELEHNT');
  });

  // --- Rückzug (§45) --------------------------------------------------------

  it('lässt den Antragsteller zurückziehen, aber niemanden sonst', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await expect(
      appeals.ziehZurueck(GILDE, appeal.id, { discordId: ANDERER, username: 'fremder' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const zurueck = await appeals.ziehZurueck(GILDE, appeal.id, {
      discordId: GEBANNT,
      username: 'antragsteller',
    });
    expect(zurueck.status).toBe('WITHDRAWN');

    // Kein hartes Löschen (§46).
    expect(await prisma.appeal.count()).toBe(1);
  });

  // --- Wartung (§28, §44) ---------------------------------------------------

  /**
   * Der Bann wird ausserhalb des Antrags aufgehoben.
   *
   * Der Antrag läuft dann ins Leere. Das System erkennt es und sagt es, statt
   * eine Entscheidung über einen gegenstandslosen Fall zu erzwingen.
   */
  it('erkennt einen ausserhalb aufgehobenen Bann', async () => {
    const attrappen = attrappe();
    const { appeal } = await reicheEin(attrappen.gateway);

    // Jemand hebt den Bann von Hand auf.
    attrappen.gebannt.delete(GEBANNT);

    const erkannt = await appeals.erkenneExterneEntbannung({ gateway: attrappen.gateway });
    expect(erkannt).toBe(1);

    const danach = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(danach.status).toBe('RESOLVED_EXTERNALLY');
    expect(danach.closedAt).not.toBeNull();

    // Der Antragsteller erfährt davon - es betrifft ihn unmittelbar.
    const sicht = await appeals.holeAntragstellerSicht(GILDE, appeal.id, GEBANNT);
    expect(sicht?.zeitleiste.map((eintrag) => eintrag.label)).toContain('Dein Bann wurde bereits aufgehoben');
  });

  it('schliesst keinen Antrag, wenn Discord nicht antwortet', async () => {
    const { appeal } = await reicheEin(attrappe().gateway);
    const kaputt = {
      bans: {
        get: vi.fn(async () => {
          throw new Error('Discord unerreichbar');
        }),
      },
    } as never;

    expect(await appeals.erkenneExterneEntbannung({ gateway: kaputt })).toBe(0);
    const danach = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(danach.status).toBe('SUBMITTED');
  });

  /**
   * Ohne Antwort läuft der Antrag ab (§44).
   *
   * Die Frist steht in der Datenbank, seit die Rückfrage gestellt wurde - ein
   * Neustart verliert sie deshalb nicht.
   */
  it('lässt einen Antrag ohne Antwort ablaufen', async () => {
    const { gateway } = attrappe();
    const { appeal } = await reicheEin(gateway);

    await appeals.schreibeStaffNachricht(GILDE, appeal.id, 'Bitte erläutere Punkt zwei.', {
      discordId: MODERATOR,
      username: 'moderatorin',
    });

    const mitFrist = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(mitFrist.status).toBe('WAITING_FOR_APPLICANT');
    expect(mitFrist.waitingUntil).not.toBeNull();

    // Noch nicht fällig.
    expect(await appeals.schliesseAbgelaufene(new Date())).toBe(0);

    // Nach Ablauf der Frist.
    const spaeter = new Date(mitFrist.waitingUntil!.getTime() + 1000);
    expect(await appeals.schliesseAbgelaufene(spaeter)).toBe(1);

    const danach = await prisma.appeal.findUniqueOrThrow({ where: { id: appeal.id } });
    expect(danach.status).toBe('EXPIRED');
  });

  // --- Kennzahlen (§48) -----------------------------------------------------

  it('rechnet Kennzahlen ohne Bewertung einzelner Personen', async () => {
    const { gateway } = attrappe();
    await reicheEin(gateway);

    const zahlen = await appeals.kennzahlen(GILDE);
    expect(zahlen.offen).toBe(1);
    expect(zahlen.ohneBearbeiter).toBe(1);
    expect(zahlen.genehmigungsQuote).toBeNull();

    // Keine Kennzahl trägt eine Moderatorkennung - eine Leistungsbewertung
    // soll aus diesen Zahlen nicht entstehen.
    expect(JSON.stringify(zahlen)).not.toContain(MODERATOR);
  });
});
