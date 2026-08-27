import { describe, expect, it } from 'vitest';

/**
 * Der Kalenderexport.
 *
 * Geprüft wird gegen den Standard, nicht gegen die eigene Erwartung: eine
 * Datei, die nur der eigene Leser versteht, nützt niemandem - sie soll sich in
 * Apple Kalender, Outlook und Google öffnen lassen.
 */
const { calendar } = await import('@swisshub/modules');

const basisEvent = {
  id: 'evt_abc123',
  slug: 'community-gaming-night',
  title: 'Community Gaming Night',
  description: 'Wir zocken zusammen; mit Pizza, Pause und allem.',
  shortDescription: null,
  startAt: new Date('2026-09-04T18:00:00.000Z'),
  endAt: new Date('2026-09-04T22:00:00.000Z'),
  timezone: 'Europe/Zurich',
  allDay: false,
  status: 'SCHEDULED',
  locationKind: 'DISCORD',
  locationChannelId: null,
  locationVoiceId: null,
  locationUrl: null,
  locationName: null,
  locationAddress: null,
  cancelReason: null,
  bannerUrl: null,
  iconUrl: null,
  categoryId: null,
  updatedAt: new Date('2026-08-01T10:00:00.000Z'),
} as unknown as Parameters<typeof calendar.buildIcs>[0];

const bauen = (overrides: Record<string, unknown> = {}) =>
  calendar.buildIcs({ ...basisEvent, ...overrides } as typeof basisEvent, {
    defaultDurationMinutes: 120,
  });

describe('ICS-Export', () => {
  it('liefert ein vollständiges VCALENDAR', () => {
    const ics = bauen();
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('trennt Zeilen mit CRLF, wie der Standard verlangt', () => {
    // Nur `\n` lehnen manche Leser ab - Outlook zum Beispiel.
    const ics = bauen();
    const nurLf = ics.split('\r\n').join('').includes('\n');
    expect(nurLf).toBe(false);
  });

  it('schreibt Zeiten als UTC', () => {
    // Die eine Schreibweise, die ohne mitgelieferte Zonendefinition überall
    // dasselbe bedeutet.
    const ics = bauen();
    expect(ics).toContain('DTSTART:20260904T180000Z');
    expect(ics).toContain('DTEND:20260904T220000Z');
  });

  it('setzt bei fehlender Endzeit die Vorgabedauer ein', () => {
    const ics = bauen({ endAt: null });
    // 18:00 + 120 Minuten.
    expect(ics).toContain('DTEND:20260904T200000Z');
  });

  it('behandelt ein ganztägiges Event als Datum', () => {
    const ics = bauen({ allDay: true });
    expect(ics).toContain('DTSTART;VALUE=DATE:20260904');
    // DTEND ist bei Datumsangaben ausschliessend - der Folgetag.
    expect(ics).toContain('DTEND;VALUE=DATE:20260905');
  });

  it('entschärft Sonderzeichen', () => {
    // Ein unmaskiertes Semikolon oder Komma zerlegt die Eigenschaft.
    const ics = bauen({ title: 'Abend; mit Komma, und \\ Schrägstrich' });
    expect(ics).toContain('SUMMARY:Abend\\; mit Komma\\, und \\\\ Schr');
  });

  it('macht aus Zeilenumbrüchen kein zerbrochenes Feld', () => {
    const ics = bauen({ description: 'Erste Zeile\nZweite Zeile' });
    expect(ics).toContain('\\nZweite Zeile');
    // Der Umbruch darf nicht als echter Zeilenwechsel dastehen.
    expect(ics).not.toContain('Erste Zeile\r\nZweite');
  });

  it('faltet lange Zeilen auf 75 Oktette', () => {
    const ics = bauen({ description: 'x'.repeat(400) });
    for (const zeile of ics.split('\r\n')) {
      expect(Buffer.from(zeile, 'utf8').length).toBeLessThanOrEqual(75);
    }
    // Fortsetzungszeilen beginnen mit einem Leerzeichen.
    expect(ics).toMatch(/\r\n x/u);
  });

  it('faltet auch mit Umlauten ohne ein Zeichen zu zerschneiden', () => {
    const ics = bauen({ description: 'ä'.repeat(200) });
    for (const zeile of ics.split('\r\n')) {
      expect(Buffer.from(zeile, 'utf8').length).toBeLessThanOrEqual(75);
    }
    // Zerschnittene Mehrbyte-Zeichen wären Ersatzzeichen.
    expect(ics).not.toContain('�');
  });

  it('führt ein abgesagtes Event als abgesagt', () => {
    // So verschwindet es im Kalender des Teilnehmers nicht still, sondern
    // wird als abgesagt gekennzeichnet.
    expect(bauen({ status: 'CANCELLED' })).toContain('STATUS:CANCELLED');
    expect(bauen()).toContain('STATUS:CONFIRMED');
  });

  it('behält dieselbe UID über Änderungen hinweg', () => {
    // Ein erneuter Import ersetzt den Termin, statt einen zweiten anzulegen.
    const a = bauen();
    const b = bauen({ title: 'Anderer Titel', startAt: new Date('2026-09-05T18:00:00.000Z') });
    const uid = (ics: string) => /UID:(.+)/u.exec(ics)?.[1];
    expect(uid(a)).toBe(uid(b));
    expect(uid(a)).toBe('evt_abc123@swisshub');
  });

  it('erhöht die Sequenz, wenn das Event bearbeitet wurde', () => {
    // Ohne steigende SEQUENCE ignorieren manche Kalender die Aktualisierung.
    const alt = bauen();
    const neu = bauen({ updatedAt: new Date('2026-08-02T10:00:00.000Z') });
    const seq = (ics: string) => Number(/SEQUENCE:(\d+)/u.exec(ics)?.[1]);
    expect(seq(neu)).toBeGreaterThan(seq(alt));
  });

  it('baut einen unbedenklichen Dateinamen', () => {
    expect(calendar.icsDateiname(basisEvent)).toBe('swisshub-community-gaming-night.ics');
  });
});
