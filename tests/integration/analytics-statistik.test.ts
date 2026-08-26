import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_statistik');

/**
 * Die Statistik mit kontrollierten Beispieldaten.
 *
 * Der Kern dieser Datei ist der Plausibilitätstest: zwei Mitglieder mit
 * bekannten Werten, und danach muss jede Zahl exakt stimmen. Eine Statistik,
 * die «ungefähr» richtig ist, ist falsch - nur merkt es niemand.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const FREMDE_GUILD = '000000000000000002';
const A = '100000000000000001';
const B = '100000000000000002';
const BOT = '800000000000000001';

const TEXT_KANAL = '700000000000000001';
const TEXT_KANAL_2 = '700000000000000002';
const VOICE_KANAL = '700000000000000010';
const VOICE_KANAL_2 = '700000000000000011';
const AFK_KANAL = '700000000000000099';

async function konfiguriere(teile: Record<string, unknown> = {}): Promise<void> {
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
      ...teile,
    },
    'test',
  );
}

/** Ein fester Zeitpunkt mitten am Tag, damit nichts an einer Tagesgrenze klebt. */
const T = (versatzStunden = 0): Date => new Date(Date.UTC(2026, 7, 20, 12, 0, 0) + versatzStunden * 3600_000);

async function nachricht(discordId: string, at: Date, channelId = TEXT_KANAL, isBot = false) {
  await analytics.zaehleNachricht({
    guildId: GUILD,
    discordId,
    isBot,
    channelId,
    channelName: channelId === TEXT_KANAL ? 'allgemein' : 'gaming',
    at,
  });
}

async function sprache(discordId: string, von: Date, bis: Date, channelId = VOICE_KANAL, isBot = false) {
  await analytics.starteSprachAbschnitt({
    guildId: GUILD,
    discordId,
    isBot,
    channelId,
    channelName: 'Treffpunkt',
    at: von,
  });
  await analytics.beendeSprachAbschnitt(GUILD, discordId, bis);
}

const ZEITRAUM = () => analytics.aufloesen({ id: '30d', jetzt: new Date(Date.UTC(2026, 7, 25, 12, 0, 0)) });

