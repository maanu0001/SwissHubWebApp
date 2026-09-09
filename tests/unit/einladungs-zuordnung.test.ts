import { describe, expect, it } from 'vitest';
import { invites } from '@swisshub/modules';
import type { GuildInvite } from '@swisshub/discord';

/**
 * Welche Einladung hat jemanden hereingebracht?
 *
 * Discord sagt es nicht - die einzige Auskunft ist ein Zaehler je Code. Der
 * Vergleich hier ist damit die ganze Aussage, und er hat genau eine Aufgabe,
 * die er nicht verfehlen darf: **nicht raten**. Ein falsch zugeordneter
 * Beitritt behauptet in einem Kanal, den das halbe Team liest, dass eine
 * bestimmte Person jemanden eingeladen hat.
 *
 * Deshalb wird hier vor allem geprueft, wann das Ergebnis «unbekannt» ist.
 */

const einladung = (code: string, uses: number, extra: Partial<GuildInvite> = {}): GuildInvite => ({
  code,
  channelId: '900000000000005001',
  channelName: 'willkommen',
  inviterDiscordId: '900000000000005099',
  inviterUsername: 'gastgeber',
  uses,
  maxUses: 0,
  expiresAt: null,
  createdAt: null,
  ...extra,
});

const gespiegelt = (
  code: string,
  uses: number,
  extra: { maxUses?: number; revokedAt?: Date | null } = {},
) => ({
  code,
  uses,
  inviterDiscordId: '900000000000005099',
  inviterUsername: 'gastgeber',
  maxUses: extra.maxUses ?? 0,
  revokedAt: extra.revokedAt ?? null,
});

