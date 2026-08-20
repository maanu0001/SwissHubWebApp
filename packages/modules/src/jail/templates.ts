import { escapeDiscordMarkdown, formatDuration, truncate } from '@swisshub/shared';

/**
 * Nachrichtenvorlagen des Jail-Moduls.
 *
 * Der alte Bot hatte seine Texte fest im Code - inklusive Rollen-IDs für die
 * Anrede. Hier sind die Texte Konfiguration: das Dashboard hinterlegt eine
 * Vorlage mit Platzhaltern, gerendert wird ausschliesslich serverseitig.
 *
 * Zwei Grundsätze:
 *  - Es werden nur bekannte Platzhalter ersetzt. Unbekanntes bleibt als Text
 *    stehen, statt einen Fehler auszulösen oder etwas zu erraten.
 *  - Benutzergenerierter Text (Grund, Namen) wird escaped. Die einzige
 *    Erwähnung, die entstehen kann, ist `{mention}` - und die wird beim Senden
 *    zusätzlich über `allowedMentions` freigegeben.
 */

/** Geschlecht für die Anrede. `null` = unbekannt/neutral. */
export type JailGender = 'MALE' | 'FEMALE' | null;

export interface JailTemplateData {
  targetDiscordId: string;
  targetLabel: string;
  moderatorLabel: string;
  moderatorDiscordId?: string | null;
  reason: string;
  /** `null` bei einem permanenten Jail. */
  durationSeconds: number | null;
  /** `null` bei einem permanenten Jail. */
  endsAt: Date | null;
  gender?: JailGender;
}

export const PERMANENT_TEXT = 'permanent';

/** Vorlagen, die ohne Konfiguration verwendet werden. */
export const DEFAULT_PUBLIC_TEMPLATE =
  '{mention} isch {duration} im Jail. Grund: {reason} — {gendered:Er chunnt|Si chunnt|Er/Si chunnt} {end_relative} wieder use.';
export const DEFAULT_PERMANENT_PUBLIC_TEMPLATE = '{mention} isch permanent im Jail. Grund: {reason}';
export const DEFAULT_PING_TEMPLATE = '{mention} — du bisch im Jail. Grund: {reason}';
export const DEFAULT_RELEASE_TEMPLATE = '{mention} isch wieder frei.';

/**
 * Alle unterstützten Platzhalter - Grundlage für die Hilfe im Dashboard und
 * für die Validierung der Vorlage.
 */
export const JAIL_TEMPLATE_PLACEHOLDERS: ReadonlyArray<{ token: string; description: string }> = [
  { token: '{mention}', description: 'Erwähnung des Mitglieds (@Name)' },
  { token: '{user}', description: 'Anzeigename des Mitglieds ohne Erwähnung' },
  { token: '{moderator}', description: 'Name des Moderators' },
  { token: '{reason}', description: 'Angegebener Grund' },
  { token: '{duration}', description: 'Dauer, z.B. "2 Stunden" oder "permanent"' },
  { token: '{end_time}', description: 'Enddatum als Discord-Zeitstempel' },
  { token: '{end_relative}', description: 'Verbleibende Zeit ("in 2 Stunden")' },
  { token: '{pronoun}', description: 'er / sie - abhängig von den Geschlechterrollen' },
  {
    token: '{gendered:männlich|weiblich|neutral}',
    description: 'Eigene Variante je Geschlecht, z.B. {gendered:Er|Si|Er/Si}',
  },
];

const MAX_RENDERED_LENGTH = 1800;

