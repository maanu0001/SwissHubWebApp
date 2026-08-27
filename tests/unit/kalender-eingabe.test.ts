import { describe, expect, it } from 'vitest';

/**
 * Wie das Formular verstanden wird.
 *
 * Der heikle Fall ist die blosse Ortszeit aus `<input type="datetime-local">`:
 * sie trägt keine Zone. Sie mit `new Date()` zu lesen hiesse, sie in der Zone
 * des Servers zu deuten - für ein Event in einer anderen Zone falsch, und die
 * Antwort hinge daran, wie der Container gestartet wurde.
 */
const { calendar } = await import('@swisshub/modules');

const basis = {
  title: 'Community Gaming Night',
  description: 'Wir zocken zusammen.',
};

describe('Eingabe eines Events', () => {
  it('liest eine Ortszeit in der Zone des Events (Winter)', () => {
    const eingabe = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-01-15T20:00',
      timezone: 'Europe/Zurich',
    });
    expect(eingabe.startAt?.toISOString()).toBe('2026-01-15T19:00:00.000Z');
  });

  it('liest eine Ortszeit in der Zone des Events (Sommer)', () => {
    const eingabe = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-07-15T20:00',
      timezone: 'Europe/Zurich',
    });
    expect(eingabe.startAt?.toISOString()).toBe('2026-07-15T18:00:00.000Z');
  });

  it('rechnet für eine andere Zone anders', () => {
    // Genau der Fall, den `new Date()` nicht treffen kann: dieselbe
    // Wanduhrzeit, eine andere Zone.
    const zuerich = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-07-15T20:00',
      timezone: 'Europe/Zurich',
    });
    const newYork = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-07-15T20:00',
      timezone: 'America/New_York',
    });
    expect(newYork.startAt?.toISOString()).toBe('2026-07-16T00:00:00.000Z');
    expect(newYork.startAt?.getTime()).toBeGreaterThan(zuerich.startAt!.getTime());
  });

  it('nimmt eine vollständige Zeitangabe unverändert', () => {
    const eingabe = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-07-15T18:00:00.000Z',
      timezone: 'Europe/Zurich',
    });
    expect(eingabe.startAt?.toISOString()).toBe('2026-07-15T18:00:00.000Z');
  });

  it('lehnt ein Ende vor dem Beginn ab', () => {
    const ergebnis = calendar.eventInputSchema.safeParse({
      ...basis,
      startAt: '2026-07-15T20:00',
      endAt: '2026-07-15T19:00',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('erlaubt ein Ende nach Mitternacht', () => {
    // Ein Abend, der um 22 Uhr beginnt und um 2 Uhr endet, ist der Normalfall
    // und kein Fehler.
    const eingabe = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-07-15T22:00',
      endAt: '2026-07-16T02:00',
    });
    expect(eingabe.endAt!.getTime() - eingabe.startAt!.getTime()).toBe(4 * 3600_000);
  });

  it('lehnt einen Anmeldeschluss nach dem Beginn ab', () => {
    const ergebnis = calendar.eventInputSchema.safeParse({
      ...basis,
      startAt: '2026-07-15T20:00',
      registrationClosesAt: '2026-07-15T21:00',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('verlangt bei aktivierter Ankündigung einen Channel', () => {
    // Ohne Channel ginge die Ankündigung ins Leere - und niemand merkte es.
    const ergebnis = calendar.eventInputSchema.safeParse({
      ...basis,
      startAt: '2026-07-15T20:00',
      announceOnDiscord: true,
    });
    expect(ergebnis.success).toBe(false);
  });

  it('lehnt eine unbekannte Zeitzone ab', () => {
    const ergebnis = calendar.eventInputSchema.safeParse({
      ...basis,
      startAt: '2026-07-15T20:00',
      timezone: 'Mars/Olympus',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('lehnt Adressen ab, die kein https sind', () => {
    const ergebnis = calendar.eventInputSchema.safeParse({
      ...basis,
      startAt: '2026-07-15T20:00',
      locationKind: 'ONLINE',
      locationUrl: 'http://beispiel.test',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('verlangt bei einem Online-Event eine Adresse', () => {
    const ergebnis = calendar.eventInputSchema.safeParse({
      ...basis,
      startAt: '2026-07-15T20:00',
      locationKind: 'ONLINE',
    });
    expect(ergebnis.success).toBe(false);
  });

  it('entfernt doppelte Vorlaufzeiten und sortiert sie', () => {
    const eingabe = calendar.eventInputSchema.parse({
      ...basis,
      startAt: '2026-07-15T20:00',
      reminderMinutes: [60, 1440, 60, 15],
    });
    expect(eingabe.reminderMinutes).toEqual([1440, 60, 15]);
  });
});
