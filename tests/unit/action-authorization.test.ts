import { describe, expect, it } from 'vitest';

/**
 * Jede Server Action prüft die Berechtigung serverseitig.
 *
 * Eine Server Action ist ein öffentlicher HTTP-Endpunkt: Next.js erzeugt für
 * jede exportierte Funktion in einer `'use server'`-Datei eine aufrufbare
 * Adresse. Ob die Oberfläche den zugehörigen Knopf anzeigt, spielt dabei keine
 * Rolle - wer die Adresse kennt, ruft sie auf.
 *
 * Deshalb muss jede Action entweder eine feste `permission` deklarieren oder
 * im Rumpf ausdrücklich prüfen (das ist nötig, wo die Berechtigung erst zur
 * Laufzeit feststeht - etwa bei den Moduleinstellungen). Diese Prüfung
 * arbeitet auf dem Quelltext und fängt damit auch eine Action ab, die niemand
 * getestet hat.
 */
const { globSync, readFileSync } = await import('node:fs');
const { join } = await import('node:path');

const FILES = globSync('apps/web/src/modules/*/{actions,*-actions}.ts', { cwd: process.cwd() }).sort();

/** Ausdrücke, die eine Prüfung im Rumpf der Action darstellen. */
const EXPLICIT_CHECKS = [
  'assertConfigurationAccess',
  'assertSetupAccess',
  'assertPermission',
  // Kalender: die Zustaendigkeit fuer genau diesen Termin. `calendar.edit`
  // deckt alle Termine ab, `calendar.manageOwn` nur die eigenen - das laesst
  // sich nicht als eine feste Permission ausdruecken.
  'requireEventZugriff',
];

interface Action {
  file: string;
  name: string;
  body: string;
}

/** Alle `export const x = defineAction({...}, handler)` einer Datei. */
function actionsOf(file: string): Action[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const found: Action[] = [];
  const pattern = /^export const (\w+) = defineAction\(\n([\s\S]*?)^\);$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    found.push({ file, name: match[1] ?? '', body: match[2] ?? '' });
  }
  return found;
}

const actions = FILES.flatMap(actionsOf);

describe('Server Actions', () => {
  it('findet die Actions der Anwendung', () => {
    expect(FILES.length).toBeGreaterThan(5);
    expect(actions.length).toBeGreaterThan(40);
  });

  it.each(actions.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a] as const))(
    '%s prüft die Berechtigung',
    (_label, action) => {
      // `permission: undefined` erfuellt zwar die Schreibweise, deklariert
      // aber nichts - es waere ein Waechter, der bei der einen Form
      // wegsieht, auf die es ankommt.
      const declared =
        /\bpermission:\s*\S/.test(action.body) && !/\bpermission:\s*undefined/.test(action.body);
      const explicit = EXPLICIT_CHECKS.some((check) => action.body.includes(check));
      // Dritte zulässige Form: Selbstbedienung. Die Aktion wirkt dann
      // ausschliesslich auf die Daten des Aufrufers und braucht keine
      // Verwaltungsberechtigung - ein Mitglied schliesst sein eigenes Abo ab.
      // Bewusst eine ausdrückliche Kennzeichnung und keine Ableitung: eine
      // Aktion, die "ctx.user.id" bloss erwähnt, ist damit nicht abgedeckt.
      const selbstbedienung = /\bselfService:\s*true/.test(action.body);
      // Vierte Form: der Antragsteller-Zugang. Er ist die einzige Stelle ohne
      // Guild-Mitgliedschaft - und deshalb die einzige, die eine eigene
      // Eigentumsprüfung mitbringen muss. Sie wird unten geprüft.
      const antragsteller = /\bapplicant:\s*true/.test(action.body);
      expect(
        declared || explicit || selbstbedienung || antragsteller,
        `${action.name}: weder "permission:", noch eine ausdrückliche Prüfung im Rumpf, noch "selfService: true", noch "applicant: true"`,
      ).toBe(true);
    },
  );

  /**
   * Der Antragsteller-Zugang trägt seine Prüfung im Rumpf.
   *
   * `applicant: true` nimmt die Mitgliedschaft aus der Kette - und damit das
   * einzige Glied, das bisher jeden Fremden abgewiesen hat. An seine Stelle
   * muss eine stärkere Prüfung treten: gehört dieser Datensatz dem
   * Aufrufer? Ohne sie könnte jeder angemeldete Discord-Benutzer den Antrag
   * eines anderen öffnen.
   *
   * Geprüft wird auf den Aufruf eines Helfers, dessen Name die Prüfung
   * benennt - nicht auf eine beliebige Erwähnung von `discordId`. Eine
   * Aktion, die die Kennung bloss weiterreicht, ist damit nicht abgedeckt.
   */
  const ANTRAGSTELLER_PRUEFUNGEN = ['requireEigenerAppeal', 'assertEigenerAppeal'];

  const antragstellerActions = actions.filter((action) => /\bapplicant:\s*true/.test(action.body));

  const antragstellerFaelle: Array<[string, Action | null]> =
    antragstellerActions.length > 0
      ? antragstellerActions.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a])
      : [['(derzeit keine)', null]];

  it.each(antragstellerFaelle)('%s prüft das Eigentum am Datensatz', (_label, action) => {
    if (!action) {
      expect(antragstellerActions).toHaveLength(0);
      return;
    }
    expect(
      ANTRAGSTELLER_PRUEFUNGEN.some((pruefung) => action.body.includes(pruefung)),
      `${action.name}: "applicant: true" ohne Eigentumsprüfung (${ANTRAGSTELLER_PRUEFUNGEN.join(' / ')})`,
    ).toBe(true);
  });

  it.each(actions.map((a) => [`${a.file.split('/').at(-2)}/${a.name}`, a] as const))(
    '%s validiert die Eingabe',
    (_label, action) => {
      // Ohne Schema landet ungeprüfter Browser-Input im Handler.
      expect(action.body, `${action.name}: kein schema`).toMatch(/\bschema:\s*\S/);
    },
  );

  it('exportiert aus Action-Dateien nichts ausser Actions', () => {
    // Ein anderer Export in einer `'use server'`-Datei waere ebenfalls von
    // aussen aufrufbar - dann jedoch ohne die Absicherungen von defineAction.
    for (const file of FILES) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      const exports = [...source.matchAll(/^export (?:async function|const|function) (\w+)/gm)];
      for (const [line, name] of exports.map((m) => [m[0], m[1]] as const)) {
        expect(line, `${file}: "${name}" ist exportiert, aber keine defineAction`).toContain('export const');
        expect(
          source.includes(`export const ${name} = defineAction(`),
          `${file}: "${name}" ist exportiert, aber keine defineAction`,
        ).toBe(true);
      }
    }
  });
});
