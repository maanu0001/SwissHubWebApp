import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aufgeteilteDauerInSekunden, AUFGETEILTE_DAUER_MAX, formatDuration } from '@swisshub/shared';
import { jail } from '@swisshub/modules';

/**
 * Die Dauer, die nicht in der Liste steht.
 *
 * Die Vorgaben decken den Alltag ab - «30 Minuten», «1 Tag», «1 Woche». Was
 * sie nicht abdecken, ist der Einzelfall, und bisher musste dafür die
 * nächstbeste Vorgabe herhalten: wer zwei Tage und drei Stunden meinte,
 * jailte drei Tage.
 *
 * Zwei Dinge werden hier geprüft. Dass die Umrechnung stimmt - und dass sie
 * nur an einer Stelle steht: Maske und Dienst müssen dieselbe Antwort darauf
 * geben, wie lang «1 Tag 2 Stunden» ist.
 */

const dauer = (tage: number, stunden: number, minuten: number) => ({ tage, stunden, minuten });

describe('Individuelle Jail-Dauer: die Umrechnung', () => {
  it('rechnet Stunden und Minuten zusammen', () => {
    expect(aufgeteilteDauerInSekunden(dauer(0, 2, 30))).toBe(2 * 3600 + 30 * 60);
    expect(formatDuration(aufgeteilteDauerInSekunden(dauer(0, 2, 30)) * 1000)).toContain('2');
  });

  it('rechnet einen Tag und vier Stunden zu 28 Stunden', () => {
    expect(aufgeteilteDauerInSekunden(dauer(1, 4, 0))).toBe(28 * 3600);
  });

  it('rechnet drei Tage und fünfzehn Minuten', () => {
    expect(aufgeteilteDauerInSekunden(dauer(3, 0, 15))).toBe(3 * 24 * 3600 + 15 * 60);
  });

  it('kombiniert alle drei Felder', () => {
    expect(aufgeteilteDauerInSekunden(dauer(1, 2, 15))).toBe(24 * 3600 + 2 * 3600 + 15 * 60);
  });
});

describe('Individuelle Jail-Dauer: was der Server annimmt', () => {
  const pruefe = (wert: unknown) => jail.individuelleJailDauerSchema.safeParse(wert);

  it('nimmt eine gültige Kombination an', () => {
    expect(pruefe(dauer(1, 2, 15)).success).toBe(true);
  });

  it('weist null Tage, null Stunden, null Minuten ab', () => {
    // Nichts ist keine Massnahme.
    expect(pruefe(dauer(0, 0, 0)).success).toBe(false);
  });

  it('weist negative Werte ab', () => {
    expect(pruefe(dauer(-1, 0, 0)).success).toBe(false);
    expect(pruefe(dauer(0, -5, 0)).success).toBe(false);
    expect(pruefe(dauer(0, 0, -30)).success).toBe(false);
  });

  it('weist NaN und Unendlich ab', () => {
    expect(pruefe(dauer(Number.NaN, 0, 0)).success).toBe(false);
    expect(pruefe(dauer(0, Number.POSITIVE_INFINITY, 0)).success).toBe(false);
  });

  it('weist Stunden ausserhalb des eigenen Felds ab', () => {
    // 25 Stunden wären nicht falsch - sie wären ein Tag und eine Stunde. Zwei
    // Schreibweisen für dieselbe Dauer sind eine zu viel, und daneben steht
    // ein eigenes Feld für Tage.
    expect(pruefe(dauer(0, AUFGETEILTE_DAUER_MAX.stunden + 1, 0)).success).toBe(false);
    expect(pruefe(dauer(0, AUFGETEILTE_DAUER_MAX.stunden, 0)).success).toBe(true);
  });

  it('weist Minuten ausserhalb des eigenen Felds ab', () => {
    expect(pruefe(dauer(0, 0, AUFGETEILTE_DAUER_MAX.minuten + 1)).success).toBe(false);
    expect(pruefe(dauer(0, 0, AUFGETEILTE_DAUER_MAX.minuten)).success).toBe(true);
  });

  it('weist Bruchteile ab', () => {
    expect(pruefe(dauer(0, 1.5, 0)).success).toBe(false);
  });

  it('verlangt mindestens eine Minute', () => {
    expect(pruefe(dauer(0, 0, 1)).success).toBe(true);
  });
});

