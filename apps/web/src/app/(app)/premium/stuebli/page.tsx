import type { Metadata } from 'next';
import { premium } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { can } from '@swisshub/auth';
import { Badge } from '@/components/ui/badge';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { StuebliRepairButton } from '@/modules/premium/components/stuebli-actions';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';
import { premiumSections } from '@/server/premium';

export const metadata: Metadata = { title: 'Premium-Stübli' };
export const dynamic = 'force-dynamic';

const ZUSTAND: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  ACTIVE: { label: 'Aktiv', variant: 'success' },
  PENDING: { label: 'Wird angelegt', variant: 'warning' },
  FAILED: { label: 'Fehler', variant: 'destructive' },
  REMOVING: { label: 'Wird entfernt', variant: 'warning' },
  REMOVED: { label: 'Entfernt', variant: 'secondary' },
};

/** Übersicht aller persönlichen Sprachkanäle. */
export default async function PremiumStuebliPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(premium.PREMIUM_PERMISSIONS.view);
  const eintraege = await premium.listStuebli();
  const darfVerwalten = can(context, premium.PREMIUM_PERMISSIONS.stuebliManage);

  return (
    <>
      <PremiumSectionNav sections={premiumSections(context)} />

      {eintraege.length === 0 ? (
        <EmptyState
          title="Noch keine Stübli"
          description="Sobald jemand ein Angebot mit eigenem Sprachkanal bucht, erscheint es hier."
        />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Premium-Stübli</caption>
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <th scope="col" className="px-5 py-3 font-semibold">Mitglied</th>
                <th scope="col" className="px-5 py-3 font-semibold">Angebot</th>
                <th scope="col" className="px-5 py-3 font-semibold">Kanal</th>
                <th scope="col" className="px-5 py-3 font-semibold">Kanal-ID</th>
                <th scope="col" className="px-5 py-3 font-semibold">Zustand</th>
                <th scope="col" className="px-5 py-3 font-semibold">Letzter Abgleich</th>
                {darfVerwalten ? <th scope="col" className="px-5 py-3 font-semibold">Aktion</th> : null}
              </tr>
            </thead>
            <tbody>
              {eintraege.map((eintrag) => {
                const zustand = ZUSTAND[eintrag.state] ?? ZUSTAND.PENDING!;
                return (
                  <tr key={eintrag.id} className="border-b border-border/40 last:border-0">
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-2">
                        <DiscordAvatar
                          discordId={eintrag.discordId}
                          avatarHash={eintrag.avatarHash}
                          name={eintrag.username ?? eintrag.discordId}
                          size={24}
                        />
                        {eintrag.username ?? eintrag.discordId}
                      </span>
                    </td>
                    <td className="px-5 py-3">{eintrag.productName ?? '–'}</td>
                    <td className="px-5 py-3">{eintrag.channelName ?? '–'}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {eintrag.channelId ?? '–'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={zustand.variant}>{zustand.label}</Badge>
                      {eintrag.lastSyncError ? (
                        <p className="mt-1 max-w-[22rem] text-xs text-destructive">
                          {eintrag.lastSyncError}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      {eintrag.lastSyncAt ? formatDateTime(eintrag.lastSyncAt) : '–'}
                    </td>
                    {darfVerwalten ? (
                      <td className="px-5 py-3">
                        <StuebliRepairButton userId={eintrag.userId} csrfToken={csrfTokenFor(context)} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
