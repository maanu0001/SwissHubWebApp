import type { ChannelKind } from '@swisshub/discord';

/**
 * Feldbeschreibung für Moduleinstellungen.
 *
 * Ein Modul beschreibt seine Einstellungen einmal - Validierung (Zod) und
 * Oberfläche (generische Settings-UI) entstehen daraus. Dadurch braucht ein
 * neues Modul keine eigene Einstellungsseite mehr, und im Dashboard gibt es
 * statt ID-Eingabefeldern echte Auswahllisten mit Rollen und Channels.
 */
export type SettingsFieldType =
  | 'discord-role'
  | 'discord-role-list'
  | 'discord-channel'
  | 'discord-channel-list'
  | 'boolean'
  | 'number'
  | 'duration'
  | 'text'
  | 'textarea';

interface SettingsFieldBase {
  key: string;
  label: string;
  description?: string;
  /** Abschnitt in der Oberfläche, z.B. `Discord` oder `Verhalten`. */
  group?: string;
  required?: boolean;
  placeholder?: string;
}

export interface DiscordRoleField extends SettingsFieldBase {
  type: 'discord-role' | 'discord-role-list';
  /** Muss der Bot die Rolle vergeben können? (Hierarchieprüfung beim Speichern) */
  mustBeManageable?: boolean;
}

export interface DiscordChannelField extends SettingsFieldBase {
  type: 'discord-channel' | 'discord-channel-list';
  /** Erlaubte Channel-Arten - die Auswahl zeigt nur passende Einträge. */
  channelKinds?: ChannelKind[];
}

export interface BooleanField extends SettingsFieldBase {
  type: 'boolean';
}

export interface NumberField extends SettingsFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface DurationField extends SettingsFieldBase {
  type: 'duration';
  /** Grenzen in Sekunden. */
  min?: number;
  max?: number;
  /** Vorschläge in Sekunden. */
  presets?: number[];
}

export interface TextField extends SettingsFieldBase {
  type: 'text' | 'textarea';
  maxLength?: number;
}

export type SettingsField =
  DiscordRoleField | DiscordChannelField | BooleanField | NumberField | DurationField | TextField;

export const isRoleField = (field: SettingsField): field is DiscordRoleField =>
  field.type === 'discord-role' || field.type === 'discord-role-list';

export const isChannelField = (field: SettingsField): field is DiscordChannelField =>
  field.type === 'discord-channel' || field.type === 'discord-channel-list';

export const isListField = (field: SettingsField): boolean =>
  field.type === 'discord-role-list' || field.type === 'discord-channel-list';

/** Gruppiert Felder für die Darstellung (Reihenfolge bleibt erhalten). */
export function groupFields(
  fields: readonly SettingsField[],
): Array<{ group: string; fields: SettingsField[] }> {
  const groups: Array<{ group: string; fields: SettingsField[] }> = [];
  for (const field of fields) {
    const name = field.group ?? 'Allgemein';
    const existing = groups.find((entry) => entry.group === name);
    if (existing) {
      existing.fields.push(field);
    } else {
      groups.push({ group: name, fields: [field] });
    }
  }
  return groups;
}