describeWithDatabase('Analytics-Statistik', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsHourly","AnalyticsDaily","AnalyticsUserDaily","AnalyticsChannelDaily","AnalyticsVoiceSegment","AnalyticsMemberProfile","AnalyticsTracking","ModuleState" RESTART IDENTITY CASCADE',
    );
  });

  it('Plausibilität: zwei Mitglieder mit bekannten Werten ergeben exakt die erwarteten Zahlen', async () => {
    await konfiguriere();

    // A: 100 Nachrichten, 2 Stunden Sprache.
    for (let i = 0; i < 100; i += 1) {
      await nachricht(A, T());
    }
    await sprache(A, T(-4), T(-2));

    // B: 50 Nachrichten, 4 Stunden Sprache.
    for (let i = 0; i < 50; i += 1) {
      await nachricht(B, T());
    }
    await sprache(B, T(-6), T(-2));

    const scope = { guildId: GUILD, zeitraum: ZEITRAUM() };
    const [zahlen, topText, topVoice] = await Promise.all([
      analytics.statistik.kennzahlen(scope),
      analytics.statistik.topMitglieder(scope, 'messages'),
      analytics.statistik.topMitglieder(scope, 'voice'),
    ]);

    // Serversumme: exakt, nicht ungefähr.
    expect(zahlen.nachrichten.wert).toBe(150);
    expect(zahlen.sprachSekunden.wert).toBe(6 * 3600);
    expect(zahlen.aktiveMitglieder.wert).toBe(2);

    // Nachrichten: A vor B. Sprache: B vor A.
    expect(topText.map((e) => e.discordId)).toEqual([A, B]);
    expect(topVoice.map((e) => e.discordId)).toEqual([B, A]);

    expect(topText[0]?.nachrichten).toBe(100);
    expect(topVoice[0]?.sprachSekunden).toBe(4 * 3600);
    // Anteile: 100 von 150 sind 66.7 %.
    expect(topText[0]?.anteil).toBe(66.7);
  });

  it('zählt eine Person, die an mehreren Tagen aktiv war, als eine aktive Person', async () => {
    await konfiguriere();
    // Der Fehler, den man leicht macht: Tageswerte addieren. A wäre dann drei
    // aktive Mitglieder.
    await nachricht(A, T(-48));
    await nachricht(A, T(-24));
    await nachricht(A, T());

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(zahlen.nachrichten.wert).toBe(3);
    expect(zahlen.aktiveMitglieder.wert).toBe(1);
  });

  it('verteilt eine Sprachsitzung über Mitternacht auf beide Tage', async () => {
    await konfiguriere();
    // 23:30 bis 01:30 Zürcher Zeit (MESZ = UTC+2).
    const von = new Date(Date.UTC(2026, 7, 20, 21, 30, 0));
    const bis = new Date(Date.UTC(2026, 7, 20, 23, 30, 0));
    await sprache(A, von, bis);

    const tage = await prisma.analyticsDaily.findMany({ orderBy: { day: 'asc' } });

    expect(tage.map((zeile) => [zeile.day.toISOString().slice(0, 10), zeile.voiceSeconds])).toEqual([
      ['2026-08-20', 1800],
      ['2026-08-21', 5400],
    ]);
    // Und die Summe bleibt, was sie war.
    expect(tage.reduce((summe, zeile) => summe + zeile.voiceSeconds, 0)).toBe(7200);
  });

  it('beendet die Sitzung beim Kanalwechsel nicht, verteilt die Zeit aber auf beide Kanäle', async () => {
    await konfiguriere();
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: VOICE_KANAL,
      channelName: 'Treffpunkt 1',
      at: T(-2),
    });
    const { sessionId } = await analytics.beendeSprachAbschnitt(GUILD, A, T(-1));
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: VOICE_KANAL_2,
      channelName: 'Treffpunkt 2',
      at: T(-1),
      sessionId: sessionId ?? undefined,
    });
    await analytics.beendeSprachAbschnitt(GUILD, A, T());

    const scope = { guildId: GUILD, zeitraum: ZEITRAUM() };
    const [zahlen, kanaele] = await Promise.all([
      analytics.statistik.kennzahlen(scope),
      analytics.statistik.topKanaele(scope, 'VOICE'),
    ]);

    // Zwei Stunden insgesamt - und eine einzige Sitzung, kein zweite durch
    // den Wechsel.
    expect(zahlen.sprachSekunden.wert).toBe(7200);
    expect(zahlen.sprachSitzungen.wert).toBe(1);
    // Je Kanal eine Stunde.
    expect(kanaele.map((e) => [e.channelId, e.sprachSekunden]).sort()).toEqual(
      [
        [VOICE_KANAL, 3600],
        [VOICE_KANAL_2, 3600],
      ].sort(),
    );
  });

  it('zählt AFK-Zeit nicht als Sprachzeit', async () => {
    await konfiguriere();
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: AFK_KANAL,
      channelName: 'AFK',
      isAfk: true,
      at: T(-3),
    });
    await analytics.beendeSprachAbschnitt(GUILD, A, T());

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(zahlen.sprachSekunden.wert).toBe(0);
    // Der Abschnitt selbst bleibt als Beleg stehen.
    expect(await prisma.analyticsVoiceSegment.count()).toBe(1);
  });

  it('schliesst Bots standardmässig aus und nimmt sie auf Wunsch auf', async () => {
    await konfiguriere({ logBots: false });
    await nachricht(BOT, T(), TEXT_KANAL, true);
    await nachricht(A, T());

    let zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.nachrichten.wert).toBe(1);

    // Musik-Workerbots dürfen die Sprach-Rangliste nicht anführen.
    await konfiguriere({ logBots: true });
    await nachricht(BOT, T(), TEXT_KANAL, true);
    zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.nachrichten.wert).toBe(2);
  });

  it('zählt keine Nachricht aus einem ausgenommenen Kanal', async () => {
    await konfiguriere({ ignoredChannelIds: [TEXT_KANAL] });
    await nachricht(A, T(), TEXT_KANAL);
    await nachricht(A, T(), TEXT_KANAL_2);

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.nachrichten.wert).toBe(1);
  });

  it('trennt strikt nach Server', async () => {
    await konfiguriere();
    await nachricht(A, T());
    await analytics.zaehleNachricht({
      guildId: FREMDE_GUILD,
      discordId: A,
      channelId: TEXT_KANAL,
      at: T(),
    });

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.nachrichten.wert).toBe(1);
  });

  it('berechnet Beitritte, Austritte und Netto-Wachstum', async () => {
    await konfiguriere();
    await analytics.zaehleBeitritt(GUILD, A, T(-48));
    await analytics.zaehleBeitritt(GUILD, B, T(-24));
    await analytics.zaehleAustritt(GUILD, B, T());

    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(zahlen.neueMitglieder.wert).toBe(2);
    expect(zahlen.austritte.wert).toBe(1);
    expect(zahlen.nettoWachstum.wert).toBe(1);
  });

  it('vergleicht mit dem gleich langen Zeitraum davor', async () => {
    await konfiguriere();
    const jetzt = new Date(Date.UTC(2026, 7, 25, 12, 0, 0));
    // Im aktuellen Zeitraum (letzte 7 Tage): 10 Nachrichten.
    for (let i = 0; i < 10; i += 1) {
      await nachricht(A, new Date(jetzt.getTime() - 2 * 86_400_000));
    }
    // Im Zeitraum davor (Tag 8-14): 5 Nachrichten.
    for (let i = 0; i < 5; i += 1) {
      await nachricht(A, new Date(jetzt.getTime() - 10 * 86_400_000));
    }

    const zeitraum = analytics.aufloesen({ id: '7d', jetzt });
    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum });

    expect(zahlen.nachrichten.wert).toBe(10);
    expect(zahlen.nachrichten.vorher).toBe(5);
    expect(zahlen.nachrichten.prozent).toBe(100);
    expect(zahlen.nachrichten.richtung).toBe('auf');
  });

  it('nennt bei einer zu kleinen Grundlage keine Prozentzahl', async () => {
    await konfiguriere();
    const jetzt = new Date(Date.UTC(2026, 7, 25, 12, 0, 0));
    for (let i = 0; i < 3; i += 1) {
      await nachricht(A, new Date(jetzt.getTime() - 2 * 86_400_000));
    }
    await nachricht(A, new Date(jetzt.getTime() - 10 * 86_400_000));

    const zeitraum = analytics.aufloesen({ id: '7d', jetzt });
    const zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum });

    // 1 auf 3 ist nicht «+200 %» - das wäre eine Zahl, die mehr verspricht,
    // als sie weiss. Die Richtung stimmt trotzdem.
    expect(zahlen.nachrichten.prozent).toBeNull();
    expect(zahlen.nachrichten.richtung).toBe('auf');
  });

  it('führt Top-Kanäle mit ihrem Anteil', async () => {
    await konfiguriere();
    for (let i = 0; i < 8; i += 1) {
      await nachricht(A, T(), TEXT_KANAL);
    }
    for (let i = 0; i < 2; i += 1) {
      await nachricht(A, T(), TEXT_KANAL_2);
    }

    const kanaele = await analytics.statistik.topKanaele({ guildId: GUILD, zeitraum: ZEITRAUM() }, 'TEXT');

    expect(kanaele[0]?.channelId).toBe(TEXT_KANAL);
    expect(kanaele[0]?.nachrichten).toBe(8);
    expect(kanaele[0]?.anteil).toBe(80);
  });

  it('unterscheidet Nur-Text, Nur-Sprache und beides', async () => {
    await konfiguriere();
    await nachricht(A, T());
    await sprache(B, T(-2), T(-1));
    const C = '100000000000000003';
    await nachricht(C, T());
    await sprache(C, T(-2), T(-1));

    const art = await analytics.statistik.nutzungsart({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(art.nurText).toBe(1);
    expect(art.nurSprache).toBe(1);
    expect(art.beides).toBe(1);
  });

  it('ordnet die Heatmap nach Zürcher Wochentag und Stunde', async () => {
    await konfiguriere();
    // 22:30 UTC am Samstag ist in Zürich bereits Sonntag 00:30 (MESZ).
    await nachricht(A, new Date(Date.UTC(2026, 7, 22, 22, 30, 0)));

    const bild = await analytics.statistik.heatmap({
      guildId: GUILD,
      zeitraum: analytics.aufloesen({ id: '30d', jetzt: new Date(Date.UTC(2026, 7, 25, 12, 0, 0)) }),
    });

    expect(bild.spitzeNachrichten).toEqual({ wochentag: 0, stunde: 0 });
  });

  it('sagt, seit wann gezählt wird, und kennzeichnet einen unvollständigen Zeitraum', async () => {
    await konfiguriere();
    await nachricht(A, T());

    const zeitraum = analytics.aufloesen({ id: '1y', jetzt: new Date(Date.UTC(2026, 7, 25, 12, 0, 0)) });
    const lage = await analytics.statistik.datenlage(GUILD, zeitraum);

    expect(lage.seit).not.toBeNull();
    expect(lage.nachrichtenSeit).not.toBeNull();
    // Ein Jahr zurück gibt es keine Daten - und die Seite behauptet es nicht.
    expect(lage.unvollstaendig).toBe(true);
    expect(lage.leer).toBe(false);
  });

  it('meldet eine leere Datenlage, solange nichts gezählt wurde', async () => {
    await konfiguriere();
    const lage = await analytics.statistik.datenlage(GUILD, ZEITRAUM());

    expect(lage.leer).toBe(true);
    expect(lage.seit).toBeNull();
  });

  it('zählt eine laufende Sitzung erst, wenn sie beendet ist', async () => {
    await konfiguriere();
    await analytics.starteSprachAbschnitt({
      guildId: GUILD,
      discordId: A,
      channelId: VOICE_KANAL,
      at: T(-2),
    });

    // Solange offen: keine Sekunden in den Tageswerten - ein abgeschlossener
    // Tag darf nicht nachträglich weiterwachsen.
    let zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.sprachSekunden.wert).toBe(0);
    // Die laufende Anwesenheit ist trotzdem sichtbar.
    expect((await analytics.statistik.heute(GUILD)).imSprachkanal).toBe(1);

    await analytics.beendeSprachAbschnitt(GUILD, A, T());
    zahlen = await analytics.statistik.kennzahlen({ guildId: GUILD, zeitraum: ZEITRAUM() });
    expect(zahlen.sprachSekunden.wert).toBe(7200);
  });

  it('berechnet Aktivierung neuer Mitglieder', async () => {
    await konfiguriere();
    const jetzt = new Date(Date.UTC(2026, 7, 25, 12, 0, 0));
    // Zehn Beitritte, davon sechs mit erster Äusserung innerhalb einer Woche.
    for (let i = 0; i < 10; i += 1) {
      const id = `10000000000000${String(100 + i)}`;
      await analytics.zaehleBeitritt(GUILD, id, new Date(jetzt.getTime() - 10 * 86_400_000));
      if (i < 6) {
        await nachricht(id, new Date(jetzt.getTime() - 9 * 86_400_000));
      }
    }

    const zeitraum = analytics.aufloesen({ id: '30d', jetzt });
    const neu = await analytics.statistik.neueMitglieder({ guildId: GUILD, zeitraum });

    expect(neu.beigetreten).toBe(10);
    expect(neu.aktiviert).toBe(6);
    expect(neu.aktivierungsQuote).toBe(60);
  });

  it('zählt wiederkehrende und neu aktive Mitglieder getrennt', async () => {
    await konfiguriere();
    const jetzt = new Date(Date.UTC(2026, 7, 25, 12, 0, 0));
    const frueher = new Date(jetzt.getTime() - 10 * 86_400_000);
    const kuerzlich = new Date(jetzt.getTime() - 2 * 86_400_000);

    // A war in beiden Zeiträumen aktiv, B nur im aktuellen.
    await nachricht(A, frueher);
    await nachricht(A, kuerzlich);
    await nachricht(B, kuerzlich);

    const zeitraum = analytics.aufloesen({ id: '7d', jetzt });
    const werte = await analytics.statistik.wiederkehrende({ guildId: GUILD, zeitraum });

    expect(werte?.aktiv).toBe(2);
    expect(werte?.wiederkehrend).toBe(1);
    expect(werte?.neuAktiv).toBe(1);
  });
});

