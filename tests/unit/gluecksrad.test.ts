import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { raffle } from '@swisshub/modules/level';

const { raffleSchema, drawWeighted, secureRandom } = raffle;
type RandomSource = raffle.RandomSource;

/**
 * Das Glücksrad: wer zieht, und wie lange es dauert.
 *
 * Zwei Dinge waren durcheinandergeraten. Erstens verlangte das Formular
 * Zeitpunkte auch dann, wenn die Ziehung von Hand gestartet wird - dabei
 * braucht sie die niemand, der selbst vor dem Rad steht. Umgekehrt liess es
 * eine automatische Verlosung ohne Zeitpunkt zu, und die zog dann nie.
 *
 * Zweitens war die Drehung so kurz, dass sie vorbei war, ehe jemand
 * hingeschaut hatte. Das ist eine reine Darstellungsfrage - der Gewinner
 * steht in der Datenbank, bevor sich das Rad überhaupt bewegt. Genau das
 * hält der zweite Teil dieser Datei fest.
 */

const BASIS = {
  title: 'Wochenverlosung',
  prizeKind: 'TEXT_ONLY' as const,
  prizeDescription: 'Ein Platz auf dem Server-Event',
  entryModel: 'FIXED' as const,
  fixedEntryXp: 100,
};

const pruefe = (eingabe: Record<string, unknown>) => raffleSchema.safeParse({ ...BASIS, ...eingabe });

const fehlerPfade = (ergebnis: ReturnType<typeof pruefe>): string[] =>
  ergebnis.success ? [] : ergebnis.error.issues.map((problem) => problem.path.join('.'));

describe('Verlosung von Hand', () => {
  it('kommt ganz ohne Zeitpunkte aus', () => {
    const ergebnis = pruefe({ autoDraw: false });

    expect(ergebnis.success).toBe(true);
    if (ergebnis.success) {
      expect(ergebnis.data.entryEndsAt).toBeNull();
      expect(ergebnis.data.drawScheduledAt).toBeNull();
    }
  });

  it('verlangt kein Ende der Teilnahme', () => {
    expect(fehlerPfade(pruefe({ autoDraw: false, entryEndsAt: '' }))).not.toContain('entryEndsAt');
  });

  it('verlangt keinen Zeitpunkt für die Auslosung', () => {
    expect(fehlerPfade(pruefe({ autoDraw: false, drawScheduledAt: '' }))).not.toContain('drawScheduledAt');
  });

  it('nimmt einen Beginn der Teilnahme trotzdem entgegen', () => {
    // Der Beginn war nie an die Automatik gebunden - wer die Teilnahme erst
    // später öffnen will, kann das auch bei einer Ziehung von Hand.
    const ergebnis = pruefe({ autoDraw: false, entryStartsAt: '2026-01-01T18:00:00.000Z' });

    expect(ergebnis.success).toBe(true);
    if (ergebnis.success) {
      expect(ergebnis.data.entryStartsAt?.toISOString()).toBe('2026-01-01T18:00:00.000Z');
    }
  });
});

