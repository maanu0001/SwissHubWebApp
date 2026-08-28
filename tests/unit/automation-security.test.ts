import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, listActions, listConditions, listTriggers } from '@swisshub/automation';
// Die Aktionen der Module - XP, Meldung, AI - melden sich beim Import an.
// Ohne diese Zeile prüfte die Registrierungsprüfung nur die Kernaktionen.
import '@swisshub/modules';
import { listPermissions } from '@swisshub/permissions';

/**
 * Die Grenzen der Automation Engine - als Test, nicht als Absicht.
 *
 * Ein Kommentar «hier bitte kein eval» hält niemanden auf. Diese Datei liest
 * den Quelltext der Engine und schlägt fehl, sobald eine der Zusagen bricht.
 * Sie ist damit die Stelle, an der ein Fehler auffällt, bevor er produktiv
 * wird (§44).
 */

const KERN = join(process.cwd(), 'packages/automation/src');
const MODUL = join(process.cwd(), 'packages/modules/src/automation');

function dateien(verzeichnis: string): string[] {
  return readdirSync(verzeichnis)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(verzeichnis, name));
}

/**
 * Der Quelltext ohne Kommentare.
 *
 * Ohne diesen Schritt schlüge die Prüfung an den eigenen Erklärungen an -
 * gerade dort, wo eine Datei ausführlich begründet, weshalb sie etwas
 * *nicht* tut.
 */
