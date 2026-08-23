import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { premium } from '@swisshub/modules';
import { formatChf } from '@swisshub/shared';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Willkommen bei SwissHub Premium' };
export const dynamic = 'force-dynamic';

/**
 * Nach der Zahlung.
 *
 * Der Erfolg wird ausschliesslich anhand des Datenbankzustands angezeigt - und
 * der entsteht nur aus einem geprüften Ereignis des Zahlungsanbieters. Kommt
 * der Browser hier an, bevor der Webhook eingetroffen ist, steht das auch so
 * da: «Zahlung wird bestätigt» statt eines Erfolgs, den niemand geprüft hat.
 */
export default async function PremiumSuccessPage(): Promise<React.JSX.Element> {
  const context = await getOptionalAuthContext();
  if (!context?.isMember) {
    redirect('/login?redirect=/premium/erfolg');
  }

  const abo = await premium.getActiveSubscription(context.user.id);
  const bezahlt = abo !== null && premium.grantsEntitlements(abo.status);
  const stuebli = abo ? await premium.getStuebli(context.user.id) : null;
  const brauchtStuebli = abo?.product.entitlements.includes('PRIVATE_VOICE') ?? false;

  return (
    <div className="mx-auto max-w-lg space-y-6 text-center">
      {bezahlt ? (
        <>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-7" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Willkommen bei SwissHub Premium</h1>
            <p className="text-muted-foreground">Danke für deine Unterstützung.</p>
          </div>
        </>
      ) : (
        <>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-warning/15 text-warning">
            <Loader2 className="size-7 animate-spin" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Zahlung wird bestätigt</h1>
            <p className="text-muted-foreground">
              Sobald unser Zahlungsanbieter die Zahlung bestätigt hat, werden deine Vorteile
              freigeschaltet. Das dauert in der Regel nur einen Moment.
            </p>
          </div>
        </>
      )}

      {abo ? (
        <dl className="space-y-2 rounded-xl border border-border bg-card p-5 text-left text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Angebot</dt>
            <dd className="font-medium">{abo.product.name}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Preis</dt>
            <dd className="tabular-nums">{formatChf(abo.product.priceMinor)} / Monat</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Status</dt>
            <dd>{premium.STATUS_LABEL[abo.status]}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Discord</dt>
            <dd>
              {abo.discordSyncStatus === 'SYNCED'
                ? 'Vorteile eingerichtet'
                : 'Deine Discord-Vorteile werden gerade eingerichtet.'}
            </dd>
          </div>
          {brauchtStuebli ? (
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Dein Stübli</dt>
              <dd>{stuebli?.state === 'ACTIVE' ? (stuebli.name ?? 'angelegt') : 'wird angelegt …'}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/premium/me" className={cn(buttonVariants())}>
          Mein Abo
        </Link>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: 'outline' }))}>
          Zum Dashboard
        </Link>
      </div>
    </div>
  );
}
