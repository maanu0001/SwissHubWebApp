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
      const declared = /\bpermission:\s*\S/.test(action.body);
      const explicit = EXPLICIT_CHECKS.some((check) => action.body.includes(check));
      expect(
        declared || explicit,
        `${action.name}: weder "permission:" noch eine ausdrückliche Prüfung im Rumpf`,
      ).toBe(true);
    },
  );

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
        expect(line, `${file}: "${name}" ist exportiert, aber keine defineAction`).toContain(
          'export const',
        );
        expect(
          source.includes(`export const ${name} = defineAction(`),
          `${file}: "${name}" ist exportiert, aber keine defineAction`,
        ).toBe(true);
      }
    }
  });
});