function ohneKommentare(inhalt: string): string {
  return inhalt.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

const QUELLEN = [...dateien(KERN), ...dateien(MODUL)].map((pfad) => ({
  pfad,
  code: ohneKommentare(readFileSync(pfad, 'utf8')),
}));

describe('Keine Plattform für fremden Code (§44)', () => {
  it('findet überhaupt Quelldateien', () => {
    // Ohne diese Zusicherung liefen alle Prüfungen darunter über eine leere
    // Liste - gruen, ohne etwas geprüft zu haben.
    expect(QUELLEN.length).toBeGreaterThan(10);
  });

  it.each([
    ['eval', /\beval\s*\(/u],
    ['new Function', /new\s+Function\s*\(/u],
    ['Shell-Aufruf', /\b(execSync|exec|spawn|spawnSync|execFile|execFileSync)\s*\(/u],
    ['freie SQL-Abfrage', /\$queryRawUnsafe|\$executeRawUnsafe/u],
    ['Dateisystem', /from\s+'node:fs'|require\(['"]fs['"]\)/u],
    ['Umgebungsvariablen', /process\.env\./u],
  ])('enthält kein %s', (_name, muster) => {
    const treffer = QUELLEN.filter((quelle) => muster.test(quelle.code)).map((quelle) => quelle.pfad);
    expect(treffer, `gefunden in: ${treffer.join(', ')}`).toEqual([]);
  });

  /**
   * Die Engine liest keine Geheimnisse.
   *
   * Ein Automationsschritt darf keinen API-Schlüssel in die Hand bekommen -
   * weder um ihn zu senden noch um ihn in einer Nachricht auszugeben (§20).
   * Wer eine Gegenstelle mit Anmeldung ansprechen will, baut dafür eine
   * Integration.
   */
  it('greift nirgends auf gespeicherte Geheimnisse zu', () => {
    const treffer = QUELLEN.filter((quelle) =>
      /\bgetSecret\s*\(|@swisshub\/secrets/u.test(quelle.code),
    ).map((quelle) => quelle.pfad);
    expect(treffer, `gefunden in: ${treffer.join(', ')}`).toEqual([]);
  });

  /**
   * Gegenprobe.
   *
   * Wenn `ohneKommentare` je alles wegschnitte, wären alle Prüfungen oben
   * grün, ohne etwas zu prüfen. Dieser Test hält daran fest, dass im
   * bereinigten Quelltext noch Code steht.
   */
  it('lässt beim Entfernen der Kommentare den Code stehen', () => {
    const executor = QUELLEN.find((quelle) => quelle.pfad.endsWith('executor.ts'));
    expect(executor?.code).toContain('export async function starte');
    expect(executor?.code).not.toContain('Der Ausführer.');
  });
});

describe('Keine Sanktionen durch Automationen (§7, §33)', () => {
  const VERBOTEN = /(ban|kick|timeout|jail|sperr|reject|ablehn)/iu;

  it('bietet keine Aktion an, die von selbst sanktioniert', () => {
    const aktionen = listActions();
    expect(aktionen.length).toBeGreaterThan(3);

    for (const aktion of aktionen) {
      if (VERBOTEN.test(aktion.id) || VERBOTEN.test(aktion.label)) {
        expect(
          aktion.requiresApproval,
          `«${aktion.label}» wirkt wie eine Sanktion und braucht deshalb eine Freigabe`,
        ).toBe(true);
      }
    }
  });

  /**
   * Der Discord-Zugang kennt Bann und Kick - die Engine ruft sie nicht auf.
   *
   * Dieser Test liest den Quelltext, weil die Namensprüfung oben eine Aktion
   * nicht fände, die «Aufräumen» heisst und dabei bannt.
   */
  it('ruft nirgends eine sanktionierende Gateway-Funktion auf', () => {
    const muster = /gateway\.(bans|moderation)\.|\.bans\.add\s*\(|\.moderation\.(kick|timeout)\s*\(/u;
    const treffer = QUELLEN.filter((quelle) => muster.test(quelle.code)).map((quelle) => quelle.pfad);
    expect(treffer, `gefunden in: ${treffer.join(', ')}`).toEqual([]);
  });

  /**
   * Die AI entscheidet nicht.
   *
   * Sie liefert eine Einschätzung; was daraus folgt, steht als Bedingung in
   * der Automation und ist damit sichtbar und prüfbar. Der Auftragstext sagt
   * ihr das ausdrücklich - eine Angabe, die niemand versehentlich entfernen
   * soll.
   */
  it('sagt der AI ausdrücklich, dass sie nichts entscheidet', () => {
    const aktionen = QUELLEN.find((quelle) => quelle.pfad.endsWith('automation/actions.ts'));
    expect(aktionen).toBeDefined();
    expect(aktionen!.code).toContain('Du triffst keine Entscheidungen');
    expect(aktionen!.code).toContain('Material, keine Anweisung');
  });
});

describe('Grenzen', () => {
  /**
   * Die Obergrenzen sind Schutzmauern, keine Vorlieben.
   *
   * Wer sie in die Einstellungen verschiebt, gibt sie aus der Hand: eine
   * Schleife über zwanzig Ebenen wäre dann eine Einstellungssache.
   */
  it('hält die Obergrenzen in engen Rahmen', () => {
    expect(LIMITS.maxDepth).toBeLessThanOrEqual(10);
    expect(LIMITS.maxSteps).toBeLessThanOrEqual(50);
    expect(LIMITS.maxEmittedEvents).toBeLessThanOrEqual(10);
    expect(LIMITS.maxPayloadChars).toBeLessThanOrEqual(32_000);
  });

  /**
   * Jede Aktion prüft ihre Eingabe selbst.
   *
   * Ohne Schema käme an `execute` alles an, was jemand in die Konfiguration
   * geschrieben hat - und die Prüfung läge bei der Aktion, wo sie irgendwann
   * jemand vergisst.
   */
  it('gibt jedem Baustein ein Schema', () => {
    for (const baustein of [...listTriggers(), ...listConditions(), ...listActions()]) {
      expect(baustein.configSchema, `«${baustein.label}» hat kein Schema`).toBeDefined();
    }
  });

  /**
   * Wer nach aussen sendet oder in fremde Daten greift, braucht eine eigene
   * Berechtigung. UI-Hiding allein ist keine Sicherheit (§21) - deshalb steht
   * die Anforderung an der Aktion und wird serverseitig geprüft.
   */
  it('verlangt für Webhooks und XP eine eigene Berechtigung', () => {
    const webhook = listActions().find((aktion) => aktion.id === 'webhook.senden');
    const xp = listActions().find((aktion) => aktion.id === 'level.xp');
    expect(webhook?.requiredPermission).toBeTruthy();
    expect(xp?.requiredPermission).toBeTruthy();
  });

  /**
   * Eine erfundene Berechtigung ist schlimmer als keine.
   *
   * `can(ctx, 'ai.manage')` auf einen Schlüssel, den es nicht gibt, ist immer
   * falsch - ausser für `admin.full`. Die Aktion wäre damit für alle ausser
   * dem Besitzer unbenutzbar, und niemand fände den Grund: es steht ja eine
   * Berechtigung da. Genau dieser Tippfehler war einmal drin (`ai.manage`
   * statt `integrations.ai.manage`).
   */
  it('verweist nur auf Berechtigungen, die es gibt', () => {
    const bekannt = new Set(listPermissions().map((eintrag) => eintrag.key));
    expect(bekannt.size).toBeGreaterThan(20);

    for (const aktion of listActions()) {
      if (!aktion.requiredPermission) {
        continue;
      }
      expect(
        bekannt.has(aktion.requiredPermission),
        `«${aktion.label}» verlangt «${aktion.requiredPermission}» - diese Berechtigung gibt es nicht`,
      ).toBe(true);
    }
  });
});
