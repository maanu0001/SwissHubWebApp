import { describe, expect, it } from 'vitest';

/**
 * Jeder Aufruf einer Server Action führt den CSRF-Token mit.
 *
 * `defineAction` prüft ihn vor allem anderen ausser der Anmeldung, und keine
 * einzige Aktion ist davon ausgenommen (`csrf: false` kommt im ganzen Projekt
 * nicht vor - der Test unten hält das fest). Fehlt der Token, antwortet jede
 * Aktion mit «Sicherheitsprüfung fehlgeschlagen» - und zwar erst im Browser,
 * nicht beim Übersetzen und nicht in einem Modultest.
 *
 * Genau so ist es passiert: die Einrichtung der Discord-Log-Kanäle ging in
 * Produktion, und der erste Klick auf ein Auswahlfeld lief in diese Meldung.
 * Typecheck, Lint und 2824 Prüfungen waren grün - keine davon fasst die
 * Verdrahtung zwischen Seite, Komponente und Aktion an.
 *
 * Diese Prüfung schliesst die Lücke auf dem Quelltext: wer eine Aktion
 * aufruft, muss den Token im Haus haben. Sie folgt ihm nicht bis in den
 * Aufruf hinein - viele Komponenten reichen ihn in einer Nutzlast weiter, und
 * eine Verfolgung über Variablen hinweg wäre mehr Aufwand als Nutzen. Der
 * Fehler, der hier wirklich passiert, ist der ganz vergessene Token, und den
 * fängt sie.
 */
const { globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const KOMPONENTEN = globSync('apps/web/src/**/*.tsx', { cwd: process.cwd() }).sort();
const AKTIONSDATEIEN = globSync('apps/web/src/modules/*/{actions,*-actions}.ts', {
  cwd: process.cwd(),
}).sort();

function lies(datei: string): string {
  return readFileSync(join(process.cwd(), datei), 'utf8');
}

/**
 * Die Namen, die eine Datei aus einem Aktionsmodul importiert.
 *
 * Nur sie zählen. Eine Komponente namens `QuickAction` ist keine Server
 * Action, und ohne diese Einschränkung stünde sie hier als Fehlalarm.
 */
function importierteAktionen(quelltext: string): string[] {
  const namen: string[] = [];
  const muster = /import\s*\{([^}]+)\}\s*from\s*'([^']*actions)'/gu;
  let treffer: RegExpExecArray | null;
  while ((treffer = muster.exec(quelltext)) !== null) {
    for (const teil of (treffer[1] ?? '').split(',')) {
      const name = teil
        .trim()
        .split(/\s+as\s+/u)
        .pop()
        ?.trim();
      if (name && name.endsWith('Action')) {
        namen.push(name);
      }
    }
  }
  return namen;
}

const MIT_AKTIONEN = KOMPONENTEN.map((datei) => {
  const quelltext = lies(datei);
  return { datei, quelltext, aktionen: importierteAktionen(quelltext) };
}).filter((eintrag) => eintrag.aktionen.length > 0);

describe('CSRF-Token an den Server Actions', () => {
  it('findet überhaupt Komponenten, die Aktionen aufrufen', () => {
    // Ohne diese Zusicherung wäre die Prüfung unten stillschweigend leer -
    // etwa wenn sich der Zuschnitt der Ordner einmal ändert.
    expect(MIT_AKTIONEN.length).toBeGreaterThan(20);
  });

  it.each(MIT_AKTIONEN.map((eintrag) => [eintrag.datei, eintrag] as const))(
    '%s führt den CSRF-Token mit',
    (_datei, eintrag) => {
      expect(
        eintrag.quelltext.includes('csrfToken'),
        `${eintrag.datei} ruft ${eintrag.aktionen.join(', ')} auf, kennt aber keinen csrfToken. ` +
          'Die Seite muss ihn über `csrfTokenFor(context)` reichen, die Komponente ihn mitsenden - ' +
          'sonst antwortet jede dieser Aktionen mit «Sicherheitsprüfung fehlgeschlagen».',
      ).toBe(true);
    },
  );

  /**
   * Keine Aktion nimmt sich von der Prüfung aus.
   *
   * Solange das gilt, ist die Regel oben ausnahmslos. Käme je eine Aktion mit
   * `csrf: false` dazu, fällt dieser Test - und wer sie einführt, muss die
   * Wache oben bewusst anpassen, statt sie unbemerkt aufzuweichen.
   */
  it('kennt keine Aktion ohne CSRF-Prüfung', () => {
    for (const datei of AKTIONSDATEIEN) {
      expect(lies(datei), `${datei} nimmt eine Aktion von der CSRF-Prüfung aus`).not.toContain('csrf: false');
    }
  });
});
