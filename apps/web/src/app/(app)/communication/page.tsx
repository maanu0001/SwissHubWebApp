import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { can } from '@swisshub/auth';
import { communication, getModuleSettings, isModuleEnabled } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorState } from '@/components/shared/states';
import { ComposeForm } from '@/modules/communication/components/compose-form';
import { CommunicationSectionNav } from '@/modules/communication/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { CommunicationHealth } from '@/modules/communication/components/health-panel';
import { communicationHealth, communicationSections } from '@/server/communication';
import { loadDiscordOptions } from '@/server/configuration';

export const metadata: Metadata = { title: 'Kommunikation' };
export const dynamic = 'force-dynamic';

/**
 * Nachricht erstellen.
 *
 * Die drei Nachrichtenarten teilen sich Formular und Vorschau; unterschiedlich
 * sind nur die Zusatzfelder und die nötige Berechtigung.
 */
/** Zeitpunkt als Wert für ein `datetime-local`-Feld (Europe/Zurich). */
function toLocalInput(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Zurich',
    dateStyle: 'short',
    timeStyle: 'short',
  })
    .format(value)
    .replace(' ', 'T');
}

/** Rollenfarbe von Discord (0 = keine) als CSS-Wert. */
const roleColor = (value: number): string | null =>
  value === 0 ? null : `#${value.toString(16).padStart(6, '0')}`;

/** Der gespeicherte Erwähnungstyp als Formularwert. */
const mentionValue = (type: string): string => {
  switch (type) {
    case 'EVERYONE':
      return 'everyone';
    case 'HERE':
      return 'here';
    case 'ROLE':
      return 'role';
    case 'USER':
      return 'user';
    default:
      return 'none';
  }
};

export default async function CommunicationPage({
  searchParams,
}: {
  searchParams: Promise<{ vorlage?: string; entwurf?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(communication.COMMUNICATION_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);
  const params = await searchParams;

  // Nichts davon darf das Öffnen der Seite verhindern. Ist Discord nicht
  // erreichbar, erscheint die Seite trotzdem - nur ohne die Angaben, die von
  // Discord kommen.
  const [enabled, settings, channels, options, template, health] = await Promise.all([
    isModuleEnabled(communication.COMMUNICATION_MODULE_ID),
    getModuleSettings<communication.CommunicationSettings>(communication.COMMUNICATION_MODULE_ID),
    communication.listSendableChannels('POLL').catch(() => []),
    loadDiscordOptions(),
    params.vorlage ? communication.getCommunicationMessage(params.vorlage) : Promise.resolve(null),
    communicationHealth().catch(() => ({ checks: [], discordReachable: false })),
  ]);

  // Entwürfe berühren Discord nicht und dürfen die Seite nie aufhalten.
  const drafts = can(context, communication.COMMUNICATION_PERMISSIONS.draft)
    ? await communication.listDrafts(context.user.discordId, 10).catch(() => [])
    : [];
  const loadedDraft = params.entwurf ? await communication.getDraft(params.entwurf).catch(() => null) : null;

  const sections = <CommunicationSectionNav sections={communicationSections(context)} />;

  if (!enabled) {
    return (
      <>
        {sections}
        <ErrorState
          title="Modul deaktiviert"
          description="Das Kommunikationsmodul ist derzeit deaktiviert."
        />
      </>
    );
  }

  const canNews = can(context, communication.COMMUNICATION_PERMISSIONS.news);
  const canEvent = can(context, communication.COMMUNICATION_PERMISSIONS.event);
  const canPoll = can(context, communication.COMMUNICATION_PERMISSIONS.poll);
  const canMention = can(context, communication.COMMUNICATION_PERMISSIONS.mention);

  /**
   * Eine frühere Nachricht als Vorlage.
   *
   * Übernommen wird alles, was sich wiederverwenden lässt - gesendet wird
   * dabei nichts. Das Datum bleibt bewusst leer: ein vergangener Termin wäre
   * beim erneuten Verwenden fast immer falsch.
   */
  /** Einen gespeicherten Entwurf ins Formular laden. */
  function fromDraft(draft: NonNullable<typeof loadedDraft>) {
    return {
      draftId: draft.id,
      title: draft.title,
      content: draft.content,
      bannerUrl: draft.bannerUrl,
      mention: mentionValue(draft.mentionType),
      mentionTarget: draft.mentionTarget ?? undefined,
      location: draft.eventLocation ?? undefined,
      // Anders als bei einer Vorlage bleibt hier das Datum erhalten - ein
      // Entwurf wurde ja mit Absicht so gespeichert.
      startsAtLocal: draft.eventStartsAt ? toLocalInput(draft.eventStartsAt) : undefined,
      registrationType: draft.registrationType,
      registrationValue: draft.registrationValue ?? undefined,
      responsibleDiscordId: draft.eventResponsibleId ?? undefined,
    };
  }

  function toTemplate(entry: NonNullable<typeof template>) {
    return {
      title: entry.title,
      content: entry.content,
      bannerUrl: entry.bannerUrl,
      mention: mentionValue(entry.mentionType),
      mentionTarget: entry.mentionTarget ?? undefined,
      location: entry.eventLocation ?? undefined,
      registrationType: entry.registrationType,
      registrationValue: entry.registrationValue ?? undefined,
      responsibleDiscordId: entry.eventResponsibleId ?? undefined,
    };
  }

  const shared = {
    csrfToken,
    channels: channels.map((entry) => ({
      id: entry.id,
      name: entry.name,
      parentName: entry.parentName,
      missing: entry.missing as string[],
    })),
    roles: options.roles.map((role) => ({
      id: role.id,
      name: role.name,
      color: roleColor(role.color),
    })),
    defaultChannelId: settings.defaultChannelId ?? null,
    footerText: settings.footerText,
    canMention,
    // @everyone erfordert beides: die eigene Berechtigung und die Einstellung.
    allowEveryone:
      settings.allowEveryoneMention && can(context, communication.COMMUNICATION_PERMISSIONS.mentionEveryone),
    currentUserName: context.user.displayName ?? context.user.username,
    canDraft: can(context, communication.COMMUNICATION_PERMISSIONS.draft),
    ticketChannel: settings.ticketChannelId
      ? (channels.find((entry) => entry.id === settings.ticketChannelId) ?? null)
      : null,
    template: loadedDraft ? fromDraft(loadedDraft) : template ? toTemplate(template) : null,
  };

  if (!canNews && !canEvent && !canPoll) {
    return (
      <>
        {sections}
        <ErrorState
          title="Keine Sendeberechtigung"
          description="Du darfst den Verlauf ansehen, aber keine Nachrichten senden."
        />
      </>
    );
  }

  return (
    <>
      {sections}

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

      <CommunicationHealth checks={health.checks} discordReachable={health.discordReachable} />

      {drafts.length > 0 ? (
        <section className="rounded-lg border border-border bg-card/60 p-4">
          <h3 className="text-sm font-semibold">Deine Entwürfe</h3>
          <ul className="mt-2 space-y-1.5">
            {drafts.map((draft) => (
              <li key={draft.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/communication?entwurf=${draft.id}`} className="font-medium hover:underline">
                  {draft.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {draft.type === 'NEWS' ? 'Neuigkeiten' : draft.type === 'EVENT' ? 'Event' : 'Umfrage'}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
