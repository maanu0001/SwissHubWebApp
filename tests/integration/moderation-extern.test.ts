import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';
import type * as DiscordModul from '@swisshub/discord';

/** Die Typen des Discord-Pakets - importiert wird es erst nach `useTestSchema`. */
type DiscordTypen = {
  AuditLogEntry: DiscordModul.AuditLogEntry;
  DiscordGateway: DiscordModul.DiscordGateway;
};

useTestSchema('test_moderation_extern');

/**
 * Massnahmen, die direkt in Discord ergriffen wurden.
 *
 * Geprüft wird gegen eine echte Datenbank, weil die entscheidenden Zusagen an
 * Datenbankeigenschaften hängen: die Eindeutigkeit des Audit-Eintrags, der
 * Abgleich gegen bereits erfasste Massnahmen, das Verhalten zweier
 * gleichzeitiger Läufe.
 *
 * Die drei Zusagen, um die es hier geht:
 *
 * 1. **Kein Doppel.** Was über SwissHub lief, entsteht nicht ein zweites Mal.
 * 2. **Kein erfundener Kick.** Ein freiwilliger Austritt bleibt einer.
 * 3. **Kein zweimal verarbeiteter Audit-Eintrag** - auch nach einem Neustart.
 */
const { prisma } = await import('@swisshub/database');
const { moderation } = await import('@swisshub/modules');
const { AUDIT_LOG_ACTIONS } = await import('@swisshub/discord');
type AuditLogEntry = DiscordTypen['AuditLogEntry'];
type DiscordGateway = DiscordTypen['DiscordGateway'];

const MODERATORIN = '100000000000000001';
const ZIEL = '200000000000000002';
const FREMDER = '300000000000000003';
const EIGENER_BOT = '400000000000000004';
const ANDERER_BOT = '500000000000000005';

const JETZT = new Date('2026-08-30T12:00:00.000Z');

let laufendeId = 900_000_000_000_000_000n;
function neueEintragsId(): string {
  laufendeId += 1n;
  return laufendeId.toString();
}

function eintrag(teile: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: neueEintragsId(),
    actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_ADD,
    userId: MODERATORIN,
    username: 'nina.mod',
    bot: false,
    targetId: ZIEL,
    reason: null,
    count: 1,
    channelId: null,
    createdAt: JETZT,
    ...teile,
  };
}

/** Ein Gateway, das genau die übergebenen Audit-Einträge kennt. */
function gatewayMit(eintraege: AuditLogEntry[] | Error): DiscordGateway {
  return {
    guild: {
      auditLog: async ({ actionType }: { actionType?: number }) => {
        if (eintraege instanceof Error) {
          throw eintraege;
        }
        return eintraege.filter((e) => actionType === undefined || e.actionType === actionType);
      },
    },
  } as unknown as DiscordGateway;
}

const sofort = async (): Promise<void> => {};

/** Der Aufruf, wie ihn der Bot beim Gateway-Ereignis macht. */
async function erfasse(
  vorgang: Parameters<typeof moderation.erfasseExterneMassnahme>[0]['vorgang'],
  eintraege: AuditLogEntry[] | Error,
  extras: { targetDiscordId?: string; eigeneBotId?: string | null } = {},
) {
  return moderation.erfasseExterneMassnahme(
    {
      vorgang,
      targetDiscordId: extras.targetDiscordId ?? ZIEL,
      targetUsername: 'spammer',
      occurredAt: JETZT,
      eigeneBotId: extras.eigeneBotId ?? EIGENER_BOT,
    },
    { gateway: gatewayMit(eintraege), warte: sofort },
  );
}