describeWithDatabase('Analytics-Statistik: Bindung als Kohorte', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AnalyticsDaily","AnalyticsUserDaily","AnalyticsMemberProfile","AnalyticsTracking","ModuleState" RESTART IDENTITY CASCADE',
    );
  });

  it('misst die Bindung an der eigenen Marke jedes Mitglieds, nicht am heutigen Stichtag', async () => {
    await konfiguriere();
    const jetzt = Date.now();

    // 25 Personen vor 60 Tagen beigetreten. Zehn davon gingen schon nach
    // drei Tagen - sie haben die 7-Tage-Marke nicht erreicht.
    for (let i = 0; i < 25; i += 1) {
      const id = `30000000000000${String(100 + i)}`;
      const beitritt = new Date(jetzt - 60 * 86_400_000);
      await analytics.zaehleBeitritt(GUILD, id, beitritt);
      if (i < 10) {
        await analytics.zaehleAustritt(GUILD, id, new Date(beitritt.getTime() + 3 * 86_400_000));
      }
    }

    const neu = await analytics.statistik.neueMitglieder({ guildId: GUILD, zeitraum: ZEITRAUM() });
    const nachSieben = neu.bindung.find((eintrag) => eintrag.tage === 7);

    // 15 von 25 waren nach sieben Tagen noch da.
    expect(nachSieben?.kohorte).toBe(25);
    expect(nachSieben?.geblieben).toBe(15);
    expect(nachSieben?.quote).toBe(60);
  });

  it('zählt jemanden mit, der erst nach der Marke gegangen ist', async () => {
    await konfiguriere();
    const jetzt = Date.now();

    // Alle 20 sind inzwischen weg - aber erst nach 30 Tagen. Für die
    // 7-Tage-Bindung zählen sie trotzdem als geblieben.
    for (let i = 0; i < 20; i += 1) {
      const id = `30000000000000${String(200 + i)}`;
      const beitritt = new Date(jetzt - 90 * 86_400_000);
      await analytics.zaehleBeitritt(GUILD, id, beitritt);
      await analytics.zaehleAustritt(GUILD, id, new Date(beitritt.getTime() + 30 * 86_400_000));
    }

    const neu = await analytics.statistik.neueMitglieder({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(neu.bindung.find((e) => e.tage === 7)?.quote).toBe(100);
    // Nach 30 Tagen waren sie weg - genau auf der Marke zählt als gegangen.
    expect(neu.bindung.find((e) => e.tage === 30)?.quote).toBe(0);
  });

  it('nimmt niemanden in die Kohorte auf, der die Marke noch nicht erreichen konnte', async () => {
    await konfiguriere();
    // Gestern beigetreten: keine 30-Tage-Bindung möglich.
    for (let i = 0; i < 30; i += 1) {
      await analytics.zaehleBeitritt(
        GUILD,
        `30000000000000${String(300 + i)}`,
        new Date(Date.now() - 86_400_000),
      );
    }

    const neu = await analytics.statistik.neueMitglieder({ guildId: GUILD, zeitraum: ZEITRAUM() });

    expect(neu.bindung.find((e) => e.tage === 30)?.kohorte).toBe(0);
    expect(neu.bindung.find((e) => e.tage === 30)?.quote).toBeNull();
  });
});
