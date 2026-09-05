import { describe, expect, it } from 'vitest';
import {
  APPEAL_FRAGEN,
  ENDZUSTAENDE,
  OFFENE_STATUS,
  STATUS_LABEL,
  STATUS_LABEL_ANTRAGSTELLER,
  baueSnapshot,
  darfZurueckziehen,
  entschaerfeDateiname,
  formatFallnummer,
  fuerAntragsteller,
  istAbgeschlossen,
  istOffen,
  moeglicheUebergaenge,
  snapshotFuerAntragsteller,
  uebergangErlaubt,
} from '@swisshub/modules/appeals';
import type { AppealStatus } from '@swisshub/database';

/**
 * Der Kern der Entbannungsanträge - alles, was ohne Datenbank prüfbar ist.
 *
 * Die Zusagen hier sind grösstenteils Zusagen darüber, was **nicht**
 * geschehen kann: kein Weg aus einem Endzustand zurück, keine interne Angabe
 * in einer Auskunft nach draussen, kein Sperrgrund im Klartext. Für jede
 * steht hier ein Test, der fehlschlägt, sobald sie bricht.
 */

const ALLE_STATUS: AppealStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'WAITING_FOR_APPLICANT',
  'WAITING_FOR_STAFF',
  'ESCALATED',
  'DECISION_PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'EXPIRED',
  'RESOLVED_EXTERNALLY',
  'CLOSED',
];

describe('Statusautomat', () => {
  it('kennt jeden Zustand', () => {
    for (const status of ALLE_STATUS) {
      expect(STATUS_LABEL[status], `${status} hat keine Beschriftung`).toBeTruthy();
      expect(moeglicheUebergaenge(status)).toBeDefined();
    }
  });

  it('erlaubt den gewöhnlichen Weg durch einen Fall', () => {
    expect(uebergangErlaubt('SUBMITTED', 'UNDER_REVIEW')).toBe(true);
    expect(uebergangErlaubt('UNDER_REVIEW', 'WAITING_FOR_APPLICANT')).toBe(true);
    expect(uebergangErlaubt('WAITING_FOR_APPLICANT', 'WAITING_FOR_STAFF')).toBe(true);
    expect(uebergangErlaubt('WAITING_FOR_STAFF', 'APPROVED')).toBe(true);
    expect(uebergangErlaubt('APPROVED', 'CLOSED')).toBe(true);
  });

  /**
   * Aus einem Endzustand führt kein Weg zurück.
   *
   * Der wichtigste Test dieser Datei. Ohne ihn liesse sich ein geschlossener
   * Fall wieder öffnen und ein zweites Mal entscheiden - und die erste
   * Entscheidung wäre dann eine Meinung gewesen.
   */
  it.each(ENDZUSTAENDE.filter((status) => status !== 'CLOSED'))(
    'lässt %s ausschliesslich nach CLOSED',
    (endzustand) => {
      expect(moeglicheUebergaenge(endzustand)).toEqual(['CLOSED']);
    },
  );

  it('lässt aus CLOSED gar nichts mehr zu', () => {
    expect(moeglicheUebergaenge('CLOSED')).toEqual([]);
  });

  it.each([
    ['APPROVED', 'REJECTED'],
    ['REJECTED', 'APPROVED'],
    ['CLOSED', 'UNDER_REVIEW'],
    ['WITHDRAWN', 'SUBMITTED'],
    ['EXPIRED', 'UNDER_REVIEW'],
    ['SUBMITTED', 'APPROVED'],
  ] as Array<[AppealStatus, AppealStatus]>)('weist %s -> %s ab', (von, nach) => {
    expect(uebergangErlaubt(von, nach)).toBe(false);
  });

  /**
   * Eine Entscheidung überschreibt keine andere.
   *
   * `SUBMITTED -> APPROVED` fehlt bewusst: erst wird geprüft, dann
   * entschieden. Ein Sprung darüber hinweg wäre eine Entscheidung ohne
   * Prüfung.
   */
  it('verlangt vor der Entscheidung eine Prüfung', () => {
    expect(uebergangErlaubt('SUBMITTED', 'APPROVED')).toBe(false);
    expect(uebergangErlaubt('SUBMITTED', 'REJECTED')).toBe(false);
    expect(uebergangErlaubt('UNDER_REVIEW', 'APPROVED')).toBe(true);
  });

  it('teilt die Zustände vollständig in offen und abgeschlossen', () => {
    for (const status of ALLE_STATUS) {
      if (status === 'DRAFT') {
        continue;
      }
      expect(
        istOffen(status) !== istAbgeschlossen(status),
        `${status} ist weder eindeutig offen noch abgeschlossen`,
      ).toBe(true);
    }
  });

  describe('Rückzug', () => {
    it.each(OFFENE_STATUS)('erlaubt den Rückzug aus %s', (status) => {
      expect(darfZurueckziehen(status)).toBe(true);
    });

    /**
     * Nach einer Entscheidung kein Rückzug.
     *
     * Sonst wäre er eine Möglichkeit, ein «Nein» aus der Akte verschwinden zu
     * lassen.
     */
    it.each(ENDZUSTAENDE)('verweigert den Rückzug aus %s', (status) => {
      expect(darfZurueckziehen(status)).toBe(false);
    });
  });
});

