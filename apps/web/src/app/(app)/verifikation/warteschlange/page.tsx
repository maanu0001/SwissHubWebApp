import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { getGuildConfig, isModuleEnabled, verification } from '@swisshub/modules';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState } from '@/components/shared/states';
import { Warteschlange } from '@/modules/verification/components/warteschlange';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Verifikation – Warteschlange' };
export const dynamic = 'force-dynamic';

const P = verification.VERIFICATION_PERMISSIONS;

/** Offene Fälle, live aktualisiert. */
export default async function WarteschlangePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission([P.review, P.approve]);

  if (!(await isModuleEnabled(verification.VERIFICATION_MODULE_ID))) {
    return <ErrorState title="Modul deaktiviert" description="Die Verifikation ist ausgeschaltet." />;
  }

  const [zeilen, settings, guild] = await Promise.all([
    verification.listQueue(100),
    verification.verificationSettings(),
    getGuildConfig(),
  ]);

  return (
    <>
      <PageHeader
        title="Warteschlange"
        description="Offene Verifikationen. Neue Fälle erscheinen von selbst - ohne Neuladen."
      />
      <Warteschlange
        csrfToken={csrfTokenFor(context)}
        guildId={guild.guildId ?? ''}
        verifikationsKanalId={settings.verificationChannelId}
        rechte={{
          approve: can(context, P.approve),
          reject: can(context, P.reject),
          ai: can(context, P.aiManage) && settings.aiEnabled,
        }}
        eintraege={zeilen.map((zeile) => ({
          ...zeile,
          status: zeile.status as 'WAITING_FOR_MESSAGE' | 'AI_ANALYZING' | 'WAITING_FOR_REVIEW',
          joinedAt: zeile.joinedAt.toISOString(),
          accountCreatedAt: zeile.accountCreatedAt?.toISOString() ?? null,
        }))}
      />
      <p className="text-xs text-muted-foreground">
        Ablehnen bedeutet einen Bann und erscheint im Moderation Center. Die AI kann ausschliesslich
        freischalten - sie lehnt nie ab.
      </p>
    </>
  );
}
