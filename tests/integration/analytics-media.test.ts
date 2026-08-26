import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_analytics_media');

/**
 * Das Medienarchiv.
 *
 * Vier Zusagen stehen im Modul, und hier wird jede davon geprüft: nichts liegt
 * öffentlich, der Pfad ist nicht erratbar, eine abgelaufene Datei ist weg, und
 * es gibt eine Obergrenze, die nicht still unterlaufen wird.
 */
process.env.SWISSHUB_UPLOAD_DIR = await mkdtemp(join(tmpdir(), 'swisshub-analytics-'));

const { prisma } = await import('@swisshub/database');
const { analytics, setModuleEnabled, setModuleSettings } = await import('@swisshub/modules');

const GUILD = '000000000000000001';
const FREMDE_GUILD = '000000000000000002';

/** Ein winziges gültiges PNG. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

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
      archiveMedia: true,
      mediaQuotaMb: 64,
      maxMediaFileMb: 1,
      ...teile,
    },
    'test',
  );
}

async function ereignis(guildId = GUILD): Promise<string> {
  const zeile = await analytics.recordEvent({
    guildId,
    category: 'MESSAGE',
    type: analytics.EVENT_TYPES.MESSAGE_DELETE,
    subjectDiscordId: '100000000000000001',
    messageId: `8${Date.now()}`,
  });
  if (!zeile) {
    throw new Error('Ereignis wurde nicht geschrieben');
  }
  return zeile.id;
}

describeWithDatabase('Analytics-Medienarchiv', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DiscordEvent","DiscordEventMedia","ModuleState" RESTART IDENTITY CASCADE',
    );
  });

  it('archiviert nichts, solange die Einstellung es nicht erlaubt', async () => {
    await konfiguriere({ archiveMedia: false });

    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'bild.png',
      mimeType: 'image/png',
      bytes: PNG,
    });

    expect(ergebnis).toEqual({ gespeichert: false, grund: 'AUS' });
  });

  it('speichert unter einem selbst erzeugten Namen, nicht unter dem von Discord', async () => {
    await konfiguriere();

    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'urlaubsfoto.png',
      mimeType: 'image/png',
      bytes: PNG,
    });

    expect(ergebnis.gespeichert).toBe(true);
    if (!ergebnis.gespeichert) {
      return;
    }
    // Der Speichername ist Zufall - wer eine Kennung kennt, kennt damit noch
    // keine zweite.
    expect(ergebnis.media.storageKey).not.toContain('urlaubsfoto');
    expect(ergebnis.media.storageKey).toMatch(/^[0-9a-f]{48}\.png$/u);
    // Der ursprüngliche Name bleibt als reine Anzeige erhalten.
    expect(ergebnis.media.displayName).toBe('urlaubsfoto.png');
  });

  it('nimmt einen Namen mit Pfadanteilen nur als Anzeige entgegen', async () => {
    await konfiguriere();

    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: '../../etc/passwd',
      mimeType: 'image/png',
      bytes: PNG,
    });

    expect(ergebnis.gespeichert).toBe(true);
    if (!ergebnis.gespeichert) {
      return;
    }
    expect(ergebnis.media.displayName).toBe('passwd');
    expect(ergebnis.media.storageKey).not.toContain('..');
  });

  it('entfernt Zeilenumbrüche aus dem Anzeigenamen', async () => {
    await konfiguriere();

    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      // Ein Umbruch im Namen wäre im Content-Disposition-Header eine zweite
      // Kopfzeile.
      displayName: 'bild.png"\r\nX-Boese: ja',
      mimeType: 'image/png',
      bytes: PNG,
    });

    expect(ergebnis.gespeichert).toBe(true);
    if (!ergebnis.gespeichert) {
      return;
    }
    expect(ergebnis.media.displayName).not.toMatch(/[\r\n"]/u);
  });

  it('lehnt einen Dateityp ab, der nicht auf der Positivliste steht', async () => {
    await konfiguriere();

    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'schad.exe',
      mimeType: 'application/x-msdownload',
      bytes: PNG,
    });

    expect(ergebnis).toEqual({ gespeichert: false, grund: 'TYP' });
  });

  it('lehnt eine zu grosse Datei ab', async () => {
    await konfiguriere({ maxMediaFileMb: 1 });

    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'gross.png',
      mimeType: 'image/png',
      bytes: new Uint8Array(2 * 1024 * 1024),
    });

    expect(ergebnis).toEqual({ gespeichert: false, grund: 'ZU_GROSS' });
  });

  it('archiviert nichts mehr, wenn die Speichergrenze erreicht ist - und löscht nichts Altes', async () => {
    // Die Aufbewahrungsfrist ist eine Zusage. Sie still zu unterlaufen, um
    // Platz für Neues zu schaffen, wäre ihr Gegenteil.
    await konfiguriere({ mediaQuotaMb: 64 });
    const eventId = await ereignis();

    // Ein bereits volles Archiv - als Eintrag gesetzt statt 64 MB zu
    // schreiben. Die Belegung errechnet sich ohnehin aus den Einträgen.
    const belegt = await prisma.discordEventMedia.create({
      data: {
        eventId,
        guildId: GUILD,
        storageKey: 'bereits-belegt.png',
        displayName: 'alt.png',
        mimeType: 'image/png',
        byteSize: 64 * 1024 * 1024 - 8,
        sha256: 'x'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const neu = await analytics.archiveAttachment({
      eventId,
      guildId: GUILD,
      displayName: 'neu.png',
      mimeType: 'image/png',
      bytes: PNG,
    });

    expect(neu).toEqual({ gespeichert: false, grund: 'QUOTA' });
    // Und die alte Datei ist noch da: die Grenze verdrängt nichts.
    const alte = await prisma.discordEventMedia.findUniqueOrThrow({ where: { id: belegt.id } });
    expect(alte.deletedAt).toBeNull();
    expect(await prisma.discordEventMedia.count({ where: { deletedAt: null } })).toBe(1);
  });

  it('gibt eine Datei nur für den eigenen Server heraus', async () => {
    await konfiguriere();
    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'bild.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    if (!ergebnis.gespeichert) {
      throw new Error('Datei wurde nicht gespeichert');
    }

    await expect(analytics.readArchivedMedia(GUILD, ergebnis.media.id)).resolves.not.toBeNull();
    await expect(analytics.readArchivedMedia(FREMDE_GUILD, ergebnis.media.id)).resolves.toBeNull();
  });

  it('gibt eine abgelaufene Datei nicht mehr heraus', async () => {
    await konfiguriere();
    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'bild.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    if (!ergebnis.gespeichert) {
      throw new Error('Datei wurde nicht gespeichert');
    }

    await prisma.discordEventMedia.update({
      where: { id: ergebnis.media.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Die Bytes liegen noch auf dem Datenträger - herausgegeben werden sie
    // trotzdem nicht. Sonst wäre die Frist eine Absichtserklärung.
    await expect(analytics.readArchivedMedia(GUILD, ergebnis.media.id)).resolves.toBeNull();
  });

  it('löscht abgelaufene Dateien und lässt den Eintrag als Spur stehen', async () => {
    await konfiguriere();
    const ergebnis = await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'bild.png',
      mimeType: 'image/png',
      bytes: PNG,
    });
    if (!ergebnis.gespeichert) {
      throw new Error('Datei wurde nicht gespeichert');
    }
    await prisma.discordEventMedia.update({
      where: { id: ergebnis.media.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const aufgeraeumt = await analytics.enforceRetention(GUILD);
    expect(aufgeraeumt.medien).toBe(1);

    const eintrag = await prisma.discordEventMedia.findUniqueOrThrow({
      where: { id: ergebnis.media.id },
    });
    // «Hier gab es eine Datei» bleibt eine Auskunft - die Datei selbst ist weg.
    expect(eintrag.deletedAt).not.toBeNull();
    await expect(analytics.readArchivedMedia(GUILD, ergebnis.media.id)).resolves.toBeNull();
  });

  it('zählt die Belegung je Server getrennt', async () => {
    await konfiguriere();
    await analytics.archiveAttachment({
      eventId: await ereignis(),
      guildId: GUILD,
      displayName: 'bild.png',
      mimeType: 'image/png',
      bytes: PNG,
    });

    expect(await analytics.medienBelegung(GUILD)).toBe(PNG.byteLength);
    expect(await analytics.medienBelegung(FREMDE_GUILD)).toBe(0);
  });
});
