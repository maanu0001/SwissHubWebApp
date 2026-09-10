import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Die Detailseite eines Events.
 *
 * Datum, Zeit, Ort und Teilnahme stehen oben - das war schon so. Was nicht
 * stimmte: der Ort stand zweimal da, und die beiden Stellen antworteten
 * unterschiedlich.
 */

const detail = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/kalender/[slug]/page.tsx'), 'utf8');

describe('Der Ort wird einmal beantwortet', () => {
  it('rechnet ihn an einer Stelle aus', () => {
    expect(detail).toContain('const ort =');
    expect(detail).toContain('value={ort.titel}');
    expect(detail).toContain('hint={ort.zusatz ?? undefined}');
  });

  it('stellt die Fallunterscheidung nicht selbst auf', () => {
    // Ob ein Termin auf Discord oder vor Ort stattfindet, entscheidet das
    // Modul. Eine eigene Bedingung hier wäre eine zweite Meinung darüber.
    expect(detail).toContain("calendar.ortsArt(event) === 'DISCORD'");
    expect(detail).not.toContain('event.locationKind ===');
  });

  it('behält jede Unterscheidung, die vorher irgendwo stand', () => {
    // «Discord-Kanal» und «SwissHub Discord» kamen aus dem unteren
    // Abschnitt, «Vor Ort» aus der Karte oben. Alle drei gibt es weiterhin.
    for (const text of ["'Discord-Kanal'", "'SwissHub Discord'", "'Vor Ort'"]) {
      expect(detail, text).toContain(text);
    }
  });

  it('nennt den Ort nicht mehr im unteren Abschnitt', () => {
    // Der zweite Eintrag war der, aus dem die abweichende Antwort kam.
    expect(detail).not.toContain('<dt className="text-muted-foreground">Ort</dt>');
  });

  it('benennt den Abschnitt nach dem, was noch darin steht', () => {
    expect(detail).toContain('<Panel title="Organisation & Anmeldung">');
    expect(detail).not.toContain('title="Wo & Wer"');
  });
});

describe('Die Priorisierung des Events bleibt', () => {
  it('führt Datum, Zeit, Ort und Teilnehmer oben', () => {
    for (const label of ['label="Datum"', 'label="Zeit"', 'label="Ort"', 'label="Teilnehmer"']) {
      expect(detail, label).toContain(label);
    }
  });

  it('behält Beschreibung, Anmeldung und die übrigen Angaben', () => {
    for (const stelle of [
      '<Panel title="Beschreibung">',
      '<AnmeldeBereich',
      'Organisation</dt>',
      'Anmeldeschluss</dt>',
      'Link</dt>',
    ]) {
      expect(detail, stelle).toContain(stelle);
    }
  });
});

describe('Die Übersicht bleibt ein Kalender', () => {
  const uebersicht = readFileSync(join(process.cwd(), 'apps/web/src/app/(app)/kalender/page.tsx'), 'utf8');

  it('zeigt Monat, Woche und Agenda', () => {
    for (const ansicht of ['<Monatsansicht', '<Wochenansicht', '<Agendaansicht']) {
      expect(uebersicht, ansicht).toContain(ansicht);
    }
  });

  it('hebt «Event erstellen» hervor und stellt die Verwaltung daneben', () => {
    // Der eine ist die Hauptaktion, die andere eine Nebentür - erkennbar am
    // `variant`, nicht an der Reihenfolge allein.
    expect(uebersicht).toContain('<Button variant="outline" asChild>');
    expect(uebersicht).toContain('Event erstellen');
    expect(uebersicht).toContain('/kalender/verwaltung');
  });
});

describe('Die Mitgliedsakte führt mit der Massnahme', () => {
  const akte = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/members/components/mitglieds-akte.tsx'),
    'utf8',
  );
  const jailDialog = readFileSync(
    join(process.cwd(), 'apps/web/src/modules/jail/components/create-jail-dialog.tsx'),
    'utf8',
  );

  it('behält jede Handlung, die vorher im Kopf stand', () => {
    // Freilassen, Massnahme ergreifen, Jailen - alle drei weiterhin, mit
    // denselben Bedingungen davor.
    for (const stelle of ['<ReleaseJailButton', '<ModerationDialog', '<CreateJailDialog']) {
      expect(akte, stelle).toContain(stelle);
    }
  });

  it('stellt das Jailen als Nebenaktion daneben', () => {
    // Es ist eine Abkürzung in denselben Vorgang, den «Massnahme ergreifen»
    // ohnehin anbietet - keine zweite Hauptaktion.
    const stelle = akte.indexOf('triggerLabel="Mitglied jailen"');
    expect(stelle).toBeGreaterThan(0);
    expect(akte.slice(stelle, stelle + 120)).toContain('variant="outline"');
  });

  it('lässt «Massnahme ergreifen» als Hauptaktion stehen', () => {
    const stelle = akte.indexOf('<ModerationDialog');
    const bis = akte.indexOf('/>', stelle);
    expect(akte.slice(stelle, bis)).not.toContain('variant="outline"');
  });

  it('nimmt dem Jail-Dialog seine Vorgabe nicht weg', () => {
    // Überall sonst - etwa in den Schnellaktionen des Dashboards - bleibt er,
    // was er war.
    expect(jailDialog).toContain("variant = 'button'");
    expect(jailDialog).toContain("variant === 'outline' ? 'outline' : 'default'");
  });
});
