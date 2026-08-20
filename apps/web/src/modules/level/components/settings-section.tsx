import { groupFields, level, readModuleSettings, type SettingsField } from '@swisshub/modules';
import { can } from '@swisshub/auth';
import type { AuthContext } from '@swisshub/auth';
import { SettingsForm } from '@/modules/configuration/components/settings-form';
import { loadDiscordOptions } from '@/server/configuration';

/**
 * Ausschnitt der Moduleinstellungen als eigene Seite.
 *
 * Die Unterseiten "XP-Regeln", "Voice XP" und "Inaktivität" zeigen jeweils
 * einen Teil derselben Einstellungen. Sie benutzen bewusst dasselbe Formular
 * wie die allgemeine Einstellungsseite - es gibt nur einen Weg zu speichern
 * und damit nur eine Validierung.
 */
export async function LevelSettingsSection({
  context,
  csrfToken,
  groups: wanted,
}: {
  context: AuthContext;
  csrfToken: string;
  groups: readonly string[];
}): Promise<React.JSX.Element> {
  const fields: SettingsField[] = level.levelSettingsFields.filter((field) =>
    wanted.includes(field.group ?? 'Allgemein'),
  );

  const [options, values] = await Promise.all([
    loadDiscordOptions(),
    readModuleSettings<Record<string, unknown>>(level.LEVEL_MODULE_ID),
  ]);

  return (
    <SettingsForm
      moduleId={level.LEVEL_MODULE_ID}
      csrfToken={csrfToken}
      groups={groupFields(fields)}
      values={values}
      roles={options.roles}
      channels={options.channels}
      disabled={!can(context, level.LEVEL_PERMISSIONS.settingsManage)}
    />
  );
}
