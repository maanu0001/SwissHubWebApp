import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_automation');

/**
 * Die Automation Engine gegen eine echte Datenbank.
 *
 * Die entscheidenden Zusagen dieser Engine hängen an
 * Datenbankeigenschaften - eindeutige Indizes, bedingte Aktualisierungen,
 * Transaktionen. Eine Nachbildung von Prisma würde am Ende vor allem sich
 * selbst prüfen: sie hätte genau die Eindeutigkeit, die man ihr einbaut, und
 * bestätigte damit nichts.
 *
 * Geprüft wird deshalb, was schiefgehen könnte, wenn zwei Prozesse laufen
 * und einer davon abstürzt.
 */
const { prisma } = await import('@swisshub/database');
const automation = await import('@swisshub/automation');
const automationModul2 = automation;
// Die Ereignisse der Module - `member.joined` und die übrigen - meldet
// `@swisshub/modules` beim Import an. Ohne diesen Import kennt die Engine
// kein einziges Ereignis, und jede Veröffentlichung würde abgewiesen.
const { setModuleEnabled, setModuleSettings, automation: automationModul } = await import(
  '@swisshub/modules'
);

const GILDE = '900000000000000900';
const KANAL = '900000000000000901';
const MITGLIED = '100000000000000902';

/** Ein Discord-Zugang, der mitschreibt statt zu handeln. */
function attrappe() {
  const gesendet: Array<{ channelId: string; content?: string }> = [];
  const rollen: Array<{ discordId: string; roleId: string; art: 'add' | 'remove' }> = [];
  const gateway = {
    members: {
      get: vi.fn(async (discordId: string) => ({
        discordId,
        username: 'manu',
        displayName: 'Manu',
        globalName: null,
        nickname: null,
        avatarHash: null,
        isBot: false,
        roleIds: [] as string[],
        joinedAt: new Date(),
        accountCreatedAt: new Date(),
        boosting: false,
        timedOutUntil: null,
      })),
    },
    roles: {
      add: vi.fn(async (discordId: string, roleId: string) => {
        rollen.push({ discordId, roleId, art: 'add' });
      }),
      remove: vi.fn(async (discordId: string, roleId: string) => {
        rollen.push({ discordId, roleId, art: 'remove' });
      }),
      list: vi.fn(async () => []),
    },
    channels: {
      list: vi.fn(async () => []),
      send: vi.fn(async (channelId: string, payload: { content?: string }) => {
        gesendet.push({ channelId, ...(payload.content ? { content: payload.content } : {}) });
        return { id: '800000000000000001', channelId };
      }),
      sendDirect: vi.fn(async () => true),
    },
  };
  return { gateway: gateway as never, gesendet, rollen };
}

