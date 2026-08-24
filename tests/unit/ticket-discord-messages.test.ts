import { describe, expect, it } from 'vitest';
import { tickets } from '@swisshub/modules';

/**
 * Die Discord-Nachrichten des Ticket-Moduls.
 *
 * Sie entstehen ohne Datenbank und ohne Netz - deshalb laesst sich hier
 * pruefen, was tatsaechlich bei Discord ankaeme. Das ist die Stelle, an der
 * eine vergessene Erwaehnungssperre oder eine falsche Knopf-Kennung
 * auffallen soll, und nicht im laufenden Betrieb.
 */
describe('Ticket-Panel', () => {
  const basis = {
    title: 'SwissHub Support',
    description: 'Wähle aus, worum es geht.',
    buttonLabel: 'Ticket erstellen',
    buttonEmoji: '🎫',
  };

  it('gibt jeder Kategorie einen eigenen Knopf mit ihrer Kennung', () => {
    const nachricht = tickets.panelNachricht({
      ...basis,
      kategorien: [
        { id: 'kat-a', name: 'Allgemein', emoji: '❓' },
        { id: 'kat-b', name: 'Meldung', emoji: null },
      ],
    });

    const knoepfe = nachricht.components?.flatMap((reihe) => reihe.components) ?? [];
    expect(knoepfe).toHaveLength(2);
    expect(knoepfe.map((knopf) => ('custom_id' in knopf ? knopf.custom_id : null))).toEqual([
      `${tickets.PANEL_BUTTON_PREFIX}kat-a`,
      `${tickets.PANEL_BUTTON_PREFIX}kat-b`,
    ]);
    // Bei mehreren Kategorien traegt der Knopf ihren Namen, nicht die
    // Panel-Beschriftung - sonst waeren alle Knoepfe gleich benannt.
    expect(knoepfe.map((knopf) => knopf.label)).toEqual(['Allgemein', 'Meldung']);
  });

  it('nimmt bei genau einer Kategorie die Beschriftung des Panels', () => {
    const nachricht = tickets.panelNachricht({
      ...basis,
      kategorien: [{ id: 'kat-a', name: 'Allgemein', emoji: null }],
    });
    const knopf = nachricht.components?.[0]?.components[0];
    expect(knopf?.label).toBe('Ticket erstellen');
  });

  it('verteilt mehr als fünf Kategorien auf mehrere Reihen', () => {
    const nachricht = tickets.panelNachricht({
      ...basis,
      kategorien: Array.from({ length: 7 }, (_, index) => ({
        id: `kat-${index}`,
        name: `Kategorie ${index}`,
        emoji: null,
      })),
    });
    // Discord erlaubt fuenf Knoepfe je Reihe; eine sechste im selben Block
    // wuerde die Nachricht ablehnen.
    expect(nachricht.components).toHaveLength(2);
    expect(nachricht.components?.[0]?.components).toHaveLength(5);
    expect(nachricht.components?.[1]?.components).toHaveLength(2);
  });

  it('unterbindet jede Erwähnung', () => {
    const nachricht = tickets.panelNachricht({
      ...basis,
      description: 'Frag hier @everyone',
      kategorien: [{ id: 'kat-a', name: 'Allgemein', emoji: null }],
    });
    expect(nachricht.allowedMentions).toEqual({ parse: [] });
  });
});

describe('Eröffnungsnachricht', () => {
  const basis = {
    ticketNumber: 42,
    subject: 'Mein Anliegen',
    creatorDiscordId: '100000000000000001',
    kategorieName: 'Allgemein',
    formAnswers: { Anliegen: 'Bitte um Hilfe' },
    supportRollen: ['900000000000000004'],
  };

  it('erwähnt nur den Ersteller, solange der Ping nicht gewünscht ist', () => {
    const nachricht = tickets.eroeffnungsNachricht({ ...basis, pingSupport: false });
    expect(nachricht.content).toBe('<@100000000000000001>');
    expect(nachricht.allowedMentions).toEqual({
      parse: [],
      users: ['100000000000000001'],
    });
  });

  it('erwähnt die Support-Rollen nur mit ausdrücklicher Freigabe', () => {
    const nachricht = tickets.eroeffnungsNachricht({ ...basis, pingSupport: true });
    expect(nachricht.content).toContain('<@&900000000000000004>');
    expect(nachricht.allowedMentions?.roles).toEqual(['900000000000000004']);
  });

  it('lässt ein @everyone im Betreff wirkungslos', () => {
    const nachricht = tickets.eroeffnungsNachricht({
      ...basis,
      subject: '@everyone dringend',
      pingSupport: false,
    });
    expect(nachricht.allowedMentions?.parse).toEqual([]);
    expect(nachricht.allowedMentions).not.toHaveProperty('roles');
  });

  it('stellt die Angaben aus dem Formular als Felder dar', () => {
    const nachricht = tickets.eroeffnungsNachricht({
      ...basis,
      formAnswers: { Anliegen: 'Kaputt', 'Seit wann': 'gestern' },
      pingSupport: false,
    });
    expect(nachricht.embeds?.[0]?.fields).toEqual([
      { name: 'Anliegen', value: 'Kaputt', inline: false },
      { name: 'Seit wann', value: 'gestern', inline: false },
    ]);
  });

  it('trägt die Knöpfe, die der Bot beim Klick wiedererkennt', () => {
    const nachricht = tickets.eroeffnungsNachricht({ ...basis, pingSupport: false });
    const kennungen =
      nachricht.components?.[0]?.components.map((knopf) =>
        'custom_id' in knopf ? knopf.custom_id : null,
      ) ?? [];
    expect(kennungen).toEqual([tickets.TICKET_BUTTON.claim, tickets.TICKET_BUTTON.close]);
  });
});
