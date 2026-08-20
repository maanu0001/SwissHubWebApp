import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { spielersuche } from '@swisshub/modules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { SendOnboardingButton } from '@/modules/spielersuche/components/onboarding-preview';
import { SpielersucheSectionNav } from '@/modules/spielersuche/components/section-nav';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { spielersucheSections } from '@/server/spielersuche';

export const metadata: Metadata = { title: 'Onboarding' };
export const dynamic = 'force-dynamic';

/**
 * Tägliche Hinweisnachricht.
 *
 * Inhalt und Zeitpunkt werden in den Moduleinstellungen gepflegt; hier stehen
 * die Vorschau und der Sofortversand.
 */
export default async function OnboardingPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(spielersuche.SPIELERSUCHE_PERMISSIONS.onboardingManage);
  const csrfToken = csrfTokenFor(context);

  const [runtime, options] = await Promise.all([
    spielersuche.loadSpielersucheContext(),
    loadDiscordOptions(),
  ]);
  const settings = runtime.settings;
  const message = spielersuche.buildOnboardingMessage(runtime);

  const channelId = settings.onboardingChannelId ?? settings.searchChannelId ?? null;
  const channelName = channelId
    ? (options.channels.find((entry) => entry.id === channelId)?.name ?? channelId)
    : null;

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Die tägliche Nachricht, die erklärt, wie die Spielersuche funktioniert."
        actions={<SendOnboardingButton csrfToken={csrfToken} disabled={!channelId} />}
      />
      <SpielersucheSectionNav sections={spielersucheSections(context)} />

      {!settings.onboardingEnabled ? (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Der automatische Versand ist ausgeschaltet. Einschalten lässt er sich in den{' '}
            <Link href={`/modules/${spielersuche.SPIELERSUCHE_MODULE_ID}`} className="underline">
              Moduleinstellungen
            </Link>
            . Die Testnachricht funktioniert trotzdem.
          </span>
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Vorschau</CardTitle>
            <CardDescription>So erscheint die Nachricht auf Discord.</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="rounded-md border-l-4 bg-secondary/40 p-4"
              style={{ borderLeftColor: settings.accentColor }}
            >
              <p className="font-semibold">{message.title}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{message.description}</p>
              {message.bannerUrl ? (
                // Frei konfigurierbare Adresse - deshalb ohne `next/image`.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={message.bannerUrl}
                  alt=""
                  className="mt-3 max-h-48 w-full rounded object-cover"
                  loading="lazy"
                />
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">{message.footerText}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Zeitplan</CardTitle>
            <CardDescription>Ausgewertet in der Zeitzone Europe/Zurich.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label="Automatisch" value={settings.onboardingEnabled ? 'aktiv' : 'aus'} />
              <Row label="Uhrzeit" value={`${settings.onboardingTime} Uhr`} />
              <Row label="Channel" value={channelName ? `#${channelName}` : 'nicht gewählt'} />
              <Row label="Banner" value={message.bannerUrl ? 'gesetzt' : 'kein Bild'} />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Titel, Text, Banner und Uhrzeit werden in den{' '}
              <Link href={`/modules/${spielersuche.SPIELERSUCHE_MODULE_ID}`} className="underline">
                Moduleinstellungen
              </Link>{' '}
              gepflegt.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
