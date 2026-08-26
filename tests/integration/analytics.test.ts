import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics');

/**
 * Das Ereignisprotokoll gegen eine echte Datenbank.
 *
 * Die Fälle hier prüfen vor allem, was **nicht** geschieht: kein Eintrag bei
 * ausgeschaltetem Modul, kein Inhalt ohne die entsprechende Einstellung, kein
 * Inhalt in einer Antwort an jemanden ohne die Berechtigung, kein erfundener
 * Verursacher. Die Zusagen des Moduls sind Zusagen darüber, was es unterlässt.
 */
const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const FREMDE_GUILD = '000000000000000002';
const ANNA = '100000000000000001';
const NINA = '100000000000000002';

async function konfiguriere(teile: Record<string, unknown> = {}): Promise<void> {
  await setModuleEnabled(analytics.ANALYTICS_MODULE_ID, true, 'test');
  await setModuleSettings(
    analytics.ANALYTICS_MODULE_ID,
    {
      logMessages: true,
      storeMessageContent: true,
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

const NACHRICHT_GELOESCHT = {
  guildId: GUILD,
  category: 'MESSAGE' as const,
  type: analytics.EVENT_TYPES.MESSAGE_DELETE,
  subjectDiscordId: ANNA,
  subjectUsername: 'manuel',
  channelId: '700000000000000001',
  channelName: 'allgemein',
  messageId: '800000000000000001',
  contentBefore: 'Das hier war der Text',
};

describeWithDatabase('Analytics', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordEvent","DiscordMessageSnapshot","DiscordEventMedia","ModerationAction","ModuleState","AuditLog" RESTART IDENTITY CASCADE',
    );
  });

  it('zeichnet nichts auf, solange das Modul aus ist', async () => {
    await setModuleEnabled(analytics.ANALYTICS_MODULE_ID, false, 'test');

    await expect(analytics.recordEvent(NACHRICHT_GELOESCHT)).resolves.toBeNull();
    expect(await prisma.discordEvent.count()).toBe(0);
  });

  it('zeichnet auf, sobald das Modul eingeschaltet ist', async () => {
    await konfiguriere();

    const eintrag = await analytics.recordEvent(NACHRICHT_GELOESCHT);

    expect(eintrag?.type).toBe('MESSAGE_DELETE');
    expect(eintrag?.contentBefore).toBe('Das hier war der Text');
  });

  it('lässt den Verursacher unbekannt, wenn keiner belegt ist', async () => {
    await konfiguriere();

    const eintrag = await analytics.recordEvent(NACHRICHT_GELOESCHT);

    // Der Kern der ganzen Sache: Discord sagt nicht, wer gelöscht hat, und
    // das Protokoll behauptet es deshalb auch nicht.
    expect(eintrag?.actorDiscordId).toBeNull();
    expect(eintrag?.actorSource).toBe('UNKNOWN');
  });

  it('macht aus einem Verursacher ohne belegte Quelle keine Tatsache', async () => {
    await konfiguriere();

    // Ein Aufrufer nennt jemanden, ohne zu sagen, woher er es weiss.
    const eintrag = await analytics.recordEvent({
      ...NACHRICHT_GELOESCHT,
      actorDiscordId: NINA,
      actorUsername: 'nina.mod',
    });

    // Der Name steht drin, die Herkunft bleibt «unbekannt» - die Oberfläche
    // zeigt daraufhin «nicht zuzuordnen».
    expect(eintrag?.actorSource).toBe('UNKNOWN');
  });

  it('speichert keinen Text, wenn die Einstellung ihn nicht erlaubt', async () => {
    await konfiguriere({ storeMessageContent: false });

    const eintrag = await analytics.recordEvent(NACHRICHT_GELOESCHT);

    // Nicht erst in der Anzeige gefiltert: was nicht in der Datenbank steht,
    // kann auch nicht versehentlich sichtbar werden.
    expect(eintrag).not.toBeNull();
    expect(eintrag?.contentBefore).toBeNull();
  });

  it('zeichnet eine abgeschaltete Kategorie nicht auf', async () => {
    await konfiguriere({ logVoice: false });

    await analytics.recordEvent({
      guildId: GUILD,
      category: 'VOICE',
      type: analytics.EVENT_TYPES.VOICE_JOIN,
      subjectDiscordId: ANNA,
    });
    await analytics.recordEvent(NACHRICHT_GELOESCHT);

    const zeilen = await prisma.discordEvent.findMany();
    expect(zeilen.map((zeile) => zeile.category)).toEqual(['MESSAGE']);
  });

  it('zeichnet nichts aus einem ausgenommenen Kanal auf', async () => {
    await konfiguriere({ ignoredChannelIds: ['700000000000000001'] });

    await expect(analytics.recordEvent(NACHRICHT_GELOESCHT)).resolves.toBeNull();
  });

  it('trennt strikt nach Server', async () => {
    await konfiguriere();
    await analytics.recordEvent(NACHRICHT_GELOESCHT);
    await analytics.recordEvent({ ...NACHRICHT_GELOESCHT, guildId: FREMDE_GUILD });

    const eigene = await analytics.timeline({ guildId: GUILD, mitInhalten: true });
    expect(eigene.zeilen).toHaveLength(1);
    expect(eigene.zeilen[0]?.guildId).toBe(GUILD);
  });

  it('liefert keine Inhalte an jemanden, der sie nicht sehen darf', async () => {
    await konfiguriere();
    await analytics.recordEvent(NACHRICHT_GELOESCHT);

    const ohne = await analytics.timeline({ guildId: GUILD, mitInhalten: false });
    const mit = await analytics.timeline({ guildId: GUILD, mitInhalten: true });

    expect('contentBefore' in (ohne.zeilen[0] ?? {})).toBe(false);
    expect((mit.zeilen[0] as { contentBefore?: string }).contentBefore).toBe('Das hier war der Text');
  });

  it('durchsucht Nachrichtentexte nur für die, die sie lesen dürfen', async () => {
    await konfiguriere();
    await analytics.recordEvent(NACHRICHT_GELOESCHT);

    const ohne = await analytics.timeline({ guildId: GUILD, suche: 'Text', mitInhalten: false });
    const mit = await analytics.timeline({ guildId: GUILD, suche: 'Text', mitInhalten: true });

    // Sonst liesse sich über Treffer/kein-Treffer erschliessen, was in einer
    // Nachricht stand, die der Suchende gar nicht lesen darf.
    expect(ohne.zeilen).toHaveLength(0);
    expect(mit.zeilen).toHaveLength(1);
  });

  it('findet über Namen und Kanal auch ohne Inhaltsberechtigung', async () => {
    await konfiguriere();
    await analytics.recordEvent(NACHRICHT_GELOESCHT);

    const treffer = await analytics.timeline({ guildId: GUILD, suche: 'allgemein', mitInhalten: false });
    expect(treffer.zeilen).toHaveLength(1);
  });

  it('blättert über einen Cursor ohne Lücken und ohne Dopplungen', async () => {
    await konfiguriere();
    for (let index = 0; index < 5; index += 1) {
      await analytics.recordEvent({
        ...NACHRICHT_GELOESCHT,
        messageId: `80000000000000000${index}`,
        occurredAt: new Date(Date.now() - index * 1000),
      });
    }

    const erste = await analytics.timeline({ guildId: GUILD, pageSize: 2 });
    const zweite = await analytics.timeline({
      guildId: GUILD,
      pageSize: 2,
      cursor: erste.naechsterCursor ?? undefined,
    });
    const dritte = await analytics.timeline({
      guildId: GUILD,
      pageSize: 2,
      cursor: zweite.naechsterCursor ?? undefined,
    });

    const gesehen = [...erste.zeilen, ...zweite.zeilen, ...dritte.zeilen].map((zeile) => zeile.id);
    expect(new Set(gesehen).size).toBe(5);
    expect(dritte.naechsterCursor).toBeNull();
  });

  it('merkt sich den Nachrichtentext, damit die Löschung ihn noch kennt', async () => {
    await konfiguriere();

    await analytics.rememberMessage({
      messageId: '800000000000000009',
      guildId: GUILD,
      channelId: '700000000000000001',
      authorDiscordId: ANNA,
      authorUsername: 'manuel',
      content: 'Bitte nicht löschen',
      postedAt: new Date(),
    });

    const stand = await analytics.recallMessage('800000000000000009');
    expect(stand?.content).toBe('Bitte nicht löschen');

    await analytics.forgetMessage('800000000000000009');
    expect(await analytics.recallMessage('800000000000000009')).toBeNull();
  });

  it('merkt sich nichts, wenn Inhalte nicht gespeichert werden sollen', async () => {
    await konfiguriere({ storeMessageContent: false });

    await analytics.rememberMessage({
      messageId: '800000000000000009',
      guildId: GUILD,
      channelId: '700000000000000001',
      authorDiscordId: ANNA,
      authorUsername: 'manuel',
      content: 'Bitte nicht löschen',
      postedAt: new Date(),
    });

    expect(await analytics.recallMessage('800000000000000009')).toBeNull();
  });

  it('verknüpft ein Discord-Ereignis mit der Massnahme, die es ausgelöst hat', async () => {
    await konfiguriere();

    const massnahme = await prisma.moderationAction.create({
      data: {
        type: 'BAN',
        module: 'moderation',
        actorDiscordId: NINA,
        actorUsername: 'nina.mod',
        targetDiscordId: ANNA,
        targetUsername: 'manuel',
        reason: 'Werbung im Chat',
        status: 'COMPLETED',
      },
    });

    const ereignis = await analytics.recordEvent({
      guildId: GUILD,
      category: 'MEMBER',
      type: analytics.EVENT_TYPES.MEMBER_BAN,
      subjectDiscordId: ANNA,
      subjectUsername: 'manuel',
    });

    const frisch = await prisma.discordEvent.findUniqueOrThrow({ where: { id: ereignis?.id ?? '' } });
    // Beide Zeilen bleiben - sie beantworten verschiedene Fragen. Die
    // Verknüpfung sagt der Zeitleiste nur, dass es ein Geschehen war.
    expect(frisch.moderationActionId).toBe(massnahme.id);
    expect(frisch.actorSource).toBe('WEBAPP');
    expect(frisch.actorDiscordId).toBe(NINA);
    expect(await prisma.moderationAction.count()).toBe(1);
  });

  it('verknüpft nichts, wenn keine passende Massnahme vorliegt', async () => {
    await konfiguriere();

    const ereignis = await analytics.recordEvent({
      guildId: GUILD,
      category: 'MEMBER',
      type: analytics.EVENT_TYPES.MEMBER_BAN,
      subjectDiscordId: ANNA,
      subjectUsername: 'manuel',
    });

    // Ein Bann ohne Massnahme im Dashboard: jemand hat direkt in Discord
    // gehandelt. Genau das soll sichtbar bleiben.
    expect(ereignis?.moderationActionId).toBeNull();
    expect(ereignis?.actorSource).toBe('UNKNOWN');
  });

  it('löscht, was älter ist als die Aufbewahrungsfrist', async () => {
    await konfiguriere({ retentionDays: 7 });

    await analytics.recordEvent({
      ...NACHRICHT_GELOESCHT,
      occurredAt: new Date(Date.now() - 30 * 86_400_000),
    });
    const bleibt = await analytics.recordEvent({ ...NACHRICHT_GELOESCHT, messageId: '800000000000000002' });

    const ergebnis = await analytics.enforceRetention(GUILD);

    expect(ergebnis.ereignisse).toBe(1);
    const uebrig = await prisma.discordEvent.findMany();
    expect(uebrig.map((zeile) => zeile.id)).toEqual([bleibt?.id]);
  });

  it('rührt die Daten eines anderen Servers beim Aufräumen nicht an', async () => {
    await konfiguriere({ retentionDays: 7 });
    const alt = new Date(Date.now() - 30 * 86_400_000);

    await analytics.recordEvent({ ...NACHRICHT_GELOESCHT, occurredAt: alt });
    await analytics.recordEvent({ ...NACHRICHT_GELOESCHT, guildId: FREMDE_GUILD, occurredAt: alt });

    await analytics.enforceRetention(GUILD);

    const uebrig = await prisma.discordEvent.findMany();
    expect(uebrig.map((zeile) => zeile.guildId)).toEqual([FREMDE_GUILD]);
  });

  it('zählt die Kennzahlen je Server getrennt', async () => {
    await konfiguriere();
    await analytics.recordEvent(NACHRICHT_GELOESCHT);
    await analytics.recordEvent({ ...NACHRICHT_GELOESCHT, guildId: FREMDE_GUILD });

    const kennzahlen = await analytics.analyticsStats(GUILD);
    expect(kennzahlen.gesamt).toBe(1);
    expect(kennzahlen.heute).toBe(1);
    expect(kennzahlen.proKategorie).toEqual([{ category: 'MESSAGE', anzahl: 1 }]);
  });
});
