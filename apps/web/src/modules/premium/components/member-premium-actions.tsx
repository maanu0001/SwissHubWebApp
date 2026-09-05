'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { adminEndSubscriptionAction, adminSyncMemberAction } from '@/modules/premium/actions';

/**
 * Verwaltungsaktionen am Abonnement eines fremden Mitglieds.
 *
 * Beide Aktionen prüfen serverseitig eine eigene Berechtigung; die Knöpfe
 * hier werden nur zusätzlich ausgeblendet, damit niemand ins Leere klickt.
 * Das administrative Beenden verlangt einen Grund - er landet im Audit-Log
 * und ist der einzige Weg, den Vorgang später nachzuvollziehen.
 */
export function MemberPremiumActions({
  csrfToken,
  userId,
  subscriptionId,
  memberLabel,
  canSync,
  canEnd,
}: {
  csrfToken: string;
  userId: string;
  subscriptionId: string | null;
  memberLabel: string;
  canSync: boolean;
  canEnd: boolean;
}): React.JSX.Element | null {
  const router = useRouter();
  const [pending, setPending] = useState<'sync' | 'end' | null>(null);
  const [dialog, setDialog] = useState(false);
  const [grund, setGrund] = useState('');

  if (!canSync && !(canEnd && subscriptionId)) {
    return null;
  }

  async function abgleichen(): Promise<void> {
    setPending('sync');
    const response = await adminSyncMemberAction({ csrfToken, userId });
    if (response.ok && response.data.ok) {
      toast.success(`Discord-Vorteile von ${memberLabel} abgeglichen.`);
      router.refresh();
    } else {
      toast.error(
        response.ok ? (response.data.error ?? 'Der Abgleich ist fehlgeschlagen.') : response.error.message,
      );
    }
    setPending(null);
  }

  async function beenden(): Promise<void> {
    if (!subscriptionId) {
      return;
    }
    if (grund.trim().length < 3) {
      toast.error('Bitte einen Grund angeben.');
      // Der Wurf hält den Dialog offen und die Eingabe erhalten.
      throw new Error('Grund fehlt');
    }
    setPending('end');
    const response = await adminEndSubscriptionAction({
      csrfToken,
      subscriptionId,
      reason: grund.trim(),
    });
    if (response.ok) {
      toast.success('Das Abonnement wurde beendet.');
      setGrund('');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
    setPending(null);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canSync ? (
        <Button variant="outline" size="sm" onClick={abgleichen} disabled={pending !== null}>
          {pending === 'sync' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Discord abgleichen
        </Button>
      ) : null}

      {canEnd && subscriptionId ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setDialog(true)} disabled={pending !== null}>
            {pending === 'end' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Abonnement beenden
          </Button>
          <ConfirmationDialog
            open={dialog}
            onOpenChange={setDialog}
            title="Abonnement administrativ beenden?"
            description={`Das Abonnement von ${memberLabel} endet sofort. Rolle und Stübli werden anschliessend entfernt. Dieser Schritt lässt sich nicht rückgängig machen.`}
            confirmLabel="Jetzt beenden"
            destructive
            onConfirm={beenden}
          >
            <div className="space-y-2 text-left">
              <Label htmlFor="premium-end-reason">Grund (wird protokolliert)</Label>
              <Textarea
                id="premium-end-reason"
                value={grund}
                onChange={(event) => setGrund(event.target.value)}
                maxLength={300}
                rows={3}
                placeholder="z. B. Rückbuchung nach Zahlungsstreit"
              />
            </div>
          </ConfirmationDialog>
        </>
      ) : null}
    </div>
  );
}
