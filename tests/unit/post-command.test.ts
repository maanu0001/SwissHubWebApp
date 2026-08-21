import { describe, expect, it } from 'vitest';
import { datumFelder } from '../../apps/bot/src/commands/communication-commands';

/**
 * `/post` - das Verhalten des Vorgängers.
 *
 * Das Discord-Modal kennt keinen Datumsauswähler; der alte Bot übernahm die
 * Eingabe unverändert ("wird nöd validiert"). Wo sich ein echtes Datum lesen
 * lässt, wird daraus ein Discord-Zeitstempel - dann sieht jedes Mitglied
 * seine eigene lokale Zeit. Wo nicht, bleibt der Text stehen. Lieber die
 * Angabe der Person als eine falsch geratene Zeit.
 */
describe('Datumsangabe aus dem Modal', () => {
  it('liest die Schreibweise aus dem Platzhalter des Vorgängers', () => {
    const result = datumFelder('01.01.2026 18:00 Uhr');
    expect(result.startsAt).toBeDefined();
    expect(result.startsAtText).toBeUndefined();
    // 1. Januar ist Winterzeit: Europe/Zurich liegt eine Stunde vor UTC.
    expect(result.startsAt).toBe('2026-01-01T17:00:00.000Z');
  });

  it('berücksichtigt die Sommerzeit', () => {
    // Im August liegt Europe/Zurich zwei Stunden vor UTC.
    const result = datumFelder('22.08.2026 20:00');
    expect(result.startsAt).toBe('2026-08-22T18:00:00.000Z');
  });

  it('nimmt einstellige Angaben an', () => {
    expect(datumFelder('1.9.2026 8:05').startsAt).toBe('2026-09-01T06:05:00.000Z');
  });

  it('übernimmt unklare Angaben unverändert als Text', () => {
    for (const eingabe of ['nächste Woche', 'Samstag am Abend', 'irgendwann im Sommer', '2026-09-01']) {
      const result = datumFelder(eingabe);
      expect(result.startsAt).toBeUndefined();
      expect(result.startsAtText).toBe(eingabe);
    }
  });

  it('erfindet aus einem unmöglichen Datum keine Zeit', () => {
    // `Date.UTC` rollt still weiter: aus dem 32. Januar würde der 1. Februar,
    // aus dem 31. April der 1. Mai. Wer sich vertippt, soll den eigenen Text
    // im Kanal sehen und nicht ein stillschweigend verschobenes Datum.
    for (const eingabe of ['32.01.2026 18:00', '31.04.2026 10:00', '01.13.2026 10:00', '01.01.2026 25:00']) {
      const result = datumFelder(eingabe);
      expect(result.startsAt).toBeUndefined();
      expect(result.startsAtText).toBe(eingabe);
    }
  });
});
