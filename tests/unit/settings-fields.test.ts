import { describe, expect, it } from 'vitest';
import { groupFields, isChannelField, isListField, isRoleField, type SettingsField } from '@swisshub/modules';

/**
 * Feldbeschreibungen der generischen Einstellungsoberfläche.
 *
 * Sie bestimmen, welche Auswahlliste im Dashboard erscheint - ein Fehler hier
 * würde bedeuten, dass wieder Discord-IDs eingetippt werden müssten.
 */
const FIELDS: SettingsField[] = [
  { key: 'jailRoleId', type: 'discord-role', label: 'Jail-Rolle', group: 'Discord', mustBeManageable: true },
  { key: 'keepRoleIds', type: 'discord-role-list', label: 'Rollen behalten', group: 'Discord' },
  { key: 'logChannelId', type: 'discord-channel', label: 'Log', group: 'Discord', channelKinds: ['text'] },
  { key: 'enabled', type: 'boolean', label: 'Aktiv', group: 'Verhalten' },
  { key: 'note', type: 'text', label: 'Notiz' },
];

describe('Settings-Felder', () => {
  it('erkennt Rollen- und Channel-Felder', () => {
    expect(FIELDS.filter(isRoleField).map((field) => field.key)).toEqual(['jailRoleId', 'keepRoleIds']);
    expect(FIELDS.filter(isChannelField).map((field) => field.key)).toEqual(['logChannelId']);
  });

  it('erkennt Mehrfachauswahlen', () => {
    expect(FIELDS.filter(isListField).map((field) => field.key)).toEqual(['keepRoleIds']);
  });

  it('gruppiert in Reihenfolge des Auftretens und nutzt "Allgemein" als Standard', () => {
    const groups = groupFields(FIELDS);
    expect(groups.map((group) => group.group)).toEqual(['Discord', 'Verhalten', 'Allgemein']);
    expect(groups[0]?.fields).toHaveLength(3);
    expect(groups[2]?.fields[0]?.key).toBe('note');
  });
});
