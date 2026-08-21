import { describe, expect, it } from 'vitest';
import { raffle } from '@swisshub/modules/level';

const { drawWeighted, secureRandom } = raffle;
type WeightedTicket = raffle.WeightedTicket;
type RandomSource = raffle.RandomSource;

/**
 * Die Ziehung.
 *
 * Getestet wird mit einer vorgegebenen Zufallsquelle, damit sich das Ergebnis
 * nachrechnen lässt. Im Betrieb kommt der Zufall aus `crypto` - ein Test, der
 * echten Zufall auswertet, würde sonst gelegentlich grundlos fehlschlagen.
 */
const fixedRandom = (value: number): RandomSource => ({
  integer: () => value,
  hex: (bytes: number) => 'a'.repeat(bytes * 2),
});

const ticket = (id: string, weight: number): WeightedTicket => ({
  entryId: id,
  discordId: `disc-${id}`,
  weight,
});

describe('Gewichtete Ziehung', () => {
  const tickets = [ticket('a', 1000), ticket('b', 500), ticket('c', 500)];

  it('trifft anhand des gezogenen Punktes den richtigen Bereich', () => {
    // Achse: a belegt 0-999, b 1000-1499, c 1500-1999.
    expect(drawWeighted(tickets, fixedRandom(0))?.winner.entryId).toBe('a');
    expect(drawWeighted(tickets, fixedRandom(999))?.winner.entryId).toBe('a');
    expect(drawWeighted(tickets, fixedRandom(1000))?.winner.entryId).toBe('b');
    expect(drawWeighted(tickets, fixedRandom(1499))?.winner.entryId).toBe('b');
    expect(drawWeighted(tickets, fixedRandom(1500))?.winner.entryId).toBe('c');
    expect(drawWeighted(tickets, fixedRandom(1999))?.winner.entryId).toBe('c');
  });

  it('meldet die Gesamtsumme der Gewichte', () => {
    expect(drawWeighted(tickets, fixedRandom(0))?.totalWeight).toBe(2000);
  });

  it('zieht niemanden, wenn niemand teilnimmt', () => {
    expect(drawWeighted([], fixedRandom(0))).toBeNull();
  });

  it('übergeht Teilnahmen ohne Gewicht', () => {
    const withZero = [ticket('leer', 0), ticket('echt', 10)];
    expect(drawWeighted(withZero, fixedRandom(0))?.winner.entryId).toBe('echt');
  });

  it('zieht bei einer einzigen Teilnahme genau diese', () => {
    expect(drawWeighted([ticket('allein', 7)], secureRandom)?.winner.entryId).toBe('allein');
  });
});

describe('Verteilung', () => {
  it('folgt beim Festbetrag der Gleichverteilung', () => {
    // Jede Teilnahme wiegt 1, also entscheidet allein der gezogene Punkt.
    const gleich = ['a', 'b', 'c', 'd'].map((id) => ticket(id, 1));
    const gewinner = [0, 1, 2, 3].map((punkt) => drawWeighted(gleich, fixedRandom(punkt))?.winner.entryId);
    expect(gewinner).toEqual(['a', 'b', 'c', 'd']);
  });

  it('folgt beim Anteilsmodell dem Einsatz', () => {
    // Bei doppeltem Einsatz gehört einem die doppelte Strecke auf der Achse.
    const gewichtet = [ticket('gross', 2), ticket('klein', 1)];
    const treffer = [0, 1, 2].map((punkt) => drawWeighted(gewichtet, fixedRandom(punkt))?.winner.entryId);
    expect(treffer).toEqual(['gross', 'gross', 'klein']);
  });

  it('bleibt über viele echte Ziehungen im erwarteten Rahmen', () => {
    // Kein Test auf einen exakten Wert - geprüft wird nur, dass die
    // sichere Quelle nicht auffällig einseitig zieht.
    const gewichtet = [ticket('drei-viertel', 750), ticket('ein-viertel', 250)];
    const runden = 4000;
    let gross = 0;
    for (let index = 0; index < runden; index += 1) {
      if (drawWeighted(gewichtet, secureRandom)?.winner.entryId === 'drei-viertel') {
        gross += 1;
      }
    }
    const anteil = gross / runden;
    expect(anteil).toBeGreaterThan(0.7);
    expect(anteil).toBeLessThan(0.8);
  });

  it('bleibt innerhalb der Gewichtsachse', () => {
    const gewichtet = [ticket('a', 3), ticket('b', 5)];
    for (let index = 0; index < 500; index += 1) {
      const selection = drawWeighted(gewichtet, secureRandom);
      expect(selection).not.toBeNull();
      expect(selection!.ticket).toBeGreaterThanOrEqual(0);
      expect(selection!.ticket).toBeLessThan(8);
    }
  });
});
