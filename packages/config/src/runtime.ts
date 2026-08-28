/**
 * Laufzeitwerte aus der zentralen Integrationsverwaltung.
 *
 * `discordConfig.botToken` und seine Geschwister lasen bisher direkt aus der
 * Umgebung. Damit dieselben Aufrufstellen ohne Umbau weiterfunktionieren,
 * schaut jeder dieser Zugriffe jetzt zuerst in diese Ablage und erst danach in
 * `process.env` - genau die Reihenfolge aus §39: Datenbank gewinnt, Umgebung
 * ist der Rückfall.
 *
 * Warum hier und nicht im Secret-Speicher: `@swisshub/config` hat bewusst
 * keine Abhängigkeit auf die Datenbank. Hätte es eine, entstünde ein Ring
 * (config → database → config), und jeder Zugriff auf eine Umgebungsvariable
 * würde eine Datenbankverbindung voraussetzen. Stattdessen füllt
 * `@swisshub/secrets` diese Ablage beim Start und nach jeder Änderung; wer
 * liest, bleibt synchron und braucht nichts davon zu wissen.
 *
 * Die Werte stehen ausschliesslich im Speicher des Prozesses. Sie werden nicht
 * serialisiert, nicht exportiert und nicht protokolliert.
 */

const werte = new Map<string, string>();

/** `discord.botToken`, `ai.apiKey`, `bot:<id>.token`, ... */
export type RuntimeConfigKey = string;

export function setRuntimeConfigValues(neu: Record<RuntimeConfigKey, string | null>): void {
  for (const [key, wert] of Object.entries(neu)) {
    if (wert === null || wert === '') {
      werte.delete(key);
    } else {
      werte.set(key, wert);
    }
  }
}

export function runtimeConfigValue(key: RuntimeConfigKey): string | undefined {
  return werte.get(key);
}

export function hasRuntimeConfigValue(key: RuntimeConfigKey): boolean {
  return werte.has(key);
}

/** Nach einem Wechsel des Hauptschlüssels oder in Tests. */
export function clearRuntimeConfigValues(): void {
  werte.clear();
}

/** Welche Schlüssel derzeit belegt sind - für Diagnose, ohne die Werte. */
export function runtimeConfigKeys(): string[] {
  return [...werte.keys()].sort();
}
