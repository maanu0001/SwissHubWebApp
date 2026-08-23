import type { Metadata } from 'next';
import Link from 'next/link';
import { premium } from '@swisshub/modules';
import { formatChf, formatDateTime } from '@swisshub/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { Pagination } from '@/components/shared/pagination';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { requirePagePermission } from '@/server/auth';
import { premiumSections } from '@/server/premium';

export const metadata: Metadata = { title: 'Abonnements' };
export const dynamic = 'force-dynamic';

const datum = (wert: Date | null): string => (wert ? formatDateTime(wert) : '–');

/**
 * Alle Abonnements.
 *
 * Filter und Suche laufen über die Adresszeile - dadurch bleibt ein Stand
 * teilbar und der Zurück-Knopf tut, was er soll.
 */
export default async function PremiumSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(premium.PREMIUM_PERMISSIONS.view);
  const params = await searchParams;

  const seite = Number.parseInt(params.seite ?? '1', 10);
  const ergebnis = await premium.listSubscriptions({
    search: params.suche?.trim() || undefined,
    productId: params.angebot || undefined,
    status: (params.status as never) || undefined,
    syncFailed: params.sync === 'fehler',
    withStuebli: params.stuebli === 'ja',
    page: Number.isFinite(seite) && seite > 0 ? seite : 1,
    pageSize: 25,
  });

  const angebote = await premium.listAllProducts();

  return (
    <>
      <PremiumSectionNav sections={premiumSections(context)} />

      <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" action="/premium/abos">
        <Input name="suche" placeholder="Name oder Discord-ID" defaultValue={params.suche ?? ''} />
        <select
          name="angebot"
          defaultValue={params.angebot ?? ''}
          className="h-10 rounded-lg border border-border bg-card/70 px-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Angebot"
        >
          <option value="">Alle Angebote</option>
          {angebote.map((angebot) => (
            <option key={angebot.id} value={angebot.id}>
              {angebot.name}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={params.status ?? ''}
          className="h-10 rounded-lg border border-border bg-card/70 px-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Status"
        >
          <option value="">Alle Zustände</option>
          {Object.entries(premium.STATUS_LABEL).map(([wert, label]) => (
            <option key={wert} value={wert}>
              {label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filtern
        </Button>
      </form>

      {ergebnis.rows.length === 0 ? (
        <EmptyState title="Keine Abonnements" description="Für diese Auswahl gibt es keine Einträge." />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Premium-Abonnements</caption>
            <thead>
              <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <th scope="col" className="px-5 py-3 font-semibold">Mitglied</th>
                <th scope="col" className="px-5 py-3 font-semibold">Angebot</th>
                <th scope="col" className="px-5 py-3 font-semibold">Preis</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                <th scope="col" className="px-5 py-3 font-semibold">Beginn</th>
                <th scope="col" className="px-5 py-3 font-semibold">Nächste Zahlung</th>
                <th scope="col" className="px-5 py-3 font-semibold">Discord</th>
                <th scope="col" className="px-5 py-3 font-semibold">Stübli</th>
              </tr>
            </thead>
            <tbody>
              {ergebnis.rows.map((row) => (
                <tr key={row.subscription.id} className="border-b border-border/40 last:border-0">
                  <td className="px-5 py-3">
                    <Link
                      href={`/members/${row.subscription.discordId}`}
                      className="inline-flex min-h-6 items-center gap-2 font-medium hover:underline"
                    >
                      <DiscordAvatar
                        discordId={row.subscription.discordId}
                        avatarHash={row.avatarHash}
                        name={row.username}
                        size={24}
                      />
                      {row.username}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{row.subscription.product.name}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {formatChf(row.subscription.product.priceMinor)}
                  </td>
                  <td className="px-5 py-3">
                    <Badge
                      variant={
                        row.subscription.status === 'ACTIVE'
                          ? 'success'
                          : premium.grantsEntitlements(row.subscription.status)
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {premium.STATUS_LABEL[row.subscription.status]}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">{datum(row.subscription.currentPeriodStart)}</td>
                  <td className="px-5 py-3">{datum(row.subscription.currentPeriodEnd)}</td>
                  <td className="px-5 py-3">
                    <Badge
                      variant={
                        row.subscription.discordSyncStatus === 'SYNCED'
                          ? 'success'
                          : row.subscription.discordSyncStatus === 'FAILED'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {row.subscription.discordSyncStatus === 'SYNCED'
                        ? 'Abgeglichen'
                        : row.subscription.discordSyncStatus === 'FAILED'
                          ? 'Fehler'
                          : 'Ausstehend'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{row.stuebliName ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ergebnis.total > ergebnis.pageSize ? (
        <Pagination
          page={ergebnis.page}
          totalPages={Math.ceil(ergebnis.total / ergebnis.pageSize)}
          total={ergebnis.total}
          buildHref={(seite) => {
            const suche = new URLSearchParams(
              Object.entries(params).filter(([, wert]) => wert !== undefined) as [string, string][],
            );
            suche.set('seite', String(seite));
            return `/premium/abos?${suche.toString()}`;
          }}
        />
      ) : null}
    </>
  );
}
