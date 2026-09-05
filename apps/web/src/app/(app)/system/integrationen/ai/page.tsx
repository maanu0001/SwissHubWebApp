import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { can } from '@swisshub/auth';
import { ai, isModuleEnabled, verification } from '@swisshub/modules';
import { AI_INTEGRATION_ID, AI_MODEL_SUGGESTIONS, describe, getIntegration } from '@swisshub/secrets';
import { Panel } from '@/components/shared/panel';
import { Button } from '@/components/ui/button';
import { SecretFeld } from '@/modules/integrations/components/secret-feld';
import { TestKnopf } from '@/modules/integrations/components/test-knopf';
import { AiEinstellungen } from '@/modules/integrations/components/ai-einstellungen';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'AI-Integration' };
export const dynamic = 'force-dynamic';

/**
 * Die zentrale AI-Anbindung.
 *
 * Ein Anbieter, ein Schlüssel, ein Modell - für alle Module. Ein Modul, das
 * eine AI nutzt, hat kein eigenes Schlüsselfeld; es entscheidet nur, ob es
 * diese Anbindung verwendet und wie es mit dem Ergebnis umgeht (§27/§28).
 */
export default async function AiIntegrationPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('integrations.view');
  const csrfToken = csrfTokenFor(context);
  const darfAendern = can(context, 'integrations.ai.manage');
  const darfSecrets = darfAendern && can(context, 'integrations.secrets.manage');

  const definition = getIntegration(AI_INTEGRATION_ID);
  const [felder, settings, verifikationAn] = await Promise.all([
    describe(AI_INTEGRATION_ID),
    ai.readAiSettings(),
    isModuleEnabled(verification.VERIFICATION_MODULE_ID).catch(() => false),
  ]);

  const verifikationSettings = verifikationAn
    ? await verification.verificationSettings().catch(() => null)
    : null;

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
        title="AI-Anbieter"
        icon={<Sparkles />}
        description="Gilt für alle Module. Der Schlüssel wird verschlüsselt gespeichert und nie angezeigt."
      >
        <div className="space-y-3">
          {felder.map((feld) => {
            const katalog = definition?.fields.find((eintrag) => eintrag.key === feld.key);
            return (
              <SecretFeld
                key={feld.key}
                integrationId={AI_INTEGRATION_ID}
                csrfToken={csrfToken}
                darfAendern={darfSecrets}
                feld={{
                  ...feld,
                  ...(katalog?.description ? { description: katalog.description } : {}),
                  updatedAt: feld.updatedAt ? feld.updatedAt.toISOString() : null,
                }}
              />
            );
          })}
        </div>

        <div className="mt-5 space-y-5 border-t border-border/60 pt-5">
          <AiEinstellungen
            csrfToken={csrfToken}
            darfAendern={darfAendern}
            daten={settings}
            vorschlaege={AI_MODEL_SUGGESTIONS}
          />
          <TestKnopf integrationId={AI_INTEGRATION_ID} csrfToken={csrfToken} />
        </div>
      </Panel>

      <Panel title="Wer diese Anbindung nutzt">
        <ul className="space-y-2 text-sm">
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3">
            <div className="min-w-0">
              <p className="font-medium">Verifikation</p>
              <p className="text-xs text-muted-foreground">
                Ordnet die Nachricht neuer Mitglieder ein. Kann ausschliesslich freischalten oder an die
                Moderation abgeben - niemals ablehnen oder bannen.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {!verifikationAn
                ? 'Modul aus'
                : verifikationSettings?.aiEnabled
                  ? verifikationSettings.aiAutoVerify
                    ? `Aktiv, schaltet ab ${Math.round(verifikationSettings.aiThreshold * 100)} % selbst frei`
                    : 'Aktiv, schlägt nur vor'
                  : 'AI im Modul aus'}
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          Ein Modul entscheidet selbst, <em>ob</em> es die AI nutzt und was aus dem Ergebnis folgt. Anbieter,
          Schlüssel und Modell kommen ausschliesslich von dieser Seite.
        </p>
      </Panel>
    </>
  );
}
