import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tickets } from '@swisshub/modules';

/**
 * Warum ein Ticket-Kanal stehen bleiben kann, ohne dass etwas kaputt ist.
 *
 * `closeBehaviour` entscheidet, wie lange er nach dem Abschluss bleibt. Steht
 * dort etwas anderes als «sofort», wird gar keine Löschung eingeplant - und
 * von aussen sieht das genauso aus wie ein Fehler: der Kanal ist noch da.
 *
 * Die Vorgabe im Code ist «sofort». Sobald aber einmal die Einstellungen
 * gespeichert wurden, steht dort der damals gewählte Wert.
 */

describe('Aufbewahrungsfrist je Einstellung', () => {
  it('löscht bei «sofort» nach fünf Sekunden', () => {
    expect(tickets.aufbewahrungsfristMs('DELETE_IMMEDIATELY')).toBe(tickets.KANAL_LOESCHVERZOEGERUNG_MS);
    expect(tickets.KANAL_LOESCHVERZOEGERUNG_MS).toBe(5_000);
  });

  it('plant bei «nie löschen» gar keine Löschung', () => {
    // Kein Versehen, sondern eine Ansage - und deshalb muss sie sichtbar sein.
    expect(tickets.aufbewahrungsfristMs('KEEP_FOREVER')).toBeNull();
  });

  it('wartet bei den übrigen Einstellungen deutlich länger', () => {
    expect(tickets.aufbewahrungsfristMs('KEEP_24H')).toBe(24 * 3600_000);
    expect(tickets.aufbewahrungsfristMs('KEEP_7D')).toBe(7 * 24 * 3600_000);
  });
});

describe('Der Systemstatus sagt, was mit dem Kanal geschieht', () => {
  const quelle = readFileSync(join(process.cwd(), 'packages/modules/src/tickets/config.ts'), 'utf8');

  it('nennt jede der vier Einstellungen im Klartext', () => {
    expect(quelle).toContain("label: 'Kanal nach Abschluss'");
    expect(quelle).toContain('rund 5 Sekunden nach dem Schliessen gelöscht');
    expect(quelle).toContain('24 Stunden stehen');
    expect(quelle).toContain('7 Tage stehen');
    expect(quelle).toContain('dauerhaft stehen');
  });

  it('führt von dort direkt in die Einstellungen', () => {
    const abschnitt = quelle.slice(
      quelle.indexOf("label: 'Kanal nach Abschluss'"),
      quelle.indexOf('Kanalloeschungen, die nicht durchkommen'),
    );
    expect(abschnitt).toContain('fixHref');
  });
});

describe('Die Migration setzt die Einstellung auf «sofort»', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'packages/database/prisma/migrations/20260905220000_ticket_sofort_loeschen/migration.sql',
    ),
    'utf8',
  );

  it('ändert genau diesen einen Schlüssel', () => {
    // `jsonb_set` statt Überschreiben: alles andere in den Einstellungen
    // bleibt, wie es war.
    expect(sql).toContain('jsonb_set');
    expect(sql).toContain("'{closeBehaviour}'");
    expect(sql).toContain('"DELETE_IMMEDIATELY"');
  });

  it('fasst nur das Ticket-Modul an', () => {
    expect(sql).toContain('"moduleId" = \'tickets\'');
  });

  it('läuft ein zweites Mal ins Leere', () => {
    expect(sql).toContain("<> 'DELETE_IMMEDIATELY'");
  });

  it('löscht und verwirft nichts', () => {
    for (const verboten of ['DROP', 'TRUNCATE', 'DELETE FROM']) {
      expect(sql.toUpperCase(), verboten).not.toContain(verboten);
    }
  });
});
