import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { can } from '@swisshub/auth';
import { communication, getModuleSettings, isModuleEnabled } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/shared/states';
import { ComposeForm } from '@/modules/communication/components/compose-form';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Kommunikation' };
export const dynamic = 'force-dynamic';

/**
 * Nachricht erstellen.
 *
 * Die drei Nachrichtenarten teilen sich Formular und Vorschau; unterschiedlich
 * sind nur die Zusatzfelder und die nötige Berechtigung.
 */
export default async function CommunicationPage({
  searchParams,
}: {
  searchParams: Promise<{ vorlage?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(communication.COMMUNICATION_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);
  const params = await searchParams;

  const [enabled, settings, channels, options, template] = await Promise.all([
    isModuleEnabled(communication.COMMUNICATION_MODULE_ID),
    getModuleSettings<communication.CommunicationSettings>(communication.COMMUNICATION_MODULE_ID),
    communication.listSendableChannels('POLL').catch(() => []),
    loadDiscordOptions(),
    params.vorlage ? communication.getCommunicationMessage(params.vorlage) : Promise.resolve(null),
  ]);

  if (!enabled) {
    return (
      <ErrorState title="Modul deaktiviert" description="Das Kommunikationsmodul ist derzeit deaktiviert." />
    );
  }

  const canNews = can(context, communication.COMMUNICATION_PERMISSIONS.news);
  const canEvent = can(context, communication.COMMUNICATION_PERMISSIONS.event);
  const canPoll = can(context, communication.COMMUNICATION_PERMISSIONS.poll);
  const canMention = can(context, communication.COMMUNICATION_PERMISSIONS.mention);

  const shared = {
    csrfToken,
    channels: channels.map((entry) => ({
      id: entry.id,
      name: entry.name,
      parentName: entry.parentName,
      missing: entry.missing as string[],
    })),
    roles: options.roles.map((role) => ({ id: role.id, name: role.name })),
    defaultChannelId: settings.defaultChannelId ?? null,
    footerText: settings.footerText,
    canMention,
    allowEveryone: settings.allowEveryoneMention,
    template: template
      ? { title: template.title, content: template.content, bannerUrl: template.bannerUrl }
      : null,
  };

  if (!canNews && !canEvent && !canPoll) {
    return (
      <ErrorState
        title="Keine Sendeberechtigung"
        description="Du darfst den Verlauf ansehen, aber keine Nachrichten senden."
      />
    );
  }

  return (
    <>
      {template ? (
        <p className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Vorlage aus einer früheren Nachricht geladen. Es wird nichts automatisch erneut gesendet -{' '}
            <Link href="/communication" className="underline">
              zurücksetzen
            </Link>
            .
          </span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Neue Nachricht erstellen</CardTitle>
          <CardDescription>
            Der Bot sendet als {settings.footerText.split('•')[0]?.trim() || 'SwissHub'}. Die Vorschau zeigt,
            wie das Embed auf Discord aussieht.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={canNews ? 'news' : canEvent ? 'event' : 'poll'}>
            <TabsList>
              {canNews ? <TabsTrigger value="news">Neuigkeiten</TabsTrigger> : null}
              {canEvent ? <TabsTrigger value="event">Event</TabsTrigger> : null}
              {canPoll ? <TabsTrigger value="poll">Umfrage</TabsTrigger> : null}
            </TabsList>

            {canNews ? (
              <TabsContent value="news" className="pt-6">
                <ComposeForm {...shared} type="NEWS" />
              </TabsContent>
            ) : null}
            {canEvent ? (
              <TabsContent value="event" className="pt-6">
                <ComposeForm {...shared} type="EVENT" />
              </TabsContent>
            ) : null}
            {canPoll ? (
              <TabsContent value="poll" className="pt-6">
                <ComposeForm {...shared} type="POLL" />
              </TabsContent>
            ) : null}
          </Tabs>
        </CardContent>
      </Card>
    </>
  );
}
