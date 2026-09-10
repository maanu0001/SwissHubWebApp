import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Oberflaeche der Automationen.
 *
 * Zwei Dinge, die in den Daten schon standen und die man trotzdem nicht sah:
 * wann eine Automation zuletzt lief und wann sie das naechste Mal laeuft.
 * Und ein Abschnitt, den man fast nie braucht und trotzdem jedes Mal las.
 */

function lies(pfad: string): string {
  return readFileSync(join(process.cwd(), pfad), 'utf8');
}

describe('Die Übersicht zeigt, ob eine Automation lebt', () => {
  const liste = lies('apps/web/src/modules/automation/components/automation-liste.tsx');

  it('zeigt die letzte und die nächste Ausführung', () => {
    // Beides stand bisher in den Daten dieser Zeile und wurde nicht
    // angezeigt - der teuerste Zustand: geladen, übergeben, weggeworfen.
    expect(liste).toContain('zeile.letzterLaufLabel');
    expect(liste).toContain('zeile.naechsterLaufLabel');
  });

  it('zeigt weiterhin Name, Auslöser und die Zahlen', () => {
    for (const feld of ['zeile.name', 'zeile.triggerLabel', 'zeile.laeufe24h', 'zeile.fehler24h']) {
      expect(liste, feld).toContain(feld);
    }
  });

  it('behält den Schalter als Statusanzeige', () => {
    expect(liste).toContain('checked={zeile.enabled}');
  });

  it('lässt eine fehlende Angabe weg statt einen Platzhalter zu zeigen', () => {
    // «zuletzt -» ist eine Zeile mehr zu lesen und keine Auskunft.
    expect(liste).toContain('{zeile.letzterLaufLabel ? (');
    expect(liste).toContain('{zeile.naechsterLaufLabel ? (');
  });
});

describe('Die Zeiten kommen fertig vom Server', () => {
  const seite = lies('apps/web/src/app/(app)/automationen/page.tsx');

  it('formatiert beide Zeiten serverseitig', () => {
    // Im Browser formatiert stünde dieselbe Zeit in der Zeitzone des Geräts,
    // während jede andere Zeit dieser Anwendung in der des Servers steht.
    expect(seite).toContain('letzterLaufLabel: eintrag.lastRunAt ? formatDateTime(eintrag.lastRunAt) : null');
    expect(seite).toContain(
      'naechsterLaufLabel: eintrag.naechsterLauf ? formatDateTime(eintrag.naechsterLauf) : null',
    );
  });
});

describe('Der Termin kommt aus dem Zeitplaner', () => {
  const store = lies('packages/automation/src/store.ts');

  it('liest den eingeplanten Auftrag statt neu zu rechnen', () => {
    // Eine zweite Rechnung wäre eine Vorhersage; der Auftrag ist das, was
    // tatsächlich passieren wird.
    expect(store).toContain('prisma.automationJob.findMany');
    expect(store).toContain("status: 'PENDING'");
    expect(store).not.toContain('nextRunAt(');
  });

  it('fragt einmal für alle statt einmal je Zeile', () => {
    // Bei fünfhundert Automationen wären das fünfhundert Abfragen für eine
    // Spalte.
    expect(store).toContain('automationId: { in: automationen.map((eintrag) => eintrag.id) }');
  });

  it('bindet die Abfrage an die Gilde', () => {
    const abschnitt = store.slice(store.indexOf('prisma.automationJob.findMany'));
    expect(abschnitt.slice(0, 400)).toContain('guildId');
  });
});

describe('Der Editor stellt das Seltene hintan', () => {
  const builder = lies('apps/web/src/modules/automation/components/builder.tsx');

  it('behält die drei Schritte der Automation als Abschnitte', () => {
    // WENN - Bedingungen - DANN, in dieser Reihenfolge und mit denselben
    // Worten wie zuvor.
    const wann = builder.indexOf('title="Wann"');
    const nurWenn = builder.indexOf('title="Nur wenn"');
    const dann = builder.indexOf('title="Dann"');
    expect(wann).toBeGreaterThan(0);
    expect(nurWenn).toBeGreaterThan(wann);
    expect(dann).toBeGreaterThan(nurWenn);
  });

  it('klappt die Grenzen zu', () => {
    expect(builder).toContain('<details');
    expect(builder).toContain('open={grenzenAbweichend}');
  });

  it('klappt sie auf, sobald ein Wert vom Üblichen abweicht', () => {
    // Ein gesetzter Wert, den man nicht sieht, ist schlimmer als ein
    // Abschnitt zu viel - und genau der Wert, den man beim Suchen eines
    // Fehlers braucht.
    for (const feld of [
      'entwurf.concurrency !== LEERER_ENTWURF.concurrency',
      'entwurf.concurrencyKey.trim() !== LEERER_ENTWURF.concurrencyKey',
      'entwurf.maxRunsPerMinute !== LEERER_ENTWURF.maxRunsPerMinute',
    ]) {
      expect(builder, feld).toContain(feld);
    }
  });

  it('behält jedes Feld der Grenzen', () => {
    for (const feld of ['automation-concurrency', 'automation-key', 'automation-rate']) {
      expect(builder, feld).toContain(feld);
    }
  });

  it('sagt am zugeklappten Abschnitt, ob dahinter etwas eingestellt ist', () => {
    expect(builder).toContain("{grenzenAbweichend ? 'angepasst' : 'Standard'}");
  });
});
