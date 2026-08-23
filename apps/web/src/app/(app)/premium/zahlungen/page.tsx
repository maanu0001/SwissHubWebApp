import type { Metadata } from 'next';
import { premium } from '@swisshub/modules';
import { formatChf, formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/states';
import { Pagination } from '@/components/shared/pagination';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { premiumSections } from '@/server/premium';

export const metadata: Metadata = { title: 'Zahlungen' };
export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = {
  PENDING: 'Ausstehend',
  PAID: 'Bezahlt',
  FAILED: 'Fehlgeschlagen',
  REFUNDED: 'Zurückerstattet',
};

/**
 * Zahlungen aller Mitglieder.
 *
 * Angezeigt wird ausschliesslich, was zur Nachvollziehbarkeit nötig ist. Der
 * Verweis des Anbieters steht gekürzt da; Zahlungsmittel-Daten liegen gar nicht
 * erst in dieser Anwendung.
 */
export default async function PremiumPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ seite?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(premium.PREMIUM_PERMISSIONS.paymentsView);
  const { seite } = await searchParams;
  const nummer = Number.parseInt(seite ?? '1', 10);

  const ergebnis = await premium.listPayments({
    page: Number.isFinite(nummer) && nummer > 0 ? nummer : 1,
    pageSize: 30,
  });

  return (
    <>
      <PremiumSectionNav sections={premiumSections(context)} />

      {ergebnis.rows.length === 0 ? (
        <EmptyState title="Noch keine Zahlungen" description="Hier erscheinen alle Belastungen." />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Premium-Zahlungen</caption>
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <th scope="col" className="px-5 py-3 font-semibold">Datum</th>
                <th scope="col" className="px-5 py-3 font-semibold">Mitglied</th>
                <th scope="col" className="px-5 py-3 font-semibold">Angebot</th>
                <th scope="col" className="px-5 py-3 font-semibold">Betrag</th>
                <th scope="col" className="px-5 py-3 font-semibold">Anbieter</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                <th scope="col" className="px-5 py-3 font-semibold">Referenz</th>
              </tr>
            </thead>
            <tbody>
              {ergebnis.rows.map((zahlung) => (
                <tr key={zahlung.id} className="border-b border-border/40 last:border-0">
                  <td className="px-5 py-3">
                    {formatDateTime(zahlung.paidAt ?? zahlung.failedAt ?? zahlung.createdAt)}
                  </td>
                  <td className="px-5 py-3">{zahlung.username ?? '–'}</td>
                  <td className="px-5 py-3">{zahlung.productName ?? '–'}</td>
                  <td className="px-5 py-3 tabular-nums">{formatChf(zahlung.amountMinor)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{zahlung.provider}</td>
                  <td className="px-5 py-3">
                    <Badge
                      variant={
                        zahlung.status === 'PAID'
                          ? 'success'
                          : zahlung.status === 'FAILED'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {LABEL[zahlung.status] ?? zahlung.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {zahlung.providerPaymentId?.slice(0, 24) ?? '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ergebnis.total > 30 ? (
        <Pagination
          page={nummer}
          totalPages={Math.ceil(ergebnis.total / 30)}
          total={ergebnis.total}
          buildHref={(s) => `/premium/zahlungen?seite=${s}`}
        />
      ) : null}
    </>
  );
}