describe('Was der Antragsteller liest', () => {
  /**
   * Interne Einordnungen erreichen ihn nicht.
   *
   * «Eskaliert» sagt ihm nichts, ausser dass intern etwas vorgeht. Er liest
   * «Wird geprüft» - richtig und ohne Einblick.
   */
  it('übersetzt interne Zustände in verständliche', () => {
    expect(STATUS_LABEL_ANTRAGSTELLER.ESCALATED).toBe('Wird geprüft');
    expect(STATUS_LABEL_ANTRAGSTELLER.DECISION_PENDING).toBe('Wird geprüft');
    expect(STATUS_LABEL_ANTRAGSTELLER.ESCALATED).not.toBe(STATUS_LABEL.ESCALATED);
  });

  it('hat für jeden Zustand eine Beschriftung', () => {
    for (const status of ALLE_STATUS) {
      expect(STATUS_LABEL_ANTRAGSTELLER[status]).toBeTruthy();
    }
  });

  /**
   * Der Befund verliert alles Interne.
   *
   * `pruefeZulaessigkeit` liefert den Bann und den Moderationseintrag mit -
   * das Team braucht sie. `fuerAntragsteller` ist die eine Stelle, an der aus
   * dem internen Befund die äussere Auskunft wird, und sie reicht
   * ausdrücklich vier Felder weiter. Ein neues Feld am Befund landet damit
   * nicht versehentlich im Browser.
   */
  it('gibt vom Befund nur weiter, was hinausgehen darf', () => {
    const aussen = fuerAntragsteller({
      erlaubt: false,
      code: 'COOLDOWN',
      grund: 'Du kannst aktuell keinen weiteren Antrag stellen.',
      naechsteMoeglichkeitAm: new Date('2026-09-15T00:00:00Z'),
      bann: { discordId: '100000000000000001', reason: 'Interner Banngrund' },
      moderationsEintrag: {
        id: 'mod-1',
        reason: 'Wiederholter Regelverstoss, siehe Notiz',
        actorUsername: 'moderatorin',
      } as never,
    });

    const alsText = JSON.stringify(aussen);
    expect(alsText).not.toContain('Interner Banngrund');
    expect(alsText).not.toContain('Wiederholter Regelverstoss');
    expect(alsText).not.toContain('moderatorin');
    expect(alsText).not.toContain('COOLDOWN');
    expect(Object.keys(aussen).sort()).toEqual(['erlaubt', 'grund', 'naechsteMoeglichkeitAm']);
  });

  /**
   * Die Momentaufnahme geht nur zum Teil hinaus.
   *
   * Der Grund bei Discord ist ihm bekannt - er steht in der Bannmeldung. Was
   * SwissHub intern vermerkt hat, ist es nicht.
   */
  it('gibt von der Momentaufnahme nur den Discord-Grund weiter', () => {
    const snapshot = baueSnapshot(
      { discordId: '100000000000000001', reason: 'Spam im Allgemein-Kanal' },
      {
        id: 'mod-1',
        createdAt: new Date('2026-08-01T12:00:00Z'),
        reason: 'Dritter Verstoss - Notiz von Moderatorin X',
        actorDiscordId: '200000000000000002',
        actorUsername: 'moderatorin',
      } as never,
      new Date('2026-08-30T12:00:00Z'),
    );

    expect(snapshot.internerGrund).toBe('Dritter Verstoss - Notiz von Moderatorin X');
    expect(snapshot.moderatorUsername).toBe('moderatorin');

    const aussen = snapshotFuerAntragsteller(snapshot);
    const alsText = JSON.stringify(aussen);
    expect(alsText).toContain('Spam im Allgemein-Kanal');
    expect(alsText).not.toContain('Notiz von Moderatorin X');
    expect(alsText).not.toContain('moderatorin');
    expect(alsText).not.toContain('200000000000000002');
    expect(Object.keys(aussen).sort()).toEqual(['discordGrund', 'verhaengtAm']);
  });

  it('vermerkt die Quelle der Sanktion', () => {
    const vonSwissHub = baueSnapshot({ discordId: '1', reason: null }, {
      id: 'x',
      createdAt: new Date(),
    } as never);
    const vonDiscord = baueSnapshot({ discordId: '1', reason: null }, null);
    expect(vonSwissHub.quelle).toBe('swisshub');
    expect(vonDiscord.quelle).toBe('discord');
    // Ohne Moderationseintrag gibt es kein Datum - und keins wird erfunden.
    expect(vonDiscord.verhaengtAm).toBeNull();
  });
});

