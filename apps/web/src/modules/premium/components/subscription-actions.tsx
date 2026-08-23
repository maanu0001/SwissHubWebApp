'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  cancelSubscriptionAction,
  resumeSubscriptionAction,
  syncOwnEntitlementsAction,
} from '@/modules/premium/actions';

/**
 * Aktionen am eigenen Abonnement.
 *
 * Die Kündigung ist bewusst hinter einem Bestätigungsdialog: sie ist zwar
 * umkehrbar, solange die Periode läuft, aber kein Klick, der versehentlich
 * passieren sollte.
 */
export function SubscriptionActions({
  subscriptionId,
  csrfToken,
  cancelled,
  periodEnd,
}: {
  subscriptionId: string;
  csrfToken: string;
  cancelled: boolean;
  periodEnd: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<'cancel' | 'resume' | 'sync' | null>(null);
  const [dialog, setDialog] = useState(false);

  async function kuendigen(): Promise<void> {
    setPending('cancel');
    const response = await cancelSubscriptionAction({ csrfToken, subscriptionId });
    if (response.ok) {
      toast.success(
        periodEnd
          ? `Gekündigt. Deine Vorteile bleiben bis ${periodEnd} bestehen.`
          : 'Dein Abonnement wurde gekündigt.',
      );
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
    setPending(null);
  }

  async function fortsetzen(): Promise<void> {
    setPending('resume');
    const response = await resumeSubscriptionAction({ csrfToken, subscriptionId });
    if (response.ok) {
      toast.success('Deine Kündigung wurde zurückgenommen.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
    setPending(null);
  }

  async function abgleichen(): Promise<void> {
    setPending('sync');
    const response = await syncOwnEntitlementsAction({ csrfToken });
    if (response.ok && response.data.ok) {
      toast.success('Deine Discord-Vorteile wurden abgeglichen.');
      router.refresh();
    } else {
      toast.error(
        response.ok ? (response.data.error ?? 'Der Abgleich ist fehlgeschlagen.') : response.error.message,
      );
    }
    setPending(null);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={abgleichen} disabled={pending !== null}>
        {pending === 'sync' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Discord abgleichen
      </Button>

      {cancelled ? (
        <Button onClick={fortsetzen} disabled={pending !== null}>
          {pending === 'resume' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Kündigung zurücknehmen
        </Button>
      ) : (
        <>
          <Button variant="outline" onClick={() => setDialog(true)} disabled={pending !== null}>
            {pending === 'cancel' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Abonnement kündigen
          </Button>
          <ConfirmationDialog
            open={dialog}
            onOpenChange={setDialog}
            title="Abonnement wirklich kündigen?"
            description={
              periodEnd
                ? `Deine Vorteile bleiben bis ${periodEnd} bestehen. Danach werden Rolle und Stübli entfernt.`
                : 'Deine Vorteile bleiben bis zum Ende der bezahlten Periode bestehen.'
            }
            confirmLabel="Jetzt kündigen"
            onConfirm={kuendigen}
          />
        </>
      )}
    </div>
  );
}
