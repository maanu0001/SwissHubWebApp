import type { Metadata } from 'next';
import { automation, isModuleEnabled } from '@swisshub/modules';
import { ErrorState } from '@/components/shared/states';
import { Builder, LEERER_ENTWURF } from '@/modules/automation/components/builder';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { ladeBausteine } from '@/server/automation';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Neue Automation' };
export const dynamic = 'force-dynamic';

const P = automation.AUTOMATION_PERMISSIONS;

export default async function NeueAutomationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.create]);

  if (!(await isModuleEnabled(automation.AUTOMATION_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Automation Engine ist ausgeschaltet." />;
  }

  const [bausteine, discordOptions] = await Promise.all([ladeBausteine(), loadDiscordOptions()]);

  return (
    <Builder
      csrfToken={csrfTokenFor(context)}
      bausteine={bausteine}
      roles={discordOptions.roles}
      channels={discordOptions.channels}
      entwurf={LEERER_ENTWURF}
      eigeneRechte={context.permissionKeys}
      darfSpeichern
    />
  );
}
