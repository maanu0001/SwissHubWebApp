import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_backfill');

/**
 * Aggregate aus vorhandenen Ereignissen nachziehen.
 *
 * Die wichtigste Eigenschaft ist die Wiederholbarkeit: ein Job, der bei jedem
 * Lauf addiert, verdoppelt die Zahlen beim zweiten Mal - und niemand merkt
 * es, weil das Ergebnis plausibel aussieht.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const A = '100000000000000001';
const B = '100000000000000002';
const VOICE = '700000000000000010';
const VOICE_2 = '700000000000000011';

async function konfiguriere(): Promise<void> {
  await setModuleEnabled(analytics.ANALYTICS_MODULE_ID, true, 'test');
  await setModuleSettings(
    analytics.ANALYTICS_MODULE_ID,
    {
      logMessages: true,
      storeMessageContent: false,
      logVoice: true,
      logMembers: true,
      logAdmin: true,
      logBots: false,
      ignoredChannelIds: [],
      retentionDays: 90,
      mediaRetentionDays: 30,
      archiveMedia: false,
      mediaQuotaMb: 2048,
      maxMediaFileMb: 8,
    },
    'test',
  );
}

async function ereignis(type: string, subject: string, at: Date, channelId?: string): Promise<void> {
  await prisma.discordEvent.create({
    data: {
      guildId: GUILD,
      category: type.startsWith('VOICE') ? 'VOICE' : 'MEMBER',
      type,
      subjectDiscordId: subject,
      channelId: channelId ?? null,
      channelName: channelId ? 'Treffpunkt' : null,
      occurredAt: at,
    },
  });
}

const T = (versatzStunden: number): Date =>
  new Date(Date.UTC(2026, 7, 20, 12, 0, 0) + versatzStunden * 3600_000);

const ZEITRAUM = () => analytics.aufloesen({ id: '30d', jetzt: new Date(Date.UTC(2026, 7, 25, 12, 0, 0)) });

describeWithDatabase('Analytics-Backfill', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordEvent","AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","ModuleState" RESTART IDENTITY CASCADE',
    );
  });

  it('zieht Beitritte und Austritte aus dem Ereignisprotokoll nach', async () => {
    await konfiguriere();
    await ereignis('MEMBER_JOIN', A, T(-48));
    await ereignis('MEMBER_JOIN', B, T(-24));
    await ereignis('MEMBER_LEAVE', B, T(-2));

    const ergebnis = await analytics.backfill(GUILD);

    expect(ergebnis.beitritte).toBe(2);
    expect(ergebnis.austritte).toBe(1);

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.neueMitglieder.wert).toBe(2);
    expect(zahlen.austritte.wert).toBe(1);
    expect(zahlen.nettoWachstum.wert).toBe(1);
  });

  it('ist wiederholbar - zweimal laufen ergibt dieselben Zahlen, nicht die doppelten', async () => {
    await konfiguriere();
    await ereignis('MEMBER_JOIN', A, T(-48));
    await ereignis('VOICE_JOIN', A, T(-4), VOICE);
    await ereignis('VOICE_LEAVE', A, T(-2), VOICE);

    await analytics.backfill(GUILD);
    const ersteZahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });

    // Der Fortschritt wird zurückgesetzt, damit derselbe Bereich noch einmal
    // bearbeitet wird - genau der Fall, in dem ein addierender Job verdoppelt.
    await prisma.analyticsTracking.updateMany({ where: { guildId: GUILD }, data: { backfilledUntil: null } });
    await analytics.backfill(GUILD);
    const zweiteZahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(zweiteZahlen.neueMitglieder.wert).toBe(ersteZahlen.neueMitglieder.wert);
    expect(zweiteZahlen.sprachSekunden.wert).toBe(ersteZahlen.sprachSekunden.wert);
    expect(zweiteZahlen.sprachSekunden.wert).toBe(7200);
  });

  it('rekonstruiert Sprachabschnitte aus Betreten, Verschieben und Verlassen', async () => {
    await konfiguriere();
    await ereignis('VOICE_JOIN', A, T(-3), VOICE);
    await ereignis('VOICE_MOVE', A, T(-2), VOICE_2);
    await ereignis('VOICE_LEAVE', A, T(-1), VOICE_2);

    const ergebnis = await analytics.backfill(GUILD);

    expect(ergebnis.sprachAbschnitte).toBe(2);
    expect(ergebnis.sprachSekunden).toBe(7200);

    const kanaele = await analytics.statistik.topKanaele({ guildId: GUILD, zeitraum: ZEITRAUM() }, 'VOICE');
    // Je Kanal eine Stunde - der Wechsel verteilt die Zeit, statt sie einem
    // Kanal zuzuschlagen.
    expect(kanaele.map((e) => e.sprachSekunden).sort()).toEqual([3600, 3600]);
  });

  it('verwirft einen Abschnitt ohne Ende, statt seine Dauer zu schätzen', async () => {
    await konfiguriere();
    // Der Bot war weg, als die Person ging: es gibt nur ein Betreten.
    await ereignis('VOICE_JOIN', A, T(-4), VOICE);
    await ereignis('VOICE_JOIN', B, T(-3), VOICE);
    await ereignis('VOICE_LEAVE', B, T(-1), VOICE);

    const ergebnis = await analytics.backfill(GUILD);

    // Nur B zählt. A wird nicht mit einer erfundenen Dauer aufgefüllt.
    expect(ergebnis.sprachAbschnitte).toBe(1);
    expect(ergebnis.sprachSekunden).toBe(7200);
  });

  it('zieht keine Nachrichten nach und sagt warum', async () => {
    await konfiguriere();
    // Eine gelöschte Nachricht steht im Protokoll - eine geschriebene nie.
    await prisma.discordEvent.create({
      data: {
        guildId: GUILD,
        category: 'MESSAGE',
        type: 'MESSAGE_DELETE',
        subjectDiscordId: A,
        occurredAt: T(-2),
      },
    });

    const ergebnis = await analytics.backfill(GUILD);
    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(zahlen.nachrichten.wert).toBe(0);
    expect(ergebnis.hinweis).toMatch(/nicht nachziehen/i);
  });

  it('lässt laufend gezählte Nachrichten beim Nachziehen unangetastet', async () => {
    await konfiguriere();
    // Eine im Betrieb gezählte Nachricht darf der Backfill nicht wegräumen -
    // er setzt nur zurück, was er selbst schreibt.
    await analytics.zaehleNachricht({
      guildId: GUILD,
      discordId: A,
      channelId: '700000000000000001',
      at: T(-2),
    });
    await ereignis('MEMBER_JOIN', B, T(-3));

    await analytics.backfill(GUILD);

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.nachrichten.wert).toBe(1);
    expect(zahlen.neueMitglieder.wert).toBe(1);
  });

  it('rührt einen anderen Server nicht an', async () => {
    await konfiguriere();
    await prisma.discordEvent.create({
      data: {
        guildId: '000000000000000002',
        category: 'MEMBER',
        type: 'MEMBER_JOIN',
        subjectDiscordId: A,
        occurredAt: T(-2),
      },
    });

    const ergebnis = await analytics.backfill(GUILD);
    expect(ergebnis.beitritte).toBe(0);
  });
});
