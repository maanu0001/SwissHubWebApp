import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { can } from '@swisshub/auth';
import { ensureSystemBot, listBots } from '@swisshub/secrets';
import { Button } from '@/components/ui/button';
import { BotListe } from '@/modules/integrations/components/bot-liste';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Discord-Bots' };
export const dynamic = 'force-dynamic';

/**
 * Die hinterlegten Discord-Bots.
 *
 * Geladen wird ausschliesslich `listBots()`: Name, Kurzname, Anwendungs-ID,
 * Zustand und ob ein Token vorhanden ist. Das Token selbst kommt hier nicht
 * vor - `BotZeile` hat kein Feld dafür, es liesse sich also gar nicht
 * versehentlich mitrendern.
 */
export default async function BotsPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  const darfAendern =
    can(context, 'integrations.discord.manage') && can(context, 'integrations.secrets.manage');

  await ensureSystemBot().catch(() => null);
  const bots = await listBots();

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

      <BotListe
        csrfToken={csrfToken}
        darfAendern={darfAendern}
        bots={bots.map((bot) => ({
          id: bot.id,
          kind: bot.kind,
          label: bot.label,
          slug: bot.slug,
          clientId: bot.clientId,
          botUsername: bot.botUsername,
          status: bot.status,
          lastError: bot.lastError,
          lastCheckedAt: bot.lastCheckedAt ? bot.lastCheckedAt.toISOString() : null,
          lastLoginAt: bot.lastLoginAt ? bot.lastLoginAt.toISOString() : null,
          hasToken: bot.hasToken,
        }))}
      />

      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          Der Systembot dient zugleich als Musik-Controller: er betritt den Sprachkanal unter dem
          Namen, den alle ohnehin kennen, und braucht dafür keine zweite Discord-Anwendung.
        </p>
        <p>
          Jeder <strong>Worker</strong> dagegen braucht eine eigene Anwendung. Zwei Bots mit
          demselben Token können nicht gleichzeitig in verschiedenen Kanälen spielen - ein Bot ist
          je Server immer nur in einem Sprachkanal.
        </p>
      </div>
    </>
  );
}