describe('Einladung eines Beitritts bestimmen', () => {
  it('ordnet zu, wenn genau ein Zähler um genau eins gestiegen ist', () => {
    const ergebnis = invites.vergleiche(
      [gespiegelt('aaa', 4), gespiegelt('bbb', 9)],
      [einladung('aaa', 5), einladung('bbb', 9)],
    );

    expect(ergebnis.art).toBe('EINDEUTIG');
    expect(ergebnis.code).toBe('aaa');
    expect(ergebnis.uses).toBe(5);
    expect(invites.istBelegt(ergebnis)).toBe(true);
  });

  it('nennt den Ersteller der zugeordneten Einladung', () => {
    const ergebnis = invites.vergleiche(
      [gespiegelt('aaa', 0)],
      [einladung('aaa', 1, { inviterDiscordId: '900000000000005001', inviterUsername: 'munoha' })],
    );

    expect(ergebnis.inviterDiscordId).toBe('900000000000005001');
    expect(ergebnis.inviterUsername).toBe('munoha');
  });

  it('bleibt bei zwei gestiegenen Zählern unbekannt', () => {
    // Zwei Beitritte zwischen zwei Abgleichen. Einen davon auszuwählen wäre
    // eine Behauptung mit 50 Prozent Trefferquote.
    const ergebnis = invites.vergleiche(
      [gespiegelt('aaa', 4), gespiegelt('bbb', 9)],
      [einladung('aaa', 5), einladung('bbb', 10)],
    );

    expect(ergebnis.art).toBe('MEHRDEUTIG');
    expect(ergebnis.code).toBeNull();
    expect(invites.istBelegt(ergebnis)).toBe(false);
  });

  it('bleibt ohne jede Änderung unbekannt', () => {
    // Vanity-URL, ein Bot-Beitritt oder ein verpasstes Ereignis. Alle drei
    // sehen gleich aus, und keiner davon ist eine Einladung.
    const ergebnis = invites.vergleiche([gespiegelt('aaa', 4)], [einladung('aaa', 4)]);

    expect(ergebnis.art).toBe('KEINE_AENDERUNG');
    expect(ergebnis.code).toBeNull();
  });

  it('wertet einen unbekannten Code nicht als Treffer', () => {
    // Zwischen zwei Abgleichen erstellt und sofort benutzt: der Zähler steht
    // von Anfang an auf eins. Ohne Vorher-Wert ist das keine Steigerung,
    // sondern eine Zahl ohne Vergleich.
    const ergebnis = invites.vergleiche([gespiegelt('aaa', 4)], [einladung('aaa', 4), einladung('neu', 1)]);

    expect(ergebnis.art).toBe('KEINE_AENDERUNG');
    expect(ergebnis.code).toBeNull();
  });

  it('ordnet nach einem Neustart zu, nennt aber die Unschärfe', () => {
    // Der Bot lief zwischendurch nicht. Der Zähler ist um drei gestiegen -
    // die Einladung stimmt, aber dieser eine Beitritt ist nicht der einzige
    // gewesen.
    const ergebnis = invites.vergleiche([gespiegelt('aaa', 4)], [einladung('aaa', 7)]);

    expect(ergebnis.art).toBe('MEHRERE_NUTZUNGEN');
    expect(ergebnis.code).toBe('aaa');
    expect(invites.istBelegt(ergebnis)).toBe(true);
  });

  it('erkennt eine Einladung, die mit diesem Beitritt aufgebraucht wurde', () => {
    // Discord löscht eine Einladung, sobald ihr letzter Platz weg ist. Ihr
    // Zähler kann also gar nicht mehr steigen - sie verschwindet einfach.
    const ergebnis = invites.vergleiche(
      [gespiegelt('einmal', 0, { maxUses: 1 }), gespiegelt('aaa', 4)],
      [einladung('aaa', 4)],
    );

    expect(ergebnis.art).toBe('AUFGEBRAUCHT');
    expect(ergebnis.code).toBe('einmal');
    expect(ergebnis.uses).toBe(1);
  });

  it('bleibt unbekannt, wenn eine Einladung mit Restplätzen verschwindet', () => {
    // Aufgebraucht und gelöscht sehen gleich aus. War noch Platz, war es
    // vermutlich eine Löschung - und «vermutlich» reicht hier nicht.
    const ergebnis = invites.vergleiche(
      [gespiegelt('viele', 0, { maxUses: 10 }), gespiegelt('aaa', 4)],
      [einladung('aaa', 4)],
    );

    expect(ergebnis.art).toBe('KEINE_AENDERUNG');
    expect(ergebnis.code).toBeNull();
  });

  it('bleibt unbekannt, wenn zwei einmalige Einladungen gleichzeitig verschwinden', () => {
    const ergebnis = invites.vergleiche(
      [gespiegelt('eins', 0, { maxUses: 1 }), gespiegelt('zwei', 0, { maxUses: 1 })],
      [],
    );

    expect(ergebnis.art).toBe('KEINE_AENDERUNG');
  });

  it('zieht eine bereits zurückgezogene Einladung nicht mehr heran', () => {
    // Sie ist schon beim letzten Lauf verschwunden. Sie jetzt erneut zu
    // werten hiesse, denselben Vorgang zweimal zu erklären.
    const ergebnis = invites.vergleiche(
      [gespiegelt('einmal', 0, { maxUses: 1, revokedAt: new Date('2026-09-01T10:00:00Z') })],
      [],
    );

    expect(ergebnis.art).toBe('KEINE_AENDERUNG');
  });

  it('behandelt einen leeren Spiegel als unbekannt, nicht als Treffer', () => {
    // Der allererste Beitritt nach der Einrichtung. Es gibt keinen
    // Vorher-Stand, gegen den sich vergleichen liesse.
    const ergebnis = invites.vergleiche([], [einladung('aaa', 1)]);

    expect(ergebnis.art).toBe('KEINE_AENDERUNG');
  });

  it('gilt ein fehlendes Recht nie als Zuordnung', () => {
    for (const art of ['KEIN_ZUGRIFF', 'DISCORD_FEHLER', 'MEHRDEUTIG', 'KEINE_AENDERUNG'] as const) {
      expect(
        invites.istBelegt({
          art,
          code: 'aaa',
          inviterDiscordId: null,
          inviterUsername: null,
          uses: null,
        }),
      ).toBe(false);
    }
  });

  it('hat für jede Art einen eigenen Klartext', () => {
    const texte = Object.values(invites.ZUORDNUNG_TEXT);
    expect(new Set(texte).size).toBe(texte.length);
    for (const text of texte) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});
