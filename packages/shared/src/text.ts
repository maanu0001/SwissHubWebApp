/**
 * Input hardening helpers.
 *
 * All user supplied free text (jail reasons, search queries, ...) passes
 * through here before it is stored, logged or forwarded to Discord.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export interface SanitizeOptions {
  /**
   * Zeilenumbrüche erhalten. Für mehrzeilige Texte (z.B. Ankündigungen)
   * nötig - dort ist die Formatierung Teil der Nachricht. Standard ist aus,
   * weil einzeilige Eingaben so nicht heimlich mehrzeilig werden können.
   */
  keepNewlines?: boolean;
}

/** Removes control characters and collapses whitespace. */
export function sanitizeText(value: string, maxLength = 1000, options: SanitizeOptions = {}): string {
  const withoutControls = value.replace(CONTROL_CHARS, '');
  if (!options.keepNewlines) {
    return withoutControls.replace(/\s+/gu, ' ').trim().slice(0, maxLength);
  }
  return (
    withoutControls
      // Zeilenumbrüche vereinheitlichen, aber erhalten.
      .replace(/\r\n?/gu, '\n')
      // Höchstens zwei aufeinanderfolgende Leerzeilen.
      .replace(/\n{3,}/gu, '\n\n')
      // Innerhalb einer Zeile weiterhin Leerraum zusammenfassen.
      .replace(/[^\S\n]+/gu, ' ')
      .trim()
      .slice(0, maxLength)
  );
}

/** Escapes Discord markdown so user content cannot forge formatting or mentions. */
export function escapeDiscordMarkdown(value: string): string {
  return value.replace(/([\\*_~`|>])/gu, '\\$1').replace(/@(everyone|here)/gu, '@\u200b$1');
}

/** Truncates with an ellipsis, keeping the string within `max` characters. */
export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}\u2026`;
}

/** Case-insensitive `includes` that is safe for user supplied needles. */
export function containsInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

/** Einfache Pluralisierung: `plural(1, 'Freilassung', 'Freilassungen')`. */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