describe('Automatische Verlosung', () => {
  it('verlangt einen Zeitpunkt für die Auslosung', () => {
    // Das war der stille Fehlschlag: gespeichert wurde sie, gezogen nie.
    const ergebnis = pruefe({ autoDraw: true });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('drawScheduledAt');
  });

  it('verlangt kein Ende der Teilnahme', () => {
    // Zulässige Mischform: die Teilnahme wird von Hand geschlossen, gezogen
    // wird danach selbsttätig.
    const ergebnis = pruefe({ autoDraw: true, drawScheduledAt: '2026-02-01T20:00:00.000Z' });

    expect(ergebnis.success).toBe(true);
  });

  it('geht mit beiden Zeitpunkten durch', () => {
    const ergebnis = pruefe({
      autoDraw: true,
      entryEndsAt: '2026-02-01T19:00:00.000Z',
      drawScheduledAt: '2026-02-01T20:00:00.000Z',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('weist eine Auslosung vor dem Ende der Teilnahme ab', () => {
    // Sie fände zu dieser Zeit gar nicht statt: gezogen wird erst, wenn die
    // Teilnahme geschlossen ist.
    const ergebnis = pruefe({
      autoDraw: true,
      entryEndsAt: '2026-02-01T20:00:00.000Z',
      drawScheduledAt: '2026-02-01T19:00:00.000Z',
    });

    expect(fehlerPfade(ergebnis)).toContain('drawScheduledAt');
  });
});

describe('Der Gewinner entsteht auf dem Server', () => {
  const quelle = (wert: number): RandomSource => ({
    integer: () => wert,
    hex: (bytes: number) => 'b'.repeat(bytes * 2),
  });

  const teilnahmen = [
    { entryId: 'a', discordId: '1', weight: 1 },
    { entryId: 'b', discordId: '2', weight: 1 },
    { entryId: 'c', discordId: '3', weight: 1 },
  ];

  it('bestimmt ihn aus der Zufallsquelle des Servers', () => {
    expect(drawWeighted(teilnahmen, quelle(0))?.winner.entryId).toBe('a');
    expect(drawWeighted(teilnahmen, quelle(2))?.winner.entryId).toBe('c');
  });

  it('legt den Startwert der Drehung ebenfalls auf dem Server fest', () => {
    // Der Browser würfelt nicht: er bekommt Gewinner und Startwert und
    // rechnet daraus dieselbe Drehung wie jedes andere Gerät.
    const quelltext = readFileSync(
      fileURLToPath(new URL('../../packages/modules/src/level/raffle/draw.ts', import.meta.url)),
      'utf8',
    );

    expect(quelltext).toContain('animationSeed: random.hex(8)');
    expect(secureRandom.hex(8)).toMatch(/^[0-9a-f]{16}$/u);
  });
});

describe('Das Rad zeigt nur, was feststeht', () => {
  const quelle = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/modules/level/components/raffle-wheel.tsx', import.meta.url)),
    'utf8',
  );

  it('würfelt im Browser nicht', () => {
    expect(quelle).not.toMatch(/Math\.random/u);
    expect(quelle).not.toMatch(/crypto\.getRandomValues/u);
  });

  it('dreht auf das Segment, das den Gewinner enthält', () => {
    expect(quelle).toContain('segment.containsEntryIds.includes(winnerEntryId)');
    expect(quelle).toContain('const middle = round((winnerSegment.startAngle + winnerSegment.endAngle) / 2)');
    expect(quelle).toContain('const target = extraTurns * 360 + (360 - middle);');
  });

  it('dreht deutlich länger als die früheren sechs Sekunden', () => {
    const dauer = /const DREHDAUER_MS = ([\d_]+);/u.exec(quelle)?.[1]?.replace(/_/gu, '');

    expect(dauer).toBeDefined();
    expect(Number(dauer)).toBeGreaterThanOrEqual(10_000);
  });

  it('verwendet dieselbe Dauer für Übergang und Auswertung', () => {
    // Zwei getrennte Zahlen liefen früher auseinander: das Rad stand still,
    // während der Name noch fehlte, oder er stand da, bevor es stillstand.
    expect(quelle).toContain("transition: animate ? `transform ${DREHDAUER_MS}ms ${DREH_KURVE}` : 'none'");
    expect(quelle).toContain('}, DREHDAUER_MS + NACHLAUF_MS);');
  });

  it('dreht mindestens acht volle Umdrehungen', () => {
    expect(quelle).toContain('const MIN_UMDREHUNGEN = 8;');
    expect(quelle).toContain('const extraTurns = MIN_UMDREHUNGEN + (seedNumber % 5);');
  });

  it('lässt das Rad langsam auslaufen statt gleichmässig zu drehen', () => {
    expect(quelle).toMatch(/const DREH_KURVE = 'cubic-bezier\(/u);
    expect(quelle).not.toContain('transition: animate ? `transform ${DREHDAUER_MS}ms linear`');
  });

  it('zeigt das Ergebnis ohne Drehung, wenn Bewegung abbestellt wurde', () => {
    expect(quelle).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)')");
    expect(quelle).toContain('if (reducedMotion || !spinning) {');
    // Ohne Bewegung landet das Rad direkt auf dem Gewinner, und der Aufrufer
    // erfährt sofort, dass die Ziehung vorbei ist.
    expect(quelle).toContain('setAnimate(false);');
    expect(quelle).toContain('setRotation(360 - middle);');
  });

  it('hört auf Änderungen der Systemeinstellung', () => {
    expect(quelle).toContain("query.addEventListener('change', listener)");
    expect(quelle).toContain("query.removeEventListener('change', listener)");
  });
});

describe('Das Formular verlangt nur, was die Prüfung verlangt', () => {
  const quelle = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/modules/level/components/raffle-form.tsx', import.meta.url)),
    'utf8',
  );

  it('zeigt das Feld für die Auslosung nur bei automatischer Ziehung', () => {
    expect(quelle).toContain('{values.autoDraw ? (');
    expect(quelle).toContain('<Label htmlFor="drawScheduledAt">Auslosung</Label>');
  });

  it('lässt das Ende der Teilnahme unabhängig davon offen', () => {
    const feld = quelle.slice(quelle.indexOf('id="entryEndsAt"'), quelle.indexOf('id="entryEndsAt"') + 400);

    expect(feld).not.toContain('required');
  });

  it('beschriftet den Schalter in der Richtung, in die er schaltet', () => {
    // Umgekehrt beschriftet hiess «ein» für den Lesenden das Gegenteil von
    // dem, was `autoDraw` bedeutet - und man stellte genau das Falsche ein.
    expect(quelle).toContain('Auslosung automatisch starten');
    expect(quelle).not.toContain('Auslosung selbst starten');
  });
});
