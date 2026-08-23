import type { Metadata } from 'next';
import { AlertTriangle, CreditCard, Crown, Mic, TrendingUp, UserMinus, Users } from 'lucide-react';
import { isModuleEnabled, premium } from '@swisshub/modules';
import { formatChf } from '@swisshub/shared';
import { StatCard } from '@/components/shared/stat-card';
import { ErrorState } from '@/components/shared/states';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { premiumSections } from '@/server/premium';

export const metadata: Metadata = { title: 'Premium' };
export const dynamic = 'force-dynamic';

/** Kennzahlen des Premium-Moduls. */
export default async function PremiumOverviewPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission(premium.PREMIUM_PERMISSIONS.view);
  const sections = <PremiumSectionNav sections={premiumSections(context)} />;

  if (!(await isModuleEnabled(premium.PREMIUM_MODULE_ID))) {
    return (
      <>
        {sections}
        <ErrorState
          title="Modul deaktiviert"
          description="SwissHub Premium ist abgeschaltet. Unter Module lässt es sich einschalten."
        />
      </>
    );
  }

  const kennzahlen = await premium.getPremiumOverview();

  return (
    <>
      {sections}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aktive Abonnements"
          value={String(kennzahlen.activeSubscriptions)}
          icon={<Users />}
        />
        <StatCard
          label="MRR"
          value={formatChf(kennzahlen.mrrMinor)}
          hint="monatlich wiederkehrend"
          icon={<TrendingUp />}
        />
        <StatCard
          label="Premium-Mitglieder"
          value={String(kennzahlen.premiumMembers)}
          icon={<Crown />}
        />
        <StatCard
          label="Stübli-Mitglieder"
          value={String(kennzahlen.stuebliMembers)}
          hint={`${kennzahlen.activeStuebli} Kanäle aktiv`}
          icon={<Mic />}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Bundle-Mitglieder" value={String(kennzahlen.bundleMembers)} icon={<Crown />} />
        <StatCard
          label="Fehlgeschlagene Zahlungen"
          value={String(kennzahlen.failedPayments)}
          tone={kennzahlen.failedPayments > 0 ? 'warning' : 'default'}
          icon={<CreditCard />}
        />
        <StatCard
          label="Kündigungen"
          value={String(kennzahlen.cancellations)}
          hint="laufen bis Periodenende"
          icon={<UserMinus />}
        />
        <StatCard
          label="Discord-Sync-Fehler"
          value={String(kennzahlen.syncErrors)}
          tone={kennzahlen.syncErrors > 0 ? 'destructive' : 'default'}
          icon={<AlertTriangle />}
        />
      </div>
    </>
  );
}