describe('Individuelle Jail-Dauer im Jail-Auftrag', () => {
  const basis = {
    targetDiscordId: '900000000000000123',
    reason: 'Provokation im Voice',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  };

  it('wird zu Sekunden - der Dienst rechnet weiterhin nur damit', () => {
    const ergebnis = jail.createJailSchema.safeParse({
      ...basis,
      type: 'TEMPORARY',
      dauer: dauer(1, 2, 15),
    });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.durationSeconds).toBe(24 * 3600 + 2 * 3600 + 15 * 60);
    // Die drei Felder sind eine Eingabeform und keine zweite Währung: was
    // weitergereicht wird, ist eine Sekundenzahl wie bei jeder Vorgabe.
    expect(ergebnis.success && 'dauer' in ergebnis.data).toBe(false);
  });

  it('lehnt eine leere individuelle Dauer ab, bevor sie zu Sekunden wird', () => {
    const ergebnis = jail.createJailSchema.safeParse({
      ...basis,
      type: 'TEMPORARY',
      dauer: dauer(0, 0, 0),
    });

    expect(ergebnis.success).toBe(false);
  });

  it('nimmt weiterhin eine vorgegebene Dauer an', () => {
    // Keine Regression: die Liste bleibt, «Individuell» kommt dazu.
    const ergebnis = jail.createJailSchema.safeParse({
      ...basis,
      type: 'TEMPORARY',
      durationSeconds: 3600,
    });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.durationSeconds).toBe(3600);
  });

  it('lehnt beides zugleich ab', () => {
    // Zweideutig - und «wir nehmen halt eines davon» ist keine Antwort.
    const ergebnis = jail.createJailSchema.safeParse({
      ...basis,
      type: 'TEMPORARY',
      durationSeconds: 3600,
      dauer: dauer(1, 0, 0),
    });

    expect(ergebnis.success).toBe(false);
  });

  it('verlangt weiterhin überhaupt eine Dauer', () => {
    expect(jail.createJailSchema.safeParse({ ...basis, type: 'TEMPORARY' }).success).toBe(false);
  });

  it('lässt einen permanenten Jail ohne Dauer durch', () => {
    const ergebnis = jail.createJailSchema.safeParse({ ...basis, type: 'PERMANENT' });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.durationSeconds).toBeNull();
  });

  it('kann die konfigurierte Höchstdauer nicht umgehen', () => {
    // «Individuell» ist eine Eingabeform und keine Ausnahme: die Obergrenze
    // prüft dieselbe Stelle wie bei jeder Vorgabe, gegen dieselbe
    // Einstellung.
    const lang = jail.createJailSchema.parse({
      ...basis,
      type: 'TEMPORARY',
      dauer: dauer(300, 0, 0),
    });

    expect(() => jail.assertDurationWithinLimit(lang.durationSeconds!, 7 * 24 * 3600)).toThrow();
    // Und innerhalb der Grenze bleibt es dabei.
    expect(() => jail.assertDurationWithinLimit(3600, 7 * 24 * 3600)).not.toThrow();
  });
});

describe('Die Maske im Moderations-Dialog', () => {
  const quelle = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/moderation/components/moderation-dialog.tsx'),
    'utf8',
  );

  it('behält alle bestehenden Vorgaben', () => {
    for (const label of ['30 Minuten', '1 Stunde', '6 Stunden', '1 Tag', '3 Tage', '1 Woche']) {
      expect(quelle, label).toContain(label);
    }
    expect(quelle).toContain('Permanent');
  });

  it('bietet «Individuell» zusätzlich an', () => {
    expect(quelle).toContain('<SelectItem value={JAIL_INDIVIDUELL}>Individuell</SelectItem>');
  });

  it('blendet dafür drei Felder ein', () => {
    expect(quelle).toContain('jailDauer === JAIL_INDIVIDUELL ?');
    for (const feld of ['Tage', 'Stunden', 'Minuten']) {
      expect(quelle, feld).toContain(`label: '${feld}'`);
    }
  });

  it('rechnet nicht selbst, sondern nimmt die gemeinsame Funktion', () => {
    // Eine zweite Rechnung hier wäre eine zweite Wahrheit darüber, wie lang
    // «1 Tag 2 Stunden» ist.
    expect(quelle).toContain('aufgeteilteDauerInSekunden(eigeneDauer)');
  });

  it('schickt die Eingabe, nicht das Ergebnis', () => {
    expect(quelle).toContain('dauer: eigeneDauer');
  });

  it('geht weiterhin über den zentralen Jail-Dienst', () => {
    // Kein eigener Einfügeweg: Policy, Rollen-Snapshot, Discord, Scheduler
    // und Akte liegen im Jail-Service.
    expect(quelle).toContain('createJailAction(');
  });
});
