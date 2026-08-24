import { beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithDatabase, pushSchema, useTestSchema } from '../helpers/database';

useTestSchema('test_ticket_numbering');

/**
 * Die Nummernvergabe gegen eine echte Datenbank.
 *
 * Das ist die Stelle, an der ein Ticketsystem still kaputtgeht: zwei
 * gleichzeitige Erstellungen bekommen dieselbe Nummer, die Eindeutigkeit
 * schlaegt zu, und ein Ticket geht verloren. Ohne echte Nebenlaeufigkeit
 * laesst sich das nicht pruefen.
 */
const { prisma } = await import('@swisshub/database');
const { tickets } = await import('@swisshub/modules');

const GUILD = '100000000000000800';

describeWithDatabase('Ticketnummern', () => {
  beforeAll(() => {
    pushSchema();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "TicketCounter" RESTART IDENTITY CASCADE');
  });

  it('beginnt bei eins', async () => {
    expect(await tickets.nextTicketNumber(GUILD)).toBe(1);
  });

  it('zaehlt hoch', async () => {
    await tickets.nextTicketNumber(GUILD);
    await tickets.nextTicketNumber(GUILD);
    expect(await tickets.nextTicketNumber(GUILD)).toBe(3);
  });

  it('vergibt bei fünfzig gleichzeitigen Anfragen keine Nummer doppelt', async () => {
    const nummern = await Promise.all(
      Array.from({ length: 50 }, () => tickets.nextTicketNumber(GUILD)),
    );
    expect(new Set(nummern).size).toBe(50);
    expect([...nummern].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it('zaehlt je Guild getrennt', async () => {
    await tickets.nextTicketNumber(GUILD);
    await tickets.nextTicketNumber(GUILD);
    expect(await tickets.nextTicketNumber('200000000000000800')).toBe(1);
  });

  it('formatiert die Nummer lesbar', () => {
    expect(tickets.formatTicketNumber(123)).toBe('#000123');
    expect(tickets.formatTicketNumber(1, 'SH-')).toBe('SH-000001');
  });
});
