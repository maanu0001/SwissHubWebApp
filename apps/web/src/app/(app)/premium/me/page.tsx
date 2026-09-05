import type { Metadata } from 'next';
import Link from 'next/link';
import { premium } from '@swisshub/modules';
import { formatChf, formatDateTime } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { PremiumSectionNav } from '@/modules/premium/components/section-nav';
import { SubscriptionActions } from '@/modules/premium/components/subscription-actions';
import { csrfTokenFor, requireMember } from '@/server/auth';
import { premiumSections } from '@/server/premium';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Mein Abo' };
export const dynamic = 'force-dynamic';

const datum = (wert: Date | null): string => (wert ? formatDateTime(wert) : '–');

const ZAHLUNG_LABEL: Record<string, string> = {
  PENDING: 'Ausstehend',
  PAID: 'Bezahlt',
  FAILED: 'Fehlgeschlagen',
  REFUNDED: 'Zurückerstattet',
};

/** Zustandspunkt: grün, wenn der Anspruch derzeit besteht. */
function Anspruch({ label, aktiv }: { label: string; aktiv: boolean }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={cn('size-2 rounded-full', aktiv ? 'bg-success' : 'bg-muted-foreground/40')}
          aria-hidden="true"
        />
        {aktiv ? 'Aktiv' : 'Nicht aktiv'}
      </span>
    </div>
  );
}

/**
 * Das eigene Abonnement.
 *
 * Bewusst im geschützten Bereich mit Seitenleiste: es ist Teil des eigenen
 * Kontos, kein Shop. Ein zweites Benutzerkonto gibt es nicht - hier steht der
 * bereits angemeldete Discord-Benutzer.
 */
export default async function PremiumMePage(): Promise<React.JSX.Element> {
  const context = await requireMember();
  const sections = <PremiumSectionNav sections={premiumSections(context)} />;

  const abo = await premium.getActiveSubscription(context.user.id);
  const zahlungen = await premium.listPayments({ userId: context.user.id, page: 1, pageSize: 10 });

  if (!abo) {
    return (
      <>
        {sections}
        <EmptyState
          title="Du hast noch kein Premium-Abo"
          description="Unterstütze SwissHub und sichere dir exklusive Vorteile für unsere Community."
          action={
            <Link href="/premium" className={cn(buttonVariants())}>
              Angebote ansehen
            </Link>
          }
        />
      </>
    );
  }

  const stuebli = await premium.getStuebli(context.user.id);
  const gilt = premium.grantsEntitlements(abo.status);
  const hat = (anspruch: 'PREMIUM_ROLE' | 'PREMIUM_STUEBLI_ROLE' | 'PRIVATE_VOICE'): boolean =>
    gilt && abo.product.entitlements.includes(anspruch);

  return (
    <>
      {sections}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-4 rounded-xl border border-border bg-card p-6 lg:col-span-2">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <DiscordAvatar
                discordId={context.user.discordId}
                avatarHash={context.user.avatarHash}
                name={context.user.displayName}
                size={40}
              />
              <div>
                <p className="font-semibold">{context.user.displayName}</p>
                <p className="text-xs text-muted-foreground">@{context.user.username}</p>
              </div>
            </div>
            <Badge variant={abo.status === 'ACTIVE' ? 'success' : gilt ? 'warning' : 'destructive'}>
              {premium.STATUS_LABEL[abo.status]}
            </Badge>
          </header>

          <div>
            <h2 className="text-lg font-semibold">{abo.product.name}</h2>
            <p className="text-sm text-muted-foreground">{abo.product.description}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {formatChf(abo.product.priceMinor)}{' '}
              <span className="text-sm font-normal text-muted-foreground">/ Monat</span>
            </p>
          </div>

          <dl className="grid gap-x-6 gap-y-1 border-t border-border/60 pt-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-muted-foreground">Beginn</dt>
              <dd>{datum(abo.currentPeriodStart)}</dd>
            </div>
            <div className="flex justify-between gap-3 py-1">
              <dt className="text-muted-foreground">
                {abo.status === 'CANCEL_AT_PERIOD_END' ? 'Vorteile bis' : 'Nächste Zahlung'}
              </dt>
              <dd>{datum(abo.currentPeriodEnd)}</dd>
            </div>
            {abo.cancelledAt ? (
              <div className="flex justify-between gap-3 py-1">
                <dt className="text-muted-foreground">Gekündigt am</dt>
                <dd>{datum(abo.cancelledAt)}</dd>
              </div>
            ) : null}
            {abo.graceUntil ? (
              <div className="flex justify-between gap-3 py-1">
                <dt className="text-muted-foreground">Schonfrist bis</dt>
                <dd>{datum(abo.graceUntil)}</dd>
              </div>
            ) : null}
          </dl>

          <SubscriptionActions
            subscriptionId={abo.id}
            csrfToken={csrfTokenFor(context)}
            cancelled={abo.status === 'CANCEL_AT_PERIOD_END'}
            periodEnd={abo.currentPeriodEnd ? formatDateTime(abo.currentPeriodEnd) : null}
          />
        </section>

        <section className="space-y-1 rounded-xl border border-border bg-card p-6 text-sm">
          <h2 className="mb-3 text-base font-semibold">Deine Discord-Vorteile</h2>
          <Anspruch label="Premium-Rolle" aktiv={hat('PREMIUM_ROLE')} />
          <Anspruch label="Premium-Stübli-Rolle" aktiv={hat('PREMIUM_STUEBLI_ROLE')} />
          <Anspruch label="Eigener Sprachkanal" aktiv={hat('PRIVATE_VOICE')} />

          {hat('PRIVATE_VOICE') ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
              <span className="text-muted-foreground">Dein Stübli</span>
              <span className="truncate font-medium">
                {stuebli?.state === 'ACTIVE' ? (stuebli.name ?? 'angelegt') : 'wird angelegt …'}
              </span>
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <span className="text-muted-foreground">Letzter Abgleich</span>
            <span>{datum(abo.lastSyncAt)}</span>
          </div>
          {abo.discordSyncStatus === 'FAILED' && abo.lastSyncError ? (
            <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              Der letzte Abgleich ist fehlgeschlagen: {abo.lastSyncError}
            </p>
          ) : null}
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Deine Zahlungen</h2>
        {zahlungen.rows.length === 0 ? (
          <EmptyState title="Noch keine Zahlungen" description="Hier erscheinen deine Belastungen." />
        ) : (
          <div className="relative overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Zahlungen deines Premium-Abos</caption>
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Datum
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Angebot
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Betrag
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Referenz
                  </th>
                </tr>
              </thead>
              <tbody>
                {zahlungen.rows.map((zahlung) => (
                  <tr key={zahlung.id} className="border-b border-border/40 last:border-0">
                    <td className="px-5 py-3">{datum(zahlung.paidAt ?? zahlung.createdAt)}</td>
                    <td className="px-5 py-3">{zahlung.productName ?? '–'}</td>
                    <td className="px-5 py-3 tabular-nums">{formatChf(zahlung.amountMinor)}</td>
                    <td className="px-5 py-3">
                      <Badge
                        variant={
                          zahlung.status === 'PAID'
                            ? 'success'
                            : zahlung.status === 'FAILED'
                              ? 'destructive'
                              : 'warning'
                        }
                      >
                        {ZAHLUNG_LABEL[zahlung.status]}
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
      </section>
    </>
  );
}