describeWithDatabase('Massnahmen aus Discord', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.moderationAction.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.botStatus.deleteMany();
  });

  // --- Erkennung -----------------------------------------------------------

  it('erfasst einen direkt in Discord verhängten Bann', async () => {
    const ergebnis = await erfasse({ art: 'BAN' }, [
      eintrag({ reason: 'Spam nach mehrfacher Verwarnung' }),
    ]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(zeile).not.toBeNull();
    expect(zeile?.source).toBe('DISCORD');
    expect(zeile?.actorDiscordId).toBe(MODERATORIN);
    expect(zeile?.actorUsername).toBe('nina.mod');
    expect(zeile?.actorType).toBe('HUMAN');
    expect(zeile?.reason).toBe('Spam nach mehrfacher Verwarnung');
    expect(zeile?.targetDiscordId).toBe(ZIEL);
    expect(zeile?.detectedAt).not.toBeNull();
  });

  it('erfasst eine direkt in Discord aufgehobene Sperre', async () => {
    const ergebnis = await erfasse({ art: 'UNBAN' }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_BAN_REMOVE }),
    ]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'UNBAN' } });
    expect(zeile?.source).toBe('DISCORD');
  });

  it('erfasst einen direkt in Discord ausgeführten Kick', async () => {
    const ergebnis = await erfasse({ art: 'KICK' }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_KICK, reason: 'Werbung' }),
    ]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'KICK' } });
    expect(zeile?.reason).toBe('Werbung');
  });

  it('erfasst einen direkt in Discord gesetzten Timeout mit Frist', async () => {
    const bis = new Date(JETZT.getTime() + 3_600_000);
    const ergebnis = await erfasse({ art: 'TIMEOUT', bis }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_UPDATE }),
    ]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'TIMEOUT' } });
    expect(zeile?.expiresAt?.toISOString()).toBe(bis.toISOString());
    expect((zeile?.metadata as Record<string, unknown>).timeoutUntil).toBe(bis.toISOString());
  });

  it('erfasst eine Aufhebung des Timeouts', async () => {
    const vorher = new Date(JETZT.getTime() + 3_600_000);
    const ergebnis = await erfasse({ art: 'TIMEOUT_REMOVE', vorher }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_UPDATE }),
    ]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'TIMEOUT_REMOVE' } });
    expect(zeile?.expiresAt).toBeNull();
    expect((zeile?.metadata as Record<string, unknown>).previousTimeoutUntil).toBe(
      vorher.toISOString(),
    );
  });

  it('erfasst eine geänderte Timeout-Frist als eigene Massnahme', async () => {
    const vorher = new Date(JETZT.getTime() + 1_800_000);
    const bis = new Date(JETZT.getTime() + 86_400_000);
    await erfasse({ art: 'TIMEOUT_UPDATE', vorher, bis }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_UPDATE }),
    ]);

    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'TIMEOUT_UPDATE' } });
    expect(zeile).not.toBeNull();
    const daten = zeile?.metadata as Record<string, unknown>;
    expect(daten.previousTimeoutUntil).toBe(vorher.toISOString());
    expect(daten.timeoutUntil).toBe(bis.toISOString());
  });

  // --- Der freiwillige Austritt --------------------------------------------

  /**
   * Der wichtigste Test dieser Datei.
   *
   * Discord sendet für ein freiwilliges Verlassen dasselbe Ereignis wie für
   * einen Kick. Ohne Beleg daraus einen Kick zu machen, hiesse: in die Akte
   * eines Menschen eine Massnahme schreiben, die es nie gab - und niemand
   * würde es je bemerken.
   */
  it('macht aus einem freiwilligen Austritt keinen Kick', async () => {
    const ergebnis = await erfasse({ art: 'KICK' }, []);

    expect(ergebnis).toEqual({ ergebnis: 'verworfen', grund: 'freiwilliger-austritt' });
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  it('macht auch aus einem Austritt ohne lesbares Audit Log keinen Kick', async () => {
    const ergebnis = await erfasse({ art: 'KICK' }, new Error('403 Missing Permissions'));

    expect(ergebnis).toEqual({ ergebnis: 'verworfen', grund: 'kick-unbelegt' });
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  /** Ein Kick-Eintrag für jemand anderen belegt diesen Austritt nicht. */
  it('nimmt keinen Kick-Eintrag, der einem anderen gilt', async () => {
    const ergebnis = await erfasse({ art: 'KICK' }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_KICK, targetId: FREMDER }),
    ]);

    expect(ergebnis.ergebnis).toBe('verworfen');
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  // --- Ohne Beleg, aber eindeutig ------------------------------------------

  /**
   * Ein Bann ist auch ohne Audit-Eintrag ein Bann.
   *
   * Das Gateway-Ereignis sagt es selbst; es fehlt nur, wer ihn verhängt hat.
   * Die Massnahme zu verschweigen, weil der Handelnde unbekannt ist, wäre der
   * grössere Verlust - anders als beim Kick, wo ohne Beleg gar nicht
   * feststeht, dass überhaupt etwas geschah.
   */
  it('erfasst einen Bann auch ohne Audit-Eintrag - mit unbekanntem Handelnden', async () => {
    const ergebnis = await erfasse({ art: 'BAN' }, []);

    expect(ergebnis.ergebnis).toBe('erfasst');
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(zeile?.actorType).toBe('UNKNOWN');
    expect(zeile?.actorDiscordId).toBe('unknown');
    expect(zeile?.reason).toBeNull();
  });

  // --- Andere Bots ---------------------------------------------------------

  it('erfasst den Bann eines fremden Bots mit ihm als Handelndem', async () => {
    await erfasse({ art: 'BAN' }, [
      eintrag({ userId: ANDERER_BOT, username: 'AutoMod', bot: true }),
    ]);

    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(zeile?.actorType).toBe('BOT');
    expect(zeile?.actorDiscordId).toBe(ANDERER_BOT);
    expect(zeile?.actorUsername).toBe('AutoMod');
    expect(zeile?.source).toBe('DISCORD');
  });

  // --- Keine Doppel --------------------------------------------------------

  /**
   * Der Bann über das Dashboard erzeugt genau eine Zeile.
   *
   * Danach kommt das Gateway-Ereignis für denselben Vorgang. Ohne Abgleich
   * stünde derselbe Bann zweimal in der Akte - einmal mit Grund und
   * Verantwortlicher, einmal ohne.
   */
  it('erzeugt kein zweites Ereignis für eine Massnahme aus dem Dashboard', async () => {
    const eigene = await prisma.moderationAction.create({
      data: {
        type: 'BAN',
        module: 'moderation',
        actorDiscordId: MODERATORIN,
        actorUsername: 'nina.mod',
        targetDiscordId: ZIEL,
        targetUsername: 'spammer',
        reason: 'Spam',
        source: 'WEBAPP',
        createdAt: JETZT,
      },
    });

    const auditEintrag = eintrag({ userId: EIGENER_BOT, username: 'SwissHub', bot: true });
    const ergebnis = await erfasse({ art: 'BAN' }, [auditEintrag]);

    expect(ergebnis).toEqual({ ergebnis: 'abgeglichen', massnahmeId: eigene.id });
    expect(await prisma.moderationAction.count()).toBe(1);

    // Der Audit-Eintrag hängt jetzt an der bestehenden Zeile: er belegt, dass
    // Discord die Massnahme tatsächlich vollzogen hat.
    const danach = await prisma.moderationAction.findUnique({ where: { id: eigene.id } });
    expect(danach?.discordAuditLogEntryId).toBe(auditEintrag.id);
    expect(danach?.source).toBe('WEBAPP');
  });

  it('erzeugt kein zweites Ereignis für eine Massnahme aus einem Slash-Befehl', async () => {
    await prisma.moderationAction.create({
      data: {
        type: 'KICK',
        module: 'moderation',
        actorDiscordId: MODERATORIN,
        actorUsername: 'nina.mod',
        targetDiscordId: ZIEL,
        targetUsername: 'spammer',
        reason: 'Werbung',
        source: 'BOT',
        createdAt: JETZT,
      },
    });

    await erfasse({ art: 'KICK' }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_KICK, userId: EIGENER_BOT, bot: true }),
    ]);

    expect(await prisma.moderationAction.count()).toBe(1);
  });

  /**
   * Der eigene Bot hat gehandelt, die Zeile fehlt noch.
   *
   * Sie wird gerade geschrieben - jeder Weg, der den Bot handeln lässt,
   * schreibt sie unmittelbar danach. Eine eigene anzulegen hiesse, genau das
   * Doppel zu erzeugen, das hier verhindert werden soll.
   */
  it('legt für den eigenen Bot ohne zugehörige Zeile nichts an', async () => {
    const ergebnis = await erfasse({ art: 'BAN' }, [
      eintrag({ userId: EIGENER_BOT, username: 'SwissHub', bot: true }),
    ]);

    expect(ergebnis).toEqual({ ergebnis: 'verworfen', grund: 'eigener-bot-ohne-zeile' });
    expect(await prisma.moderationAction.count()).toBe(0);
  });

  /** Eine Massnahme an einem anderen Menschen ist kein Abgleichspartner. */
  it('gleicht nicht gegen eine Massnahme an einer anderen Person ab', async () => {
    await prisma.moderationAction.create({
      data: {
        type: 'BAN',
        module: 'moderation',
        actorDiscordId: MODERATORIN,
        actorUsername: 'nina.mod',
        targetDiscordId: FREMDER,
        targetUsername: 'jemand',
        reason: 'Spam',
        source: 'WEBAPP',
        createdAt: JETZT,
      },
    });

    const ergebnis = await erfasse({ art: 'BAN' }, [eintrag()]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    expect(await prisma.moderationAction.count()).toBe(2);
  });

  /** Eine Massnahme von gestern gehört nicht zu einem Ereignis von heute. */
  it('gleicht nicht gegen eine weit zurückliegende Massnahme ab', async () => {
    await prisma.moderationAction.create({
      data: {
        type: 'BAN',
        module: 'moderation',
        actorDiscordId: MODERATORIN,
        actorUsername: 'nina.mod',
        targetDiscordId: ZIEL,
        targetUsername: 'spammer',
        reason: 'Ein früherer Bann',
        source: 'WEBAPP',
        createdAt: new Date(JETZT.getTime() - 86_400_000),
      },
    });

    const ergebnis = await erfasse({ art: 'BAN' }, [eintrag()]);

    expect(ergebnis.ergebnis).toBe('erfasst');
    expect(await prisma.moderationAction.count()).toBe(2);
  });

  // --- Idempotenz ----------------------------------------------------------

  /**
   * Derselbe Audit-Eintrag darf nie zwei Massnahmen erzeugen.
   *
   * Das gilt über Neustarts hinweg, weshalb es die Datenbank entscheidet und
   * nicht ein Zwischenspeicher im Arbeitsspeicher - der wäre nach einem
   * Neustart leer.
   */
  it('verarbeitet denselben Audit-Eintrag kein zweites Mal', async () => {
    const derselbe = eintrag();

    const erst = await erfasse({ art: 'BAN' }, [derselbe]);
    const zweit = await erfasse({ art: 'BAN' }, [derselbe]);

    expect(erst.ergebnis).toBe('erfasst');
    expect(zweit.ergebnis).toBe('bereits-verarbeitet');
    expect(await prisma.moderationAction.count()).toBe(1);
  });

  it('hält die Eindeutigkeit auch in der Datenbank fest', async () => {
    const derselbe = eintrag();
    await erfasse({ art: 'BAN' }, [derselbe]);

    await expect(
      prisma.moderationAction.create({
        data: {
          type: 'BAN',
          module: 'moderation',
          actorDiscordId: MODERATORIN,
          actorUsername: 'nina.mod',
          targetDiscordId: ZIEL,
          targetUsername: 'spammer',
          source: 'DISCORD',
          discordAuditLogEntryId: derselbe.id,
        },
      }),
    ).rejects.toThrow();
  });

  /**
   * Zwei gleichzeitige Läufe auf demselben Eintrag.
   *
   * Genau der Fall, für den die Eindeutigkeit da ist: das Gateway-Ereignis
   * und der Abgleichlauf stossen zur selben Zeit darauf.
   */
  it('erzeugt bei zwei gleichzeitigen Läufen genau eine Zeile', async () => {
    const derselbe = eintrag();

    const ergebnisse = await Promise.all([
      erfasse({ art: 'BAN' }, [derselbe]),
      erfasse({ art: 'BAN' }, [derselbe]),
    ]);

    expect(await prisma.moderationAction.count()).toBe(1);
    expect(ergebnisse.filter((e) => e.ergebnis === 'erfasst')).toHaveLength(1);
  });

  // --- Zwei Banns kurz hintereinander --------------------------------------

  /**
   * Zwei Personen, fast gleichzeitig gebannt.
   *
   * Ohne Prüfung des Ziels bekäme die eine den Moderator der anderen
   * zugeschrieben.
   */
  it('ordnet zwei fast gleichzeitige Banns den richtigen Personen zu', async () => {
    const eintraege = [
      eintrag({ targetId: ZIEL, userId: MODERATORIN, username: 'nina.mod' }),
      eintrag({
        targetId: FREMDER,
        userId: '700000000000000007',
        username: 'tom.mod',
        createdAt: new Date(JETZT.getTime() + 500),
      }),
    ];

    await erfasse({ art: 'BAN' }, eintraege, { targetDiscordId: ZIEL });
    await erfasse({ art: 'BAN' }, eintraege, { targetDiscordId: FREMDER });

    const einer = await prisma.moderationAction.findFirst({ where: { targetDiscordId: ZIEL } });
    const anderer = await prisma.moderationAction.findFirst({
      where: { targetDiscordId: FREMDER },
    });

    expect(einer?.actorUsername).toBe('nina.mod');
    expect(anderer?.actorUsername).toBe('tom.mod');
  });

  // --- Sicherheit ----------------------------------------------------------

  /**
   * Der Grund kommt von aussen.
   *
   * Er landet in der Oberfläche, und niemand hat ihn geprüft, ausser dass
   * Discord ihn durchgereicht hat.
   */
  it('kürzt und entschärft den Grund aus dem Audit Log', async () => {
    const boshaft = `${'A'.repeat(900)} <script>alert(1)</script>`;
    await erfasse({ art: 'BAN' }, [eintrag({ reason: boshaft })]);

    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(zeile?.reason?.length).toBeLessThanOrEqual(400);
    expect(zeile?.reason).not.toContain(' ');
  });

  it('kürzt einen übermässig langen Namen des Handelnden', async () => {
    await erfasse({ art: 'BAN' }, [eintrag({ username: 'B'.repeat(5_000) })]);

    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(zeile?.actorUsername.length).toBeLessThanOrEqual(100);
  });

  it('hält die Metadaten klein', async () => {
    await erfasse({ art: 'BAN' }, [eintrag({ reason: 'C'.repeat(2_000) })]);

    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(JSON.stringify(zeile?.metadata).length).toBeLessThan(1_000);
  });

  // --- Das Audit Log der Anwendung -----------------------------------------

  it('vermerkt die Erkennung im Audit Log der Anwendung', async () => {
    await erfasse({ art: 'BAN' }, [eintrag({ reason: 'Spam' })]);

    const spur = await prisma.auditLog.findFirst({
      where: { action: 'MODERATION_EXTERNAL_ACTION_DETECTED' },
    });
    expect(spur).not.toBeNull();
    expect(spur?.targetDiscordId).toBe(ZIEL);
    const daten = spur?.metadata as Record<string, unknown>;
    expect(daten.source).toBe('DISCORD');
    expect(daten.actionType).toBe('BAN');
  });

  // --- Verlauf und Kennzahlen ----------------------------------------------

  /**
   * Es gibt keine zweite Historie.
   *
   * Extern erkannte Massnahmen stehen in derselben Tabelle wie alle anderen
   * und erscheinen deshalb ohne weiteres Zutun im Verlauf.
   */
  it('zeigt die Massnahme im gemeinsamen Verlauf', async () => {
    await erfasse({ art: 'BAN' }, [eintrag({ reason: 'Spam' })]);

    const { zeilen } = await moderation.listActions({});
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.source).toBe('DISCORD');
  });

  it('lässt sich nach der Quelle filtern', async () => {
    await erfasse({ art: 'BAN' }, [eintrag()]);
    await prisma.moderationAction.create({
      data: {
        type: 'KICK',
        module: 'moderation',
        actorDiscordId: MODERATORIN,
        actorUsername: 'nina.mod',
        targetDiscordId: FREMDER,
        targetUsername: 'jemand',
        source: 'WEBAPP',
      },
    });

    const ausDiscord = await moderation.listActions({ source: ['DISCORD'] });
    const ausSwissHub = await moderation.listActions({ source: ['WEBAPP'] });
    const alle = await moderation.listActions({});

    expect(ausDiscord.zeilen).toHaveLength(1);
    expect(ausSwissHub.zeilen).toHaveLength(1);
    expect(alle.zeilen).toHaveLength(2);
  });

  it('erscheint in der Akte des Mitglieds', async () => {
    await erfasse({ art: 'BAN' }, [eintrag()]);

    const akte = await moderation.memberHistory(ZIEL);
    expect(akte).toHaveLength(1);
    expect(akte[0]?.source).toBe('DISCORD');
  });

  /** Ein extern gesetzter Timeout läuft - die Übersicht muss ihn kennen. */
  it('zählt einen extern gesetzten Timeout zu den laufenden', async () => {
    const bis = new Date(Date.now() + 3_600_000);
    await erfasse({ art: 'TIMEOUT', bis }, [
      eintrag({ actionType: AUDIT_LOG_ACTIONS.MEMBER_UPDATE }),
    ]);

    const laufend = await moderation.aktiveTimeouts();
    expect(laufend).toHaveLength(1);
    expect(laufend[0]?.source).toBe('DISCORD');
  });

  // --- Der Abgleichlauf ----------------------------------------------------

  /**
   * Beim ersten Lauf wird nichts nachgetragen.
   *
   * Die gesamte erreichbare Vergangenheit eines Servers nachträglich in die
   * Akte zu schreiben wäre etwas anderes als das Schliessen einer Lücke.
   */
  it('setzt beim ersten Abgleich nur den Zeiger', async () => {
    await prisma.botStatus.create({ data: { id: 'singleton', botUserId: EIGENER_BOT } });
    const alt = eintrag();

    const ergebnis = await moderation.gleicheAuditLogAb({ gateway: gatewayMit([alt]) });

    expect(await prisma.moderationAction.count()).toBe(0);
    expect(ergebnis.zeiger).toBe(alt.id);
    const status = await prisma.botStatus.findUnique({ where: { id: 'singleton' } });
    expect(status?.lastAuditEntryId).toBe(alt.id);
  });

  /** Was der Bot während einer Trennung verpasst hat. */
  it('trägt beim zweiten Abgleich einen verpassten Bann nach', async () => {
    await prisma.botStatus.create({
      data: { id: 'singleton', botUserId: EIGENER_BOT, lastAuditEntryId: '800000000000000000' },
    });
    const verpasst = eintrag({ reason: 'Während des Neustarts' });

    const ergebnis = await moderation.gleicheAuditLogAb({ gateway: gatewayMit([verpasst]) });

    expect(ergebnis.erfasst).toBe(1);
    const zeile = await prisma.moderationAction.findFirst({ where: { type: 'BAN' } });
    expect(zeile?.source).toBe('DISCORD');
    expect(zeile?.reason).toBe('Während des Neustarts');
    expect(zeile?.discordAuditLogEntryId).toBe(verpasst.id);
  });

  /**
   * Der Neustart darf nichts verdoppeln.
   *
   * Das Gateway-Ereignis hat den Eintrag bereits verarbeitet; der
   * Abgleichlauf sieht ihn danach ein zweites Mal.
   */
  it('trägt einen bereits verarbeiteten Eintrag nicht erneut nach', async () => {
    await prisma.botStatus.create({
      data: { id: 'singleton', botUserId: EIGENER_BOT, lastAuditEntryId: '800000000000000000' },
    });
    const derselbe = eintrag();

    await erfasse({ art: 'BAN' }, [derselbe]);
    const ergebnis = await moderation.gleicheAuditLogAb({ gateway: gatewayMit([derselbe]) });

    expect(ergebnis.erfasst).toBe(0);
    expect(await prisma.moderationAction.count()).toBe(1);
  });

  it('lässt den Zeiger stehen, wenn das Audit Log nicht lesbar ist', async () => {
    await prisma.botStatus.create({
      data: { id: 'singleton', botUserId: EIGENER_BOT, lastAuditEntryId: '800000000000000000' },
    });

    const ergebnis = await moderation.gleicheAuditLogAb({
      gateway: gatewayMit(new Error('403 Missing Permissions')),
    });

    expect(ergebnis.erfasst).toBe(0);
    const status = await prisma.botStatus.findUnique({ where: { id: 'singleton' } });
    expect(status?.lastAuditEntryId).toBe('800000000000000000');
  });

  // --- Gesundheit ----------------------------------------------------------

  it('meldet fehlendes Leserecht, ohne zu werfen', async () => {
    const fehler = Object.assign(new Error('Missing Permissions'), { status: 403 });
    const befund = await moderation.pruefeAuditZugang({ gateway: gatewayMit(fehler) });

    expect(befund.zugang).toBe('kein-recht');
  });

  it('unterscheidet fehlendes Recht von einer Störung', async () => {
    const stoerung = Object.assign(new Error('502 Bad Gateway'), { status: 502 });
    const befund = await moderation.pruefeAuditZugang({ gateway: gatewayMit(stoerung) });

    expect(befund.zugang).toBe('unerreichbar');
  });

  /**
   * Eine Störung überschreibt den bekannten Zustand nicht.
   *
   * Sonst flöge die Anzeige bei jedem Aussetzer zwischen «geht» und «geht
   * nicht», und niemand traute ihr mehr.
   */
  it('überschreibt den bekannten Zustand bei einer Störung nicht', async () => {
    await prisma.botStatus.create({ data: { id: 'singleton', auditLogAccess: true } });

    await moderation.schreibeAuditZugang({ zugang: 'unerreichbar', geprueftAm: new Date() });

    const status = await prisma.botStatus.findUnique({ where: { id: 'singleton' } });
    expect(status?.auditLogAccess).toBe(true);
  });

  it('vermerkt den geprüften Zugang', async () => {
    await prisma.botStatus.create({ data: { id: 'singleton' } });

    await moderation.schreibeAuditZugang({ zugang: 'ok', geprueftAm: JETZT });

    const status = await prisma.botStatus.findUnique({ where: { id: 'singleton' } });
    expect(status?.auditLogAccess).toBe(true);
    expect(status?.auditLogCheckedAt?.toISOString()).toBe(JETZT.toISOString());
  });
});
