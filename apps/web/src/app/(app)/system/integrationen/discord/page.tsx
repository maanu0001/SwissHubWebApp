import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Bot } from 'lucide-react';
import { can } from '@swisshub/auth';
import { appUrl } from '@swisshub/config';
import { DISCORD_INTEGRATION_ID, describe, getIntegration } from '@swisshub/secrets';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { SecretFeld } from '@/modules/integrations/components/secret-feld';
import { TestKnopf } from '@/modules/integrations/components/test-knopf';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Discord-Integration' };
export const dynamic = 'force-dynamic';

/**
 * Discord: Bot-Token, Client ID und Client Secret.
 *
 * Was die Seite lädt, ist ausschliesslich `describe()` - eine Auskunft ohne
 * Werte. Ein Server Component rendert seine Daten in die Seite; stünde hier
 * `getSecret()`, läge das Token im ausgelieferten HTML (§20). Es gibt in
 * dieser Datei keinen Aufruf, der einen Klartext beschaffen könnte.
 */
export default async function DiscordIntegrationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  const darfAendern =
    can(context, 'integrations.secrets.manage') && can(context, 'integrations.discord.manage');

  const definition = getIntegration(DISCORD_INTEGRATION_ID);
  const felder = await describe(DISCORD_INTEGRATION_ID);

  return (
    <>
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/system/integrationen">
            <ArrowLeft aria-hidden="true" />
            Zurück zu den Integrationen
          </Link>
        </Button>
      </div>

      <Panel
        title="Discord-Anwendung"
        icon={<Bot />}
        description="Zugangsdaten aus dem Discord Developer Portal. Der Bot-Token wird vor dem Übernehmen bei Discord geprüft."
      >
        <div className="space-y-3">
          {felder.map((feld) => {
            const katalog = definition?.fields.find((eintrag) => eintrag.key === feld.key);
            return (
              <SecretFeld
                key={feld.key}
                integrationId={DISCORD_INTEGRATION_ID}
                csrfToken={csrfToken}
                darfAendern={darfAendern}
                feld={{
                  ...feld,
                  ...(katalog?.description ? { description: katalog.description } : {}),
                  updatedAt: feld.updatedAt ? feld.updatedAt.toISOString() : null,
                }}
              />
            );
          })}
        </div>

        <div className="mt-5 border-t border-border/60 pt-4">
          <TestKnopf integrationId={DISCORD_INTEGRATION_ID} csrfToken={csrfToken} />
        </div>
      </Panel>

      <Panel title="OAuth" description="Wie sich Mitglieder am Dashboard anmelden.">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Redirect URI</dt>
            <dd className="mt-1">
              <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {appUrl('/api/auth/callback/discord')}
              </code>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Scopes</dt>
            <dd className="mt-1">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">identify</code>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Die Redirect URI ergibt sich aus <code className="font-mono">NEXT_PUBLIC_APP_URL</code> und
          ist bewusst nicht hier einstellbar: sie muss mit der Adresse übereinstimmen, unter der die
          WebApp tatsächlich erreichbar ist, und diese kennt nur der Betrieb. Sie gehört im Discord
          Developer Portal unter OAuth2 → Redirects eingetragen.
        </p>
      </Panel>
    </>
  );
}
