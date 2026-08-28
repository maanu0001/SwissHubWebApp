import { registerRuntimeSecret, unregisterRuntimeSecret } from '@swisshub/logger';

/**
 * Geheimnisse, die der Logger aus jeder Zeile entfernen muss.
 *
 * Die Schwärzung des Loggers kannte bisher nur Umgebungsvariablen. Sobald ein
 * Token aus der Datenbank kommt, steht es in keiner Umgebungsvariablen mehr -
 * und eine Ausnahme von Discord, die es enthält, ginge unverändert ins
 * Protokoll. Deshalb meldet der Speicher jeden entschlüsselten Wert hier an.
 *
 * Nur eine dünne Weiterleitung: die Liste selbst lebt im Logger, damit sie
 * nicht davon abhängt, ob dieses Paket geladen wurde.
 */

export function registerSecretValue(wert: string): void {
  registerRuntimeSecret(wert);
}

export function forgetSecretValue(wert: string): void {
  unregisterRuntimeSecret(wert);
}