function discordTimestamp(date: Date, style: 'f' | 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function pronoun(gender: JailGender): string {
  if (gender === 'MALE') {
    return 'er';
  }
  if (gender === 'FEMALE') {
    return 'sie';
  }
  return 'er/sie';
}

/**
 * Wählt aus `{gendered:m|w|n}` die passende Variante.
 *
 * Fehlt die dritte Variante, wird bei unbekanntem Geschlecht die männliche
 * und die weibliche Form mit Schrägstrich verbunden - so entsteht nie eine
 * falsche Zuschreibung.
 */
function renderGendered(body: string, gender: JailGender): string {
  const parts = body.split('|');
  const male = parts[0] ?? '';
  const female = parts[1] ?? male;
  const neutral = parts[2] ?? (male === female ? male : `${male}/${female}`);
  if (gender === 'MALE') {
    return male;
  }
  if (gender === 'FEMALE') {
    return female;
  }
  return neutral;
}

/**
 * Setzt eine Vorlage mit den Daten eines Jails zusammen.
 *
 * Das Ergebnis ist fertiger Discord-Text. Er wird auf eine sichere Länge
 * gekürzt, damit eine zu lange Vorlage die Nachricht nicht scheitern lässt.
 */
export function renderJailTemplate(template: string, data: JailTemplateData): string {
  const permanent = data.endsAt === null;
  const values: Record<string, string> = {
    mention: `<@${data.targetDiscordId}>`,
    user: truncate(escapeDiscordMarkdown(data.targetLabel), 100),
    moderator: truncate(escapeDiscordMarkdown(data.moderatorLabel), 100),
    reason: truncate(escapeDiscordMarkdown(data.reason), 500),
    duration: permanent ? PERMANENT_TEXT : formatDuration((data.durationSeconds ?? 0) * 1000),
    end_time: permanent ? PERMANENT_TEXT : discordTimestamp(data.endsAt as Date, 'f'),
    end_relative: permanent ? PERMANENT_TEXT : discordTimestamp(data.endsAt as Date, 'R'),
    pronoun: pronoun(data.gender ?? null),
  };

  const rendered = template
    .replace(/\{gendered:([^{}]*)\}/gu, (_match, body: string) => renderGendered(body, data.gender ?? null))
    // Unbekannte Platzhalter bleiben unveraendert stehen - das macht einen
    // Tippfehler in der Vorlage sichtbar, statt ihn stillschweigend zu
    // verschlucken.
    .replace(/\{([a-z_]+)\}/gu, (match, token: string) => values[token] ?? match);

  return truncate(rendered.trim(), MAX_RENDERED_LENGTH);
}

/**
 * Vorschau für das Dashboard.
 *
 * Verwendet Beispieldaten, damit sich eine Vorlage prüfen lässt, ohne jemanden
 * zu jailen. Erwähnungen erscheinen als lesbarer Name statt als rohe ID.
 */
export function previewJailTemplate(template: string, options: { permanent?: boolean } = {}): string {
  const permanent = options.permanent ?? false;
  const rendered = renderJailTemplate(template, {
    targetDiscordId: '000000000000000000',
    targetLabel: 'Beispiel',
    moderatorLabel: 'Moderator',
    reason: 'Spam im Chat',
    durationSeconds: permanent ? null : 2 * 60 * 60,
    endsAt: permanent ? null : new Date(Date.now() + 2 * 60 * 60 * 1000),
    gender: null,
  });
  return rendered
    .replace(/<@0{18}>/gu, '@Beispiel')
    .replace(/<t:(\d+):f>/gu, 'Heute um 18:30')
    .replace(/<t:(\d+):R>/gu, 'in 2 Stunden');
}

/**
 * Bestimmt das Geschlecht anhand der im Dashboard hinterlegten Rollen.
 *
 * Optional: sind keine Rollen konfiguriert, bleibt die Anrede neutral. Es gibt
 * bewusst keine Vermutung anhand des Namens.
 */
export function resolveGender(
  roleIds: readonly string[],
  config: { maleRoleId?: string | null; femaleRoleId?: string | null },
): JailGender {
  if (config.maleRoleId && roleIds.includes(config.maleRoleId)) {
    return 'MALE';
  }
  if (config.femaleRoleId && roleIds.includes(config.femaleRoleId)) {
    return 'FEMALE';
  }
  return null;
}