describe('Fallnummer', () => {
  it('formatiert lesbar und stabil', () => {
    expect(formatFallnummer(2026, 42)).toBe('A-2026-0042');
    expect(formatFallnummer(2026, 1)).toBe('A-2026-0001');
    expect(formatFallnummer(2026, 12_345)).toBe('A-2026-12345');
  });
});

describe('Fragen des Formulars', () => {
  /*
    Ein Feld, nicht fünf. Gemeint waren die fünf gut - sie führen jemanden
    durch das, was einen Antrag überzeugend macht. Davor stand aber eine
    Wand: wer gerade gebannt wurde, schreibt selten viermal dreissig Zeichen,
    und dieselbe Antwort landete am Ende in zwei Feldern, weil sie zu beiden
    passte.
  */

  it('stellt dem Antragsteller genau eine inhaltliche Frage', () => {
    expect(APPEAL_FRAGEN).toHaveLength(1);
  });

  it('macht sie zur Pflicht, mit sinnvollen Grenzen', () => {
    const frage = APPEAL_FRAGEN[0]!;

    expect(frage.pflicht).toBe(true);
    expect(frage.min).toBeGreaterThan(0);
    // Dreissig Zeichen sind etwa ein Satz - mehr zu verlangen hiesse, nach
    // Länge statt nach Inhalt zu urteilen.
    expect(frage.min).toBeLessThanOrEqual(50);
    // Das eine Feld trägt jetzt, was vorher auf vier verteilt war.
    expect(frage.max).toBeGreaterThanOrEqual(4000);
  });

  it('vergibt jeden Schlüssel genau einmal', () => {
    const schluessel = APPEAL_FRAGEN.map((frage) => frage.key);
    expect(new Set(schluessel).size).toBe(schluessel.length);
  });
});

describe('Dateinamen von Anhängen', () => {
  /**
   * Der Name kommt von jemandem, der gerade gebannt ist.
   *
   * Er wird nirgends zum Pfad - gespeichert wird unter einem Zufallsnamen.
   * Trotzdem steht er später in einer `Content-Disposition`-Kopfzeile, und
   * dort haben Anführungszeichen und Steuerzeichen nichts verloren.
   */
  it.each([
    ['../../etc/passwd', '.._.._etc_passwd'],
    ['bild".png', 'bild.png'],
    ['normal.png', 'normal.png'],
  ])('entschärft %s', (roh, erwartet) => {
    expect(entschaerfeDateiname(roh, 'png')).toBe(erwartet);
  });

  it('entfernt Steuerzeichen', () => {
    const mitSteuerzeichen = `beleg${String.fromCharCode(13)}${String.fromCharCode(10)}.pdf`;
    const sauber = entschaerfeDateiname(mitSteuerzeichen, 'pdf');
    expect(sauber).toBe('beleg.pdf');
    expect(sauber).not.toContain(String.fromCharCode(13));
  });

  it('fällt auf einen Vorgabenamen zurück, wenn nichts übrig bleibt', () => {
    expect(entschaerfeDateiname('///', 'pdf')).toBe('___');
    expect(entschaerfeDateiname('', 'pdf')).toBe('anhang.pdf');
  });
});
