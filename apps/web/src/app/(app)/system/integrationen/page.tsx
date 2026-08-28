import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot, KeyRound, Plug, Sparkles, TriangleAlert } from 'lucide-react';
import { can } from '@swisshub/auth';
import { ai } from '@swisshub/modules';
import {
  AI_INTEGRATION_ID,
  DISCORD_INTEGRATION_ID,
  INTEGRATIONS,
  checkIntegrations,
  listBots,
  listEnvCandidates,
  readAllStatus,
  type IntegrationHealth,
} from '@swisshub/secrets';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { HealthBadge } from '@/modules/integrations/components/shared';
import { EnvUebernahme } from '@/modules/integrations/components/env-uebernahme';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Integrationen' };
export const dynamic = 'force-dynamic';

/**
 * Übersicht der Integrationen.
 *
 * Diese Seite zeigt Zustände und sonst nichts. Kein Wert, keine Maske eines
 * Werts, den man nicht ohnehin sehen dürfte - die Werte selbst stehen auf den
 * Unterseiten, und auch dort nur als Maske.
 *
 * Der Zustand entsteht aus zwei Quellen: was hinterlegt ist (Pflichtfelder
 * vorhanden?) und was der letzte Verbindungstest ergeben hat. Ohne Test steht
 * «Nicht eingerichtet» oder «Eingeschränkt», nie «Verbunden» - eine Zusage,
 * die niemand geprüft hat, wäre keine.
 */
export default async function IntegrationenPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  const darfImportieren = can(context, 'integrations.secrets.manage');

  const [bericht, status, bots, aiSettings, kandidaten] = await Promise.all([
    checkIntegrations(),
    readAllStatus(),
    listBots().catch(() => []),
    ai.readAiSettings(),
    darfImportieren ? listEnvCandidates() : Promise.resolve([]),
  ]);

  const statusVon = (providerId: string): IntegrationHealth => {
    const eintrag = bericht.eintraege.find((zeile) => zeile.integrationId === providerId);
    const gemessen = status.find((zeile) => zeile.provider === providerId);
    if (eintrag && !eintrag.vollstaendig) {
      return eintrag.essential ? 'ERROR' : 'NOT_CONFIGURED';
    }
    // Vollständig hinterlegt, aber nie geprüft: «eingeschränkt» statt
    // «verbunden» - wir wissen es schlicht nicht.
    return gemessen?.status ?? 'DEGRADED';
  };

  const detailVon = (providerId: string): string => {
    const eintrag = bericht.eintraege.find((zeile) => zeile.integrationId === providerId);
    if (eintrag && !eintrag.vollstaendig) {
      return `Fehlt: ${eintrag.fehlend.join(', ')}`;
    }
    const gemessen = status.find((zeile) => zeile.provider === providerId);
    return gemessen?.detail ?? 'Noch nicht getestet.';
  };

  const kacheln = [
    {
      id: DISCORD_INTEGRATION_ID,
      icon: <Bot />,
      href: '/system/integrationen/discord',
      zusatz: `${bots.filter((bot) => bot.hasToken).length} von ${bots.length} Bots mit Token`,
    },
    {
      id: AI_INTEGRATION_ID,
      icon: <Sparkles />,
      href: '/system/integrationen/ai',
      zusatz: aiSettings.enabled
        ? `${aiSettings.provider} · ${aiSettings.model}`
        : 'Ausgeschaltet',
    },
  ];

  return (
    <>
      {!bericht.masterKey ? (
        <section
          aria-label="Hauptschlüssel fehlt"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <TriangleAlert className="size-4" aria-hidden="true" />
            MASTER_ENCRYPTION_KEY ist nicht gesetzt
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Ohne diesen Schlüssel lassen sich keine Zugangsdaten verschlüsselt ablegen. Es gilt
            ausschliesslich, was in der Serverumgebung steht. Erzeugen mit{' '}
            <code className="font-mono">openssl rand -base64 32</code> und als{' '}
            <code className="font-mono">MASTER_ENCRYPTION_KEY</code> in die{' '}
            <code className="font-mono">.env</code> eintragen - siehe docs/INTEGRATIONS.md.
          </p>
        </section>
      ) : null}

      <section
        aria-label="Integrationen"
        className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]"
      >
        {kacheln.map((kachel) => {
          const definition = INTEGRATIONS.find((eintrag) => eintrag.id === kachel.id);
          if (!definition) {
            return null;
          }
          return (
            <article
              key={kachel.id}
              className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    {kachel.icon}
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold">{definition.label}</h2>
                    <p className="text-xs text-muted-foreground">{kachel.zusatz}</p>
                  </div>
                </div>
                <HealthBadge status={statusVon(kachel.id)} />
              </div>
              <p className="text-sm text-muted-foreground">{detailVon(kachel.id)}</p>
              <div className="mt-auto pt-1">
                <Button asChild variant="outline" size="sm">
                  <Link href={kachel.href}>Verwalten</Link>
                </Button>
              </div>
            </article>
          );
        })}
      </section>

      <Panel
        title="Discord-Bots"
        icon={<Bot />}
        description="Systembot und Musik-Bots mit ihrem zuletzt gemeldeten Zustand."
        action={{ label: 'Verwalten', href: '/system/integrationen/bots' }}
      >
        {bots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch kein Bot hinterlegt.</p>
        ) : (
          <ul className="space-y-2">
            {bots.map((bot) => (
              <li
                key={bot.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{bot.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {bot.botUsername ?? bot.slug}
                    {bot.lastLoginAt
                      ? ` · zuletzt verbunden ${new Date(bot.lastLoginAt).toLocaleString('de-CH')}`
                      : ' · noch nie verbunden'}
                  </p>
                </div>
                <HealthBadge status={bot.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {darfImportieren ? (
        <EnvUebernahme
          csrfToken={csrfToken}
          kandidaten={kandidaten.map((kandidat) => ({ ...kandidat }))}
        />
      ) : null}

      <Panel title="Wie Geheimnisse hier gespeichert werden" icon={<KeyRound />}>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Tokens und Schlüssel liegen mit AES-256-GCM verschlüsselt in der Datenbank. Der
            Hauptschlüssel steht ausschliesslich in der Serverumgebung, wird nie angezeigt und nie
            gespeichert - ohne ihn sind die Werte absichtlich nicht lesbar.
          </p>
          <p>
            Im Dashboard erscheint nie ein vollständiger Wert, sondern höchstens die letzten vier
            Zeichen. Für eine Sicherung braucht es beides: die Datenbank <em>und</em> den
            Hauptschlüssel.
          </p>
          <p className="flex items-center gap-1.5">
            <Plug className="size-4 shrink-0" aria-hidden="true" />
            Einzelheiten: <code className="font-mono">docs/INTEGRATIONS.md</code>
          </p>
        </div>
      </Panel>
    </>
  );
}