async function legeAutomationAn(
  patch: Partial<Parameters<typeof prisma.automation.create>[0]['data']> = {},
) {
  return prisma.automation.create({
    data: {
      guildId: GILDE,
      name: 'Testautomation',
      enabled: true,
      triggerType: 'event',
      triggerConfig: { eventType: 'member.joined' },
      conditions: undefined,
      steps: [
        {
          art: 'aktion',
          typ: 'nachricht.kanal',
          config: { channelId: KANAL, inhalt: 'Hoi {{payload.displayName}}' },
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ],
      ...patch,
    } as never,
  });
}

async function veroeffentliche(
  typ = 'member.joined',
  payload: Record<string, unknown> = {
    discordId: MITGLIED,
    username: 'manu',
    displayName: 'Manu',
    kontoAlterTage: 400,
    istBot: false,
  },
) {
  return automation.publish({ type: typ, guildId: GILDE, payload, subjectId: MITGLIED });
}

describeWithDatabase('Automation Engine', () => {
  beforeAll(async () => {
    pushSchema();
    await setModuleEnabled('automation', true, 'test');
  });

  beforeEach(async () => {
    await prisma.automationJob.deleteMany({});
    await prisma.automationApproval.deleteMany({});
    await prisma.automationStepRun.deleteMany({});
    await prisma.automationRun.deleteMany({});
    await prisma.automationVersion.deleteMany({});
    await prisma.automation.deleteMany({});
    await prisma.automationEvent.deleteMany({});
  });

  // --- Ereignisbus --------------------------------------------------------

  it('weist ein Ereignis ab, dessen Nutzdaten nicht zum Schema passen', async () => {
    const ergebnis = await automation.publish({
      type: 'member.joined',
      guildId: GILDE,
      payload: { discordId: 'keine-snowflake' },
    });
    expect(ergebnis.angenommen).toBe(false);
    expect(await prisma.automationEvent.count()).toBe(0);
  });

  it('weist ein nicht angemeldetes Ereignis ab', async () => {
    const ergebnis = await automation.publish({
      type: 'erfundenes.ereignis',
      guildId: GILDE,
      payload: {},
    });
    expect(ergebnis.angenommen).toBe(false);
  });

  /**
   * Genau eine Instanz bekommt das Ereignis.
   *
   * Der zweite Anspruch ändert null Zeilen und weiss damit, dass er zu spät
   * ist. Ohne diese Bedingung liefe bei zwei Bot-Prozessen jede
   * Willkommensnachricht doppelt hinaus.
   */
  it('lässt ein Ereignis nur einmal beanspruchen', async () => {
    const { eventId } = await veroeffentliche();
    const ersteHand = await automation.beanspruche(eventId);
    const zweiteHand = await automation.beanspruche(eventId);
    expect(ersteHand).toBe(true);
    expect(zweiteHand).toBe(false);
  });

  // --- Verteilung und Ausführung ------------------------------------------

  it('führt eine passende Automation aus', async () => {
    await legeAutomationAn();
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    const ergebnis = await automation.verteileEreignisse({ gateway });

    expect(ergebnis.laeufe).toBe(1);
    expect(gesendet).toEqual([{ channelId: KANAL, content: 'Hoi Manu' }]);

    const lauf = await prisma.automationRun.findFirst();
    expect(lauf?.status).toBe('SUCCESS');
  });

  /**
   * Ein Ereignis gilt erst als verteilt, wenn die Läufe stehen.
   *
   * Andersherum verlöre ein Absturz zwischen Marke und Lauf das Ereignis
   * endgültig: die Marke stünde, den Lauf gäbe es nie, und im Verlauf stünde
   * nichts, das darauf hinwiese.
   */
  it('beansprucht ein Ereignis erst nach dem Starten', async () => {
    await legeAutomationAn();
    const { eventId } = await veroeffentliche();

    const vorher = await prisma.automationEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(vorher.processedAt).toBeNull();

    const { gateway } = attrappe();
    await automation.verteileEreignisse({ gateway });

    const nachher = await prisma.automationEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(nachher.processedAt).not.toBeNull();
    expect(await prisma.automationRun.count()).toBe(1);
  });

  /**
   * Zwei Verteiler, ein Lauf.
   *
   * Beide dürfen dasselbe Ereignis betrachten - doppelte Arbeit ist der Preis
   * dafür, dass keines verlorengeht. Wirkung darf sie keine haben: der
   * Idempotenzschlüssel lässt genau einen Lauf entstehen (§14).
   */
  it('erzeugt auch bei zwei gleichzeitigen Verteilern nur einen Lauf', async () => {
    await legeAutomationAn();
    await veroeffentliche();

    const ersteInstanz = attrappe();
    const zweiteInstanz = attrappe();
    await Promise.all([
      automation.verteileEreignisse({ gateway: ersteInstanz.gateway }),
      automation.verteileEreignisse({ gateway: zweiteInstanz.gateway }),
    ]);

    expect(await prisma.automationRun.count()).toBe(1);
    expect(ersteInstanz.gesendet.length + zweiteInstanz.gesendet.length).toBe(1);
  });

  it('lässt eine ausgeschaltete Automation liegen', async () => {
    await legeAutomationAn({ enabled: false });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });
    expect(gesendet).toHaveLength(0);
  });

  /**
   * Guild-Isolation.
   *
   * Die Gilde steht in der Abfrage, nicht in einer Nachprüfung. Eine
   * Automation darf nie auf ein Ereignis eines fremden Servers reagieren.
   */
  it('reagiert nicht auf ein Ereignis einer anderen Gilde', async () => {
    await legeAutomationAn();
    await automation.publish({
      type: 'member.joined',
      guildId: '900000000000000999',
      payload: {
        discordId: MITGLIED,
        username: 'manu',
        displayName: 'Manu',
        kontoAlterTage: 400,
        istBot: false,
      },
    });

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });
    expect(gesendet).toHaveLength(0);
  });

  /**
   * Dasselbe Ereignis erzeugt genau einen Lauf (§14).
   *
   * Discord liefert Ereignisse gelegentlich doppelt, und ein Verteiler kann
   * nach einem Absturz dasselbe Ereignis erneut sehen. Der eindeutige
   * Schlüssel ist die Stelle, an der das auffällt.
   */
  it('erzeugt für dasselbe Ereignis nur einen Lauf', async () => {
    const eintrag = await legeAutomationAn();
    const { eventId } = await veroeffentliche();
    const ereignis = await prisma.automationEvent.findUniqueOrThrow({ where: { id: eventId } });
    const { gateway } = attrappe();

    const eingabe = {
      automation: eintrag,
      trigger: 'event' as const,
      guildId: GILDE,
      gateway,
      event: {
        id: ereignis.id,
        type: ereignis.type,
        actorId: ereignis.actorId,
        subjectId: ereignis.subjectId,
        entityId: ereignis.entityId,
        payload: ereignis.payload as Record<string, unknown>,
        correlationId: ereignis.correlationId,
        depth: ereignis.depth,
        occurredAt: ereignis.occurredAt,
      },
    };

    const erster = await automation.starte(eingabe);
    const zweiter = await automation.starte(eingabe);

    expect(erster.runId).not.toBeNull();
    expect(zweiter.runId).toBeNull();
    expect(await prisma.automationRun.count()).toBe(1);
  });

  it('überspringt den Lauf, wenn die Bedingungen nicht zutreffen', async () => {
    await legeAutomationAn({
      conditions: {
        art: 'gruppe',
        verknuepfung: 'UND',
        kinder: [
          { art: 'bedingung', typ: 'wert', config: { pfad: 'payload.kontoAlterTage', operator: 'lt', wert: '7' } },
        ],
      } as never,
    });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });

    expect(gesendet).toHaveLength(0);
    const lauf = await prisma.automationRun.findFirst();
    expect(lauf?.status).toBe('SKIPPED');
  });

  // --- Wartezeiten --------------------------------------------------------

  /**
   * Eine Wartezeit lebt in der Datenbank, nicht im Arbeitsspeicher (§9).
   *
   * Der Lauf hält an, hinterlässt seine Stellung und einen Wecker. Ein
   * Neustart zwischen den beiden Schritten verliert dadurch nichts - genau
   * das wäre mit `setTimeout` verloren gewesen.
   */
  it('hält bei einem Wait an und setzt später fort', async () => {
    await legeAutomationAn({
      steps: [
        { art: 'warten', sekunden: 3600 },
        {
          art: 'aktion',
          typ: 'nachricht.kanal',
          config: { channelId: KANAL, inhalt: 'Nach der Wartezeit' },
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });

    const lauf = await prisma.automationRun.findFirstOrThrow();
    expect(lauf.status).toBe('WAITING');
    expect(gesendet).toHaveLength(0);

    const wecker = await prisma.automationJob.findFirstOrThrow();
    expect(wecker.kind).toBe('RESUME');
    expect(wecker.runId).toBe(lauf.id);

    // Der Wecker klingelt: derselbe Lauf, dieselbe Stellung.
    await automation.setzeFort(lauf.id, { gateway });

    const fertig = await prisma.automationRun.findUniqueOrThrow({ where: { id: lauf.id } });
    expect(fertig.status).toBe('SUCCESS');
    expect(gesendet).toEqual([{ channelId: KANAL, content: 'Nach der Wartezeit' }]);
  });

  it('setzt einen wartenden Lauf nur einmal fort', async () => {
    await legeAutomationAn({
      steps: [
        { art: 'warten', sekunden: 60 },
        {
          art: 'aktion',
          typ: 'nachricht.kanal',
          config: { channelId: KANAL, inhalt: 'Genau einmal' },
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });
    const lauf = await prisma.automationRun.findFirstOrThrow();

    await Promise.all([
      automation.setzeFort(lauf.id, { gateway }),
      automation.setzeFort(lauf.id, { gateway }),
    ]);

    expect(gesendet).toHaveLength(1);
  });

  // --- Zeitplaner ---------------------------------------------------------

  it('plant denselben Termin nicht zweimal ein', async () => {
    const eintrag = await legeAutomationAn({
      triggerType: 'schedule',
      triggerConfig: { modus: 'TAEGLICH', zeit: '20:00', zeitzone: 'Europe/Zurich' },
    });

    const von = new Date('2026-08-28T10:00:00Z');
    await automation.planeNaechsten(eintrag, von);
    await automation.planeNaechsten(eintrag, von);

    expect(await prisma.automationJob.count({ where: { kind: 'SCHEDULE' } })).toBe(1);
  });

  it('lässt einen Job nur von einer Instanz beanspruchen', async () => {
    await automation.planeJob({
      kind: 'SCHEDULE',
      guildId: GILDE,
      runAt: new Date(Date.now() - 1000),
      dedupeKey: 'test:einmal',
    });

    const [ersteHand, zweiteHand] = await Promise.all([
      automation.beanspruchFaellige(10),
      automation.beanspruchFaellige(10),
    ]);

    expect(ersteHand.length + zweiteHand.length).toBe(1);
  });

  /**
   * Ein abgestürzter Prozess gibt seinen Job wieder her.
   *
   * Ohne diese Rückholung bliebe ein Job für immer beansprucht und liefe nie -
   * still, denn im Verlauf stünde nichts.
   */
  it('holt einen verwaisten Job nach der Pachtfrist zurück', async () => {
    const job = await automation.planeJob({
      kind: 'SCHEDULE',
      guildId: GILDE,
      runAt: new Date(Date.now() - 1000),
    });
    await prisma.automationJob.update({
      where: { id: job!.id },
      data: {
        status: 'CLAIMED',
        claimedBy: 'abgestuerzt-1',
        claimedAt: new Date(Date.now() - automation.PACHT_MS - 60_000),
      },
    });

    const zurueck = await automation.holeVerwaisteZurueck();
    expect(zurueck).toBe(1);
    expect((await prisma.automationJob.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe(
      'PENDING',
    );
  });

  it('verwirft geplante Läufe beim Ausschalten', async () => {
    const eintrag = await legeAutomationAn({
      triggerType: 'schedule',
      triggerConfig: { modus: 'TAEGLICH', zeit: '20:00', zeitzone: 'Europe/Zurich' },
    });
    await automation.planeNaechsten(eintrag);
    expect(await prisma.automationJob.count()).toBe(1);

    await automation.schalte(GILDE, eintrag.id, false, { discordId: MITGLIED });
    expect(await prisma.automationJob.count()).toBe(0);
  });

  // --- Grenzen ------------------------------------------------------------

  it('drosselt eine Automation, die ihre Ratengrenze erreicht', async () => {
    const eintrag = await legeAutomationAn({ maxRunsPerMinute: 2 });
    for (let i = 0; i < 2; i += 1) {
      await prisma.automationRun.create({
        data: {
          automationId: eintrag.id,
          version: 1,
          guildId: GILDE,
          status: 'SUCCESS',
          trigger: 'event',
          correlationId: `c-${i}`,
          idempotencyKey: `k-${i}`,
          context: {},
        },
      });
    }
    expect(await automation.pruefeRate(eintrag.id, 2)).toBe(false);
    expect(await automation.pruefeRate(eintrag.id, 5)).toBe(true);
  });

  it('überspringt einen Lauf, solange einer offen ist', async () => {
    const eintrag = await legeAutomationAn({ concurrency: 'SKIP_IF_RUNNING' });
    await prisma.automationRun.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        guildId: GILDE,
        status: 'WAITING',
        trigger: 'event',
        correlationId: 'offen',
        idempotencyKey: 'offen',
        context: {},
      },
    });

    expect(await automation.pruefeGleichzeitigkeit(eintrag, null)).toBe('SKIP');
  });

  /**
   * Der Schlüssel trennt die Zählung.
   *
   * «Höchstens ein Lauf je Mitglied» und «höchstens ein Lauf überhaupt» sind
   * verschiedene Zusagen. Ohne den Schlüssel liesse sich nur die zweite
   * ausdrücken - und ein Server mit tausend Mitgliedern hätte eine Automation,
   * die praktisch nie läuft.
   */
  it('zählt Gleichzeitigkeit je Schlüssel getrennt', async () => {
    const eintrag = await legeAutomationAn({ concurrency: 'SKIP_IF_RUNNING' });
    await prisma.automationRun.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        guildId: GILDE,
        status: 'RUNNING',
        trigger: 'event',
        correlationId: 'a',
        idempotencyKey: 'a',
        concurrencyKey: MITGLIED,
        context: {},
      },
    });

    expect(await automation.pruefeGleichzeitigkeit(eintrag, MITGLIED)).toBe('SKIP');
    expect(await automation.pruefeGleichzeitigkeit(eintrag, 'jemand-anders')).toBe('START');
  });

  /**
   * Der Kreis in der Ursachenkette (§17).
   *
   * Zwei Automationen, die sich gegenseitig auslösen, bräuchten fünf Ebenen,
   * ehe die Tiefengrenze greift - fünf ausgeführte Runden mit echten Wirkungen
   * auf Discord. Dieselbe Automation ein zweites Mal in derselben Kette wird
   * deshalb sofort abgewiesen.
   */
  it('weist dieselbe Automation in derselben Ursachenkette ab', async () => {
    const eintrag = await legeAutomationAn();
    await prisma.automationRun.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        guildId: GILDE,
        status: 'SUCCESS',
        trigger: 'event',
        correlationId: 'kette-1',
        idempotencyKey: 'kette-1',
        context: {},
      },
    });

    const befund = await automation.pruefeKette(eintrag.id, 'kette-1', 1);
    expect(befund.erlaubt).toBe(false);

    // Eine neue Kette wird nicht gebremst - sonst liefe eine Automation auf
    // «Mitglied beigetreten» nur ein einziges Mal.
    expect((await automation.pruefeKette(eintrag.id, 'kette-2', 1)).erlaubt).toBe(true);
    expect((await automation.pruefeKette(eintrag.id, 'kette-1', 0)).erlaubt).toBe(true);
  });

  it('lehnt ein Ereignis ab, dessen Kette zu tief ist', async () => {
    const tief = await automation.publish({
      type: 'automation.custom',
      guildId: GILDE,
      payload: { x: 1 },
      causation: { correlationId: 'c', causationId: 'e', depth: automation.LIMITS.maxDepth },
    });
    expect(tief.angenommen).toBe(false);
  });

  // --- Probelauf ----------------------------------------------------------

  /**
   * Der Probelauf wirkt nicht (§23).
   *
   * Bedingungen werden echt geprüft - sonst wäre die Antwort wertlos -,
   * Aktionen beschrieben. Auf Discord geschieht dabei nichts.
   */
  it('führt im Probelauf keine Aktion aus', async () => {
    const eintrag = await legeAutomationAn();
    const { gateway, gesendet } = attrappe();

    const ergebnis = await automation.starte({
      automation: eintrag,
      trigger: 'manual',
      guildId: GILDE,
      gateway,
      dryRun: true,
    });

    expect(gesendet).toHaveLength(0);
    expect(ergebnis.status).toBe('SUCCESS');
    expect(ergebnis.schritte?.[0]?.status).toBe('DRY_RUN');
    expect(ergebnis.schritte?.[0]?.detail).toContain(KANAL);
  });

  it('lässt sich beliebig oft als Probelauf wiederholen', async () => {
    const eintrag = await legeAutomationAn();
    const { gateway } = attrappe();
    const eingabe = {
      automation: eintrag,
      trigger: 'manual' as const,
      guildId: GILDE,
      gateway,
      dryRun: true,
    };

    expect((await automation.starte(eingabe)).runId).not.toBeNull();
    expect((await automation.starte(eingabe)).runId).not.toBeNull();
  });

  // --- Versionierung ------------------------------------------------------

  /**
   * Ein laufender Lauf behält seine Fassung (§12).
   *
   * Wird eine Automation geändert, während ein Lauf zwischen zwei Schritten
   * wartet, macht er nach dem Aufwachen trotzdem das, was beim Start dastand.
   * Andernfalls täte eine Automation etwas, das niemand ausgelöst hat.
   */
  it('setzt einen wartenden Lauf mit seiner alten Fassung fort', async () => {
    const eintrag = await legeAutomationAn({
      steps: [
        { art: 'warten', sekunden: 60 },
        {
          art: 'aktion',
          typ: 'nachricht.kanal',
          config: { channelId: KANAL, inhalt: 'Alte Fassung' },
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await prisma.automationVersion.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        snapshot: {
          steps: [
            { art: 'warten', sekunden: 60 },
            {
              art: 'aktion',
              typ: 'nachricht.kanal',
              config: { channelId: KANAL, inhalt: 'Alte Fassung' },
              beiFehler: 'ABBRECHEN',
              retry: { versuche: 1, basisSekunden: 30 },
            },
          ],
        } as never,
      },
    });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });
    const lauf = await prisma.automationRun.findFirstOrThrow();

    // Jetzt ändert jemand die Automation - der wartende Lauf darf das nicht
    // mitbekommen.
    await prisma.automation.update({
      where: { id: eintrag.id },
      data: {
        version: 2,
        steps: [
          {
            art: 'aktion',
            typ: 'nachricht.kanal',
            config: { channelId: KANAL, inhalt: 'NEUE Fassung' },
            beiFehler: 'ABBRECHEN',
            retry: { versuche: 1, basisSekunden: 30 },
          },
        ] as never,
      },
    });

    await automation.setzeFort(lauf.id, { gateway });
    expect(gesendet.map((eintragung) => eintragung.content)).toEqual(['Alte Fassung']);
  });

  it('legt beim Ändern eine neue Fassung an', async () => {
    const akteur = { discordId: MITGLIED, username: 'manu' };
    const angelegt = await automation.legeAn(
      {
        guildId: GILDE,
        name: 'Versionstest',
        triggerType: 'event',
        triggerConfig: { eventType: 'member.joined' },
        steps: [
          {
            art: 'aktion',
            typ: 'nachricht.kanal',
            config: { channelId: KANAL, inhalt: 'eins' },
            beiFehler: 'ABBRECHEN',
            retry: { versuche: 1, basisSekunden: 30 },
          },
        ],
      },
      akteur,
    );

    const geaendert = await automation.aendere(
      GILDE,
      angelegt.id,
      {
        guildId: GILDE,
        name: 'Versionstest',
        triggerType: 'event',
        triggerConfig: { eventType: 'member.joined' },
        steps: [
          {
            art: 'aktion',
            typ: 'nachricht.kanal',
            config: { channelId: KANAL, inhalt: 'zwei' },
            beiFehler: 'ABBRECHEN',
            retry: { versuche: 1, basisSekunden: 30 },
          },
        ],
      },
      akteur,
    );

    expect(geaendert.version).toBe(2);
    expect(await prisma.automationVersion.count({ where: { automationId: angelegt.id } })).toBe(2);
  });

  /**
   * Löschen ist ein Archivieren.
   *
   * Wer wissen will, warum vor drei Wochen tausend Nachrichten hinausgingen,
   * fände die Automation sonst nicht mehr.
   */
  it('archiviert statt zu löschen und nimmt sie aus der Verteilung', async () => {
    const eintrag = await legeAutomationAn();
    await automation.archiviere(GILDE, eintrag.id, { discordId: MITGLIED });

    expect(await prisma.automation.count()).toBe(1);
    await veroeffentliche();
    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });
    expect(gesendet).toHaveLength(0);
  });

  it('lässt eine Systemautomation nicht bearbeiten oder löschen', async () => {
    const eintrag = await legeAutomationAn({ kind: 'SYSTEM', systemKey: 'test.system' });
    await expect(
      automation.archiviere(GILDE, eintrag.id, { discordId: MITGLIED }),
    ).rejects.toThrow();
  });

  /**
   * Eine fremde Gilde ist nicht einmal lesbar.
   *
   * Die Gilde steht in der Abfrage, nicht in einer Nachprüfung nach dem Lesen.
   */
  it('findet eine Automation einer fremden Gilde nicht', async () => {
    const eintrag = await legeAutomationAn();
    expect(await automation.holeAutomation('900000000000000999', eintrag.id)).toBeNull();
  });

  // --- Freigaben ----------------------------------------------------------

  /**
   * Eine freigabepflichtige Aktion hält den Lauf an (§32).
   *
   * Sie wirkt erst, wenn ein Mensch entschieden hat - und bis dahin steht der
   * Lauf still, nicht die Aktion halb ausgeführt.
   */
  it('hält bei einer freigabepflichtigen Aktion an', async () => {
    const ausgefuehrt = vi.fn();
    automation.registerAction({
      id: 'test.freigabe',
      label: 'Braucht eine Freigabe',
      description: '',
      group: 'Test',
      requiresApproval: true,
      configSchema: z.object({}),
      fields: [],
      execute: async () => {
        ausgefuehrt();
        return { status: 'SUCCESS' as const };
      },
      preview: async () => 'Würde etwas Folgenreiches tun.',
    });

    await legeAutomationAn({
      steps: [
        {
          art: 'aktion',
          typ: 'test.freigabe',
          config: {},
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway } = attrappe();
    await automation.verteileEreignisse({ gateway });

    expect(ausgefuehrt).not.toHaveBeenCalled();
    const lauf = await prisma.automationRun.findFirstOrThrow();
    expect(lauf.status).toBe('AWAITING_APPROVAL');

    const freigabe = await prisma.automationApproval.findFirstOrThrow();
    expect(freigabe.summary).toBe('Würde etwas Folgenreiches tun.');

    await automation.entscheideFreigabe(GILDE, freigabe.id, true, { discordId: MITGLIED }, { gateway });
    expect(ausgefuehrt).toHaveBeenCalledTimes(1);
  });

  it('bricht den Lauf ab, wenn die Freigabe abgelehnt wird', async () => {
    const ausgefuehrt = vi.fn();
    automation.registerAction({
      id: 'test.freigabe.ablehnen',
      label: 'Braucht eine Freigabe',
      description: '',
      group: 'Test',
      requiresApproval: true,
      configSchema: z.object({}),
      fields: [],
      execute: async () => {
        ausgefuehrt();
        return { status: 'SUCCESS' as const };
      },
    });

    await legeAutomationAn({
      steps: [
        {
          art: 'aktion',
          typ: 'test.freigabe.ablehnen',
          config: {},
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway } = attrappe();
    await automation.verteileEreignisse({ gateway });
    const freigabe = await prisma.automationApproval.findFirstOrThrow();

    await automation.entscheideFreigabe(GILDE, freigabe.id, false, { discordId: MITGLIED }, { gateway });

    expect(ausgefuehrt).not.toHaveBeenCalled();
    const lauf = await prisma.automationRun.findFirstOrThrow();
    expect(lauf.status).toBe('CANCELLED');
  });

  it('entscheidet eine Freigabe nur einmal', async () => {
    automation.registerAction({
      id: 'test.freigabe.einmal',
      label: 'Braucht eine Freigabe',
      description: '',
      group: 'Test',
      requiresApproval: true,
      configSchema: z.object({}),
      fields: [],
      execute: async () => ({ status: 'SUCCESS' as const }),
    });
    await legeAutomationAn({
      steps: [
        {
          art: 'aktion',
          typ: 'test.freigabe.einmal',
          config: {},
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway } = attrappe();
    await automation.verteileEreignisse({ gateway });
    const freigabe = await prisma.automationApproval.findFirstOrThrow();

    const erste = await automation.entscheideFreigabe(GILDE, freigabe.id, true, { discordId: MITGLIED }, { gateway });
    const zweite = await automation.entscheideFreigabe(GILDE, freigabe.id, true, { discordId: MITGLIED }, { gateway });

    expect(erste.ok).toBe(true);
    expect(zweite.ok).toBe(false);
  });

  // --- Fehler -------------------------------------------------------------

  /**
   * Ein gescheiterter Lauf verschwindet nicht (§26).
   *
   * Er bleibt als FAILED liegen und ist im Fehler-Posteingang zu sehen. Eine
   * Automation, die still scheitert, ist schlimmer als gar keine: man
   * verlässt sich auf sie.
   */
  it('hält einen gescheiterten Lauf mit bereinigter Meldung fest', async () => {
    automation.registerAction({
      id: 'test.scheitert',
      label: 'Scheitert',
      description: '',
      group: 'Test',
      configSchema: z.object({}),
      fields: [],
      execute: async () => {
        throw Object.assign(new Error('Interner Text mit Token abc123'), {
          code: 'FORBIDDEN',
          userMessage: 'Der Bot darf das nicht.',
        });
      },
    });

    await legeAutomationAn({
      steps: [
        {
          art: 'aktion',
          typ: 'test.scheitert',
          config: {},
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway } = attrappe();
    await automation.verteileEreignisse({ gateway });

    const lauf = await prisma.automationRun.findFirstOrThrow();
    expect(lauf.status).toBe('FAILED');
    expect(lauf.error).toBe('Der Bot darf das nicht.');
    // Die interne Meldung darf nirgends stehen - weder im Lauf noch im Schritt.
    expect(JSON.stringify(lauf)).not.toContain('abc123');
    const schritt = await prisma.automationStepRun.findFirstOrThrow();
    expect(JSON.stringify(schritt)).not.toContain('abc123');
  });

  it('macht weiter, wenn der Schritt es so vorsieht', async () => {
    automation.registerAction({
      id: 'test.scheitert.weiter',
      label: 'Scheitert',
      description: '',
      group: 'Test',
      configSchema: z.object({}),
      fields: [],
      execute: async () => {
        throw Object.assign(new Error('kaputt'), { code: 'NOT_FOUND', userMessage: 'Weg.' });
      },
    });

    await legeAutomationAn({
      steps: [
        {
          art: 'aktion',
          typ: 'test.scheitert.weiter',
          config: {},
          beiFehler: 'WEITER',
          retry: { versuche: 1, basisSekunden: 30 },
        },
        {
          art: 'aktion',
          typ: 'nachricht.kanal',
          config: { channelId: KANAL, inhalt: 'trotzdem' },
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });

    expect(gesendet).toEqual([{ channelId: KANAL, content: 'trotzdem' }]);
    expect((await prisma.automationRun.findFirstOrThrow()).status).toBe('SUCCESS');
  });

  // --- Aufbewahrung -------------------------------------------------------

  it('räumt alte Läufe, lässt aber wartende stehen', async () => {
    const eintrag = await legeAutomationAn();
    const alt = new Date(Date.now() - 90 * 24 * 3600_000);

    for (const [status, key] of [
      ['SUCCESS', 'alt-erfolg'],
      ['WAITING', 'alt-wartend'],
      ['FAILED', 'alt-fehler'],
    ] as const) {
      await prisma.automationRun.create({
        data: {
          automationId: eintrag.id,
          version: 1,
          guildId: GILDE,
          status,
          trigger: 'event',
          correlationId: key,
          idempotencyKey: key,
          context: {},
          createdAt: alt,
        },
      });
    }

    const entfernt = await automation.raeumeLaeufe(30);
    expect(entfernt).toBe(1);

    const uebrig = await prisma.automationRun.findMany({ select: { status: true } });
    expect(uebrig.map((zeile) => zeile.status).sort()).toEqual(['FAILED', 'WAITING']);
  });

  // --- Meldungen ----------------------------------------------------------

  /**
   * Ein gescheiterter Lauf wird gemeldet - genau einmal (§26).
   *
   * Die zweite Meldung wäre schlimmer als keine: wer dreimal täglich dieselbe
   * Nachricht bekommt, liest bald keine mehr.
   */
  it('meldet einen gescheiterten Lauf genau einmal', async () => {
    await setModuleSettings(
      'automation',
      { meldeKanalId: KANAL, meldeRolleId: null, freigabeKanalId: null },
      'test',
    );

    const eintrag = await legeAutomationAn();
    await prisma.automationRun.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        guildId: GILDE,
        status: 'FAILED',
        trigger: 'event',
        correlationId: 'gescheitert',
        idempotencyKey: 'gescheitert',
        context: {},
        error: 'Der Bot darf das nicht.',
      },
    });

    const { gateway, gesendet } = attrappe();
    const erste = await automationModul.meldeOffenes({ gateway });
    const zweite = await automationModul.meldeOffenes({ gateway });

    expect(erste.fehler).toBe(1);
    expect(zweite.fehler).toBe(0);
    expect(gesendet).toHaveLength(1);
  });

  /**
   * Alte Fehler lösen keine Flut aus.
   *
   * Ohne diese Grenze meldete der erste Durchgang nach der Einführung - oder
   * nach einer längeren Störung - jeden gescheiterten Lauf der letzten Wochen
   * auf einmal.
   */
  it('meldet keine Fehler ausserhalb des Fensters', async () => {
    await setModuleSettings(
      'automation',
      { meldeKanalId: KANAL, meldeRolleId: null, freigabeKanalId: null },
      'test',
    );

    const eintrag = await legeAutomationAn();
    await prisma.automationRun.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        guildId: GILDE,
        status: 'FAILED',
        trigger: 'event',
        correlationId: 'uralt',
        idempotencyKey: 'uralt',
        context: {},
        error: 'Vor Wochen gescheitert.',
        createdAt: new Date(Date.now() - 7 * 24 * 3600_000),
      },
    });

    const { gateway, gesendet } = attrappe();
    expect((await automationModul.meldeOffenes({ gateway })).fehler).toBe(0);
    expect(gesendet).toHaveLength(0);
  });

  it('meldet einen Probelauf nicht', async () => {
    await setModuleSettings(
      'automation',
      { meldeKanalId: KANAL, meldeRolleId: null, freigabeKanalId: null },
      'test',
    );

    const eintrag = await legeAutomationAn();
    await prisma.automationRun.create({
      data: {
        automationId: eintrag.id,
        version: 1,
        guildId: GILDE,
        status: 'FAILED',
        trigger: 'manual',
        correlationId: 'probe',
        idempotencyKey: 'probe',
        context: {},
        dryRun: true,
        error: 'Nur ein Probelauf.',
      },
    });

    const { gateway, gesendet } = attrappe();
    expect((await automationModul.meldeOffenes({ gateway })).fehler).toBe(0);
    expect(gesendet).toHaveLength(0);
  });

  /**
   * Eine offene Freigabe wird gemeldet - genau einmal (§32).
   *
   * Ohne die Meldung wartet ein angehaltener Lauf still im Dashboard, und wer
   * nicht hinsieht, lässt ihn tagelang stehen.
   */
  it('meldet eine offene Freigabe genau einmal', async () => {
    await setModuleSettings(
      'automation',
      { meldeKanalId: null, meldeRolleId: null, freigabeKanalId: KANAL },
      'test',
    );

    automationModul2.registerAction({
      id: 'test.freigabe.meldung',
      label: 'Braucht eine Freigabe',
      description: '',
      group: 'Test',
      requiresApproval: true,
      configSchema: z.object({}),
      fields: [],
      execute: async () => ({ status: 'SUCCESS' as const }),
      preview: async () => 'Würde etwas Folgenreiches tun.',
    });

    await legeAutomationAn({
      steps: [
        {
          art: 'aktion',
          typ: 'test.freigabe.meldung',
          config: {},
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ] as never,
    });
    await veroeffentliche();

    const { gateway, gesendet } = attrappe();
    await automation.verteileEreignisse({ gateway });

    const erste = await automationModul.meldeOffenes({ gateway });
    const zweite = await automationModul.meldeOffenes({ gateway });

    expect(erste.freigaben).toBe(1);
    expect(zweite.freigaben).toBe(0);
    expect(gesendet).toHaveLength(1);

    // Die Nachrichtenkennung steht an der Freigabe - sie ist die Spur zurück
    // zur Meldung auf Discord.
    const freigabe = await prisma.automationApproval.findFirstOrThrow();
    expect(freigabe.discordChannelId).toBe(KANAL);
    expect(freigabe.discordMessageId).not.toBeNull();
  });

  it('räumt nur verarbeitete Ereignisse', async () => {
    const alt = new Date(Date.now() - 90 * 24 * 3600_000);
    await prisma.automationEvent.createMany({
      data: [
        {
          type: 'member.joined',
          guildId: GILDE,
          sourceModule: 'members',
          correlationId: 'a',
          payload: {},
          occurredAt: alt,
          processedAt: alt,
        },
        {
          type: 'member.joined',
          guildId: GILDE,
          sourceModule: 'members',
          correlationId: 'b',
          payload: {},
          occurredAt: alt,
          processedAt: null,
        },
      ],
    });

    expect(await automation.raeumeEreignisse(30)).toBe(1);
    expect(await prisma.automationEvent.count()).toBe(1);
  });
});
